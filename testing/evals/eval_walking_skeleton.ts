// The Walking Skeleton — the doc's closure scenario, end to end through the harness.
//
// The doc's steps, verbatim: installing this system; drafting a profile interactively;
// spawning an instantiation; attempting to query the new instance (it's empty); adding a
// couple items; querying the new instance for those items; starting a fresh thread in
// Claude Code (no shared context, shared tooling & cwd); modifying a couple items;
// querying the instance for those items, again.
//
// The user turns are written from the doc's own UX flow ("routine initialization,
// Claude-initiated") rather than invented, because the scenario's claim is about a User
// who "only has to respond in natural language". A turn that says "run cog-graphs
// initialize --profile ./p.yml" would grade the harness, not the interface.
//
// WHAT "INSTALLING THIS SYSTEM" MEANS HERE. v0.3.1's form factor is a CLI inside a Claude
// Code plugin, and the plugin does not exist yet — so installation is modelled as the
// binary being on PATH and the agent being told only that it is there. No usage, no flags,
// no primer in the system prompt. That is deliberately the harder reading: everything the
// agent knows about the grammar it has to get from `--help`, which is RU-3's claim and the
// reason `--help` is treated as a deliverable. When the plugin lands, this is the eval that
// should gain the skill and lose the sentence.
//
// GATES ARE DETERMINISTIC AND READ THE ARTIFACT. Every gate here goes to the .sqlite or to
// the CLI's own exit code rather than to the assistant's prose. Grading prose is how an
// eval starts rewarding an agent that *says* it stored something. The rubric cases
// (RU-1..RU-7) are the ones that read the transcript, and they are judged separately.

import { Database } from "bun:sqlite";
import { existsSync, readdirSync } from "node:fs";
import * as path from "node:path";
import { runScenario, type ScenarioDefinition, type GateContext } from "../harness/runtime";

const ENGINE = path.resolve(import.meta.dir, "..", "..", "engine", "main.ts");

// The installed program. A one-line shim so the agent invokes `cog-graphs` exactly as a
// User who installed it would — the name is all it ever learns.
const SHIM = `#!/bin/sh\nexec bun ${JSON.stringify(ENGINE)} "$@"\n`;
const SHIM_CMD = `@echo off\r\nbun ${JSON.stringify(ENGINE)} %*\r\n`;

