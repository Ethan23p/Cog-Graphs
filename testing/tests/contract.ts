// The test-facing contract: the CLI surface and artifact shape the suite pins.
//
// WHY THIS FILE EXISTS
// The design doc (`Cog-Graphs` in `Logseq-DB-Aurelius`) is the source of truth for
// *what* the system does. It deliberately leaves grammar soft ("Command syntax &
// grammar might change"). Tests cannot be soft — an assertion has to name a flag and
// an exit code. So the concrete surface is ratified once, here, and every test reads
// it from here. Changing the surface is a one-file change plus a conversation with
// Ethan; it is never an incidental edit inside a test.
//
// Ratified 2026-09-08 with Ethan, derived from the doc's own examples. Deltas from
// the doc's illustrative commands, and the reasons, are marked DELTA below.
//
// The engine is free to organise its internals however it likes. What it is NOT free
// to change is what appears below: this is the durable, inspectable data contract.

import * as path from "node:path";

/** The binary. Invoked as a subprocess in every test — never imported. */
export const BIN = "cog-graphs";

/**
 * Exit codes. The doc commits to "intuitive/useful error & exit codes" and IN-10
 * requires distinct codes for distinct failure classes; these are that alphabet.
 * Anything non-zero must also emit a structured error object (IN-11).
 */
export const EXIT = {
  OK: 0,
  /** Malformed invocation: unknown command, unknown option, missing required flag. */
  USAGE: 1,
  /** The named thing does not exist: no such graph, no such entity. */
  NOT_FOUND: 2,
  /** The thing already exists: `add-item` on a live entity. */
  ALREADY_EXISTS: 3,
  /** Bulk ingestion committed some records and rejected others (DE-20). */
  PARTIAL: 4,
  /** Target could not be resolved: >1 graph in cwd and no `--graph` (DE-22). */
  AMBIGUOUS: 5,
  /** The engine broke. Never expected; asserted against so it can never be the default. */
  INTERNAL: 6,
} as const;

/**
 * Every command, with the flags tests rely on. DE-5 iterates this list, so a command
 * added to the engine without being added here is a command with no `--help` coverage.
 */
export const COMMANDS = [
  { name: "introduce", required: [], optional: ["--graph", "--interface-skill"] },
  { name: "initialize", required: ["--profile"], optional: ["--dir"] },
  { name: "query", required: [], optional: ["--graph", "--attr", "--exclude"] },
  { name: "add-item", required: ["--entity"], optional: ["--graph", "--attr"] },
  { name: "modify-item", required: ["--entity"], optional: ["--graph", "--attr"] },
  { name: "remove-item", required: ["--entity"], optional: ["--graph"] },
  // DELTA: the doc's capability is "add item(s)", which would suggest a flag on
  // add-item. Split into its own command because (a) DE-20 requires the
  // partial-with-report semantic to be stated in the bulk command's own --help,
  // (b) EXIT.PARTIAL then belongs to exactly one command, and (c) it avoids an
  // add-item/add-items one-letter footgun for the Operator.
  { name: "import", required: ["--from"], optional: ["--graph"] },
  { name: "convention", required: [], optional: ["--graph", "--append"] },
] as const;

/** Global flags accepted by every command. */
export const GLOBAL_FLAGS = ["--pretty", "--help"] as const;

/**
 * The commands the Walking Skeleton scenario cannot be completed without. DE-2
 * requires the `--interface-skill` primer to name every one of them: a primer that
 * omits one leaves the Operator to discover it, which is the failure the primer exists
 * to prevent.
 */
export const WALKING_SKELETON_COMMANDS = ["initialize", "add-item", "query", "modify-item"] as const;

/**
 * Shape of a successful `query` payload. Pinned because DE-8 requires an empty result
 * to be well-formed rather than merely non-erroring — "no items" and "no such key" must
 * not look alike to an Operator parsing the output.
 */
export interface QueryPayload {
  items: { entity: string; attributes: Record<string, string> }[];
}

/**
 * The flag that must not exist yet. The doc keeps the manual/managed structure in the
 * code but withholds it from the user-facing side entirely ("From the user-facing side,
 * there is no such thing as `--managed`, yet"). DE-3 and DE-4 police both directions.
 */
export const WITHHELD_FLAG = "--managed";

// --- Initialization input ---------------------------------------------------

