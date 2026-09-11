// Ingestion — RU-6's scenario: messy source material, handed over all at once.
//
// The doc's UX flow: "I'll do one ingestion to confirm my understanding, then I can take
// advantage of one of the bulk ingestion options." Ergonomics and token efficiency are
// priorities, and a bulk ingestion of a misread source multiplies the misreading.
//
// WHAT THE SCENARIO PROVIDES. A dozen books, pasted as the User actually keeps them: an
// inconsistent list, some entries with a rating, some with a note, some with neither, and two
// written in a different shape from the rest. Enough material that going item by item is
// visibly the wrong tool, and enough irregularity that a mapping is worth confirming before
// it is applied twelve times.
//
// GATES READ THE ARTIFACT. Whether the approach suited the material — confirm on a sample,
// then scale — is a taste call and belongs to RU-6's judge over the same run. What a gate can
// settle is that every book the User handed over is in the graph, described in the same terms,
// and that the bulk path was used at all rather than twelve add-items.

import { Database } from "bun:sqlite";
import { readdirSync } from "node:fs";
import * as path from "node:path";
import { runScenario, type ScenarioDefinition, type GateContext } from "../harness/runtime";

const ENGINE = path.resolve(import.meta.dir, "..", "..", "engine", "main.ts");
const SHIM = `#!/bin/sh\nexec bun ${JSON.stringify(ENGINE)} "$@"\n`;
const SHIM_CMD = `@echo off\r\nbun ${JSON.stringify(ENGINE)} %*\r\n`;

/** The User's list, as pasted. One line per book, and deliberately not uniform. */
const BOOKS = `The Left Hand of Darkness - Le Guin, 5/5, still thinking about it
Piranesi (Susanna Clarke) 5/5
Project Hail Mary, Weir - fun, 4/5
The Dispossessed - Le Guin
Klara and the Sun, Ishiguro, 3/5, didn't land for me
Blindsight - Watts, 4/5, bleak
A Memory Called Empire (Martine) 4/5
Children of Time - Tchaikovsky, 4/5
The Overstory, Powers - 3/5, too long
Exhalation - Chiang, 5/5, the best of these
Stories of Your Life and Others by Ted Chiang, 5/5
Annihilation - VanderMeer, 3/5`;

/** The title fragments a gate looks for: one per line above, distinctive and lowercase. */
const TITLES = [
  "left hand",
  "piranesi",
  "hail mary",
  "dispossessed",
  "klara",
  "blindsight",
  "memory called empire",
  "children of time",
  "overstory",
  "exhalation",
  "stories of your life",
  "annihilation",
];

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

function items(ctx: GateContext): [string, Record<string, string>][] {
  return Object.values(graphsIn(ctx.sandboxPath("."))).flatMap((state) => Object.entries(state));
}

const scenario: ScenarioDefinition = {
  name: "ingestion",
  timeoutMs: 15 * 60_000,
  agent: {
    model: "claude-sonnet-5",
    systemPrompt:
      "You are Claude Code, working in the user's current directory. A command-line program " +
      "called `cog-graphs` is installed and available on your PATH. Respond to the user in " +
      "natural language; use your tools to do the work.",
    tools: ["Bash", "Read", "Write"],
    install: { "cog-graphs": SHIM, "cog-graphs.cmd": SHIM_CMD },
    maxTurnsPerMessage: 40,
    maxBudgetUsd: 3,
  },
  haltOnGateFailure: false,
  turns: [
    // 1 — the whole pile, at once, with no instructions about how to take it in.
    {
      user:
        // "Right here in this folder" is load-bearing, and it is here because of a failed run
        // (2026-09-11): asked only to put the list "somewhere I can actually search", the
        // agent judged the working directory to be a temporary workspace and created the
        // graph under ~/cog-graphs/books-read instead. That is the agent working — it is
        // reasoning about where its User's durable data belongs — but it leaves the scenario
        // with nothing to read. Where the graph goes is DE-7's subject, not RU-6's.
        "I keep a running list of the books I've read in a note on my phone, and it's getting " +
        "unwieldy. Could you put it somewhere I can actually search, right here in this " +
        "folder? Here's the lot:\n\n" +
        BOOKS,
      gate: (ctx) => {
        const stored = items(ctx);
        const names = stored.map(([entity]) => entity.toLowerCase()).join(" | ");
        const missing = TITLES.filter((t) => !names.includes(t));
        ctx.assert(missing.length === 0, `every book the User pasted is in the graph (missing: ${missing.join(", ") || "none"})`);
        const withAttributes = stored.filter(([, attrs]) => Object.keys(attrs).length > 0);
        ctx.assert(
          withAttributes.length === stored.length,
          `every item carries attributes (${withAttributes.length}/${stored.length})`,
        );
        // Described in the same terms: one attribute every book shares. Without that the list
        // cannot be pulled by selection, which is this version's only search strategy.
        const shared = Object.keys(stored[0]?.[1] ?? {}).filter((k) => stored.every(([, a]) => k in a));
        ctx.assert(shared.length > 0, `all the books share at least one attribute (${shared.join(", ") || "none"})`);
        // The bulk path exists for exactly this; twelve add-items is the anti-pattern the
        // doc's flow is written against. Whether the confirm-then-scale shape was right is
        // RU-6's judge's call, over this same run.
        ctx.assert(
          ctx.lastTurn.bashCommands.some((c) => /cog-graphs/.test(c) && /\bimport\b/.test(c)),
          "the bulk path was used",
        );
      },
    },
    // 2 — a read-back that only a well-described ingestion can answer.
    {
      user: "Which ones did I give five stars?",
      gate: (ctx) => {
        ctx.assert(
          ctx.lastTurn.bashCommands.some((c) => /cog-graphs/.test(c) && /\bquery\b/.test(c)),
          "the answer went through the CLI",
        );
        const text = ctx.lastTurn.assistantText.toLowerCase();
        // The User's own list says which three: Le Guin, Chiang twice.
        for (const title of ["left hand", "exhalation", "stories of your life"]) {
          ctx.assert(text.includes(title), `the five-star answer names "${title}"`);
        }
        ctx.assert(!text.includes("klara"), "the five-star answer leaves out a three-star book");
      },
    },
  ],
};

const result = await runScenario(scenario);

const strays = result.stats.sandboxAfter.filter(
  (f) => !/\.(sqlite|md|yml|yaml)$/i.test(f) && !result.stats.sandboxBefore.includes(f),
);
if (strays.length > 0) {
  console.error(`[ingestion] IN-6 FAIL — stray artifacts: ${strays.join(", ")}`);
}

console.error(
  `[ingestion] budget: ${result.stats.turns} user turns, ` +
    `${result.stats.agentTurnsPerMessage.reduce((a, b) => a + b, 0)} agent turns, ` +
    `${result.stats.toolCallCount} tool calls, ` +
    `$${result.stats.totalCostUsd.toFixed(3)}`,
);

process.exit(result.pass && strays.length === 0 ? 0 : 1);
