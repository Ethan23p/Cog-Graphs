#!/usr/bin/env bun
// Cog-Graphs engine — CLI entry point.
//
// The CLI is the UX and its user is an AI agent, so every answer is JSON on stdout and
// the process boundary is the whole contract.

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

const argv = process.argv.slice(2);
const command = argv[0];
const flags = new Set(argv.slice(1));

/**
 * The fields the profile schema declares. Named once here because both the writer and
 * the completeness check read it — the doc expects this list to grow ("probably more -
 * TBD") and a second copy is how it would grow out of step with itself.
 */
const PROFILE_FIELDS = ["namespace", "use-pattern", "description"] as const;

/**
 * The functional face. One file, self-contained, openable by anything that speaks
 * SQLite — the doc's requirement is that it "neatly contains *everything* functional",
 * so the profile and the convention live in here beside the data rather than in
 * companion files that can be separated from it.
 *
 * EAV rows hang off `entity` by id rather than repeating the name, which is what makes
 * "every EAV row resolves to a known entity" (IN-1) structural instead of a convention
 * the engine has to remember to honor.
 *
 * No WAL, deliberately: it would leave `-wal`/`-shm` files beside the database and
 * break IN-6, and one short-lived process per command needs no concurrency.
 */
const SCHEMA = `
  CREATE TABLE profile (
    field TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE convention (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    recorded_at TEXT NOT NULL
  );
  CREATE TABLE entity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE eav (
    entity_id INTEGER NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
    attribute TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (entity_id, attribute)
  );
`;

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
  "  profile:",
  "    namespace: game-recs",
  "    use-pattern: manual",
  "    description: Games Ethan has played and what he thought of them.",
  "  convention: |",
  "    Every game carries a status and a taste-alignment.",
  "",
  "  cog-graphs initialize --profile <profile.yml> [--dir <path>]",
  "",
  "The convention is the graph's own expectations about its schema — seed it with what",
  "you are actually about to store, and amend it as the shape of the data changes.",
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
        "Path to a .yml holding a 'profile:' map (namespace, use-pattern, description) and a 'convention:' string to seed the graph with.",
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

/**
 * Render the inspectable face.
 *
 * Two rules govern this file and both come straight from the doc. It is *derived*: the
 * engine writes it and never reads it, so anything only recorded here is not recorded.
 * And it is *for an observer* — the person or agent who found a `.sqlite` in a directory
 * and has no idea what it is — so it leads with what the graph is for and how to work
 * it, and the item listing comes after.
 */
function renderSidecar(dbPath: string): string {
  const db = new Database(dbPath, { readonly: true });
  try {
    const namespace =
      (
        db.query("SELECT value FROM profile WHERE field = 'namespace'").get() as
          | { value: string }
          | undefined
      )?.value ?? path.basename(dbPath, ".sqlite");
    const profile = db.query("SELECT field, value FROM profile").all() as {
      field: string;
      value: string;
    }[];
    const convention = (
      db.query("SELECT text FROM convention ORDER BY seq").all() as { text: string }[]
    ).map((r) => r.text);
    const entities = db.query("SELECT id, name FROM entity ORDER BY name").all() as {
      id: number;
      name: string;
    }[];
    const attributes = db
      .query("SELECT entity_id, attribute, value FROM eav ORDER BY attribute")
      .all() as { entity_id: number; attribute: string; value: string }[];

    const lines: string[] = [];
    lines.push(`# ${namespace}`, "");
    lines.push(
      "> Derived file — do not edit. The engine rewrites it whenever the graph changes,",
      `> and never reads it back. Everything real lives in \`${path.basename(dbPath)}\`.`,
      "",
    );
    lines.push(
      "This is a **Cog Graph**: a persistent store of entities and the attribute/value",
      "pairs recorded about them. It is meant to be worked through the `cog-graphs` CLI —",
      "`cog-graphs introduce --graph " + namespace + "` is the way in, and",
      "`cog-graphs introduce --interface-skill` is the full primer.",
      "",
    );

    lines.push("## Profile", "");
    for (const { field, value } of profile) lines.push(`- **${field}**: ${value}`);
    lines.push("");

    lines.push("## Convention", "");
    lines.push(
      "The expectations this graph keeps about its own shape. Amended as the data changes.",
      "",
    );
    if (convention.length === 0) lines.push("_None recorded._", "");
    else for (const text of convention) lines.push(`- ${text}`), lines.push("");

    lines.push("## Contents", "");
    if (entities.length === 0) {
      lines.push("_Empty — nothing has been added yet._", "");
    } else {
      lines.push(`${entities.length} ${entities.length === 1 ? "entity" : "entities"}.`, "");
      for (const entity of entities) {
        lines.push(`### ${entity.name}`, "");
        const own = attributes.filter((a) => a.entity_id === entity.id);
        if (own.length === 0) lines.push("_No attributes recorded._", "");
        else {
          for (const a of own) lines.push(`- **${a.attribute}**: ${a.value}`);
          lines.push("");
        }
      }
    }
    return lines.join("\n");
  } finally {
    db.close();
  }
}

