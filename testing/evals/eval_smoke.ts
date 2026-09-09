// Smoke eval — validates the harness itself, no Cog-Graphs dependency.
// Proves: session persistence across turns, gating, transcript capture,
// stats, sandbox isolation, and auth (testing/harness/IMPLEMENTATION.md E5).
//
// It also produces the transcript that `bun run verify:claims` reads to
// re-verify E1–E4 offline, so this is the cheapest way to refresh those.

import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { runScenario, type ScenarioDefinition } from "../harness/runtime";

const FIXTURES = path.resolve(import.meta.dir, "fixtures", "smoke");
const NOTES_FIRST_LINE = "A Cog Graph is a persistent, structured store of information.";

async function readOrNull(p: string): Promise<string | null> {
  try {
    return await readFile(p, "utf8");
  } catch {
    return null;
  }
}

// G1: normalize line endings and trailing newline; the content itself must be
// exact. Without this, turn 1 fails on Windows — which makes this eval the
// standing regression test for that gotcha.
const norm = (s: string) => s.replaceAll("\r\n", "\n").replace(/\n+$/, "");

const scenario: ScenarioDefinition = {
  name: "smoke",
  sandbox: { fixtures: FIXTURES },
  agent: {
    model: "claude-haiku-4-5-20251001",
    systemPrompt:
      "You are operating in a scratch working directory. Do exactly what the user asks, using shell commands. Be brief.",
    tools: ["Bash", "Read"],
    maxTurnsPerMessage: 15,
    maxBudgetUsd: 0.5,
  },
  haltOnGateFailure: false,
  turns: [
    {
      user: "Create a file named greeting.txt in the current directory containing exactly the text: hello cog-graphs",
      gate: async (ctx) => {
        const content = await readOrNull(ctx.sandboxPath("greeting.txt"));
        ctx.assert(content !== null, "greeting.txt exists");
        ctx.assert(
          content !== null && norm(content) === "hello cog-graphs",
          "greeting.txt contains exactly 'hello cog-graphs'",
        );
      },
    },
    {
      user: "Now append the first line of notes.txt to greeting.txt, as a second line. Do not modify notes.txt.",
      gate: async (ctx) => {
        const content = await readOrNull(ctx.sandboxPath("greeting.txt"));
        ctx.assert(
          content !== null && norm(content) === `hello cog-graphs\n${NOTES_FIRST_LINE}`,
          "greeting.txt is exactly the two expected lines",
        );
        const notesNow = await readFile(ctx.sandboxPath("notes.txt"));
        const notesFixture = await readFile(path.join(FIXTURES, "notes.txt"));
        ctx.assert(notesNow.equals(notesFixture), "notes.txt is byte-identical to the fixture");
      },
    },
  ],
};

const result = await runScenario(scenario);
process.exit(result.pass ? 0 : 1);
