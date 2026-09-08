import { describe, expect, test } from "bun:test";
import { makeSandbox, runCli } from "./helpers";
import { EXIT, INTRO_SCOPE } from "./contract";
import { BIN, WALKING_SKELETON_COMMANDS } from "./contract";

describe("DE-1 — introduce with no instance present", () => {
  // The doc: introduce returns an introduction to this instantiation, "unless there's no
  // instantiation to be found, in which case it introduces this system and how to use
  // it". An empty directory is the first thing an Operator meets, so erroring there
  // would put a wall exactly where the self-documentation is supposed to start.
  test("returns the system introduction rather than erroring", () => {
    const cwd = makeSandbox();

    const r = runCli(["introduce"], { cwd });

    expect(r.exitCode).toBe(EXIT.OK);
    const payload = JSON.parse(r.stdout);
    expect(payload.scope).toBe(INTRO_SCOPE.SYSTEM);
    // "how to use it" is the load-bearing half: an introduction that does not point at
    // the first command leaves the Operator to guess it.
    expect(payload.introduction).toContain("initialize");
  });
});

describe("DE-2 — introduce --interface-skill", () => {
  // The doc: the flag exists "specifically for instances in which the external AI Agent
  // needs to operate the CLI directly", and it "includes all relevant information for
  // initializing and using a Cog-Graph". A primer that omits a command the scenario
  // needs sends the Operator back to guessing, which is the failure the flag exists to
  // prevent. The assertion is on the invocation form rather than the bare word, so a
  // primer that merely mentions "query" in prose does not pass for one that shows how
  // to run it.
  test("returns non-empty primer content naming every Walking Skeleton command", () => {
    const cwd = makeSandbox();

    const r = runCli(["introduce", "--interface-skill"], { cwd });

    expect(r.exitCode).toBe(EXIT.OK);
    const payload = JSON.parse(r.stdout);
    expect(typeof payload.primer).toBe("string");
    expect(payload.primer.trim().length).toBeGreaterThan(0);
    for (const command of WALKING_SKELETON_COMMANDS) {
      expect(payload.primer).toContain(BIN + " " + command);
    }
  });
});
