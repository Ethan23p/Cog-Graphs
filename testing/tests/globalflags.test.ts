import { describe, expect, test } from "bun:test";
import { makeSandbox, runCli, spawnGraph } from "./helpers";
import { EXIT, GLOBAL_FLAGS } from "./contract";

// DE-19.8.1 (minted) — a global flag is not a command, wherever it appears.
//
// Found by /code-review after IN-9/10/11 landed. `cog-graphs --pretty` answered
// `unknown_command: '--pretty' is not a cog-graphs command` at exit 1. The front door
// derived the command from `argv[0]` and special-cased only `--help`, so every other
// global flag arriving first was read as a command name.
//
// This is the worst possible place for it. `--pretty` is advertised in the overview's own
// output line — "Add --pretty for the human-readable form" — so a person reading over an
// agent's shoulder types exactly that, first, before anything else, and is told they
// typed a command that does not exist. An interface that names a flag and then rejects it
// as a command has misdirected the one Operator who was doing what it asked.
//
// Numbered off DE-19.8, which put --pretty in the surface; same deviation from the
// mint-by-slice rule as DE-7.1, and flagged the same way.
describe("DE-19.8.1 (minted) — a global flag is never mistaken for a command", () => {
  for (const flag of GLOBAL_FLAGS) {
    test(`bare '${flag}' is answered, not rejected as a command`, () => {
      const cwd = makeSandbox();

      const r = runCli([flag], { cwd });

      expect(r.exitCode).toBe(EXIT.OK);
      expect(r.stderr).toBe("");
      expect(r.stdout.trim().length).toBeGreaterThan(0);
      expect(r.stdout).not.toContain("unknown_command");
      // Whichever form it is in, it must be the overview: the front door answers "what is
      // this", and every command it offers has to be in the answer.
      for (const name of ["introduce", "initialize", "query", "add-item"]) {
        expect(r.stdout).toContain(name);
      }
    });
  }

  test("--pretty gives the overview in the human-readable form", () => {
    // The specific promise the overview makes about itself, kept when taken up literally.
    const cwd = makeSandbox();

    const plain = runCli([], { cwd });
    const pretty = runCli(["--pretty"], { cwd });

    expect(pretty.exitCode).toBe(EXIT.OK);
    expect(() => JSON.parse(plain.stdout)).not.toThrow();
    expect(() => JSON.parse(pretty.stdout)).toThrow();
  });

  test("a global flag before the command still runs the command", () => {
    // Argument order is something an agent gets wrong on its first try and a person gets
    // wrong always. Both spellings mean the same thing, so both have to work.
    const g = spawnGraph({ namespace: "flagorder" });

    const after = runCli(["query", "--graph", g.namespace, "--pretty"], { cwd: g.cwd });
    const before = runCli(["--pretty", "query", "--graph", g.namespace], { cwd: g.cwd });

    expect(after.exitCode).toBe(EXIT.OK);
    expect(before.exitCode).toBe(EXIT.OK);
    expect(before.stdout).toBe(after.stdout);
  });

  test("--help before a command names that command, not the overview", () => {
    // `--help query` and `query --help` are the same question. Answering the first with
    // the overview would be a quiet downgrade: the Operator asked about one command and
    // got the index.
    const cwd = makeSandbox();

    const before = runCli(["--help", "query"], { cwd });
    const after = runCli(["query", "--help"], { cwd });

    expect(before.exitCode).toBe(EXIT.OK);
    expect(before.stdout).toBe(after.stdout);
  });

  test("an unknown command is still an unknown command", () => {
    // The guard must not become "anything starting with -- is fine". A real typo still has
    // to land as a typo, and a flag that is not global is still an unknown option.
    const cwd = makeSandbox();

    const typo = runCli(["frobnicate"], { cwd });
    expect(typo.exitCode).toBe(EXIT.USAGE);
    expect(JSON.parse(typo.stderr).code).toBe("unknown_command");

    const notGlobal = runCli(["--nonsense"], { cwd });
    expect(notGlobal.exitCode).toBe(EXIT.USAGE);
    expect(JSON.parse(notGlobal.stderr).code).toBe("unknown_option");
  });
});
