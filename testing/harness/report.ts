// Artifacts and console reporting.

import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { renderMarkdown } from "./transcript";
// No SDK import here by design: runtime.ts and judge.ts are the only modules that
// touch the Agent SDK. (The DKB original imported SDKMessage and mistyped the
// param below, which never surfaced because that repo had no typecheck step.)
import type { CapturedMessage, GateResult, ScenarioResult } from "./types";
import type { TurnView } from "./types";
import type { ScenarioDefinition } from "./types";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

const ARTIFACTS_ROOT = path.resolve(import.meta.dir, "..", "artifacts");

// The artifacts dir is created up front so partial flushes (below) have a home
// from turn 1; a run that times out or is killed still leaves evidence.
export async function createArtifactsDir(name: string): Promise<string> {
  const stamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d+Z$/, "Z");
  const dir = path.join(ARTIFACTS_ROOT, `${name}-${stamp}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

// Flushed after every completed turn. Overwritten by the final writeArtifacts;
// `partial: true` marks a summary from a run that never reached the end.
export async function writePartialArtifacts(
  dir: string,
  name: string,
  transcript: CapturedMessage[],
  turns: TurnView[],
  gates: GateResult[],
): Promise<void> {
  await writeFile(path.join(dir, "transcript.json"), JSON.stringify(transcript, null, 2));
  await writeFile(path.join(dir, "transcript.md"), renderMarkdown(name, turns));
  await writeFile(
    path.join(dir, "summary.json"),
    JSON.stringify({ scenario: name, partial: true, completedTurns: turns.length, gates }, null, 2),
  );
}

export async function writeArtifacts(name: string, result: ScenarioResult, dir?: string): Promise<string> {
  if (!dir) dir = await createArtifactsDir(name);

  await writeFile(path.join(dir, "transcript.json"), JSON.stringify(result.transcript, null, 2));
  await writeFile(path.join(dir, "transcript.md"), renderMarkdown(name, result.turns));
  await writeFile(
    path.join(dir, "summary.json"),
    JSON.stringify(
      {
        scenario: name,
        pass: result.pass,
        gates: result.gates,
        stats: result.stats,
        gradeVerdict: result.gradeVerdict,
        error: result.error,
      },
      null,
      2,
    ),
  );
  return dir;
}

/**
 * What an offline judge needs that the transcript does not hold (S1).
 *
 * The user turns go into the session and are never echoed back as SDK messages, so
 * `transcript.json` has none of them. The SDK emits `system/init` on every turn, not only
 * on a new session, so it cannot mark a fresh thread either. And the graph's face lives in
 * the sandbox, not the artifacts. Gates never missed any of this, because they run live
 * against in-memory turn views and the sandbox itself. The judge reads only the stored
 * record, so the record has to be complete.
 */
export interface RunRecord {
  scenario: string;
  workingDirectory: string;
  agent: {
    model: string;
    systemPrompt?: string;
    tools: string[];
    skills?: string[] | "all";
    /** Program names on the agent's PATH, without platform twins (`x.cmd` is `x`). */
    installed: string[];
  };
  turns: { user: string; freshThread: boolean }[];
  /** Every graph's `.md` face in the sandbox when this was written, keyed by relative path. */
  faces: Record<string, string>;
}

/** Written at the start of a run and after every turn, so a killed run still leaves one. */
export function writeRunRecord(dir: string, def: ScenarioDefinition, sandbox: string): void {
  const record: RunRecord = {
    scenario: def.name,
    workingDirectory: sandbox,
    agent: {
      model: def.agent.model,
      systemPrompt: def.agent.systemPrompt,
      tools: def.agent.tools ?? ["Bash", "Read"],
      skills: def.agent.skills,
      installed: [...new Set(Object.keys(def.agent.install ?? {}).map((n) => n.replace(/\.(cmd|bat|exe)$/i, "")))],
    },
    turns: def.turns.map((t) => ({ user: t.user, freshThread: t.freshThread === true })),
    faces: faces(sandbox),
  };
  writeFileSync(path.join(dir, "run.json"), JSON.stringify(record, null, 2));
}

/** The `.md` beside every `.sqlite` under `sandbox`, LF-normalized. */
function faces(sandbox: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(sandbox)) return out;
  for (const entry of readdirSync(sandbox, { recursive: true }) as string[]) {
    const rel = String(entry).replaceAll("\\", "/");
    if (!rel.endsWith(".sqlite")) continue;
    const face = rel.replace(/\.sqlite$/, ".md");
    const abs = path.join(sandbox, face);
    if (existsSync(abs)) out[face] = readFileSync(abs, "utf8").replaceAll("\r\n", "\n");
  }
  return out;
}

export function printReport(name: string, result: ScenarioResult): void {
  const s = result.stats;
  console.log(`\n=== ${name}: ${result.pass ? "PASS" : "FAIL"} ===`);
  for (const g of result.gates) {
    const where = g.turn >= 0 ? `turn ${g.turn + 1}` : "grade";
    console.log(`  [${g.pass ? "pass" : "FAIL"}] (${where}) ${g.label}`);
  }
  if (result.error) console.log(`  runtime error: ${result.error}`);

  console.log("  --- stats ---");
  console.log(`  user turns:            ${s.turns}`);
  console.log(`  agent turns/message:   ${s.agentTurnsPerMessage.join(", ") || "-"}`);
  console.log(`  tool calls:            ${s.toolCallCount} (${s.bashCommandCount} bash)`);
  const exits = Object.entries(s.bashExitCodes).map(([c, n]) => `${c}×${n}`).join(", ");
  console.log(`  bash exit codes:       ${exits || "n/a"}`);
  console.log(
    `  tokens:                in ${s.totalInputTokens}, out ${s.totalOutputTokens}, cache read ${s.totalCacheReadTokens}, cache create ${s.totalCacheCreationTokens}`,
  );
  console.log(`  cost:                  $${s.totalCostUsd.toFixed(4)}`);
  console.log(
    `  wall clock:            ${(s.wallClockMsTotal / 1000).toFixed(1)}s total (per turn: ${s.wallClockMsPerTurn.map((ms) => (ms / 1000).toFixed(1) + "s").join(", ")})`,
  );
  console.log(`  artifacts:             ${result.artifactsDir}`);
}
