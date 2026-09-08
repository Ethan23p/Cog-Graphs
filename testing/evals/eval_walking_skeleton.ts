// The Walking Skeleton — the scenario v0.3.1 exists to satisfy.
//
//   "A User goes from vanilla Claude Code to a functional, lightly populated
//    cog-graph (Claude consumes as much of the mechanical work as necessary, the
//    User only has to respond in natural language)"
//
// Nine steps from the doc, in order: installing the system (the plugin/skill is
// loaded into the session, not a turn), drafting a profile interactively, spawning an
// instantiation, querying it empty, adding items, querying for them, STARTING A FRESH
// THREAD over the same working directory, modifying items, querying again.
//
// Covers: RU-1, RU-2, RU-4, RU-5, RU-6 (judged), DE-24 (measured), and the
// agentic half of the DE cases as per-turn gates.
//
//   bun run eval:skeleton
//
// This is the spec's second layer. Never edited to fit the engine — see
// testing/DISPUTES.md.

import { runScenario, type ScenarioDefinition, type ScenarioResult } from "../harness/runtime";
import { readProfile, readConvention, storeEntities, storeItem } from "../tests/helpers";
import { PROFILE_FIELDS } from "../tests/contract";
import {
  IN_LOOP_MODEL,
  PLUGIN_DIR,
  assertPluginExists,
  putBinOnPath,
  findGraphs,
  judgeRubrics,
  checkErgonomics,
  type RubricCase,
} from "./eval-support";

putBinOnPath();
assertPluginExists();

/** Resolve the single graph the agent created, or explain why a gate cannot proceed. */
function theGraph(dir: string): string | null {
  const graphs = findGraphs(dir);
  return graphs.length === 1 ? graphs[0]! : null;
}

const AGENT = {
  model: IN_LOOP_MODEL,
  // No systemPrompt priming. The Operator meets the system exactly as a real one
  // would — through the plugin's skill and the CLI's own self-documentation. A
  // preamble here would test a surface that does not exist in the field.
  tools: ["Bash", "Read", "Write"],
  plugins: [{ type: "local" as const, path: PLUGIN_DIR }],
  skills: "all" as const,
  maxTurnsPerMessage: 40,
  maxBudgetUsd: 4.0,
};

// --- Session one: a fresh User and a fresh Assistant -------------------------

