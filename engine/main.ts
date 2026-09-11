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

/**
 * Accepted by every command, and therefore never a command themselves.
 *
 * Declared here rather than beside the help tables because the command is derived from
 * this list: `--pretty query` and `query --pretty` are the same request, and an Operator
 * who writes the flag first has not made a mistake (DE-19.8.1).
 */
const GLOBAL_FLAGS = ["--pretty", "--help"];

/**
 * The command is the first token that is not a global flag.
 *
 * Reading `argv[0]` directly meant `cog-graphs --pretty` was answered with
 * "'--pretty' is not a cog-graphs command" — at the exact moment a person took the
 * overview's own advice ("Add --pretty for the human-readable form") literally, with
 * nothing else typed yet. An interface that names a flag and then rejects it as a command
 * has misdirected the one Operator who was doing what it asked.
 */
const commandIndex = argv.findIndex((token) => !GLOBAL_FLAGS.includes(token));
const command = commandIndex === -1 ? undefined : argv[commandIndex];
const flags = new Set(argv.filter((_, i) => i !== commandIndex));

/**
 * The fields the profile schema declares. Named once here because both the writer and
 * the completeness check read it — the doc expects this list to grow ("probably more -
 * TBD") and a second copy is how it would grow out of step with itself.
 */
const PROFILE_FIELDS = ["namespace", "use-pattern", "description"] as const;

// use-pattern stays in the artifact so the manual/managed structure survives into later
// versions, but v0.3.1 has only 'manual' and the doc keeps the distinction out of view:
// "From the user-facing side, there is no such thing as `--managed`, yet." So it is
// defaulted rather than asked for, and withheld from every rendered surface — the primer,
// --help, the initialize payload, introduce, and the sidecar. Ethan, 2026-09-11: "it's not
// meaningful in v0.3.1, so it shouldn't be presented in the Operator/User-facing
// experience." When managed lands, this is the switch to remove.
const PROFILE_DEFAULTS: Record<string, string> = { "use-pattern": "manual" };
const WITHHELD_PROFILE_FIELDS = new Set<string>(["use-pattern"]);
const shownProfileFields = PROFILE_FIELDS.filter((f) => !WITHHELD_PROFILE_FIELDS.has(f));

// The two files an Operator writes for the CLI, as samples it accepts verbatim. They are
// served under 'files' in the --help of the command that takes them, and the primer shows
// the same text, so there is one source for each shape (DE-5.1). DE-5.1 imports them back
// through the real parser, so help cannot drift from what the command accepts.
//
// The items shape is add-item in data form, and it is exactly what `query` returns, so a
// query's output imports as it is. Ethan ratified it on 2026-09-11.
const PROFILE_SAMPLE = [
  "profile:",
  "  namespace: my-list",
  "  description: What this graph is for, in the User's words.",
  "convention: |",
  "  Every item carries a status.",
  "",
].join("\n");
const ITEMS_SAMPLE = [
  "items:",
  "  - entity: First item",
  "    attributes:",
  "      status: open",
  "  - entity: Second item",
  "    attributes:",
  "      status: done",
  "      note: Anything the User said about it.",
  "",
].join("\n");
const indented = (text: string) => text.trimEnd().split("\n").map((line) => "  " + line);

/**
 * `introduce` answers as one of two things and the payload says which, so an Operator
 * never has to infer from the shape whether they were told about a graph or about the
 * system. Mirrors INTRO_SCOPE in the test contract.
 */
/** The binary's own name, as it appears in every example and error the engine emits. */
const BINARY = "cog-graphs";

/**
 * Commands the grammar documents that the engine has not built yet.
 *
 * Named explicitly rather than inferred from a missing branch, so the honesty is
 * deliberate: an Operator is told "not yet" instead of meeting silence. Each entry
 * leaves as its slice lands — `import` at DE-19/DE-20, `convention` at DE-21 — and the
 * set going empty is what retires DE-19.3.
 */
const UNBUILT = new Set<string>([]);

/** What to do in the meantime, per unbuilt command. Vague advice is not a next step. */
const UNBUILT_NEXT_STEP: Record<string, string> = {};

const INTRO_SCOPE_SYSTEM = "system";
const INTRO_SCOPE_INSTANCE = "instance";

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
  "(a namespace, a description, and a seed convention), then run:",
  "  cog-graphs initialize --profile <file.yml>",
].join("\n");

