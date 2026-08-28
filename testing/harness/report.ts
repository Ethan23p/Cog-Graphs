// Artifacts and console reporting.

import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { renderMarkdown } from "./transcript";
// No SDK import here by design: runtime.ts and judge.ts are the only modules that
// touch the Agent SDK. (The DKB original imported SDKMessage and mistyped the
// param below, which never surfaced because that repo had no typecheck step.)
import type { CapturedMessage, GateResult, ScenarioResult } from "./types";
import type { TurnView } from "./types";

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
