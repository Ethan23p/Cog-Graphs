#!/usr/bin/env bun
// Cog-Graphs engine — CLI entry point.
//
// The CLI is the UX and its user is an AI agent, so every answer is JSON on stdout and
// the process boundary is the whole contract.

const argv = process.argv.slice(2);
const command = argv[0];
const flags = new Set(argv.slice(1));

const SYSTEM_INTRODUCTION = [
  "Cog-Graphs spawns and manipulates persistent structured stores — a Cog Graph is an",
  "EAV store you create per use-case and keep in your working directory.",
  "",
  "There is no Cog Graph here yet. To make one, write a profile as a small .yml file",
  "(namespace, use-pattern, description, and a seed convention), then run:",
  "  cog-graphs initialize --profile <file.yml>",
].join("\n");

// The primer an Operator gets from `introduce --interface-skill`: everything needed to
// initialize and use a Cog Graph directly, and nothing else. It is the whole priming an
// agent operating the CLI is guaranteed to have, so every command the Walking Skeleton
// walks appears here in runnable form (DE-2).
const INTERFACE_SKILL_PRIMER = [
  "# Operating a Cog Graph directly",
  "",
  "A Cog Graph is an EAV store: entities carry attribute/value pairs. It lives as two",
  "files in a directory the User owns — `<namespace>.sqlite`, which holds everything,",
  "and a derived `<namespace>.md` beside it, which is written for inspection and never",
  "read back. Do not hand-edit the `.md`; do not put either file in a temp directory,",
  "or the User loses the thing they were meant to keep.",
  "",
  "## Spawn one",
  "",
  "Establish the profile with the User conversationally — namespace, use-pattern, and a",
  "description in their words — then write it to a one-time-use `.yml` and pass it in:",
  "",
  "  cog-graphs initialize --profile <profile.yml> [--dir <path>]",
  "",
  "## Look at what is there",
  "",
  "  cog-graphs query --graph <namespace> [--attr k=v ...] [--exclude k=v ...]",
  "",
  "An empty graph answers with an empty result, not an error. Query is the way to",
  "traverse: each attribute is a handhold, so ask narrow questions repeatedly rather",
  "than one broad one.",
  "",
  "## Put things in, change them",
  "",
  "  cog-graphs add-item --graph <namespace> --entity <name> [--attr k=v ...]",
  "  cog-graphs modify-item --graph <namespace> --entity <name> [--attr k=v ...]",
  "",
  "`add-item` refuses an entity that already exists and `modify-item` refuses one that",
  "does not, so the two never silently do each other's job.",
  "",
  "## Coming in cold",
  "",
  "  cog-graphs introduce --graph <namespace>",
  "",
  "Run this against an existing graph to be told what it is for and what convention it",
  "keeps. Every command answers `--help`; check it the first time you meet a surface",
  "rather than assuming the grammar has held still.",
].join("\n");

interface Help {
  summary: string;
  usage: string;
  required: Record<string, string>;
  optional: Record<string, string>;
  examples: string[];
  notes?: string[];
}