const sessionOne: ScenarioDefinition = {
  name: "walking-skeleton-1",
  agent: AGENT,
  haltOnGateFailure: false,
  timeoutMs: 15 * 60_000,
  turns: [
    {
      // Step 2: drafting a profile interactively. The User says what they want in
      // plain language and nothing else; everything mechanical is the Assistant's.
      user:
        "Hey Claude! I've got a pile of files on this drive I need to work through, and I want you to " +
        "keep track of what you find as you go — I gather you've got some kind of persistent list tool " +
        "available. Could you get something set up for that?",
      gate: async (ctx) => {
        const ran = ctx.lastTurn.bashCommands.join("\n");
        ctx.assert(/\bcog-graphs\b/.test(ran), "the agent reached for the cog-graphs CLI");
        ctx.assert(/introduce/.test(ran), "the agent oriented itself via `introduce`");
      },
    },
    {
      // Step 3: spawning an instantiation.
      user:
        "Let's call it file-reports. It's for tracking the files I'm sorting on my external drive — for " +
        "each one I care about what kind of file it is and whether you've been through it yet.",
      gate: async (ctx) => {
        const ns = theGraph(ctx.sandboxPath("."));
        ctx.assert(ns !== null, `exactly one graph exists in the working directory (found: ${findGraphs(ctx.sandboxPath(".")).join(", ") || "none"})`);
        if (!ns) return;

        ctx.assert(ns === "file-reports", `the namespace the User asked for was used (got '${ns}')`);
        const { existsSync } = await import("node:fs");
        ctx.assert(existsSync(ctx.sandboxPath(`${ns}.md`)), "the inspectable face was written beside it");

        const profile = readProfile(ctx.sandboxPath("."), ns);
        for (const field of PROFILE_FIELDS) {
          ctx.assert(String(profile[field] ?? "").trim().length > 0, `profile carries a non-empty '${field}'`);
        }
        ctx.assert(readConvention(ctx.sandboxPath("."), ns).trim().length > 0, "a convention was seeded (IN-8)");
        ctx.assert(/initialize/.test(ctx.lastTurn.bashCommands.join("\n")), "the graph was created via `initialize`, not by hand");
      },
    },
    {
      // Step 4: attempting to query the new instance — it's empty.
      user: "Before we put anything in it — what's in there right now?",
      gate: async (ctx) => {
        const ns = theGraph(ctx.sandboxPath("."));
        if (!ns) return ctx.fail("no graph to query");
        ctx.assert(/query/.test(ctx.lastTurn.bashCommands.join("\n")), "the agent used `query` rather than reading the file");
        ctx.assert(storeEntities(ctx.sandboxPath("."), ns).length === 0, "the graph is genuinely empty");
        // DE-8 through the Operator's eyes: an empty result must not read as a fault.
        const r = await ctx.exec(`cog-graphs query --graph ${ns}`);
        ctx.assert(r.exitCode === 0, `an empty query exits 0 (got ${r.exitCode})`);
      },
    },
    {
      // Step 5: adding items — from unstructured source material, which is what
      // RU-6 is about (one ingestion to confirm understanding, then the rest).
      user:
        "Okay, here's what I've got so far, just from eyeballing the folder:\n" +
        "quarterly-report.pdf — that's a document, I've already been through that one\n" +
        "budget-2026.xlsx — spreadsheet, haven't looked yet\n" +
        "team-photo.jpg — image, haven't looked\n" +
        "notes-from-call.md — document, been through it\n" +
        "Can you get those in?",
      gate: async (ctx) => {
        const ns = theGraph(ctx.sandboxPath("."));
        if (!ns) return ctx.fail("no graph to add to");
        const entities = storeEntities(ctx.sandboxPath("."), ns);
        for (const f of ["quarterly-report.pdf", "budget-2026.xlsx", "team-photo.jpg", "notes-from-call.md"]) {
          ctx.assert(entities.includes(f), `'${f}' is in the store`);
        }
        ctx.assert(entities.length === 4, `exactly the four files were stored (got ${entities.length}: ${entities.join(", ")})`);
        for (const f of entities) {
          ctx.assert(Object.keys(storeItem(ctx.sandboxPath("."), ns, f)).length > 0, `'${f}' carries attributes`);
        }
      },
    },
    {
      // Step 6: querying for those items.
      user: "Great — which ones are still waiting on me?",
      gate: async (ctx) => {
        ctx.assert(/query/.test(ctx.lastTurn.bashCommands.join("\n")), "the agent answered by querying the graph");
        const said = ctx.lastTurn.assistantText;
        ctx.assert(said.includes("budget-2026.xlsx"), "the answer names budget-2026.xlsx");
        ctx.assert(said.includes("team-photo.jpg"), "the answer names team-photo.jpg");
        ctx.assert(!said.includes("notes-from-call.md"), "the answer does not name an already-processed file");
      },
    },
  ],
};

// --- Session two: a fresh thread, the same working directory -----------------
// No shared context, shared tooling and cwd. This is the step that proves the graph
// is a durable object in the User's environment rather than a fact about one
// conversation — so it is a second session, not a further turn.

function sessionTwo(sandbox: string): ScenarioDefinition {
  return {
    name: "walking-skeleton-2",
    sandbox: { reuse: sandbox },
    agent: AGENT,
    haltOnGateFailure: false,
    timeoutMs: 15 * 60_000,
    turns: [
      {
        // Step 8: modifying items. Note what the User does NOT say: where the
        // record lives, what it is called, or what tool to use.
        user:
          "Hey — I've finished going through budget-2026.xlsx and team-photo.jpg now. Can you update " +
          "wherever that's being tracked?",
        gate: async (ctx) => {
          const ns = theGraph(ctx.sandboxPath("."));
          if (!ns) return ctx.fail("no graph found in the shared working directory");
          const dir = ctx.sandboxPath(".");

          // Tolerant by design: the attribute names were the agent's to choose in
          // session one, so the gate asserts that the two named files changed and
          // the others did not — not that any particular key holds any particular
          // value.
          const before = JSON.parse(process.env.COG_SKELETON_PRESTATE ?? "{}") as Record<string, Record<string, string>>;
          for (const f of ["budget-2026.xlsx", "team-photo.jpg"]) {
            ctx.assert(
              JSON.stringify(storeItem(dir, ns, f)) !== JSON.stringify(before[f] ?? {}),
              `'${f}' was updated`,
            );
          }
          for (const f of ["quarterly-report.pdf", "notes-from-call.md"]) {
            ctx.assert(
              JSON.stringify(storeItem(dir, ns, f)) === JSON.stringify(before[f] ?? {}),
              `'${f}' was left alone (IN-5)`,
            );
          }
          ctx.assert(/modify-item/.test(ctx.lastTurn.bashCommands.join("\n")), "the update went through `modify-item`");
        },
      },
      {
        // Step 9: querying for those items, again.
        user: "And show me the whole list again?",
        gate: async (ctx) => {
          const ns = theGraph(ctx.sandboxPath("."));
          if (!ns) return ctx.fail("no graph to query");
          const entities = storeEntities(ctx.sandboxPath("."), ns);
          ctx.assert(entities.length === 4, `all four items survived the whole scenario (got ${entities.length})`);
          const said = ctx.lastTurn.assistantText;
          for (const f of entities) ctx.assert(said.includes(f), `the answer names '${f}'`);
        },
      },
    ],
  };
}