// The primer an Operator gets from `introduce --interface-skill`: everything needed to
// initialize and use a Cog Graph directly, and nothing else. It is the whole priming an
// agent operating the CLI is guaranteed to have, so every command the Walking Skeleton
// walks appears here in runnable form (DE-2).
//
// Its worked example — and every example in HELP below — is deliberately domain-neutral.
// An Operator copies the example it is shown: in the Walking Skeleton run of
// 2026-09-09T20-59, when the example here was a games list, the agent's profile reproduced
// it almost word for word, down to a name the User never gave. That makes the example part
// of the product's behavior, and it means an eval in the example's domain cannot tell a
// designed profile from a transcribed one. Keep examples free of any subject matter.
const INTERFACE_SKILL_PRIMER = [
  "# Operating a Cog Graph directly",
  "",
  "A Cog Graph is an EAV store: entities carry attribute/value pairs. It lives as two",
  "files in a directory the User owns — `<namespace>.sqlite`, which holds everything,",
  "and a derived `<namespace>.md` beside it, which is written for inspection and is never",
  "a source of truth. Do not hand-edit the `.md`; do not put either file in a temp directory,",
  "or the User loses the thing they were meant to keep.",
  "",
  "## Spawn one",
  "",
  "Establish the profile with the User conversationally — a namespace, and a",
  "description in their words — then write it to a one-time-use `.yml` and pass it in:",
  "",
  ...indented(PROFILE_SAMPLE),
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
  "To bring in many at once, write them to a .yml and import it. The file is the shape",
  "`query` returns, so a query's output imports as it is:",
  "",
  ...indented(ITEMS_SAMPLE),
  "",
  "  cog-graphs import --graph <namespace> --from <items.yml>",
  "",
  "Import is partial with report: valid records land, and each rejected one is named.",
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
  /** A sample of each file a flag takes, accepted verbatim by the command (DE-5.1). */
  files?: Record<string, string>;
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
        "Path to a .yml holding a 'profile:' map (namespace, description) and a 'convention:' string to seed the graph with. A sample is under 'files'.",
    },
    optional: {
      "--dir": "Directory to create the graph in. Defaults to the working directory.",
    },
    files: { "--profile": PROFILE_SAMPLE },
    examples: [
      "cog-graphs initialize --profile ./profile.yml",
      "cog-graphs initialize --profile ./profile.yml --dir 'D:/Shared Files'",
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
      "cog-graphs query --graph my-list",
      "cog-graphs query --graph my-list --attr status=open --exclude priority=low",
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
      "cog-graphs add-item --graph my-list --entity 'First item' --attr status=open",
    ],
    notes: ["An entity that already exists is refused; use modify-item to change it."],
  },
  import: {
    summary: "Bulk-ingest many items from a .yml in one invocation.",
    usage: "cog-graphs import --from <items.yml> [--graph <namespace>]",
    required: {
      "--from":
        "Path to a .yml holding the items to ingest. A sample is under 'files'; it is the shape query returns.",
    },
    optional: { "--graph": "Which graph to ingest into, when the directory holds more than one." },
    files: { "--from": ITEMS_SAMPLE },
    examples: ["cog-graphs import --graph my-list --from ./items.yml"],
    notes: [
      "Partial with report: valid records are committed and invalid ones are rejected, never all-or-nothing. The exit code is distinct from both clean success and total failure, and the report arrives on stderr carrying 'ingested' and a 'rejected' list that names each offender by 'entity' and by 'index' — its zero-based position in the source's items list.",
      "A record is rejected on the same terms add-item would refuse it: an entity the graph already holds, or one already named earlier in the same file. Fix the named records and re-run import on a .yml holding only those.",
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
      "cog-graphs modify-item --graph my-list --entity 'First item' --attr status=done",
    ],
    notes: ["An entity that does not exist is refused; use add-item to create it."],
  },
  "remove-item": {
    summary: "Remove one entity and everything recorded about it.",
    usage: "cog-graphs remove-item --entity <name> [--graph <namespace>]",
    required: { "--entity": "The entity to remove. Must already exist." },
    optional: { "--graph": "Which graph to remove from, when the directory holds more than one." },
    examples: ["cog-graphs remove-item --graph my-list --entity 'First item'"],
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
      "cog-graphs convention --graph my-list",
      "cog-graphs convention --graph my-list --append 'every item carries a status of open | done'",
    ],
    notes: [
      "The convention lives in the artifact, not the engine. It is yours to keep honest: it should describe the data you actually store.",
    ],
  },
};

/**
 * Render the inspectable face.
 *
 * Two rules govern this file and both come straight from the doc. It is *derived*: no
 * content is ever taken from it, so anything only recorded here is not recorded. The
 * engine does open it: writeSidecar compares the rendering against what is on disk to skip
 * a no-op rewrite (IN-4), then discards what it read. Nothing from the file reaches the
 * artifact or an answer. Worth stating precisely, because "never read" is a claim about
 * trust rather than about file handles, and it is the claim the Operator relies on.
 * And it is *for an observer* — the person or agent who found a `.sqlite` in a directory
 * and has no idea what it is — so it leads with what the graph is for and how to work
 * it, and the item listing comes after.
 */
/**
 * One line, always.
 *
 * The sidecar is interpolated Markdown, so any datum that can introduce a line can
 * introduce a *heading* — an entity named "Sword\n\n### Shield" renders an entity that
 * does not exist (DE-19.7). The database is the authority and keeps what it was given,
 * which is exactly why the rendering is where this is dealt with: the fix must not reach
 * back and edit the User's data.
 *
 * Line breaks become a visible `\n`, so the value stays legible and stays one line.
 * Nothing else is touched — backslashes especially are left alone, because `C:\games` is
 * an ordinary value in this domain and doubling it would make every sidecar pay for the
 * rare case.
 */
function inline(value: string): string {
  return value.replace(/\r\n|\r|\n/g, "\\n");
}

function renderSidecar(dbPath: string): string {
  const db = new Database(dbPath, { readonly: true });
  try {
    const namespace =
      (
        db.query("SELECT value FROM profile WHERE field = 'namespace'").get() as
          | { value: string }
          | undefined
      )?.value ?? path.basename(dbPath, ".sqlite");
    const profile = (db.query("SELECT field, value FROM profile").all() as {
      field: string;
      value: string;
    }[]).filter((r) => !WITHHELD_PROFILE_FIELDS.has(r.field));
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
    lines.push(`# ${inline(namespace)}`, "");
    lines.push(
      "> Derived file — do not edit. The engine rewrites it whenever the graph changes,",
      `> and never takes anything back from it. Everything real lives in \`${path.basename(dbPath)}\`.`,
      "",
    );
    lines.push(
      "This is a **Cog Graph**: a persistent store of entities and the attribute/value",
      "pairs recorded about them. It is meant to be worked through the `cog-graphs` CLI —",
      "`cog-graphs introduce --graph " + inline(namespace) + "` is the way in, and",
      "`cog-graphs introduce --interface-skill` is the full primer.",
      "",
    );

    lines.push("## Profile", "");
    for (const { field, value } of profile) lines.push(`- **${inline(field)}**: ${inline(value)}`);
    lines.push("");

    lines.push("## Convention", "");
    lines.push(
      "The expectations this graph keeps about its own shape. Amended as the data changes.",
      "",
    );
    if (convention.length === 0) lines.push("_None recorded._", "");
    else for (const text of convention) lines.push(`- ${inline(text)}`), lines.push("");

    lines.push("## Contents", "");
    if (entities.length === 0) {
      lines.push("_Empty — nothing has been added yet._", "");
    } else {
      lines.push(`${entities.length} ${entities.length === 1 ? "entity" : "entities"}.`, "");
      for (const entity of entities) {
        lines.push(`### ${inline(entity.name)}`, "");
        const own = attributes.filter((a) => a.entity_id === entity.id);
        if (own.length === 0) lines.push("_No attributes recorded._", "");
        else {
          for (const a of own) lines.push(`- **${inline(a.attribute)}**: ${inline(a.value)}`);
          lines.push("");
        }
      }
    }
    return lines.join("\n");
  } finally {
    db.close();
  }
}

