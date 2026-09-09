import { describe, expect, test } from "bun:test";
import { makeSandbox, runCli } from "./helpers";
import { BIN, COMMANDS, ERROR_FIELDS, EXIT } from "./contract";

// MINTED at the DE-17 → DE-19 boundary, found by /code-review.
//
// Bare `cog-graphs`, `cog-graphs --help`, and an unknown command each exited 1 with
// empty stdout *and* empty stderr. Nothing on either stream, at any exit code an
// Operator could interpret.
//
// This is the front door. RU-3 gives an agent the binary name and a goal and nothing
// else, and scores it pass^3 because the whole claim is reliability; the first thing
// that agent types is `cog-graphs --help`. Silence there does not slow it down, it ends
// the run. The existing DE-3 sweep passed these invocations vacuously — it asserts
// output *lacks* `--managed`, and empty output qualifies — which is a good reminder that
// a negative assertion is not coverage.
describe("DE-19.2 (minted) — every invocation answers on a stream", () => {
  const entryPoints: { label: string; args: string[] }[] = [
    { label: "no arguments at all", args: [] },
    { label: "top-level --help", args: ["--help"] },
    { label: "an unknown command", args: ["frobnicate"] },
  ];

  for (const { label, args } of entryPoints) {
    test(`${label} produces output, not silence`, () => {
      const cwd = makeSandbox();

      const r = runCli(args, { cwd });

      expect((r.stdout + r.stderr).trim().length).toBeGreaterThan(0);
    });
  }

  test("bare invocation and --help both succeed and name every command", () => {
    // The overview is a success, not an error: asking a tool what it is has not gone
    // wrong. And it names the whole grammar, because an agent that has to guess which
    // commands exist will guess the ones it knows from other tools.
    const cwd = makeSandbox();

    for (const args of [[], ["--help"]]) {
      const r = runCli(args, { cwd });

      expect(r.exitCode).toBe(EXIT.OK);
      const payload = JSON.parse(r.stdout);
      const text = JSON.stringify(payload);
      for (const command of COMMANDS) {
        expect(text).toContain(command.name);
      }
      // Somewhere to go next. An overview that lists commands without saying how to
      // learn one leaves the agent to invent the convention for asking.
      expect(text).toContain("--help");
    }
  });

  test("an unknown command is a structured error naming what does exist", () => {
    const cwd = makeSandbox();

    const r = runCli(["frobnicate"], { cwd });

    expect(r.exitCode).toBe(EXIT.USAGE);
    const error = JSON.parse(r.stderr);
    for (const field of ERROR_FIELDS) {
      expect(error[field]?.length ?? 0).toBeGreaterThan(0);
    }
    expect(error.code).toBe("unknown_command");
    // The recognized commands are the recovery. Naming the offender is optional; naming
    // the alternatives is what turns a dead end into one more turn.
    for (const command of COMMANDS) {
      expect(r.stderr).toContain(command.name);
    }
    expect(error.next_step).toContain(BIN);
  });
});
