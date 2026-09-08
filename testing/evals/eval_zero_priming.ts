// RU-3 — zero-priming fluency, scored pass^k with k=3.
//
//   "an agent given only the binary name and a goal — no skill, no primer — reaches
//    a working graph."
//
// This is the one case whose whole claim is *reliability*, which is why it is pass^k:
// three independent runs, all of which must succeed. A capability that works two
// times in three is not the property the doc asserts ("an AI Agent should be able to
// pick it up with zero priming and get to a fluent level of control").
//
//   bun run eval:zero-priming
//
// This is the spec's second layer. Never edited to fit the engine — see
// testing/DISPUTES.md.

import { runScenario, type ScenarioDefinition } from "../harness/runtime";
import { storeEntities, storeItem } from "../tests/helpers";
import { IN_LOOP_MODEL, putBinOnPath, findGraphs } from "./eval-support";

putBinOnPath();

const K = 3;

function attempt(i: number): ScenarioDefinition {
  return {
    name: `zero-priming-${i + 1}`,
    agent: {
      model: IN_LOOP_MODEL,
      // Deliberately bare: no plugin, no skill, no systemPrompt. Everything the
      // agent learns, it learns from the CLI's own self-documentation. If this
      // passes only with the skill loaded, the CLI is not self-documenting — it is
      // merely documented elsewhere.
      tools: ["Bash", "Read"],
      maxTurnsPerMessage: 30,
      maxBudgetUsd: 2.0,
    },
    haltOnGateFailure: true,
    timeoutMs: 10 * 60_000,
    turns: [
      {
        user:
          "There's a command-line tool called `cog-graphs` available in this environment. I'd like a " +
          "persistent record of the books I'm reading, kept in this directory — start it off with " +
          "Piranesi, Blindsight, and The Dispossessed, and note for each one whether I've finished it. " +
          "I've finished Piranesi only.",
        gate: async (ctx) => {
          const dir = ctx.sandboxPath(".");
          const graphs = findGraphs(dir);
          ctx.assert(graphs.length === 1, `exactly one graph was created (found: ${graphs.join(", ") || "none"})`);
          if (graphs.length !== 1) return;
          const ns = graphs[0]!;

          const entities = storeEntities(dir, ns);
          ctx.assert(entities.length === 3, `all three books were stored (got ${entities.length}: ${entities.join(", ")})`);
          for (const e of entities) {
            ctx.assert(Object.keys(storeItem(dir, ns, e)).length > 0, `'${e}' carries at least one attribute`);
          }
          // Reached it through the tool, not around it.
          const ran = ctx.lastTurn.bashCommands.join("\n");
          ctx.assert(/cog-graphs/.test(ran), "the agent used the CLI");
          ctx.assert(/--help/.test(ran), "the agent probed `--help` before committing to a command shape");
        },
      },
    ],
  };
}

const results = [];
for (let i = 0; i < K; i++) {
  console.error(`\n=== RU-3 attempt ${i + 1}/${K} ===`);
  results.push(await runScenario(attempt(i)));
}

const passes = results.filter((r) => r.pass).length;
const pass = passes === K;
console.error(
  `\nRU-3 zero-priming fluency: ${pass ? "PASS" : "FAIL"} — pass^${K} scored ${passes}/${K}.\n` +
    (pass ? "" : "A single failure fails this case: the claim is reliability, not capability.\n") +
    results.map((r, i) => `  attempt ${i + 1}: ${r.pass ? "pass" : "FAIL"} — ${r.artifactsDir}`).join("\n"),
);
process.exit(pass ? 0 : 1);
