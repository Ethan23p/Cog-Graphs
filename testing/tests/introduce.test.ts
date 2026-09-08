import { describe, expect, test } from "bun:test";
import { makeSandbox, runCli } from "./helpers";
import { EXIT, INTRO_SCOPE } from "./contract";

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