// --- Rubrics -----------------------------------------------------------------

const RUBRICS: RubricCase[] = [
  {
    id: "RU-1",
    question:
      "Did the Assistant establish the graph's configuration (its name, purpose, and what will be tracked) " +
      "*conversationally* with the User, rather than inventing values the User never supplied?",
  },
  {
    id: "RU-2",
    question:
      "In the SECOND session — a fresh thread with no memory of the first — did the Assistant orient itself " +
      "and reach the right items using only the working directory and its tooling, without the User telling it " +
      "where the record lived or what it was called?",
  },
  {
    id: "RU-4",
    question:
      "Read only the Assistant's messages to the User. Would any of them require the User to learn an " +
      "abstraction belonging to this system — profile, convention, namespace, entity, attribute, EAV, sidecar — " +
      "in order to follow what was said? Pass only if none would.",
  },
  {
    id: "RU-5",
    question:
      "Does the convention the Assistant seeded actually describe the data it then stored — that is, are the " +
      "attributes the convention names the same attributes it went on to use? Pass only if they agree.",
  },
  {
    id: "RU-6",
    question:
      "Given the unstructured list of four files, did the Assistant do one ingestion first to confirm its " +
      "understanding, and only then ingest the rest in bulk? Pass only if that two-step shape is visible.",
  },
];

// --- Run ---------------------------------------------------------------------

const one = await runScenario(sessionOne);

// Capture the pre-modification state for session two's gates. Read here, between
// sessions, because session two must not be told anything session one knew.
const ns = theGraph(one.sandboxPath);
if (ns) {
  const pre: Record<string, Record<string, string>> = {};
  for (const e of storeEntities(one.sandboxPath, ns)) pre[e] = storeItem(one.sandboxPath, ns, e);
  process.env.COG_SKELETON_PRESTATE = JSON.stringify(pre);
}

const two = await runScenario(sessionTwo(one.sandboxPath));

// DE-24 — ergonomics budget, across the whole scenario.
const ergo = [checkErgonomics("session 1", one.stats), checkErgonomics("session 2", two.stats)];
console.error("\n=== DE-24 ergonomics ===");
for (const e of ergo) console.error(`  [${e.pass ? "pass" : "FAIL"}] ${e.detail}`);

// RU — judged over both transcripts together, since RU-2 is precisely about the
// relationship between them.
console.error("\n=== RU rubrics ===");
const rubric = await judgeRubrics({
  evidence: { sessionOne: one.transcript, sessionTwo: two.transcript },
  preamble:
    "You are grading a transcript of an AI Assistant helping a non-technical User set up a persistent " +
    "store of files using a CLI tool called cog-graphs. Two separate sessions are provided; the second is " +
    "a fresh thread with no memory of the first, run in the same working directory.",
  cases: RUBRICS,
});

const pass = one.pass && two.pass && ergo.every((e) => e.pass) && rubric.pass;
console.error(
  `\nwalking skeleton: ${pass ? "PASS" : "FAIL"} — ` +
    `session 1 ${one.pass ? "pass" : "FAIL"}, session 2 ${two.pass ? "pass" : "FAIL"}, ` +
    `ergonomics ${ergo.every((e) => e.pass) ? "pass" : "FAIL"}, rubrics ${rubric.pass ? "pass" : "FAIL"}\n` +
    `artifacts: ${one.artifactsDir} and ${two.artifactsDir}`,
);
process.exit(pass ? 0 : 1);
