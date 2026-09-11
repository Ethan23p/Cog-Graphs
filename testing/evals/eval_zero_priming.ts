// Zero-priming fluency — RU-3's scenario, scored pass^3.
//
// The doc: "The CLI should be feature complete and totally self-documenting,
// self-contained; an AI Agent should be able to pick it up with zero priming and get to a
// fluent level of control." RU-3 is the one case whose whole claim is reliability, so it runs
// three independent trials and every one of them has to pass.
//
// WHAT ZERO PRIMING MEANS HERE. The agent is told the binary is on its PATH and nothing else:
// no skill, no primer, no grammar, no example. Everything it learns about the interface it
// learns from `--help` and from the CLI's own answers, which is why `--help` is a deliverable
// rather than documentation. That is the same modelling of "installed" the Walking Skeleton
// uses, and the sentence is deliberately identical.
//
// THE DOMAIN IS NOT ONE THE CLI EVER MENTIONS. The primer and every `--help` example were
// made domain-neutral on 2026-09-11 (my-list, First item, status=open), and the Walking
// Skeleton is about games. Houseplants appear nowhere in either, so an agent that gets this
// right cannot have got it by copying an example verbatim.
//
// GATES READ THE ARTIFACT. Fumbling on the way is allowed — the claim is that it arrives —
// so nothing here grades how many commands it took or whether any of them failed first.

import { Database } from "bun:sqlite";
import { readdirSync } from "node:fs";
import * as path from "node:path";
import { runScenario, type ScenarioDefinition, type GateContext } from "../harness/runtime";

const ENGINE = path.resolve(import.meta.dir, "..", "..", "engine", "main.ts");
const SHIM = `#!/bin/sh\nexec bun ${JSON.stringify(ENGINE)} "$@"\n`;
const SHIM_CMD = `@echo off\r\nbun ${JSON.stringify(ENGINE)} %*\r\n`;

const TRIALS = 3;
const MONSTERA = /monstera/i;
const SNAKE = /snake/i;

function graphsIn(dir: string): Record<string, Record<string, Record<string, string>>> {
  const out: Record<string, Record<string, Record<string, string>>> = {};
  for (const entry of readdirSync(dir, { recursive: true }) as string[]) {
    const rel = String(entry).replaceAll("\\", "/");
    if (!rel.endsWith(".sqlite")) continue;
    const db = new Database(path.join(dir, rel), { readonly: true });
    try {
      const names = new Map(
        (db.query("SELECT id, name FROM entity").all() as { id: number; name: string }[]).map((r) => [r.id, r.name]),
      );
      const state: Record<string, Record<string, string>> = {};
      for (const n of names.values()) state[n] = {};
      for (const row of db.query("SELECT entity_id, attribute, value FROM eav").all() as {
        entity_id: number;
        attribute: string;
        value: string;
      }[]) {
        const n = names.get(row.entity_id);
        if (n) state[n]![row.attribute] = row.value;
      }
      out[path.basename(rel, ".sqlite")] = state;
    } finally {
      db.close();
    }
  }
  return out;
}

function find(ctx: GateContext, pattern: RegExp): Record<string, string> | undefined {
  for (const state of Object.values(graphsIn(ctx.sandboxPath(".")))) {
    for (const [entity, attributes] of Object.entries(state)) if (pattern.test(entity)) return attributes;
  }
  return undefined;
}

const scenario: ScenarioDefinition = {
  name: "zero-priming",
  timeoutMs: 15 * 60_000,
  agent: {
    model: "claude-sonnet-5",
    systemPrompt:
      "You are Claude Code, working in the user's current directory. A command-line program " +
      "called `cog-graphs` is installed and available on your PATH. Respond to the user in " +
      "natural language; use your tools to do the work.",
    tools: ["Bash", "Read", "Write"],
    install: { "cog-graphs": SHIM, "cog-graphs.cmd": SHIM_CMD },
    maxTurnsPerMessage: 30,
    maxBudgetUsd: 3,
  },
  haltOnGateFailure: false,
  turns: [
    // 1 — a goal in the User's own words. No tool is named to them, and none is named back.
    {
      user:
        "I look after a lot of houseplants and I keep losing track of them. I'd like somewhere " +
        "to keep which room each one is in and when I last watered it. Can you set that up for " +
        "me here?",
      gate: (ctx) => {
        ctx.assert(Object.keys(graphsIn(ctx.sandboxPath("."))).length === 1, "a graph exists in the directory");
      },
    },
    // 2 — the first items, and a read-back. "A working graph" means one that holds what the
    // User asked for and can be read back, which is the whole of the claim.
    {
      user:
        "Great. The monstera is in the living room and I watered it last Sunday. The snake plant " +
        "is in the bedroom and I haven't watered it in about two weeks. What have we got?",
      gate: (ctx) => {
        const monstera = find(ctx, MONSTERA);
        const snake = find(ctx, SNAKE);
        ctx.assert(!!monstera, "the monstera is in the graph");
        ctx.assert(!!snake, "the snake plant is in the graph");
        ctx.assert(Object.keys(monstera ?? {}).length > 0, "the monstera carries attributes, not just a name");
        ctx.assert(Object.keys(snake ?? {}).length > 0, "the snake plant carries attributes, not just a name");
        const shared = Object.keys(monstera ?? {}).filter((k) => k in (snake ?? {}));
        ctx.assert(shared.length > 0, `both plants share at least one attribute (${shared.join(", ") || "none"})`);
        // Not gated: which command it used to answer the User. Two of the first three trials
        // (2026-09-11) added the plants and answered from add-item's own output rather than
        // running query, and reported both correctly. RU-3's claim is that the agent arrives
        // at a working graph, not that it takes a particular route there; requiring a query
        // here would have failed two agents that had done what the User asked.
        const text = ctx.lastTurn.assistantText.toLowerCase();
        ctx.assert(text.includes("monstera") && text.includes("snake"), "both plants are reported to the User");
      },
    },
  ],
};

// pass^3: three independent trials, each with its own sandbox and its own artifacts. Run in
// sequence rather than in parallel, so a rate limit or a failure is attributable to a trial.
const outcomes: boolean[] = [];
let spend = 0;
for (let trial = 1; trial <= TRIALS; trial++) {
  const result = await runScenario(scenario);
  const strays = result.stats.sandboxAfter.filter(
    (f) => !/\.(sqlite|md|yml|yaml)$/i.test(f) && !result.stats.sandboxBefore.includes(f),
  );
  spend += result.stats.totalCostUsd;
  outcomes.push(result.pass && strays.length === 0);
  console.error(
    `[zero-priming] trial ${trial}/${TRIALS}: ${result.pass && strays.length === 0 ? "pass" : "FAIL"} — ` +
      `${result.stats.agentTurnsPerMessage.reduce((a, b) => a + b, 0)} agent turns, ` +
      `${result.stats.toolCallCount} tool calls, $${result.stats.totalCostUsd.toFixed(3)}` +
      (strays.length ? ` — IN-6 stray artifacts: ${strays.join(", ")}` : ""),
  );
}

const passed = outcomes.filter(Boolean).length;
console.error(`[zero-priming] RU-3 pass^${TRIALS}: ${passed}/${TRIALS} — $${spend.toFixed(3)}`);
process.exit(passed === TRIALS ? 0 : 1);
