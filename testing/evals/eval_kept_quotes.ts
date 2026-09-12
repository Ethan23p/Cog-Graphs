// Kept quotes — RU-5.1's scenario, end to end through the harness.
//
// The scenario is Ethan's (2026-09-11, testing/rubrics/DRAFTS.md): the User asks their
// assistant to collect cleaned-up quotations of their own from snippets they paste, pastes
// one that is slightly malformed and names a person, asks to see what was saved, and then
// asks for the name to be taken out. The last turn is an improvised request in the User's
// own words, not a command the CLI offers — `modify-item` is how it gets done.
//
// WHAT IT IS FOR. RU-5.1 asks whether the Agent did what the User asked for: kept their
// words the way they asked, and made the change they asked for. What the Operator chooses to
// store is not a regression; our implementation misleading the Operator would be.
//
// GATES ARE DETERMINISTIC AND READ THE ARTIFACT, as in the Walking Skeleton. The taste calls
// — is this "tidied" or is it a summary? — are the judge's, over the same run. The one thing
// a gate can settle exactly is the redaction: after the last turn the name must not be
// anywhere in the graph, in an entity name, an attribute, a value, or the .md face the User
// would read. That is the User's request, and it is a fact about the files.
//
// The agent is told only that `cog-graphs` is on its PATH, the same reading of "installed"
// the Walking Skeleton uses and for the same reason.

import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { runScenario, type ScenarioDefinition, type GateContext } from "../harness/runtime";

const ENGINE = path.resolve(import.meta.dir, "..", "..", "engine", "main.ts");
const SHIM = `#!/bin/sh\nexec bun ${JSON.stringify(ENGINE)} "$@"\n`;
const SHIM_CMD = `@echo off\r\nbun ${JSON.stringify(ENGINE)} %*\r\n`;

/** The name the User asks to have taken out. Both parts, since either alone identifies them. */
const NAME = /priyanka|oduya/i;

/** Every graph in the sandbox, as namespace to entity to attributes. Read straight from SQL. */
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

/** Every item in the sandbox, whatever the agent called its graph. */
function items(ctx: GateContext): [string, Record<string, string>][] {
  return Object.values(graphsIn(ctx.sandboxPath("."))).flatMap((state) => Object.entries(state));
}

/** Every .md face in the sandbox, as text: what a User who went looking would read. */
function faces(ctx: GateContext): string {
  const dir = ctx.sandboxPath(".");
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter((f) => String(f).endsWith(".md"))
    .map((f) => readFileSync(path.join(dir, String(f)), "utf8"))
    .join("\n");
}

function ranCommand(ctx: GateContext, verb: string): boolean {
  return ctx.lastTurn.bashCommands.some((c) => /cog-graphs/.test(c) && new RegExp(`\\b${verb}\\b`).test(c));
}

const scenario: ScenarioDefinition = {
  name: "kept-quotes",
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
    // 1 — the User says what they want kept, and how.
    {
      user:
        "Hi Claude! I'd like you to start keeping a collection of things I've said, so I can " +
        "look back on them later. When I paste you a snippet from a conversation, pull out " +
        "what I said, tidy it up so it reads properly, and save it. Could you set that up here?",
      gate: async (ctx) => {
        const names = Object.keys(graphsIn(ctx.sandboxPath(".")));
        ctx.assert(names.length === 1, `exactly one graph was spawned (found ${names.length})`);
        const namespace = names[0];
        if (namespace) {
          ctx.assert(Object.keys(graphsIn(ctx.sandboxPath("."))[namespace] ?? {}).length === 0, "it starts empty");
          const intro = await ctx.exec(`cog-graphs introduce --graph ${namespace}`);
          ctx.assert(intro.exitCode === 0, "introduce answers over the new graph");
          const convention = (JSON.parse(intro.stdout || "{}").convention ?? []) as string[];
          // The User stated an expectation — their words, tidied — and the convention is
          // where an expectation has to live if the next session is to honour it too.
          ctx.assert(convention.join("").trim().length > 0, "the seeded convention is non-empty");
        }
      },
    },
    // 2 — a malformed paste, naming someone.
    {
      user:
        "Here's one from this morning:\n\n" +
        "[9:14 AM] Me: ugh ok so i think i really need to reach out to Priyanka Oduya this week,, its been way too long and i miss our\n" +
        "[9:14 AM] Me: talks\n" +
        "[9:15 AM] Sam: do it!!",
      gate: (ctx) => {
        const stored = items(ctx);
        ctx.assert(stored.length === 1, `exactly one item was saved (found ${stored.length})`);
        const attributes = stored[0]?.[1] ?? {};
        ctx.assert(Object.keys(attributes).length > 0, "the item carries attributes, not just a name");
        // What the User said, not what Sam said. Graded on the artifact: the one line of the
        // paste that is not theirs is the one line that must not have been kept as a quote.
        const values = Object.values(attributes).join(" ").toLowerCase();
        ctx.assert(!values.includes("do it!!"), "the other person's line was not kept as the User's");
        ctx.assert(/reach out/.test(values), "what the User said is in the item");
      },
    },
    // 3 — the User asks to see it.
    {
      user: "Can you show me what you saved?",
      gate: (ctx) => {
        ctx.assert(ranCommand(ctx, "query"), "the assistant read it back through the CLI");
        ctx.assert(/reach out/i.test(ctx.lastTurn.assistantText), "what was saved is shown to the User");
      },
    },
    // 4 — an improvised request: take the name out.
    {
      user: "Actually, could you take Priyanka's name out of it? I'd rather it wasn't in there.",
      // Whatever the agent named the one item it saved. Anything else that moved is an IN-5
      // violation, and removing the item entirely is a change this permits and the gate below
      // rejects: the User asked for a name to go, not for their quote to go.
      mayChange: (before) => Object.values(before.graphs).flatMap((g) => Object.keys(g)),
      gate: (ctx) => {
        const stored = items(ctx);
        ctx.assert(stored.length === 1, `the item is still there (found ${stored.length})`);
        const [entity, attributes] = stored[0] ?? ["", {}];
        ctx.assert(/reach out/i.test(Object.values(attributes).join(" ")), "the rest of what the User said survives");
        // The whole of the request, checked where the data actually is. An entity name, an
        // attribute name, a value, or the face the User would read: the name is in none of
        // them, or the assistant did not do what was asked.
        const everywhere = [entity, ...Object.entries(attributes).flat()].join(" ");
        ctx.assert(!NAME.test(everywhere), `the name is gone from the graph (${entity})`);
        ctx.assert(!NAME.test(faces(ctx)), "the name is gone from the .md face the User would read");
      },
    },
  ],
};

const result = await runScenario(scenario);

// IN-6 over the finished scenario: no stray artifacts, as in the Walking Skeleton.
const strays = result.stats.sandboxAfter.filter(
  (f) => !/\.(sqlite|md|yml|yaml)$/i.test(f) && !result.stats.sandboxBefore.includes(f),
);
if (strays.length > 0) {
  console.error(`[kept-quotes] IN-6 FAIL — stray artifacts: ${strays.join(", ")}`);
}

console.error(
  `[kept-quotes] budget: ${result.stats.turns} user turns, ` +
    `${result.stats.agentTurnsPerMessage.reduce((a, b) => a + b, 0)} agent turns, ` +
    `${result.stats.toolCallCount} tool calls, ` +
    `$${result.stats.totalCostUsd.toFixed(3)}`,
);

process.exit(result.pass && strays.length === 0 ? 0 : 1);
