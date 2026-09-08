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
