import { describe, expect, test } from "bun:test";
import { makeSandbox, runCli } from "./helpers";
import { BIN, COMMANDS, EXIT } from "./contract";

// The doc treats `--help` as the surface an agent probes first: "the CLI should be
// feature complete and totally self-documenting... an AI Agent should be able to pick it
// up with zero priming and get to a fluent level of control", and the expected habit is
// "running `app command --help` the first time an agent encounters a new surface". So
// help is a deliverable, not a courtesy, and DE-5 sweeps every command rather than
// spot-checking one.
describe("DE-5 — every command answers --help", () => {
  for (const command of COMMANDS) {
    test(`${command.name} --help names its required flags and shows an example`, () => {
      const cwd = makeSandbox();

      const r = runCli([command.name, "--help"], { cwd });

      expect(r.exitCode).toBe(EXIT.OK);
      const payload = JSON.parse(r.stdout);
      expect(payload.command).toBe(command.name);

      // A required flag absent from help is a flag the Operator can only discover by
      // failing, which is the discovery loop help exists to replace.
      const text = JSON.stringify(payload);
      for (const flag of command.required) {
        expect(text).toContain(flag);
      }

      // "Runnable" is the load-bearing word: an example that is not a whole invocation
      // leaves the agent assembling one from prose.
      expect(Array.isArray(payload.examples)).toBe(true);
      expect(payload.examples.length).toBeGreaterThan(0);
      for (const example of payload.examples) {
        expect(example.startsWith(BIN + " " + command.name)).toBe(true);
      }
      // An example that skips a required flag is not runnable.
      for (const flag of command.required) {
        expect(payload.examples.some((e: string) => e.includes(flag))).toBe(true);
      }
    });
  }
});