/** Rewrite the inspectable face from the functional one. Called after every change. */
function writeSidecar(dbPath: string): void {
  const sidecar = path.join(path.dirname(dbPath), `${path.basename(dbPath, ".sqlite")}.md`);
  writeFileSync(sidecar, renderSidecar(dbPath));
}

/**
 * Is this path inside the platform temp root?
 *
 * Compared through `path.relative` rather than a string prefix, so a sibling directory
 * that merely starts with the same characters is not mistaken for a child — the guard
 * only stays worth reading if it does not fire on directories that are fine.
 */
function isUnderTempRoot(dir: string): boolean {
  const rel = path.relative(realpathish(tmpdir()), realpathish(dir));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** realpath where possible; the literal path where it does not resolve. */
function realpathish(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

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

// Every required flag is checked from the help entry, so the check cannot drift from
// what help promises — the two read the same table.
if (command && HELP[command]) {
  for (const flag of Object.keys(HELP[command].required)) {
    if (!flags.has(flag)) {
      fail(
        EXIT.USAGE,
        "missing_option",
        `${command} requires ${flag}: ${HELP[command].required[flag]}`,
        `Run 'cog-graphs ${command} --help' for a runnable example.`,
      );
    }
  }
}

/** The value following a flag, e.g. `--profile ./p.yml`. */
function optionValue(flag: string): string | undefined {
  const at = argv.indexOf(flag);
  if (at === -1) return undefined;
  const next = argv[at + 1];
  return next && !next.startsWith("--") ? next : undefined;
}

if (command === "initialize") {
  const profilePath = optionValue("--profile");
  if (!profilePath) {
    fail(
      EXIT.USAGE,
      "missing_value",
      "--profile needs the path to a .yml file.",
      "Write the profile to a .yml, then pass its path: cog-graphs initialize --profile ./profile.yml",
    );
  }

  const resolved = path.resolve(process.cwd(), profilePath);
  if (!existsSync(resolved)) {
    fail(
      EXIT.NOT_FOUND,
      "profile_not_found",
      `No profile file at ${resolved}.`,
      "Write the profile to a .yml first, then pass that path to --profile.",
    );
  }

  let document: unknown;
  try {
    document = Bun.YAML.parse(readFileSync(resolved, "utf8"));
  } catch (cause) {
    fail(
      EXIT.USAGE,
      "profile_unparseable",
      `${resolved} is not valid YAML: ${(cause as Error).message}`,
      "Fix the YAML and run initialize again. Quoting every value is the safe default.",
    );
  }

  const doc = (document ?? {}) as Record<string, unknown>;
  const profile = (doc.profile ?? {}) as Record<string, unknown>;
  // The convention is required at initialize, not optional. The doc has it "seeded upon
  // initialization" and treats it as always present when an agent touches a graph, so a
  // graph that starts without one starts with the discipline already broken — and there
  // is no moment later at which anyone is prompted to supply it.
  const seedConvention = typeof doc.convention === "string" ? doc.convention.trim() : "";
  const missing = PROFILE_FIELDS.filter((field) => typeof profile[field] !== "string");
  if (missing.length > 0) {
    fail(
      EXIT.USAGE,
      "profile_incomplete",
      `The profile is missing: ${missing.join(", ")}.`,
      `Add the missing field(s) under 'profile:' in ${resolved}. Every profile needs: ${PROFILE_FIELDS.join(", ")}.`,
    );
  }

  if (seedConvention.length === 0) {
    fail(
      EXIT.USAGE,
      "convention_missing",
      "The profile file carries no 'convention:' to seed the graph with.",
      `Add a 'convention:' string to ${resolved} describing the shape of the data you are about to store — the attributes you will actually use, and what their values mean.`,
    );
  }

  const namespace = profile.namespace as string;
  const dir = path.resolve(process.cwd(), optionValue("--dir") ?? ".");

  // The quiet failure this catches: an Assistant initializes the graph inside its own
  // ephemeral environment, every command succeeds, and the User never sees the artifact
  // again. It is a warning rather than a refusal because a Cog Graph used as a scratch
  // resource is legitimate — the Operator is told what they are trading away and gets to
  // decide. It rides in the payload rather than on stderr so success stays one parseable
  // object on one stream (IN-9).
  const warnings: { code: string; message: string; next_step: string }[] = [];
  if (isUnderTempRoot(dir)) {
    warnings.push({
      code: "temp_directory",
      message:
        `This graph is being created under the platform temp directory (${tmpdir()}). Artifacts there are ` +
        `routinely deleted by the operating system and are usually invisible to the User, so the graph and ` +
        `everything put into it can disappear without anyone being told.`,
      next_step: `If this graph is meant to last, re-run initialize with --dir pointing somewhere the User owns, e.g. cog-graphs initialize --profile <file.yml> --dir <path>. If it is deliberately scratch, no action is needed.`,
    });
  }
  const dbPath = path.join(dir, `${namespace}.sqlite`);
  if (existsSync(dbPath)) {
    fail(
      EXIT.ALREADY_EXISTS,
      "graph_exists",
      `A graph named '${namespace}' already lives at ${dbPath}.`,
      `Use it as it is — 'cog-graphs introduce --graph ${namespace}' — or choose a different namespace in the profile.`,
    );
  }
  mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath, { create: true });
  db.exec(SCHEMA);
  const insertField = db.prepare("INSERT INTO profile (field, value) VALUES (?, ?)");
  for (const field of PROFILE_FIELDS) {
    insertField.run(field, profile[field] as string);
  }
  db.prepare("INSERT INTO convention (text, recorded_at) VALUES (?, ?)").run(
    seedConvention,
    new Date().toISOString(),
  );
  db.close();
  writeSidecar(dbPath);

  succeed({ graph: namespace, path: dbPath, sidecar: path.join(dir, `${namespace}.md`), warnings, profile: Object.fromEntries(PROFILE_FIELDS.map((f) => [f, profile[f]])) });
}

/**
 * Find the graph a command is about.
 *
 * Naming it is always allowed; omitting it is a convenience that only holds while the
 * answer is unambiguous. When it is not, the engine says what it found rather than
 * picking — an Operator who meant graph A and silently got graph B has no way to notice.
 */
function resolveGraph(): { namespace: string; dbPath: string } {
  const dir = process.cwd();
  const requested = optionValue("--graph");
  if (requested) {
    const dbPath = path.join(dir, `${requested}.sqlite`);
    if (existsSync(dbPath)) return { namespace: requested, dbPath };
    const present = listGraphs(dir);
    fail(
      EXIT.NOT_FOUND,
      "graph_not_found",
      `No graph named '${requested}' in ${dir}.`,
      present.length > 0
        ? `This directory holds: ${present.join(", ")}. Use one of those, or create '${requested}' with cog-graphs initialize --profile <file.yml>.`
        : `This directory holds no graphs at all. Create one with cog-graphs initialize --profile <file.yml>.`,
    );
  }

  const present = listGraphs(dir);
  if (present.length === 1) return { namespace: present[0], dbPath: path.join(dir, `${present[0]}.sqlite`) };
  if (present.length === 0) {
    fail(
      EXIT.NOT_FOUND,
      "no_graph_here",
      `No graph in ${dir}.`,
      "Create one with cog-graphs initialize --profile <file.yml>, or run the command from the directory that holds the graph.",
    );
  }
  fail(
    EXIT.AMBIGUOUS,
    "ambiguous_graph",
    `${dir} holds more than one graph: ${present.join(", ")}.`,
    `Name the one you mean with --graph, e.g. --graph ${present[0]}.`,
  );
}

/** Namespaces of the graphs sitting in a directory, sorted. */
function listGraphs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sqlite"))
    .map((name) => name.slice(0, -".sqlite".length))
    .sort();
}

