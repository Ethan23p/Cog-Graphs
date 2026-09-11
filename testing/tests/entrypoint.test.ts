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

describe("DE-19.3 (minted) — a command in the grammar but not yet built", () => {
  // MINTED alongside DE-19.2. `import` and `convention` are in COMMANDS, DE-5 grades
  // their --help as a deliverable complete with a runnable example, and running that
  // example produced nothing on either stream at exit 1.
  //
  // The asymmetry is what makes it worse than a missing command: the CLI advertises
  // these, so an agent has every reason to trust them, and gets less back than it would
  // for a typo. Under the vertical loop some commands are always unbuilt, so "not built
  // yet" needs to be a thing the interface can *say* — and it must be distinguishable
  // from "does not exist", because those imply different next moves.
  //
  // AMENDED 2026-09-09 by Ethan's resolution of the DE-19.3 dispute (DISPUTES.md).
  // The case previously named `["import", "convention"]` in a literal while its own
  // comment claimed the sweep "empties itself honestly" as commands graduate. It did
  // not: the literal made DE-19.3 and DE-19 mutually unsatisfiable, since one required
  // `import` to work and the other required it to report that it does not. The list is
  // now asked of the engine, so the case's real claim survives — an unbuilt command
  // says so, distinguishably from a typo — and the case retires itself when the set
  // empties, which is what the comment always promised.
  //
  // Asking the engine also widens the sweep: any command that ever regresses into
  // `not_implemented` is covered from that moment on, with no edit here.
  const cwd = makeSandbox();
  const help = COMMANDS.map((command) => ({
    name: command.name,
    payload: JSON.parse(runCli([command.name, "--help"], { cwd }).stdout) as Record<string, unknown>,
  }));
  const unbuilt = help.filter((h) => h.payload.status === "not_implemented").map((h) => h.name);

  // Present whether or not anything is unbuilt, so an empty sweep is a fact the suite
  // established rather than a silent absence of tests. The derivation is only honest if
  // every command actually answered `--help` with parseable JSON carrying a name.
  test("every command's --help reports whether it is built", () => {
    expect(help.length).toBe(COMMANDS.length);
    for (const h of help) {
      expect(h.payload.command).toBe(h.name);
      const status = h.payload.status;
      expect(status === undefined || status === "not_implemented").toBe(true);
    }
  });

  for (const name of unbuilt) {
    test(`${name} fails loudly rather than silently`, () => {
      // Invoked the way its own --help says to, so the case tracks what DE-5 promises.
      const example = JSON.parse(runCli([name, "--help"], { cwd }).stdout).examples[0] as string;
      const args = example.split(" ").slice(1);
      const r = runCli(args, { cwd });

      expect((r.stdout + r.stderr).trim().length).toBeGreaterThan(0);
      expect(r.exitCode).not.toBe(EXIT.OK);
      const error = JSON.parse(r.stderr);
      for (const field of ERROR_FIELDS) {
        expect(error[field]?.length ?? 0).toBeGreaterThan(0);
      }
      // Distinct from unknown_command: that one means "you typo'd", this one means
      // "you read the help correctly and there is nothing behind it yet". An agent that
      // conflates them retries with a different spelling forever.
      expect(error.code).toBe("not_implemented");
      expect(error.message).toContain(name);
    });
  }
});
