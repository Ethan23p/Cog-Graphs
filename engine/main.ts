#!/usr/bin/env bun
// Cog-Graphs engine — CLI entry point.
//
// The CLI is the UX and its user is an AI agent, so every answer is JSON on stdout, every
// failure is JSON on stderr, and the process boundary is the whole contract. This file is the
// only place that writes either stream or exits.
//
//   cli.ts       argv → Invocation, and the ordered gate every invocation passes
//   commands.ts  the command table: each command's help and body
//   graph.ts     the Cog Graph — schema and SQL, profile, selection, where graphs live
//   render.ts    every face the engine renders: JSON, --pretty, the sidecar
//   errors.ts    the error registry and the exit alphabet
//   docs.ts      the primer, the system introduction, the file samples

import { gate, parse, type Answer } from "./cli";
import { COMMANDS, runCommand } from "./commands";
import { CliError, EXIT, type Warning } from "./errors";
import { syncSidecar } from "./graph";
import { renderAnswer, renderError } from "./render";

const invocation = parse(process.argv.slice(2));
let touched: string | undefined;

let answer: Answer;
try {
  answer =
    gate(invocation, COMMANDS) ??
    runCommand(invocation.command!, {
      invocation,
      cwd: process.cwd(),
      touch: (dbPath) => (touched = dbPath),
    });
} catch (error) {
  if (!(error instanceof CliError)) throw error;
  // A failure after a write (import's partial report) still leaves the face current.
  if (touched) syncSidecar(touched);
  process.stderr.write(renderError(error, invocation.pretty));
  process.exit(error.exit);
}

// The sidecar is brought up to date once, after the command, whatever the command was — a
// reader included, so a deleted or stale face comes back on any command (IN-4). A face that
// cannot be refreshed is reported in the answer, never as a failure (IN-4.1).
const warning: Warning | undefined = touched ? syncSidecar(touched) : undefined;

// A warning rides in the payload, not on stderr, so a success stays one parseable object on
// one stream (IN-9). The key is kept when the command supplied one, even empty: initialize
// always reports a warnings array.
if (warning || Object.hasOwn(answer, "warnings")) {
  const supplied = (answer.warnings as Warning[] | undefined) ?? [];
  answer = { ...answer, warnings: warning ? [...supplied, warning] : supplied };
}

process.stdout.write(renderAnswer(answer, invocation.pretty));
process.exit(EXIT.OK);