/** Every entity with its attribute/value pairs, entity name ascending. */
function readItems(db: Database): { entity: string; attributes: Record<string, string> }[] {
  const entities = db.query("SELECT id, name FROM entity ORDER BY name").all() as {
    id: number;
    name: string;
  }[];
  const attributes = db.query("SELECT entity_id, attribute, value FROM eav").all() as {
    entity_id: number;
    attribute: string;
    value: string;
  }[];
  return entities.map((entity) => ({
    entity: entity.name,
    attributes: Object.fromEntries(
      attributes.filter((a) => a.entity_id === entity.id).map((a) => [a.attribute, a.value]),
    ),
  }));
}

/** Every value given for a repeatable flag, in the order the Operator wrote them. */
function optionValues(flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== flag) continue;
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) out.push(next);
  }
  return out;
}

/**
 * Parse `--attr key=value` pairs.
 *
 * Split on the *first* `=` only, so a value may contain `=` freely (DE-23). The
 * alternative — splitting on every `=` and rejecting the rest — would quietly refuse
 * perfectly ordinary values like a URL with a query string.
 */
function parseAttrs(flag = "--attr"): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const raw of optionValues(flag)) {
    const at = raw.indexOf("=");
    if (at <= 0) {
      fail(
        EXIT.USAGE,
        "malformed_attribute",
        `'${raw}' is not a key=value pair.`,
        `Write the attribute as ${flag} key=value, e.g. ${flag} status=completed. The value may itself contain '=' — only the first one separates.`,
      );
    }
    attrs[raw.slice(0, at)] = raw.slice(at + 1);
  }
  return attrs;
}