/**
 * Rewrite the inspectable face from the functional one.
 *
 * Written only when the rendering actually differs from what is on disk. The sidecar is a
 * pure function of the artifact, so an identical rewrite is a no-op that costs an mtime —
 * and an mtime that moves when nothing changed is a lie told to anyone watching the
 * directory. It also makes this safe to call on the read path (IN-4).
 */
function writeSidecar(dbPath: string): void {
  const sidecar = path.join(path.dirname(dbPath), `${path.basename(dbPath, ".sqlite")}.md`);
  const rendered = renderSidecar(dbPath);
  try {
    if (existsSync(sidecar) && readFileSync(sidecar, "utf8") === rendered) return;
    writeFileSync(sidecar, rendered);
  } catch (cause) {
    // Which face is authoritative decides this. The artifact is; the sidecar is a view of
    // it. So a view that cannot be refreshed is a warning, never a failure — the answer
    // the command gives is still correct, and on a write the artifact has already been
    // committed, so failing here would report a loss that did not happen and invite the
    // Operator to redo work that is already done (IN-4.1).
    //
    // The User who hits this is usually the careful one: the file's own banner says
    // "Derived file — do not edit", so they made it read-only. A synced folder or a
    // read-only mount arrives at the same place without anyone deciding anything.
    runtimeWarnings.push({
      code: "sidecar_unwritable",
      message:
        `The derived ${path.basename(sidecar)} could not be rewritten (${(cause as Error).message}), so it no longer ` +
        `reflects the graph. Nothing was lost: everything real lives in ${path.basename(dbPath)}, and this command's answer is unaffected.`,
      next_step: `Make ${path.basename(sidecar)} writable, or delete it, then run any command against this graph to regenerate it.`,
    });
  }
}

/**
 * Is this path inside the platform temp root?
 *
 * Compared through `path.relative` rather than a string prefix, so a sibling directory
 * that merely starts with the same characters is not mistaken for a child — the guard
 * only stays worth reading if it does not fire on directories that are fine.
 */