/** Every graph in the sandbox, as namespace to entity to attributes. Read straight from SQL. */
function graphsIn(dir: string): Record<string, Record<string, Record<string, string>>> {
  const out: Record<string, Record<string, Record<string, string>>> = {};
  for (const entry of readdirSync(dir, { recursive: true }) as string[]) {
    const rel = String(entry).replaceAll("\\", "/");
    if (!rel.endsWith(".sqlite")) continue;
    const db = new Database(path.join(dir, rel), { readonly: true });
    try {
      const names = new Map(
        (db.query("SELECT id, name FROM entity").all() as { id: number; name: string }[]).map((r) => [
          r.id,
          r.name,
        ]),
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

/** The one entity whose name matches, or undefined. Agent-chosen names are matched loosely. */
function find(
  graphs: Record<string, Record<string, Record<string, string>>>,
  pattern: RegExp,
): { entity: string; attributes: Record<string, string> } | undefined {
  for (const state of Object.values(graphs)) {
    for (const [entity, attributes] of Object.entries(state)) {
      if (pattern.test(entity)) return { entity, attributes };
    }
  }
  return undefined;
}

const PORTAL = /portal/i;
const HADES = /hades/i;

/** Did the agent actually run a query, and did the CLI answer it? */
function ranCommand(ctx: GateContext, verb: string): boolean {
  return ctx.lastTurn.bashCommands.some((c) => /cog-graphs/.test(c) && new RegExp(`\\b${verb}\\b`).test(c));
}

const scenario: ScenarioDefinition = {
  name: "walking-skeleton",
  timeoutMs: 15 * 60_000,
  agent: {
    model: "claude-sonnet-5",
    // Everything the agent is told. One sentence, no grammar — see the header.
    systemPrompt:
      "You are Claude Code, working in the user's current directory. A command-line program " +
      "called `cog-graphs` is installed and available on your PATH. Respond to the user in " +
      "natural language; use your tools to do the work.",
    tools: ["Bash", "Read", "Write"],
    // Both forms, always. Claude Code's Bash is a POSIX shell even on Windows, while a
    // gate's `exec` goes through cmd.exe there — so whichever one resolves the name, it
    // finds the same engine. Installing only the platform's "obvious" form is how this
    // fails silently, on one platform, in the middle of a paid run.
    install: { "cog-graphs": SHIM, "cog-graphs.cmd": SHIM_CMD },
    maxTurnsPerMessage: 30,
    maxBudgetUsd: 3,
  },
  // A failed gate does not stop the run: the later steps are what say whether a wobble at
  // step 3 was fatal or cosmetic, and a scenario that stops at the first blemish cannot
  // tell those apart.
  haltOnGateFailure: false,
  turns: [
    // 1 — drafting a profile interactively.
    {
      user:
        "Hey Claude! I was hoping we could set up some sort of flow so that you could " +
        "recommend me games. How would we do that?",
      gate: (ctx) => {
        // The claim is that the profile is established *with* the User (RU-1). Graded as
        // restraint rather than as prose: nothing has been created yet. An assistant that
        // guessed a namespace and a convention and built the thing has decided on the
        // User's behalf what their data is for.
        const graphs = graphsIn(ctx.sandboxPath("."));
        ctx.assert(Object.keys(graphs).length === 0, "no graph is created before the User agrees");
        ctx.assert(ctx.lastTurn.assistantText.trim().length > 0, "the assistant answers in prose");
      },
    },
    // 2 — spawning an instantiation, then querying it empty.
    {
      user:
        "That's perfect! Yes, set it up right here in this directory. Then show me what's in " +
        "it — I assume it'll be empty to start.",
      gate: async (ctx) => {
        const graphs = graphsIn(ctx.sandboxPath("."));
        const names = Object.keys(graphs);
        ctx.assert(names.length === 1, `exactly one graph was spawned (found ${names.length})`);

        const namespace = names[0];
        if (namespace) {
          // Both faces, beside each other, as the doc's architecture requires. Checked on
          // the filesystem rather than with a shell command: a gate's `exec` runs through
          // cmd.exe on Windows, where a POSIX one-liner fails for reasons that have nothing
          // to do with the claim, in the middle of a paid run.
          ctx.assert(
            existsSync(ctx.sandboxPath(`${namespace}.md`)),
            "the inspectable face exists beside the functional one",
          );
          ctx.assert(
            Object.keys(graphs[namespace] ?? {}).length === 0,
            "the new instance is empty",
          );
          // A convention is seeded at initialize and is non-empty (IN-8), and here it must
          // be one the assistant established rather than a placeholder.
          const intro = await ctx.exec(`cog-graphs introduce --graph ${namespace}`);
          ctx.assert(intro.exitCode === 0, "introduce answers over the new instance");
          const convention = (JSON.parse(intro.stdout || "{}").convention ?? []) as string[];
          ctx.assert(convention.join("").trim().length > 0, "the seeded convention is non-empty");
        }
        ctx.assert(ranCommand(ctx, "query"), "the assistant queried the empty instance");
      },
    },
    // 3 — adding a couple of items.
    {
      user:
        "Great. Let's put in a couple I've played: Portal 2, which I'm about halfway through " +
        "and loving, and Hades, which I bounced off after a few runs.",
      gate: (ctx) => {
        const graphs = graphsIn(ctx.sandboxPath("."));
        const portal = find(graphs, PORTAL);
        const hades = find(graphs, HADES);
        ctx.assert(!!portal, "Portal 2 is in the graph");
        ctx.assert(!!hades, "Hades is in the graph");
        // Attributes, not just names. An ingestion that recorded the titles and dropped
        // what the User said about them has stored the least useful half.
        ctx.assert(
          Object.keys(portal?.attributes ?? {}).length > 0,
          "Portal 2 carries attributes, not just a name",
        );
        ctx.assert(
          Object.keys(hades?.attributes ?? {}).length > 0,
          "Hades carries attributes, not just a name",
        );
        // The two items are described in the same terms. A store whose items share no
        // attribute names cannot be queried by selection, which is v0.3.1's only search
        // strategy — so this is the difference between a graph and two loose rows.
        const shared = Object.keys(portal?.attributes ?? {}).filter(
          (k) => k in (hades?.attributes ?? {}),
        );
        ctx.assert(shared.length > 0, `both items share at least one attribute (${shared.join(", ") || "none"})`);
      },
    },
    // 4 — querying the new instance for those items.
    {
      user: "What's in there now?",
      gate: (ctx) => {
        ctx.assert(ranCommand(ctx, "query"), "the assistant read the graph back through the CLI");
        const text = ctx.lastTurn.assistantText.toLowerCase();
        ctx.assert(text.includes("portal") && text.includes("hades"), "both items are reported to the User");
      },
    },
    // 5 — a fresh thread: no shared context, same tooling and cwd. Then modify.
    {
      freshThread: true,
      user:
        "I gave up on Hades for good, and I finally finished Portal 2 — can you update my " +
        "games list to match?",
      // Declared in advance, resolved late: the two entities the User named, whatever the
      // first thread chose to call them. Anything else that moved is an IN-5 violation.
      mayChange: (before) => {
        const names = Object.values(before.graphs).flatMap((g) => Object.keys(g));
        return names.filter((n) => PORTAL.test(n) || HADES.test(n));
      },
      gate: (ctx) => {
        // The whole point of the fresh thread: this session was told nothing about the
        // graph — not its namespace, not its directory, not that it exists. Finding it is
        // the interface's job, and this is the assertion that says whether it did.
        ctx.assert(
          ctx.lastTurn.bashCommands.some((c) => /cog-graphs/.test(c)),
          "the fresh thread found the tool without being told about the graph",
        );
        const graphs = graphsIn(ctx.sandboxPath("."));
        const portal = find(graphs, PORTAL);
        const hades = find(graphs, HADES);
        ctx.assert(!!portal && !!hades, "both items still exist after the update");
        const values = [
          ...Object.values(portal?.attributes ?? {}),
          ...Object.values(hades?.attributes ?? {}),
        ]
          .join(" ")
          .toLowerCase();
        // Graded on the change being recorded somewhere in the item's own values rather
        // than on a particular attribute name: the convention is the agent's to choose,
        // and pinning the word would grade this eval's guess at it.
        ctx.assert(
          /complete|finished|played|done/.test(values),
          "Portal 2 now reads as finished",
        );
        ctx.assert(
          /abandon|dropped|gave up|quit|shelved/.test(values),
          "Hades now reads as abandoned",
        );
      },
    },
    // 6 — querying for those items, again.
    {
      user: "Show me the list again.",
      gate: (ctx) => {
        ctx.assert(ranCommand(ctx, "query"), "the final read goes through the CLI");
        const text = ctx.lastTurn.assistantText.toLowerCase();
        ctx.assert(text.includes("portal") && text.includes("hades"), "both items are reported back");
      },
    },
  ],
};

const result = await runScenario(scenario);

// IN-6, over the finished scenario: no stray artifacts. Checked here rather than in a gate
// because it is a claim about the end state of the directory, and the harness already has
// the before/after listings.
const strays = result.stats.sandboxAfter.filter(
  (f) => !/\.(sqlite|md|yml|yaml)$/i.test(f) && !result.stats.sandboxBefore.includes(f),
);
if (strays.length > 0) {
  console.error(`[walking-skeleton] IN-6 FAIL — stray artifacts: ${strays.join(", ")}`);
}

// DE-24 — the ergonomics budget. The doc asks for declared ceilings on agent turns, tool
// calls, and total tokens, generous at first and tightened as the numbers stabilize.
//
// These are 2x the first passing run (2026-09-09: 24 agent turns, 18 tool calls, 245,997
// tokens counting cache, $0.543 over 6 user turns). One sample is one sample, so 2x rather
// than 1.2x — the ceiling is here to catch a regression *in kind*, an interface that
// started costing an agent twice as many attempts, not to police normal variance. Every
// tightening should name the runs it was computed from, the way this one does.
//
// Cache reads are counted. They are the bulk of the traffic and they are real tokens the
// interface caused to be read; excluding them would let the primer grow without limit and
// still look free, which is the exact failure the priority on token efficiency is about.
//
// Appended below the reporting line rather than folded into it: this file was append-only
// when it landed.
const CEILINGS = { agentTurns: 48, toolCalls: 36, tokens: 500_000 };
const de24 = {
  agentTurns: result.stats.agentTurnsPerMessage.reduce((a, b) => a + b, 0),
  toolCalls: result.stats.toolCallCount,
  tokens:
    result.stats.totalInputTokens +
    result.stats.totalOutputTokens +
    result.stats.totalCacheReadTokens +
    result.stats.totalCacheCreationTokens,
};
const overBudget = (Object.keys(CEILINGS) as (keyof typeof CEILINGS)[]).filter(
  (k) => de24[k] > CEILINGS[k],
);
console.error(
  `[walking-skeleton] DE-24 ceilings: ` +
    (Object.keys(CEILINGS) as (keyof typeof CEILINGS)[])
      .map((k) => `${k} ${de24[k]}/${CEILINGS[k]}`)
      .join(", "),
);
for (const k of overBudget) {
  console.error(`[walking-skeleton] DE-24 FAIL — ${k}: ${de24[k]} exceeds the ceiling of ${CEILINGS[k]}`);
}
if (overBudget.length > 0) process.exit(1);

console.error(
  `[walking-skeleton] DE-24 budget: ${result.stats.turns} user turns, ` +
    `${result.stats.agentTurnsPerMessage.reduce((a, b) => a + b, 0)} agent turns, ` +
    `${result.stats.toolCallCount} tool calls, ` +
    `${result.stats.totalInputTokens + result.stats.totalOutputTokens} tokens (in+out), ` +
    `$${result.stats.totalCostUsd.toFixed(3)}`,
);

// Turn 5 has to change something (the resolved dispute of 2026-09-11 in testing/DISPUTES.md,
// "Walking Skeleton turn 5"). Turn 3 used to let an agent record Portal 2 as played, so the
// fresh thread could find nothing to change, run no modify-item at all, and still pass: turn
// 5's gate reads values, and turn 3 had already written them. Turn 3 now leaves Portal 2
// half-played, so finishing it is a real change, and this asserts the change was made:
// Portal 2's values differ between the checkpoints either side of turn 5. Checkpoint 0 is
// taken before turn 1 and one more after each turn's gate, so those are 4 and 5.
// Appended here rather than written into turn 5's gate: this file was append-only when it
// landed, and the gate is not handed the checkpoint from before its turn.
const portalAt = (i: number): Record<string, string> | undefined => {
  for (const state of Object.values(result.checkpoints[i]?.graphs ?? {})) {
    for (const [entity, attributes] of Object.entries(state)) if (PORTAL.test(entity)) return attributes;
  }
  return undefined;
};
const portalBefore = portalAt(4);
const portalAfter = portalAt(5);
const turn5Changed =
  portalBefore !== undefined && portalAfter !== undefined && JSON.stringify(portalBefore) !== JSON.stringify(portalAfter);
console.error(
  `[walking-skeleton] turn 5 changed Portal 2: ${turn5Changed ? "yes" : "NO"} ` +
    `(${JSON.stringify(portalBefore ?? null)} -> ${JSON.stringify(portalAfter ?? null)})`,
);
if (!turn5Changed) {
  console.error(`[walking-skeleton] FAIL — the fresh thread did not change Portal 2, which the User had just finished`);
  process.exit(1);
}

process.exit(result.pass && strays.length === 0 ? 0 : 1);