// Help is data, and it is a deliverable: DE-5 sweeps every command for its required
// flags and a runnable example, and the doc expects an agent to reach fluency from
// `--help` alone. Each entry answers the three things an Operator needs before they can
// act — what the command means, what it must be given, and one whole invocation.
const HELP: Record<string, Help> = {
  introduce: {
    summary:
      "Introduce the Cog Graph in this directory. With no graph present, introduces the system itself instead of erroring — this is the root of the self-documentation either way.",
    usage: "cog-graphs introduce [--graph <namespace>] [--interface-skill]",
    required: {},
    optional: {
      "--graph": "Which graph to introduce, when the directory holds more than one.",
      "--interface-skill":
        "Return the operator primer: everything needed to initialize and drive a graph from the CLI directly.",
    },
    examples: ["cog-graphs introduce", "cog-graphs introduce --interface-skill"],
  },
  initialize: {
    summary:
      "Spawn a Cog Graph from a profile: creates <namespace>.sqlite and the derived <namespace>.md beside it.",
    usage: "cog-graphs initialize --profile <file.yml> [--dir <path>]",
    required: {
      "--profile":
        "Path to a .yml carrying the profile: namespace, use-pattern, description, and a seed convention.",
    },
    optional: {
      "--dir": "Directory to create the graph in. Defaults to the working directory.",
    },
    examples: [
      "cog-graphs initialize --profile ./profile-game-recs.yml",
      "cog-graphs initialize --profile ./profile-game-recs.yml --dir 'E:/AI Resources'",
    ],
    notes: [
      "The artifact belongs to the User. Creating it under a temp directory is warned about, because a graph the User cannot find is a graph they do not have.",
    ],
  },
  query: {
    summary:
      "Pull items by attribute and value. An empty graph answers with an empty result, not an error.",
    usage: "cog-graphs query --graph <namespace> [--attr k=v ...] [--exclude k=v ...]",
    required: {},
    optional: {
      "--graph": "Which graph to query, when the directory holds more than one.",
      "--attr": "Include only items carrying this attribute/value pair. Repeatable.",
      "--exclude": "Drop items carrying this attribute/value pair. Repeatable.",
    },
    examples: [
      "cog-graphs query --graph game-recs",
      "cog-graphs query --graph game-recs --attr status=completed --exclude genre=horror",
    ],
    notes: [
      "Each attribute is a handhold: narrow repeated queries traverse the graph better than one broad one.",
    ],
  },
  "add-item": {
    summary: "Add one entity and its attribute/value pairs.",
    usage: "cog-graphs add-item --entity <name> [--graph <namespace>] [--attr k=v ...]",
    required: { "--entity": "The entity to create. Must not already exist." },
    optional: {
      "--graph": "Which graph to add to, when the directory holds more than one.",
      "--attr": "An attribute/value pair on the entity. Repeatable.",
    },
    examples: [
      "cog-graphs add-item --graph game-recs --entity 'Grand Theft Auto V' --attr status=completed",
    ],
    notes: ["An entity that already exists is refused; use modify-item to change it."],
  },
  import: {
    summary: "Bulk-ingest many items from a .yml in one invocation.",
    usage: "cog-graphs import --from <items.yml> [--graph <namespace>]",
    required: { "--from": "Path to a .yml holding the items to ingest." },
    optional: { "--graph": "Which graph to ingest into, when the directory holds more than one." },
    examples: ["cog-graphs import --graph game-recs --from ./games.yml"],
    notes: [
      "Partial with report: valid records are committed and invalid ones are rejected, never all-or-nothing. The report names each offender by identifier and by position, and the exit code is distinct from both clean success and total failure.",
    ],
  },
  "modify-item": {
    summary:
      "Change attribute/value pairs on an existing entity. Attributes not named are left alone.",
    usage: "cog-graphs modify-item --entity <name> [--graph <namespace>] [--attr k=v ...]",
    required: { "--entity": "The entity to change. Must already exist." },
    optional: {
      "--graph": "Which graph to modify, when the directory holds more than one.",
      "--attr": "An attribute/value pair to set. Repeatable.",
    },
    examples: [
      "cog-graphs modify-item --graph game-recs --entity 'Grand Theft Auto V' --attr taste-alignment=high",
    ],
    notes: ["An entity that does not exist is refused; use add-item to create it."],
  },
  "remove-item": {
    summary: "Remove one entity and everything recorded about it.",
    usage: "cog-graphs remove-item --entity <name> [--graph <namespace>]",
    required: { "--entity": "The entity to remove. Must already exist." },
    optional: { "--graph": "Which graph to remove from, when the directory holds more than one." },
    examples: ["cog-graphs remove-item --graph game-recs --entity 'Grand Theft Auto V'"],
  },
  convention: {
    summary:
      "Read the graph's convention — the expectations the graph keeps about its own schema and metadata — or append to it.",
    usage: "cog-graphs convention [--graph <namespace>] [--append <text>]",
    required: {},
    optional: {
      "--graph": "Which graph's convention, when the directory holds more than one.",
      "--append": "Add an expectation to the convention.",
    },
    examples: [
      "cog-graphs convention --graph game-recs",
      "cog-graphs convention --graph game-recs --append 'every game carries a status of played | playing | abandoned'",
    ],
    notes: [
      "The convention lives in the artifact, not the engine. It is yours to keep honest: it should describe the data you actually store.",
    ],
  },
};

/** Accepted by every command. */
const GLOBAL_FLAGS = ["--pretty", "--help"];

const EXIT = { OK: 0, USAGE: 1 } as const;

function succeed(payload: Record<string, unknown>): never {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exit(EXIT.OK);
}

/**
 * Errors go to stderr as JSON so an Operator can pipe stdout into a parser without a
 * failure corrupting the parse, and every one of them carries code / message / next_step
 * — an error an agent cannot act on just costs it a turn.
 */
function fail(status: number, code: string, message: string, next_step: string): never {
  process.stderr.write(`${JSON.stringify({ code, message, next_step })}\n`);
  process.exit(status);
}

if (command && flags.has("--help")) {
  const help = HELP[command];
  if (help) succeed({ command, ...help });
}

// Unknown options are rejected before anything else runs, so a typo never half-executes.
//
// The error deliberately does not echo the offending option. `--managed` is a real flag
// in a later version and is withheld from this one entirely, and echoing an unknown
// option would confirm its spelling to an Operator who guessed it. Listing what *is*
// recognized says nothing about what is withheld and is the more useful half anyway.
if (command && HELP[command]) {
  const recognized = new Set([
    ...Object.keys(HELP[command].required),
    ...Object.keys(HELP[command].optional),
    ...GLOBAL_FLAGS,
  ]);
  for (const token of argv.slice(1)) {
    if (!token.startsWith("--") || recognized.has(token)) continue;
    fail(
      EXIT.USAGE,
      "unknown_option",
      `${command} does not recognize that option. It accepts: ${[...recognized].join(", ")}.`,
      `Run 'cog-graphs ${command} --help' for the usage and a runnable example.`,
    );
  }
}

if (command === "introduce") {
  if (flags.has("--interface-skill")) {
    succeed({ scope: "system", primer: INTERFACE_SKILL_PRIMER });
  }
  succeed({ scope: "system", introduction: SYSTEM_INTRODUCTION });
}

process.exit(1);
