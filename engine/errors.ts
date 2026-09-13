// Every way a command can fail, and the one exit each failure maps to.

/**
 * The exit-code alphabet, verbatim from the doc:
 * `0 ok ; 1 usage/unknown option ; 2 not found ; 3 already exists ; 4 partial ingestion ;
 *  5 ambiguous target ; 6 = internal`
 *
 * A new command picks from this list; it does not extend it.
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

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/**
 * Every error code the engine can raise, and its exit code — declared once.
 *
 * A call site names the code and nothing else, so an error cannot be reported under the
 * wrong exit, and a code that is not declared here does not typecheck. This registry is
 * also what the error sweep (S4) enumerates: a code added here with no provocation in
 * `testing/harness/error-sweep.ts` fails the free suite.
 */
export const ERRORS = {
  unknown_option: EXIT.USAGE,
  unknown_command: EXIT.USAGE,
  missing_option: EXIT.USAGE,
  missing_value: EXIT.USAGE,
  malformed_attribute: EXIT.USAGE,
  profile_unparseable: EXIT.USAGE,
  profile_incomplete: EXIT.USAGE,
  convention_missing: EXIT.USAGE,
  invalid_namespace: EXIT.USAGE,
  source_unparseable: EXIT.USAGE,
  profile_not_found: EXIT.NOT_FOUND,
  directory_not_found: EXIT.NOT_FOUND,
  graph_not_found: EXIT.NOT_FOUND,
  no_graph_here: EXIT.NOT_FOUND,
  entity_not_found: EXIT.NOT_FOUND,
  source_not_found: EXIT.NOT_FOUND,
  artifact_exists: EXIT.ALREADY_EXISTS,
  entity_exists: EXIT.ALREADY_EXISTS,
  partial_ingestion: EXIT.PARTIAL,
  ambiguous_graph: EXIT.AMBIGUOUS,
  not_implemented: EXIT.INTERNAL,
} as const satisfies Record<string, ExitCode>;

export type ErrorCode = keyof typeof ERRORS;

/** A problem worth telling the Operator about that does not stop the command. */
export interface Warning {
  code: string;
  message: string;
  next_step: string;
}

/**
 * A failure the Operator can act on. Thrown anywhere; written once, by `main.ts`.
 *
 * Every one carries a `next_step` — an error an agent cannot act on just costs it a turn.
 * `detail` rides alongside on the error object (import's partial report is the case).
 */
export class CliError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly next_step: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
  }

  get exit(): ExitCode {
    return ERRORS[this.code];
  }
}

export function fail(
  code: ErrorCode,
  message: string,
  next_step: string,
  detail?: Record<string, unknown>,
): never {
  throw new CliError(code, message, next_step, detail);
}