if (command === "add-item") {
  const { namespace, dbPath } = resolveGraph();
  const entity = optionValue("--entity");
  if (!entity) {
    fail(
      EXIT.USAGE,
      "missing_value",
      "--entity needs the name of the entity to add.",
      `Name it: cog-graphs add-item --graph ${namespace} --entity <name> [--attr key=value ...]`,
    );
  }
  const attributes = parseAttrs();

  const db = new Database(dbPath);
  const existing = db.query("SELECT id FROM entity WHERE name = ?").get(entity) as
    | { id: number }
    | undefined;
  if (existing) {
    db.close();
    fail(
      EXIT.ALREADY_EXISTS,
      "entity_exists",
      `'${entity}' is already in ${namespace}.`,
      `Use modify item instead: cog-graphs modify-item --graph ${namespace} --entity '${entity}' --attr key=value`,
    );
  }

  // Exactly what was supplied and nothing else — no inferred attributes, no defaults.
  // The doc's default assumption is source data at source fidelity, and an engine that
  // helpfully adds a field is an engine putting words in the Operator's mouth.
  const { lastInsertRowid } = db
    .prepare("INSERT INTO entity (name, created_at) VALUES (?, ?)")
    .run(entity, new Date().toISOString());
  const insertAttr = db.prepare("INSERT INTO eav (entity_id, attribute, value) VALUES (?, ?, ?)");
  for (const [attribute, value] of Object.entries(attributes)) {
    insertAttr.run(lastInsertRowid as number, attribute, value);
  }
  db.close();
  writeSidecar(dbPath);

  succeed({ graph: namespace, entity, attributes, added: true });
}

if (command === "query") {
  const { namespace, dbPath } = resolveGraph();
  const db = new Database(dbPath, { readonly: true });
  const items = readItems(db);
  db.close();
  // An empty graph answers with the same shape as a full one — same fields, same types.
  // Answering `{}` or a null items list when empty would force every caller to write the
  // branch twice, and would teach an Operator that a new graph is a broken one.
  succeed({ graph: namespace, count: items.length, items });
}

if (command === "introduce") {
  if (flags.has("--interface-skill")) {
    succeed({ scope: "system", primer: INTERFACE_SKILL_PRIMER });
  }
  succeed({ scope: "system", introduction: SYSTEM_INTRODUCTION });
}

process.exit(1);
