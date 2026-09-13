import { describe, expect, test } from "bun:test";
import { ERRORS } from "../../engine/errors";
import { errorSweep, unreachableCodes } from "../harness/error-sweep";

// S4 — the error sweep RU-7 is judged over.
//
// RU-7 asks whether an error's `next_step` is worth reading, which is a taste call and goes
// to a judge. What this file settles is the thing a judge cannot: that the sweep actually
// covers the engine. Every error code the engine can raise is provoked once by direct
// invocation, and each entry carries what an Operator meeting that error would have — the
// invocation, the whole error, and that command's `--help`.
//
// The failure this rules out: a sweep that has quietly stopped covering the engine. A code
// added to the engine with no provocation would otherwise ship ungraded, and the sweep would
// go on reporting a clean pass over the codes it still remembers. So the expected set is the
// engine's own error registry rather than a list typed here — a list typed here would be
// exactly as stale as the sweep it is checking.
//
// Changed 2026-09-12, approved by Ethan. The expected set used to be read out of
// `engine/main.ts` by a regex over `fail(EXIT.X, "code")` call sites. When the engine was
// split into modules (Polish phase, implementing best practices), every code came to be
// declared once in `engine/errors.ts`, and a call site naming an undeclared code no longer
// typechecks. Enumerating the registry asserts the same claim without depending on which
// file `fail` is called from or how the call is spelled.

/** Every code the engine can raise, from its error registry. */
function codesInEngine(): string[] {
  return Object.keys(ERRORS).sort();
}

describe("S4 — the error sweep covers the engine", () => {
  test("the engine's codes are found in its registry at all", () => {
    // If the registry were ever emptied, every assertion below would go vacuously green.
    expect(codesInEngine().length).toBeGreaterThan(15);
  });

  test("every error code the engine can raise is provoked once, or declared unreachable", () => {
    const swept = new Set(errorSweep().map((e) => e.code));
    // A code with no provocation is allowed only where the sweep says so and says why —
    // `not_implemented` has nothing to provoke it when every documented command is built,
    // which the sweep establishes by asking the CLI rather than by remembering a list.
    const declared = unreachableCodes();
    const missing = codesInEngine().filter((c) => !swept.has(c) && !(c in declared));
    expect(missing).toEqual([]);
    const undeclared = Object.keys(declared).filter((c) => swept.has(c));
    expect(undeclared).toEqual([]);
  });

  test("every entry really provoked its code, with a non-zero exit and an error to read", () => {
    for (const entry of errorSweep()) {
      expect([entry.label, entry.exitCode === 0]).toEqual([entry.label, false]);
      expect([entry.label, JSON.parse(entry.error).code]).toEqual([entry.label, entry.code]);
      expect([entry.label, JSON.parse(entry.error).next_step?.length > 0]).toEqual([entry.label, true]);
    }
  });

  test("every entry carries the help an Operator meeting it would have", () => {
    for (const entry of errorSweep()) {
      expect([entry.label, entry.help.length > 0]).toEqual([entry.label, true]);
    }
  });
});
