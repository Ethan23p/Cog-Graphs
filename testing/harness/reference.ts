// Reference conversations for the rubric layer, and the builder that turns one into a
// stored run the judge view can render.
//
// A reference is written by hand: what the User said, what the assistant said, and what it
// ran. The builder executes every command against the real engine, in a real directory, and
// records what came back, so the tool results and the final face the judge reads are ones
// the engine produced. A reference whose command the engine now refuses fails to build,
// loudly, rather than showing a judge a conversation that could not have happened.
//
// The stored run it writes is the same pair of files a live run leaves behind
// (transcript.json and run.json), so a reference and a real run reach the judge by the same
// path, through renderJudgeView.

import { existsSync, readdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { writeRunRecord } from "./report";
import type { ScenarioDefinition } from "./types";

const ENGINE = process.env.COG_CLI_ENTRY ?? path.resolve(import.meta.dir, "..", "..", "engine", "main.ts");

/**
 * One thing the assistant does.
 * - `say`: prose to the User.
 * - `run`: a Bash command. `cog-graphs …` runs against the engine; `ls` lists the working
 *   directory. `exit` is the exit code the reference expects, 0 unless given.
 * - `write`: the Write tool, a file in the working directory.
 */
export type Step = { say: string } | { run: string; exit?: number } | { write: string; content: string };

export interface ReferenceTurn {
  user: string;
  freshThread?: boolean;
  steps: Step[];
}

export interface Reference {
  id: string;
  /** The scenario this conversation stands in for, as the judge's preamble names it. */
  scenario: string;
  agent: { systemPrompt: string; tools: string[]; installed: string[] };
  turns: ReferenceTurn[];
}

export function buildReference(ref: Reference, sandbox: string, artifactDir: string): void {
  if (!existsSync(ENGINE)) throw new Error(`engine entry point not found: ${ENGINE}`);
  const messages: unknown[] = [];
  let toolId = 0;

  for (const turn of ref.turns) {
    for (const step of turn.steps) {
      if ("say" in step) {
        messages.push(assistant({ type: "text", text: step.say }));
        continue;
      }
      const id = `${ref.id}-tool-${++toolId}`;
      if ("write" in step) {
        const abs = path.join(sandbox, step.write);
        writeFileSync(abs, step.content);
        messages.push(assistant({ type: "tool_use", id, name: "Write", input: { file_path: abs, content: step.content } }));
        messages.push(result(id, `File created successfully at: ${abs}`, false));
        continue;
      }
      const { output, exitCode } = execute(step.run, sandbox);
      const expected = step.exit ?? 0;
      if (exitCode !== expected) {
        throw new Error(`${ref.id}: \`${step.run}\` exited ${exitCode}, the reference says ${expected}:\n${output}`);
      }
      messages.push(assistant({ type: "tool_use", id, name: "Bash", input: { command: step.run } }));
      messages.push(result(id, exitCode === 0 ? output : `Exit code ${exitCode}\n${output}`, exitCode !== 0));
    }
    messages.push({ type: "result", subtype: "success" });
  }

  writeFileSync(
    path.join(artifactDir, "transcript.json"),
    JSON.stringify(
      messages.map((message, seq) => ({ seq, ts: "2026-09-11T00:00:00.000Z", message })),
      null,
      2,
    ),
  );
  const def: ScenarioDefinition = {
    name: ref.scenario,
    agent: {
      model: "claude-sonnet-5",
      systemPrompt: ref.agent.systemPrompt,
      tools: ref.agent.tools,
      install: Object.fromEntries(ref.agent.installed.map((n) => [n, ""])),
    },
    turns: ref.turns.map((t) => ({ user: t.user, freshThread: t.freshThread })),
  };
  writeRunRecord(artifactDir, def, sandbox);
}

function assistant(block: Record<string, unknown>) {
  return { type: "assistant", parent_tool_use_id: null, message: { content: [block] } };
}

function result(id: string, content: string, isError: boolean) {
  return {
    type: "user",
    parent_tool_use_id: null,
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] },
  };
}

function execute(command: string, cwd: string): { output: string; exitCode: number } {
  const argv = words(command);
  if (argv.length === 1 && argv[0] === "ls") {
    const names = readdirSync(cwd).filter((n) => !n.startsWith(".")).sort();
    return { output: names.join("\n"), exitCode: 0 };
  }
  if (argv[0] !== "cog-graphs") throw new Error(`a reference can run \`cog-graphs …\` or \`ls\`, not: ${command}`);
  const proc = Bun.spawnSync(["bun", ENGINE, ...argv.slice(1)], { cwd, stdout: "pipe", stderr: "pipe" });
  const output = [proc.stdout.toString(), proc.stderr.toString()]
    .map((s) => s.replaceAll("\r\n", "\n").trimEnd())
    .filter(Boolean)
    .join("\n");
  return { output, exitCode: proc.exitCode ?? -1 };
}

/** POSIX-shell word splitting, for the quoting a reference uses: '…' and "…". */
function words(command: string): string[] {
  const out: string[] = [];
  let word = "";
  let started = false;
  let quote: string | null = null;
  for (const ch of command) {
    if (quote) {
      if (ch === quote) quote = null;
      else word += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started) out.push(word);
      word = "";
      started = false;
    } else {
      word += ch;
      started = true;
    }
  }
  if (quote) throw new Error(`unclosed quote in: ${command}`);
  if (started) out.push(word);
  return out;
}
