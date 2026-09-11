import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { existsSync } from "node:fs";
import { makeSandbox, runCli, spawnGraph, writeProfileYml } from "./helpers";
import { COMMANDS, ERROR_FIELDS, EXIT, GLOBAL_FLAGS, graphFile } from "./contract";

// MINTED at the DE-17 → DE-19 boundary, found by /code-review.
//
// `optionValue` returns undefined when a flag is last on the line or is followed by
// another `--` token, and `--dir` consumed that as `?? "."`. So
// `initialize --profile p.yml --dir` succeeded, exit 0, and put the graph in the working
// directory — the one flag whose entire purpose is controlling where the User's artifact
// lands, silently doing the opposite of what was asked.
//
// The general shape is what makes this worth a case rather than a one-line fix: an
// Operator who writes a flag has stated an intention, and a missing value means the
// intention did not survive whatever produced the command line. Guessing is the one
// response that cannot be right, because the guess is invisible.
describe("DE-19.6 (minted) — a flag given without a value is an error", () => {
  test("--dir with no value refuses instead of silently using the working directory", () => {
    const cwd = makeSandbox();
    const profilePath = path.join(cwd, "profile.yml");
    writeProfileYml(
      profilePath,
      { namespace: "de196", "use-pattern": "manual", description: "Missing flag value." },
      "Every entity carries a status.",
    );

    const r = runCli(["initialize", "--profile", profilePath, "--dir"], { cwd });

    expect(r.exitCode).toBe(EXIT.USAGE);
    const error = JSON.parse(r.stderr);
    expect(error.code).toBe("missing_value");
    expect(error.message).toContain("--dir");
    for (const field of ERROR_FIELDS) {
      expect(error[field]?.length ?? 0).toBeGreaterThan(0);
    }
    // The give-away that the old behavior was wrong: it produced a graph.
    expect(existsSync(graphFile(cwd, "de196"))).toBe(false);
  });

  test("a flag swallowed by a following flag is caught too", () => {
    // The subtler arrangement, and the likelier one from a generated command line: the
    // value is missing but the line still looks well-formed, because another flag sits
    // where the value should be.
    const { cwd, namespace } = spawnGraph({ namespace: "de196b" });

    const r = runCli(["add-item", "--graph", namespace, "--entity", "--attr", "status=x"], { cwd });

    expect(r.exitCode).toBe(EXIT.USAGE);
    expect(JSON.parse(r.stderr).code).toBe("missing_value");
  });

  test("no value-taking flag anywhere accepts a missing value", () => {
    // Swept over the grammar rather than spot-checked, so a flag added later inherits
    // the rule instead of quietly reintroducing the bug. --interface-skill and the
    // globals are the genuine booleans and are excluded by name.
    const booleans = new Set<string>(["--interface-skill", ...GLOBAL_FLAGS]);
    const cwd = makeSandbox();

    for (const command of COMMANDS) {
      for (const flag of [...command.required, ...command.optional]) {
        if (booleans.has(flag)) continue;

        const r = runCli([command.name, flag], { cwd });

        expect(r.exitCode).not.toBe(EXIT.OK);
        expect(r.stderr.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
