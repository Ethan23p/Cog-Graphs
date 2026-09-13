// The command line: argv parsed once into an Invocation, then checked against the command
// table by an explicit, ordered list of stages before any command runs.

import { BINARY } from "./docs";
import { fail } from "./errors";

export type Answer = Record<string, unknown>;

export interface Help {
  summary: string;
  usage: string;
  required: Record<string, string>;
  optional: Record<string, string>;
  /** A sample of each file a flag takes, accepted verbatim by the command (DE-5.1). */
  files?: Record<string, string>;
  examples: string[];
  notes?: string[];
}

/** What the gate needs to know about a command: its help, and whether it is built. */
export type CommandTable = Record<string, { help: Help; run?: unknown; unbuiltNote?: string }>;

/**
 * Accepted by every command, and therefore never a command themselves: `--pretty query` and
 * `query --pretty` are the same request, and an Operator who writes the flag first has not
 * made a mistake (DE-19.8.1).
 */
export const GLOBAL_FLAGS = ["--pretty", "--help"];

/** Flags whose bare spelling is correct — every other documented flag takes a value. */
const BOOLEAN_FLAGS = new Set(["--interface-skill", ...GLOBAL_FLAGS]);

export interface Invocation {
  argv: string[];
  /** The first token that is not a global flag; undefined when there is none. */
  command: string | undefined;
  pretty: boolean;
  has(flag: string): boolean;
  /** The value after the first occurrence of `flag`, or undefined if it was never written. */
  value(flag: string): string | undefined;
  /** Every value given for a repeatable flag, in the order the Operator wrote them. */
  values(flag: string): string[];
}

export function parse(argv: string[]): Invocation {
  // The command is the first token that is not a global flag. Reading `argv[0]` meant
  // `cog-graphs --pretty` was answered with "'--pretty' is not a cog-graphs command" — at
  // the exact moment a person took the overview's own advice literally (DE-19.8.1).
  const commandIndex = argv.findIndex((token) => !GLOBAL_FLAGS.includes(token));
  const command = commandIndex === -1 ? undefined : argv[commandIndex];
  const flags = new Set(argv.filter((_, i) => i !== commandIndex));

  return {
    argv,
    command,
    pretty: argv.includes("--pretty"),
    has: (flag) => flags.has(flag),
    value(flag) {
      const at = argv.indexOf(flag);
      return at === -1 ? undefined : valueAfter(argv, command, flag, at);
    },
    values(flag) {
      const out: string[] = [];
      argv.forEach((token, i) => {
        if (token === flag) out.push(valueAfter(argv, command, flag, i));
      });
      return out;
    },
  };
}

/**
 * The token after position `at`, or a usage failure when there isn't a usable one.
 *
 * A flag written *without* a value is not the same thing as a flag left off (DE-19.6). An
 * Operator who writes `--dir` has stated an intention; if the value did not survive whatever
 * produced the command line, a guess is the one response that cannot be right, because the
 * guess is invisible. `--dir` once defaulted to the working directory this way.
 */
function valueAfter(argv: string[], command: string | undefined, flag: string, at: number): string {
  const next = argv[at + 1];
  if (next === undefined || next.startsWith("--")) {
    fail(
      "missing_value",
      `${flag} was given without a value.`,
      command
        ? `Write the value after the flag, or drop the flag: cog-graphs ${command} --help`
        : "Write the value after the flag, or drop the flag.",
    );
  }
  return next;
}

/**
 * Parse `--attr key=value` pairs.
 *
 * Split on the *first* `=` only, so a value may contain `=` freely (DE-23). Splitting on
 * every `=` would quietly refuse ordinary values like a URL with a query string.
 */
export function parseAttrs(invocation: Invocation, flag = "--attr"): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const raw of invocation.values(flag)) {
    const at = raw.indexOf("=");
    if (at <= 0) {
      fail(
        "malformed_attribute",
        `'${raw}' is not a key=value pair.`,
        `Write the attribute as ${flag} key=value, e.g. ${flag} status=completed. The value may itself contain '=' — only the first one separates.`,
      );
    }
    attrs[raw.slice(0, at)] = raw.slice(at + 1);
  }
  return attrs;
}

// ---------------------------------------------------------------------------------------
// The gate

type Stage = (invocation: Invocation, table: CommandTable) => Answer | undefined;

const entryFor = (table: CommandTable, command: string | undefined) =>
  command !== undefined && Object.hasOwn(table, command) ? table[command] : undefined;

const documentedFlags = (help: Help) => [...Object.keys(help.required), ...Object.keys(help.optional)];

/**
 * The front door: bare `cog-graphs`, a line of nothing but global flags, or `help`.
 *
 * Asking a tool what it is has not gone wrong, so this is a success rather than a usage
 * error. The answer names every command — an agent that has to guess which commands exist
 * guesses the ones it knows from other tools, and then reports that the tool is broken.
 */