function isUnderTempRoot(dir: string): boolean {
  const rel = path.relative(realpathish(tmpdir()), realpathish(nearestExisting(dir)));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * The closest ancestor of `dir` that exists — `dir` itself when it does.
 *
 * A path that does not exist cannot be realpath'd, so on a platform where the temp root
 * is a symlink (macOS: /var/folders behind /private/var) the guard was comparing an
 * unresolved path against a resolved one and quietly not firing. The ancestor resolves,
 * and a directory's temp-ness is a property of where it sits, so this answers the same
 * question with a path the filesystem can actually speak about (DE-7.1).
 */
function nearestExisting(dir: string): string {
  let at = dir;
  while (!existsSync(at)) {
    const parent = path.dirname(at);
    if (parent === at) return at;
    at = parent;
  }
  return at;
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

/**
 * The exit-code alphabet, verbatim from the doc:
 * `0 ok ; 1 usage/unknown option ; 2 not found ; 3 already exists ; 4 partial ingestion ;
 *  5 ambiguous target ; 6 = internal`
 *
 * Whole, not as-needed. A partial map is worse than none: `EXIT.ALREADY_EXISTS` on an
 * object that does not define it is `undefined`, `process.exit(undefined)` exits 0, and
 * the command reports a failure on stderr while telling the shell it succeeded.
 */
const EXIT = {
  OK: 0,
  USAGE: 1,
  NOT_FOUND: 2,
  ALREADY_EXISTS: 3,
  PARTIAL: 4,
  AMBIGUOUS: 5,
  INTERNAL: 6,
} as const;

/**
 * Warnings raised by the machinery rather than by the command, collected as they happen
 * and merged into whatever payload is on its way out (IN-4.1). A warning about the
 * derived face belongs in the answer of the command that noticed, not on stderr — success
 * stays one parseable object on one stream (IN-9).
 */
const runtimeWarnings: { code: string; message: string; next_step: string }[] = [];

function succeed(payload: Record<string, unknown>): never {
  // The key is preserved when the command supplied one, even empty: initialize always
  // reports a warnings array and DE-7 reads it either way.
  const supplied = Object.prototype.hasOwnProperty.call(payload, "warnings");
  const warnings = [...((supplied ? payload.warnings : []) as unknown[]), ...runtimeWarnings];
  if (supplied || warnings.length > 0) payload = { ...payload, warnings };
  process.stdout.write(PRETTY ? `${prettyText(payload)}\n` : `${JSON.stringify(payload)}\n`);
  process.exit(EXIT.OK);
}

/** Was --pretty asked for? Read once, so every writer answers the same way. */
const PRETTY = argv.includes("--pretty");

/**
 * The human-readable form (DE-19.8).
 *
 * JSON is the default because the Operator is an agent and the output is usually piped;
 * `--pretty` is for the moments a person is reading over its shoulder. The renderer is
 * generic — it walks the payload rather than knowing any command's shape — so a command
 * added later is readable without anyone remembering to teach this function about it.
 *
 * The case it exists for is prose. `introduce --interface-skill` is the whole primer, and
 * as JSON it arrives as a single enormous line with every paragraph break spelled
 * backslash-n. Multi-line strings are therefore reflowed as real lines rather than
 * quoted, which is the one thing JSON structurally cannot do.
 */
function prettyText(payload: Record<string, unknown>): string {
  return prettyLines(payload, "").join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Reflow a multi-line string as real lines, or fold it onto one?
 *
 * Both, depending on whose text it is. The top-level fields of a payload are written by
 * the engine — the primer, the introduction, a summary — and reflowing them is the entire
 * reason `--pretty` exists (DE-19.8). Everything nested below that is the Operator's own
 * data: an entity, an attribute, a value. Reflowing *that* lets it forge payload fields,
 * because an attribute value of "count: 999" rendered on its own line is indistinguishable
 * from a field the payload actually has (DE-19.7.1).
 *
 * The depth is the line, and it is a real one rather than a convenient one: it is exactly
 * the boundary between text this program wrote and text it was handed.
 */
function prettyLines(value: unknown, indent: string, depth = 0): string[] {
  if (value === null || value === undefined) return [`${indent}—`];

  if (Array.isArray(value)) {
    if (value.length === 0) return [`${indent}(none)`];
    const out: string[] = [];
    for (const item of value) {
      if (item !== null && typeof item === "object") {
        // A bullet on the item's first line, so the boundary between two items is
        // something the reader can see and count rather than infer from a blank line —
        // which vanishes exactly when an item has nothing in it (DE-19.8.2).
        const rendered = prettyLines(item, indent + "  ", depth + 1);
        if (rendered.length > 0) rendered[0] = `${indent}- ${rendered[0].trimStart()}`;
        out.push(...rendered, "");
      } else {
        out.push(`${indent}- ${depth === 0 ? String(item) : inline(String(item))}`);
      }
    }
    return out;
  }

  if (typeof value === "object") {
    const out: string[] = [];
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      // Keys are snake_case in the payload because that is what a parser wants; a reader
      // wants words. The label is the only cosmetic liberty taken with the data.
      const label = key.replace(/_/g, " ");
      if (child !== null && typeof child === "object") {
        // Emptiness is a fact about the data, so it is rendered as one. A bare label with
        // nothing beneath it cannot be told apart from a renderer that stopped, and the
        // reader has no way to check (DE-19.8.2).
        const rendered = prettyLines(child, indent + "  ", depth + 1);
        if (rendered.length === 0) out.push(`${indent}${label}: (none)`);
        else out.push(`${indent}${label}:`, ...rendered, "");
      } else if (typeof child === "string" && child.includes("\n") && depth > 0) {
        out.push(`${indent}${label}: ${inline(child)}`);
      } else if (typeof child === "string" && child.includes("\n")) {
        out.push(`${indent}${label}:`, "");
        for (const line of child.split("\n")) out.push(line ? `${indent}  ${line}` : "");
        out.push("");
      } else {
        out.push(`${indent}${label}: ${String(child)}`);
      }
    }
    return out;
  }

  return [`${indent}${String(value)}`];
}

/**
 * Errors go to stderr as JSON so an Operator can pipe stdout into a parser without a
 * failure corrupting the parse, and every one of them carries code / message / next_step
 * — an error an agent cannot act on just costs it a turn.
 */
function fail(
  status: number,
  code: string,
  message: string,
  next_step: string,
  detail: Record<string, unknown> = {},
): never {
  // --pretty covers failures too: an Operator who asked for readable output asked about
  // the whole surface, and an error is the moment they are most likely to be reading it
  // themselves. Only the braces go — what went wrong and what to do next are what make
  // the error actionable, so both survive the change of form (IN-11, DE-19.8).
  process.stderr.write(
    PRETTY
      ? `${prettyText({ error: code, message, next_step, ...detail })}\n`
      : `${JSON.stringify({ code, message, next_step, ...detail })}\n`,
  );
  process.exit(status);
}

/**
 * The overview: what this is, and every command there is.
 *
 * This is the front door. An agent given only the binary name types `cog-graphs --help`
 * first, and what it gets back is the whole of its priming. Naming every command matters
 * more than it looks — an agent that has to guess which commands exist guesses the ones
 * it knows from other tools, and then reports that the tool is broken.
 */
function overview() {
  return {
    binary: BINARY,
    summary:
      "Spawn and manipulate Cog Graphs: persistent, structured stores of entities and the attribute/value pairs recorded about them. Each graph is a .sqlite file in a directory you choose, with a derived .md beside it for inspection.",
    commands: Object.entries(HELP).map(([name, help]) => ({ name, summary: help.summary })),
    getting_started: [
      `${BINARY} introduce --interface-skill   # the full primer for driving this directly`,
      `${BINARY} introduce                      # what the graph in this directory is for`,
      `${BINARY} <command> --help               # usage and a runnable example`,
    ],
    output:
      "Every command answers with JSON on stdout; failures write a JSON error to stderr carrying code, message and next_step. Add --pretty for the human-readable form.",
  };
}

// Asking a tool what it is has not gone wrong, so the overview is a success rather than
// a usage error. A line of nothing but global flags lands here — `--help` and `--pretty`
// alone both mean "what is this" — because the command derivation above leaves `command`
// undefined when there is no non-flag token to find.
if (!command || (command === "help" && argv.length === 1)) {
  succeed(overview());
}

if (command && flags.has("--help")) {
  const help = HELP[command];
  if (help) {
    // An unbuilt command says so in its own help, not only once the Operator has run it
    // and failed. Reading the docs should be enough to learn this; driven off the same
    // UNBUILT set, so the caveat disappears when the command lands.
    const status = UNBUILT.has(command)
      ? { status: "not_implemented", status_note: UNBUILT_NEXT_STEP[command] }
      : {};
    succeed({ command, ...help, ...status });
  }
}

// A leading token that looks like a flag is a mis-written flag, not a mis-written
// command, and saying so is the difference between a useful next move and a wild one:
// told "'--nonsense' is not a command", an agent starts guessing command names, which is
// the one thing that cannot help (DE-19.8.1).
if (command && command.startsWith("--")) {
  fail(
    EXIT.USAGE,
    "unknown_option",
    `${BINARY} does not recognize the option '${command}'. Before a command it accepts: ${GLOBAL_FLAGS.join(", ")}.`,
    `Every other option belongs after its command, e.g. '${BINARY} query --graph <ns>'. Run '${BINARY} --help' for the commands.`,
  );
}

// An unrecognized command is where an agent's guess lands, so the error is written for
// recovery rather than for the record: it names every command that does exist, which
// turns a dead end into one more turn.
if (!HELP[command]) {
  fail(
    EXIT.USAGE,
    "unknown_command",
    `'${command}' is not a ${BINARY} command.`,
    `The commands are: ${Object.keys(HELP).join(", ")}. Run '${BINARY} --help' for an overview, or '${BINARY} <command> --help' for one command's usage.`,
  );
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

// Syntax before semantics: a documented flag written without a value fails here, ahead
// of the missing-required-flag check below.
//
// Both diagnoses are true of `import --graph` — `--graph` has no value AND `--from` is
// absent — so the only question is which one an Operator can act on. The dangling flag is
// the more specific and more local answer: it names a token actually present in the
// command line and says what is wrong with it, where "import requires --from" ignores the
// broken thing just written. It is also the likelier defect in practice, because a value
// that vanished into shell quoting or a template leaves exactly this shape behind.
//
// The uniform rule is what DE-19.6.1 sweeps for: every value-taking flag in the grammar
// reaches the missing-value rule, on every command, no matter what else is wrong with the
// invocation. Deciding this per command is how the rule goes selectively true.
//
// Booleans are excluded because for them a bare flag is the correct spelling.
if (command && HELP[command]) {
  const valueless = new Set<string>(["--interface-skill", ...GLOBAL_FLAGS]);
  const documented = new Set([
    ...Object.keys(HELP[command].required),
    ...Object.keys(HELP[command].optional),
  ]);
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!documented.has(token) || valueless.has(token)) continue;
    valueAfter(token, i);
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

/**
 * The value following a flag, e.g. `--profile ./p.yml`, or undefined if the flag was
 * never written.
 *
 * A flag written *without* a value is not the same thing as a flag left off, and the two
 * must not collapse into one `undefined` (DE-19.6). An Operator who writes `--dir` has
 * stated an intention; if the value did not survive whatever produced the command line,
 * a guess is the one response that cannot be right, because the guess is invisible.
 * `--dir` defaulted to the working directory this way — silently putting the User's
 * artifact somewhere other than where it was asked to go.
 */
function optionValue(flag: string): string | undefined {
  const at = argv.indexOf(flag);
  if (at === -1) return undefined;
  return valueAfter(flag, at);
}

/** The token after position `at`, or a usage failure when there isn't a usable one. */
function valueAfter(flag: string, at: number): string {
  const next = argv[at + 1];
  if (next === undefined || next.startsWith("--")) {
    fail(
      EXIT.USAGE,
      "missing_value",
      `${flag} was given without a value.`,
      command
        ? `Write the value after the flag, or drop the flag: cog-graphs ${command} --help`
        : "Write the value after the flag, or drop the flag.",
    );
  }
  return next;
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
  if (typeof profile === "object" && profile !== null) {
    for (const [field, value] of Object.entries(PROFILE_DEFAULTS)) {
      if (typeof profile[field] !== "string") profile[field] = value;
    }
  }
  const missing = shownProfileFields.filter((field) => typeof profile[field] !== "string");
  if (missing.length > 0) {
    fail(
      EXIT.USAGE,
      "profile_incomplete",
      `The profile is missing: ${missing.join(", ")}.`,
      `Add the missing field(s) under 'profile:' in ${resolved}. Every profile needs: ${shownProfileFields.join(", ")}.`,
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

  // The namespace becomes a filename, so it has to be one path segment and nothing else.
  //
  // Unvalidated, it went straight into a path join: `../escaped` created the graph in
  // the parent directory and reported success with that path in the payload. That is
  // DE-7's failure — an artifact the User cannot find — reached through a different
  // door, and worse, because it silently contradicts the `--dir` the Operator gave. An
  // escaped graph is also invisible to listGraphs, which reads a single directory, so it
  // can never be introduced or queried again: written and lost in one command.
  //
  // Deliberately narrow. Dots, dashes and underscores are how real namespaces read —
  // `game-recs-Ethan`, `notes.2026` — and a validator that rejected them would push
  // Operators toward worse names to satisfy the tool.
  const namespace = (profile.namespace as string).trim();
  const namespaceIsOneSegment =
    namespace.length > 0 &&
    // Rejected rather than escaped downstream, because unlike an attribute value there is
    // no legitimate content being refused: a namespace is a filename and an identifier the
    // Operator types back, and a control character in one is never anything but a mistake
    // or an attack. On POSIX a filename containing a newline is creatable, and the
    // namespace is interpolated into the sidecar's H1 (DE-19.7.1).
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f]/.test(namespace) &&
    !namespace.includes("/") &&
    !namespace.includes("\\") &&
    path.basename(namespace) === namespace &&
    ![".", ".."].includes(namespace);
  if (!namespaceIsOneSegment) {
    fail(
      EXIT.USAGE,
      "invalid_namespace",
      `'${profile.namespace}' cannot be a namespace: it must be a single name, not a path.`,
      `The namespace becomes the filename of the graph, so it may not contain '/' or '\\\\' or be empty. Pick a plain name like 'my-list' in ${resolved}, and use --dir to choose where the graph lands.`,
    );
  }

  const dir = path.resolve(process.cwd(), optionValue("--dir") ?? ".");

  // The quiet failure this catches: an Assistant initializes the graph inside its own
  // ephemeral environment, every command succeeds, and the User never sees the artifact
  // again. It is a warning rather than a refusal because a Cog Graph used as a scratch
  // resource is legitimate — the Operator is told what they are trading away and gets to
  // decide. It rides in the payload rather than on stderr so success stays one parseable
  // object on one stream (IN-9).
  const warnings: { code: string; message: string; next_step: string }[] = [];

  // A --dir that does not exist yet is two different acts wearing one spelling, and the
  // engine has to tell them apart (DE-7.1). `--dir ./graphs` from a directory the User
  // chose is an ordinary "make me a folder for this". `--dir ./Documnets/graphs` is a
  // typo, and creating it makes the mistake real: the graph lands somewhere nobody will
  // ever open, reported as success. The line is drawn at the parent, because that is
  // exactly where the two stop looking alike.
  if (!existsSync(dir)) {
    const parent = path.dirname(dir);
    if (!existsSync(parent)) {
      fail(
        EXIT.NOT_FOUND,
        "directory_not_found",
        `Neither ${dir} nor its parent ${parent} exists.`,
        `Check the path for a typo, or create the directory first and re-run. One new directory under one that already exists is made for you; a whole tree is not, because that is usually a mistyped path rather than an intention.`,
      );
    }
    mkdirSync(dir);
    // Created, but never silently. An Operator who mistyped one level gets the cheapest
    // possible chance to notice, and one who meant it loses nothing by being told.
    warnings.push({
      code: "created_directory",
      message: `${dir} did not exist and was created for this graph.`,
      next_step: `If that is not where you meant the graph to go, remove it and re-run initialize with the --dir you intended.`,
    });
  }

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
  const sidecarPath = path.join(dir, `${namespace}.md`);

  // Both faces are checked, not just the database.
  //
  // The sidecar is derived and disposable *to the engine*, and the old check took that
  // to mean a file at that path was always one of ours. It is not: a User with
  // `notes.md` in their directory, whose Assistant sensibly picks the namespace `notes`,
  // lost the file — exit 0, no warning, nothing in the payload. Everything the artifact
  // owns is something the artifact created, so anything already sitting on either name
  // belongs to somebody else.
  const occupied = [dbPath, sidecarPath].filter((p) => existsSync(p));
  if (occupied.length > 0) {
    const isOurs = existsSync(dbPath);
    fail(
      EXIT.ALREADY_EXISTS,
      "artifact_exists",
      isOurs
        ? `A graph named '${namespace}' already lives at ${dbPath}.`
        : `Cannot create '${namespace}' here: ${occupied.join(", ")} already exists and was not created by this graph.`,
      isOurs
        ? `Use it as it is — '${BINARY} introduce --graph ${namespace}' — or choose a different namespace in the profile.`
        : `A graph named '${namespace}' would write ${dbPath} and ${sidecarPath}. Pick a different namespace in ${resolved}, or move the existing file, or use --dir to build the graph somewhere else.`,
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

  succeed({ graph: namespace, path: dbPath, sidecar: path.join(dir, `${namespace}.md`), warnings, profile: Object.fromEntries(shownProfileFields.map((f) => [f, profile[f]])) });
}

/**
 * Find the graph a command is about.
 *
 * Naming it is always allowed; omitting it is a convenience that only holds while the
 * answer is unambiguous. When it is not, the engine says what it found rather than
 * picking — an Operator who meant graph A and silently got graph B has no way to notice.
 */
/**
 * The graph this invocation is about.
 *
 * Every command that touches a graph comes through here, which is why the sidecar is
 * brought up to date here too rather than in each command (IN-4). A User who deleted the
 * derived file, or edited it and expects the engine to have noticed, gets it back current
 * whatever command they happened to run — including the readers, which otherwise would
 * have left them staring at a missing or stale face and no way to tell which. Writers
 * render again after mutating; the second call is free when nothing changed.
 */
function resolveGraph(): { namespace: string; dbPath: string } {
  const dir = process.cwd();
  const requested = optionValue("--graph");
  if (requested) {
    const dbPath = path.join(dir, `${requested}.sqlite`);
    if (existsSync(dbPath)) {
      writeSidecar(dbPath);
      return { namespace: requested, dbPath };
    }
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
  if (present.length === 1) {
    const dbPath = path.join(dir, `${present[0]}.sqlite`);
    writeSidecar(dbPath);
    return { namespace: present[0], dbPath };
  }
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
    // Same rule as optionValue, and it matters more here: a repeatable flag whose value
    // went missing would otherwise drop one attribute out of several and still report
    // success (DE-19.6).
    out.push(valueAfter(flag, i));
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

if (command === "import") {
  const { namespace, dbPath } = resolveGraph();
  const from = optionValue("--from");
  if (!from) {
    fail(
      EXIT.USAGE,
      "missing_value",
      "--from needs the path to a .yml file of items to ingest.",
      `Write the items to a .yml, then pass its path: cog-graphs import --graph ${namespace} --from ./items.yml`,
    );
  }

  const resolved = path.resolve(process.cwd(), from);
  if (!existsSync(resolved)) {
    fail(
      EXIT.NOT_FOUND,
      "source_not_found",
      `No source file at ${resolved}.`,
      "Write the items to a .yml first, then pass that path to --from.",
    );
  }

  let document: unknown;
  try {
    document = Bun.YAML.parse(readFileSync(resolved, "utf8"));
  } catch (cause) {
    fail(
      EXIT.USAGE,
      "source_unparseable",
      `${resolved} is not valid YAML: ${(cause as Error).message}`,
      "Fix the YAML and run import again. Quoting every value is the safe default.",
    );
  }

  // The file mirrors add-item in data form — an entity and its attribute map — so an
  // agent that has read `add-item --help` already knows how to write one, and the two
  // surfaces cannot drift into two different models of what an item is.
  const doc = (document ?? {}) as Record<string, unknown>;
  const records = Array.isArray(doc.items) ? doc.items : [];

  const db = new Database(dbPath);
  const insertEntity = db.prepare("INSERT INTO entity (name, created_at) VALUES (?, ?)");
  const insertAttr = db.prepare("INSERT INTO eav (entity_id, attribute, value) VALUES (?, ?, ?)");
  const now = new Date().toISOString();
  let ingested = 0;

  // Every name the graph already holds, read once. The set is then *added to* as records
  // land, which is what makes a record colliding with an earlier record in the same file
  // rejected on the same terms as one colliding with the artifact — the Operator wrote
  // both, and neither is a name the graph can hold twice (DE-20.2).
  const taken = new Set(
    (db.query("SELECT name FROM entity").all() as { name: string }[]).map((row) => row.name),
  );
  // `entity` is null on a record that failed to name one, rather than "". An empty
  // string is indistinguishable from a genuine empty name, and the index is then the
  // only handle the Operator has on that record (DE-20.1).
  const rejected: { index: number; entity: string | null; reason: string }[] = [];

  for (const [index, record] of records.entries()) {
    const item = (record ?? {}) as Record<string, unknown>;
    const named = item.entity;
    const attributes = (item.attributes ?? {}) as Record<string, unknown>;

    // A record with no name is refused, never ingested under "". An empty-named row is a
    // real entity in the artifact and in the derived face that no query can name and no
    // modify-item can reach — and the second one collides with the first, which reported
    // `entity_exists` against a name the Operator never wrote (DE-20.1).
    if (named === undefined || named === null || named === "") {
      rejected.push({ index, entity: null, reason: "missing_value" });
      continue;
    }
    // Its own code, because it is its own fix. `entity: 2001` is a game called 2001 that
    // YAML read as a number; the answer is to quote it, not to supply a name that is
    // already there. Coercing it silently is the other option and it is worse — a value
    // this program invented, in the Operator's data, with nothing saying so.
    if (typeof named !== "string") {
      rejected.push({ index, entity: null, reason: "invalid_entity" });
      continue;
    }
    const entity = named;

    // Rejected, not merged and not skipped in silence. add-item refuses an entity the
    // graph already holds, and a bulk path that quietly updated it instead would be a
    // second, laxer model of what an item is — with no report to tell the Operator that
    // the item they thought they added is someone else's row now (DE-20).
    if (taken.has(entity)) {
      rejected.push({ index, entity, reason: "entity_exists" });
      continue;
    }

    const { lastInsertRowid } = insertEntity.run(entity, now);
    for (const [attribute, value] of Object.entries(attributes)) {
      insertAttr.run(lastInsertRowid as number, attribute, String(value));
    }
    taken.add(entity);
    ingested++;
  }
  db.close();

  // Written once, at the end, rather than once per item. The inspectable face is derived
  // from the artifact in full every time, so a per-item rewrite would be N passes over a
  // file whose only correct content is the last one.
  writeSidecar(dbPath);

  // Partial is reported as a structured error rather than as a success payload with a
  // 'rejected' array in it. IN-9 gives the whole surface one rule — a non-zero exit puts
  // one object on stderr and leaves stdout empty — and an agent piping stdout into a
  // parser must not have a half-successful run corrupt the parse. So the report *is* the
  // error object, with the counts carried on it (DE-20).
  if (rejected.length > 0) {
    fail(
      EXIT.PARTIAL,
      "partial_ingestion",
      `${ingested} of ${records.length} records were ingested into ${namespace}; ${rejected.length} were rejected.`,
      "Read 'rejected' — each entry names the offending entity and its zero-based index in the source's items list. Fix those records, then re-run import on a .yml holding only them.",
      { graph: namespace, source: resolved, ingested, rejected },
    );
  }

  // The count is the whole of what a bulk Operator gets back — it cannot read the result
  // item by item — so it counts what landed, not what was offered.
  succeed({ graph: namespace, source: resolved, ingested });
}

if (command === "convention") {
  const { namespace, dbPath } = resolveGraph();
  // Absent flag and empty flag are different things, and `optionValue` already keeps them
  // apart: a dangling `--append` fails as missing_value before this line (DE-19.6.1).
  const append = optionValue("--append");

  const db = new Database(dbPath);
  if (append !== undefined) {
    // Amend means append, and the schema said so first — `convention` is an ordered table
    // with an autoincrementing seq, not a single row. An Operator who learns in week three
    // that ratings run 1-10 rather than 1-5 is recording something that *became* true, and
    // the earlier expectation is how the items already in the graph are to be read.
    // Overwriting the text would silently re-date every one of them (DE-21).
    db.prepare("INSERT INTO convention (text, recorded_at) VALUES (?, ?)").run(
      append,
      new Date().toISOString(),
    );
  }
  const convention = (
    db.query("SELECT text FROM convention ORDER BY seq").all() as { text: string }[]
  ).map((row) => row.text);
  db.close();

  // Only on a write. A read is a read: regenerating the derived face from a command that
  // changed nothing is the failure IN-4.1 came from.
  if (append !== undefined) writeSidecar(dbPath);

  // The amend answers with the whole convention rather than the addition, so an agent that
  // amends does not need a second call to learn what the graph now says about itself —
  // which is the one thing it needs before its next write.
  succeed({ graph: namespace, convention });
}

if (command === "modify-item") {
  const { namespace, dbPath } = resolveGraph();
  const entity = optionValue("--entity");
  if (!entity) {
    fail(
      EXIT.USAGE,
      "missing_value",
      "--entity needs the name of the entity to modify.",
      `Name it: cog-graphs modify-item --graph ${namespace} --entity <name> --attr key=value`,
    );
  }
  const attributes = parseAttrs();

  const db = new Database(dbPath);
  const existing = db.query("SELECT id FROM entity WHERE name = ?").get(entity) as
    | { id: number }
    | undefined;
  if (!existing) {
    db.close();
    fail(
      EXIT.NOT_FOUND,
      "entity_not_found",
      `'${entity}' is not in ${namespace}.`,
      `Use add item instead: cog-graphs add-item --graph ${namespace} --entity '${entity}' --attr key=value`,
    );
  }

  // Set the named attributes and leave every other one alone. The tempting shortcut —
  // delete the entity's rows and write the given pairs as the whole record — is
  // indistinguishable from correct on a single-attribute item and silently erases
  // everything else on a real one. Since the Operator names only what changed, that
  // shortcut destroys exactly the accumulated knowledge the graph exists to hold.
  const upsert = db.prepare(
    "INSERT INTO eav (entity_id, attribute, value) VALUES (?, ?, ?) " +
      "ON CONFLICT (entity_id, attribute) DO UPDATE SET value = excluded.value",
  );
  for (const [attribute, value] of Object.entries(attributes)) {
    upsert.run(existing.id, attribute, value);
  }
  db.close();
  writeSidecar(dbPath);

  succeed({ graph: namespace, entity, attributes, modified: true });
}

if (command === "remove-item") {
  const { namespace, dbPath } = resolveGraph();
  const entity = optionValue("--entity");
  if (!entity) {
    fail(
      EXIT.USAGE,
      "missing_value",
      "--entity needs the name of the entity to remove.",
      `Name it: cog-graphs remove-item --graph ${namespace} --entity <name>`,
    );
  }

  const db = new Database(dbPath);
  const existing = db.query("SELECT id FROM entity WHERE name = ?").get(entity) as
    | { id: number }
    | undefined;
  if (!existing) {
    const present = (db.query("SELECT name FROM entity ORDER BY name").all() as { name: string }[])
      .map((e) => e.name);
    db.close();
    fail(
      EXIT.NOT_FOUND,
      "entity_not_found",
      `'${entity}' is not in ${namespace}, so there is nothing to remove.`,
      present.length > 0
        ? `Check the name against what is there — ${namespace} holds: ${present.join(", ")}. 'cog-graphs query --graph ${namespace}' lists them with their attributes.`
        : `${namespace} is empty. Add something first: cog-graphs add-item --graph ${namespace} --entity <name>`,
    );
  }

  // The attribute rows go with the entity. Leaving them would orphan data that nothing
  // can retrieve and quietly break IN-1 — and "removed" that leaves the item's data
  // behind is not removed. Explicit rather than relying on ON DELETE CASCADE, which
  // SQLite only honors when foreign keys are switched on.
  db.prepare("DELETE FROM eav WHERE entity_id = ?").run(existing.id);
  db.prepare("DELETE FROM entity WHERE id = ?").run(existing.id);
  db.close();
  writeSidecar(dbPath);

  succeed({ graph: namespace, entity, removed: true });
}

if (command === "query") {
  const { namespace, dbPath } = resolveGraph();
  const db = new Database(dbPath, { readonly: true });
  const include = parseAttrs("--attr");
  const exclude = parseAttrs("--exclude");
  // Selection search, per the doc: simple inclusion/exclusion over attributes and
  // values. Every --attr must match and no --exclude may, which is what makes repeated
  // narrow queries a way to traverse — each attribute is a handhold.
  //
  // A filtered result is still the whole item: narrowing chooses which items come back,
  // never which of their attributes do. Projecting down to the matched pairs would make
  // query lossy exactly when an Operator is closing in on something. Pinned by DE-10.1.
  const items = readItems(db).filter((item) => {
    for (const [attribute, value] of Object.entries(include)) {
      if (item.attributes[attribute] !== value) return false;
    }
    for (const [attribute, value] of Object.entries(exclude)) {
      if (item.attributes[attribute] === value) return false;
    }
    return true;
  });
  db.close();
  // An empty graph answers with the same shape as a full one — same fields, same types.
  // Answering `{}` or a null items list when empty would force every caller to write the
  // branch twice, and would teach an Operator that a new graph is a broken one.
  succeed({ graph: namespace, count: items.length, items });
}

/**
 * The introduction to one particular graph.
 *
 * What a cold agent needs before it touches anything, and no more: what this graph is
 * for in the User's own words, the convention it keeps, how much is in it, and the
 * commands to go further. Skipping the description and convention is how a fresh thread
 * ends up inventing its own attribute names beside the established ones — the graph does
 * not break, it just quietly stops being coherent.
 */
function instanceIntroduction(namespace: string, dbPath: string) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const profile = Object.fromEntries(
      (db.query("SELECT field, value FROM profile").all() as { field: string; value: string }[])
        .filter((r) => !WITHHELD_PROFILE_FIELDS.has(r.field))
        .map((r) => [r.field, r.value]),
    );
    const convention = (
      db.query("SELECT text FROM convention ORDER BY seq").all() as { text: string }[]
    ).map((r) => r.text);
    const [{ count }] = db.query("SELECT COUNT(*) AS count FROM entity").all() as {
      count: number;
    }[];
    const attributes = (
      db.query("SELECT DISTINCT attribute FROM eav ORDER BY attribute").all() as {
        attribute: string;
      }[]
    ).map((r) => r.attribute);

    return {
      scope: INTRO_SCOPE_INSTANCE,
      graph: namespace,
      path: dbPath,
      profile,
      convention,
      // The attributes already in use are the handholds for a selection query, so an
      // agent can narrow on its first attempt instead of guessing names.
      contents: { entities: count, attributes },
      next_steps: [
        `cog-graphs query --graph ${namespace}`,
        `cog-graphs add-item --graph ${namespace} --entity <name> --attr key=value`,
        `cog-graphs modify-item --graph ${namespace} --entity <name> --attr key=value`,
        "cog-graphs introduce --interface-skill",
      ],
    };
  } finally {
    db.close();
  }
}

if (command === "introduce") {
  // The primer is about the system, not any one graph, so it answers before resolution.
  if (flags.has("--interface-skill")) {
    succeed({ scope: INTRO_SCOPE_SYSTEM, primer: INTERFACE_SKILL_PRIMER });
  }

  // The doc: introduce returns an introduction to *this instantiation*, "unless there's
  // no instantiation to be found, in which case it introduces this system". So the
  // system introduction is the fallback, not the default — an empty directory is the
  // only thing that earns it. Resolution runs first, and only a genuinely graph-less
  // directory falls through; a named graph that does not exist is still an error, since
  // an Operator who asked for something specific should not be answered about the
  // system in general.
  const requested = optionValue("--graph");
  const present = listGraphs(process.cwd());
  if (requested || present.length > 0) {
    const { namespace, dbPath } = resolveGraph();
    succeed(instanceIntroduction(namespace, dbPath));
  }

  succeed({ scope: INTRO_SCOPE_SYSTEM, introduction: SYSTEM_INTRODUCTION });
}

// Nothing above handled it, so the command is real, documented, and unbuilt.
//
// Under the vertical loop that state is normal rather than exceptional — some commands
// are always ahead of the engine — so the interface has to be able to *say* it. Silence
// was the old answer, and it was the worst one available: `--help` advertises these
// commands with runnable examples, so an agent has every reason to trust them and got
// less back than it would have for a typo.
//
// Distinct from unknown_command on purpose. That one means "you mistyped"; this means
// "you read the help correctly and there is nothing behind it yet". An agent that
// cannot tell them apart retries with a different spelling forever.
const built = Object.keys(HELP).filter((name) => !UNBUILT.has(name));
fail(
  EXIT.INTERNAL,
  "not_implemented",
  `'${command}' is documented but not implemented yet in this build.`,
  `Working commands: ${built.join(", ")}. ${UNBUILT_NEXT_STEP[command] ?? `Use one of those, or run '${BINARY} --help'.`}`,
);