/**
 * Profile fields the schema declares. IN-3 iterates this rather than asserting a
 * hardcoded three, so the case picks up new fields instead of rotting when the profile
 * grows past the doc's "probably more - TBD".
 *
 * ASSUMPTION (flagged to Ethan): the doc does not say where a machine-readable profile
 * schema lives, so the suite carries the field list itself. If the engine later
 * publishes its own schema, IN-3 should read that instead and this constant goes away.
 */
export const PROFILE_FIELDS = ["namespace", "use-pattern", "description"] as const;

/** Values `use-pattern` accepts. `managed` is a stored value, not a user-facing flag. */
export const USE_PATTERNS = ["manual", "managed"] as const;

/**
 * The init config `initialize --profile` consumes: the profile fields, plus the seed
 * convention. Convention is a sibling entity to Profile in the doc, not a profile
 * field — but it arrives in the same one-time-use `.yml`, exactly as the UX flow
 * describes ("Writes a temp file with the namespace, description, and convention").
 * IN-8 requires it to be present and non-empty in the artifact after initialize.
 */
export interface InitConfig {
  namespace: string;
  "use-pattern": (typeof USE_PATTERNS)[number];
  description: string;
  convention: string;
}

// --- Artifact shape ---------------------------------------------------------

/** Functional face: `<namespace>.sqlite` in the target directory. */
export const graphFile = (dir: string, ns: string) => path.join(dir, `${ns}.sqlite`);
/** Inspectable face: derived `<namespace>.md`, beside the functional face (IN-2). */
export const sidecarFile = (dir: string, ns: string) => path.join(dir, `${ns}.md`);

/**
 * The artifact's read contract. The engine chooses its own physical storage; these
 * names must resolve (as tables or as views over whatever it actually stores) because
 * DE-9 requires reading the store directly rather than through the CLI, and because
 * "inspectable" is worth nothing if the shape is a secret.
 *
 * DECISION (flagged to Ethan): pinning a *read view* rather than physical tables is
 * what keeps "data is explicit, portable, inspectable" true without freezing the
 * engine's internals, which the doc holds as replaceable behavior.
 */
export const READ_VIEWS = {
  /** One row per (entity, attribute, value). The EAV face of the graph. */
  eav: { name: "eav", columns: ["entity", "attribute", "value"] },
  /** The profile, one row per field, keyed by the names in PROFILE_FIELDS. */
  profile: { name: "profile", columns: ["key", "value"] },
  /** The convention, as a single row of text. */
  convention: { name: "convention", columns: ["content"] },
} as const;

/**
 * Files SQLite may legitimately leave beside the database *while a connection is open*.
 * IN-6 asserts none survive a completed run: with one short-lived process per command
 * and the default rollback journal, the directory is clean on exit.
 *
 * A leftover `-journal` after a *crash* is a recovery record, not litter — deleting it
 * corrupts the database. IN-6 is scoped to "after a full scenario" for that reason.
 */
export const SQLITE_SIDE_FILES = ["-journal", "-wal", "-shm"] as const;

// --- Output shape -----------------------------------------------------------

/**
 * Success goes to stdout, errors to stderr, both as JSON by default (IN-9); `--pretty`
 * swaps in the human-readable form. Splitting the streams is what lets an Operator pipe
 * stdout into a parser without an error corrupting the parse.
 */
export const ERROR_STREAM = "stderr";
export const SUCCESS_STREAM = "stdout";

/** Fields every non-zero exit must carry (IN-11); RU-7 judges whether next_step is worth reading. */
export const ERROR_FIELDS = ["code", "message", "next_step"] as const;

/** Warnings ride in the success payload so DE-7's temp-dir guard never breaks IN-9. */
export const WARNINGS_FIELD = "warnings";

/**
 * A partial bulk ingestion (EXIT.PARTIAL) reports its casualties in the error object,
 * alongside the IN-11 fields. DE-20 requires each to be named "by identifier and by
 * position" — an Operator re-driving a 200-record file needs to find the offending
 * record in the file, and the identifier alone does not locate a record whose
 * identifier is the thing that was wrong.
 */
export const REJECTED_FIELD = "rejected";
export interface RejectedRecord {
  /** The record's entity as supplied, or null when that is what was missing. */
  entity: string | null;
  /** 0-based position in the ingestion file. */
  index: number;
  reason: string;
}
