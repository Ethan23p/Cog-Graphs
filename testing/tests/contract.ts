// The CLI surface the suite pins. Mirrors the design doc's ratified grammar.
//
// WHY THIS FILE EXISTS
// A test has to name a flag and an exit code; it cannot be soft. The design doc now
// ratifies the binary, the exit-code alphabet, and five grammar lines, so this file is
// mostly a mirror rather than a decision. Where it goes beyond the doc, the addition is
// marked GAP and is a question owed back to Ethan.
//
// WHAT THIS FILE DOES NOT DO
// It does not pin payload shapes up front. Under the vertical loop each slice pins the
// shape it needs, in the slice that first needs it — guessing a JSON schema for a
// command nobody has written yet is exactly the imagined-behavior failure the loop is
// built to avoid. Constants arrive here when a slice earns them.

import * as path from "node:path";

/** The binary. Invoked as a subprocess in every test — never imported. */
export const BIN = "cog-graphs";

/**
 * Exit codes, verbatim from the doc:
 * `0 ok ; 1 usage/unknown option ; 2 not found ; 3 already exists ; 4 partial ingestion ;
 *  5 ambiguous target ; 6 = internal`
 */
export const EXIT = {
  OK: 0,
  USAGE: 1,
  NOT_FOUND: 2,
  ALREADY_EXISTS: 3,
  PARTIAL: 4,
  AMBIGUOUS: 5,
  INTERNAL: 6,
} as const;

/**
 * Commands and the flags tests rely on.
 *
 * The first five are the doc's ratified grammar. The last three are GAPs: the doc lists
 * `modify item(s)`, `remove item(s)` and an amendable convention as capabilities but
 * gives them no grammar line, and DE-21 is untestable without a convention surface.
 * Shapes below follow `add-item` by analogy. Flagged to Ethan 2026-09-08.
 */
export const COMMANDS = [
  { name: "introduce", required: [], optional: ["--graph", "--interface-skill"] },
  { name: "initialize", required: ["--profile"], optional: ["--dir"] },
  { name: "query", required: [], optional: ["--graph", "--attr", "--exclude"] },
  { name: "add-item", required: ["--entity"], optional: ["--graph", "--attr"] },
  { name: "import", required: ["--from"], optional: ["--graph"] },
  // GAP — no grammar line in the doc.
  { name: "modify-item", required: ["--entity"], optional: ["--graph", "--attr"] },
  { name: "remove-item", required: ["--entity"], optional: ["--graph"] },
  { name: "convention", required: [], optional: ["--graph", "--append"] },
] as const;

/**
 * Accepted by every command. GAP: `--pretty` is required by IN-9 ("`--pretty` produces
 * the human-readable form") but appears in no grammar line in the doc.
 */
export const GLOBAL_FLAGS = ["--pretty", "--help"] as const;

/**
 * The flag that must not exist yet. The doc keeps the manual/managed structure in the
 * code but withholds it from users entirely: "From the user-facing side, there is no
 * such thing as `--managed`, yet." DE-3 and DE-4 police both directions.
 */
export const WITHHELD_FLAG = "--managed";

/**
 * `introduce` answers as one of two things, and an Operator must be able to tell which
 * without guessing: the doc has it return an introduction to *this instantiation*,
 * "unless there's no instantiation to be found, in which case it introduces this system
 * and how to use it". Both are the root of the self-documentation; they are not
 * interchangeable, so the payload names its scope.
 */
export const INTRO_SCOPE = { SYSTEM: "system", INSTANCE: "instance" } as const;

/** Functional face: `<namespace>.sqlite` in the target directory. */
export const graphFile = (dir: string, ns: string) => path.join(dir, `${ns}.sqlite`);
/** Inspectable face: derived `<namespace>.md`, beside the functional face (IN-2). */
export const sidecarFile = (dir: string, ns: string) => path.join(dir, `${ns}.md`);

/**
 * Profile fields the schema declares. IN-3 iterates this rather than asserting a
 * hardcoded three, so the case picks up new fields instead of rotting when the profile
 * grows past the doc's "probably more - TBD".
 */
export const PROFILE_FIELDS = ["namespace", "use-pattern", "description"] as const;

/** Values `use-pattern` accepts. `managed` is a stored value, not a user-facing flag. */
export const USE_PATTERNS = ["manual", "managed"] as const;

/**
 * Success to stdout, errors to stderr, both JSON by default (IN-9). Splitting the
 * streams is what lets an Operator pipe stdout into a parser without an error
 * corrupting the parse.
 */
export const SUCCESS_STREAM = "stdout";
export const ERROR_STREAM = "stderr";

/** Fields every non-zero exit must carry (IN-11); RU-7 judges whether next_step is worth reading. */
export const ERROR_FIELDS = ["code", "message", "next_step"] as const;
