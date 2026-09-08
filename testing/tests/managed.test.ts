import { describe, expect, test } from "bun:test";
import { makeSandbox, runCli } from "./helpers";
import { COMMANDS, EXIT, WITHHELD_FLAG } from "./contract";

// The doc keeps the manual/managed structure in the code but withholds it from users
// entirely for v0.3.1: "From the user-facing side, there is no such thing as
// `--managed`, yet." A half-withheld flag is worse than either state — an Operator who
// sees it in help will reach for it, and DE-4 has it rejected on input. So DE-3 polices
// the output side and DE-4 the input side.
describe("DE-3 — --managed appears in no user-facing output", () => {
  // Help, success, and error are the three places output comes from, so the sweep
  // covers all three per command rather than only the one that is easy to check.
  const invocations = COMMANDS.flatMap((command) => [
    [command.name, "--help"],
    [command.name],
  ]);
  invocations.push(["introduce"], ["introduce", "--interface-skill"], []);

  for (const args of invocations) {
    test(`no mention in the output of: ${args.join(" ") || "(no arguments)"}`, () => {
      const cwd = makeSandbox();

      const r = runCli(args, { cwd });

      expect(r.stdout).not.toContain(WITHHELD_FLAG);
      expect(r.stderr).not.toContain(WITHHELD_FLAG);
    });
  }
});

describe("DE-4 — --managed supplied on input is rejected", () => {
  // Silently accepting the flag would let an Operator believe they are driving a
  // use-pattern that does not exist yet, and the artifact would carry no trace of the
  // misunderstanding. Rejecting it as an unrecognized option is the honest answer: it
  // genuinely is not part of this version's grammar.
  //
  // DE-3 and DE-4 pull against each other on one point, and the resolution is worth
  // stating. DE-3 forbids the string from "any error output", and the reflex for an
  // unknown-option error is to echo the offender. That reflex loses here: echoing would
  // confirm the flag's spelling to an Operator who guessed it. So the error names the
  // options that *are* recognized instead, which is both silent about the withheld one
  // and more actionable than an echo.
  for (const command of COMMANDS) {
    test(`${command.name} rejects it without naming it`, () => {
      const cwd = makeSandbox();

      const r = runCli([command.name, WITHHELD_FLAG], { cwd });

      expect(r.exitCode).toBe(EXIT.USAGE);
      const error = JSON.parse(r.stderr);
      expect(error.code).toBe("unknown_option");
      expect(error.message.trim().length).toBeGreaterThan(0);
      expect(error.next_step.trim().length).toBeGreaterThan(0);
      // The recognized options are the actionable half — this is what replaces the echo.
      for (const flag of [...command.required, ...command.optional]) {
        expect(r.stderr).toContain(flag);
      }
    });
  }
});