const frontDoor: Stage = ({ command, argv }, table) => {
  if (command && !(command === "help" && argv.length === 1)) return undefined;
  return {
    binary: BINARY,
    summary:
      "Spawn and manipulate Cog Graphs: persistent, structured stores of entities and the attribute/value pairs recorded about them. Each graph is a .sqlite file in a directory you choose, with a derived .md beside it for inspection.",
    commands: Object.entries(table).map(([name, { help }]) => ({ name, summary: help.summary })),
    getting_started: [
      `${BINARY} introduce --interface-skill   # the full primer for driving this directly`,
      `${BINARY} introduce                      # what the graph in this directory is for`,
      `${BINARY} <command> --help               # usage and a runnable example`,
    ],
    output:
      "Every command answers with JSON on stdout; failures write a JSON error to stderr carrying code, message and next_step. Add --pretty for the human-readable form.",
  };
};

/**
 * A command's own help. Answered before validation, so a malformed invocation can still ask
 * what it should have been. An unbuilt command says so here, not only once it has been run.
 */
const commandHelp: Stage = ({ command, has }, table) => {
  const entry = entryFor(table, command);
  if (!entry || !has("--help")) return undefined;
  const status = entry.run ? {} : { status: "not_implemented", status_note: entry.unbuiltNote };
  return { command, ...entry.help, ...status };
};

/**
 * A leading token that looks like a flag is a mis-written flag, not a mis-written command.
 * Told "'--nonsense' is not a command", an agent starts guessing command names, which is the
 * one thing that cannot help (DE-19.8.1).
 */
const leadingFlag: Stage = ({ command }) => {
  if (!command!.startsWith("--")) return undefined;
  fail(
    "unknown_option",
    `${BINARY} does not recognize the option '${command}'. Before a command it accepts: ${GLOBAL_FLAGS.join(", ")}.`,
    `Every other option belongs after its command, e.g. '${BINARY} query --graph <ns>'. Run '${BINARY} --help' for the commands.`,
  );
};

/** Where an agent's guess lands, so the error names every command that does exist. */
const unknownCommand: Stage = ({ command }, table) => {
  if (entryFor(table, command)) return undefined;
  fail(
    "unknown_command",
    `'${command}' is not a ${BINARY} command.`,
    `The commands are: ${Object.keys(table).join(", ")}. Run '${BINARY} --help' for an overview, or '${BINARY} <command> --help' for one command's usage.`,
  );
};

/**
 * Unknown options are rejected before anything runs, so a typo never half-executes.
 *
 * The error deliberately does not echo the offending option. `--managed` is a real flag in a
 * later version and is withheld from this one entirely, and echoing an unknown option would
 * confirm its spelling to an Operator who guessed it.
 */
const unknownOption: Stage = ({ command, argv }, table) => {
  const recognized = new Set([...documentedFlags(table[command!]!.help), ...GLOBAL_FLAGS]);
  for (const token of argv.slice(1)) {
    if (!token.startsWith("--") || recognized.has(token)) continue;
    fail(
      "unknown_option",
      `${command} does not recognize that option. It accepts: ${[...recognized].join(", ")}.`,
      `Run 'cog-graphs ${command} --help' for the usage and a runnable example.`,
    );
  }
  return undefined;
};

/**
 * Syntax before semantics: a documented flag written without a value fails here, ahead of
 * the missing-required-flag check.
 *
 * Both diagnoses are true of `import --graph` — no value AND no `--from` — and the dangling
 * flag is the one an Operator can act on: it names a token actually present and says what is
 * wrong with it. It is also the likelier defect, since a value lost to shell quoting leaves
 * exactly this shape. The rule is uniform across the grammar, because deciding it per command
 * is how a rule goes selectively true (DE-19.6.1).
 */
const danglingValue: Stage = ({ command, argv }, table) => {
  const documented = new Set(documentedFlags(table[command!]!.help));
  argv.forEach((token, i) => {
    if (documented.has(token) && !BOOLEAN_FLAGS.has(token)) valueAfter(argv, command, token, i);
  });
  return undefined;
};

/** Read from the same table help prints, so the check cannot drift from what help promises. */
const missingRequired: Stage = ({ command, has }, table) => {
  const { required } = table[command!]!.help;
  for (const flag of Object.keys(required)) {
    if (has(flag)) continue;
    fail(
      "missing_option",
      `${command} requires ${flag}: ${required[flag]}`,
      `Run 'cog-graphs ${command} --help' for a runnable example.`,
    );
  }
  return undefined;
};

/**
 * The order is the decision: each stage assumes the ones before it passed. Help answers
 * before any validation; a leading flag is diagnosed before it can be called an unknown
 * command; a dangling value outranks a missing required flag (DE-19.6.1).
 */
const STAGES: Stage[] = [
  frontDoor,
  commandHelp,
  leadingFlag,
  unknownCommand,
  unknownOption,
  danglingValue,
  missingRequired,
];

/** An answer that ends the invocation early (the overview, a command's help), or undefined. */
export function gate(invocation: Invocation, table: CommandTable): Answer | undefined {
  for (const stage of STAGES) {
    const answer = stage(invocation, table);
    if (answer) return answer;
  }
  return undefined;
}
