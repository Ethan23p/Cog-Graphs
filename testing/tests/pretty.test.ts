import { describe, expect, test } from "bun:test";
import { runCli, spawnGraph } from "./helpers";
import { EXIT, GLOBAL_FLAGS } from "./contract";

// MINTED at the DE-17 → DE-19 boundary, found by /code-review.
//
// `--pretty` was in GLOBAL_FLAGS purely so that passing it would not be rejected as an
// unknown option. It was accepted by every command and changed nothing, which is worse
// than not having it: `--help` promises "Add --pretty for the human-readable form", so an
// Operator who wants readable output asks for it, gets the same dense JSON, and has no
// way to tell whether the flag is broken or whether that JSON *is* the readable form.
// An inert flag that the interface advertises is a lie the interface tells about itself.
//
// The one thing this has to be judged on is whether it is actually more readable, and
// the sharpest instance of that is prose: `introduce --interface-skill` returns the whole
// primer, and in JSON it arrives as one enormous line with every paragraph break written
// as a literal backslash-n. That is the case where the flag earns its place.
describe("DE-19.8 (minted) — --pretty produces a human-readable form", () => {
  test("prose comes back as real lines instead of escaped ones", () => {
    const { cwd } = spawnGraph({ namespace: "de198" });

    const plain = runCli(["introduce", "--interface-skill"], { cwd });
    const pretty = runCli(["introduce", "--interface-skill", "--pretty"], { cwd });

    expect(plain.exitCode).toBe(EXIT.OK);
    expect(pretty.exitCode).toBe(EXIT.OK);
    // The JSON form is the thing being improved on: one line, escapes and all.
    expect(plain.stdout.includes("\\n")).toBe(true);
    // The pretty form must not merely be JSON with whitespace added — no escaped break
    // survives, and the document is many lines long.
    expect(pretty.stdout.includes("\\n")).toBe(false);
    expect(pretty.stdout.split("\n").length).toBeGreaterThan(plain.stdout.split("\n").length + 5);
  });

  test("the default stays JSON, so nothing that parses stdout is affected", () => {
    // The whole reason `--pretty` is opt-in. IN-9 requires every default invocation to
    // parse; this case exists so a later change to the pretty renderer cannot quietly
    // become the default.
    const { cwd, namespace } = spawnGraph({ namespace: "de198b" });
    runCli(["add-item", "--graph", namespace, "--entity", "Sword", "--attr", "status=owned"], { cwd });

    const plain = runCli(["query", "--graph", namespace], { cwd });

    expect(() => JSON.parse(plain.stdout)).not.toThrow();
  });

  test("pretty output is not JSON, and still carries the same facts", () => {
    // "Distinct from the default" is only half the requirement — a pretty form that
    // dropped information would be a worse answer, not a friendlier one. So: it must not
    // parse as JSON, and every entity and value must still be findable in it.
    const { cwd, namespace } = spawnGraph({ namespace: "de198c" });
    runCli(["add-item", "--graph", namespace, "--entity", "Sword", "--attr", "status=owned"], { cwd });
    runCli(["add-item", "--graph", namespace, "--entity", "Shield", "--attr", "status=lost"], { cwd });

    const pretty = runCli(["query", "--graph", namespace, "--pretty"], { cwd });

    expect(pretty.exitCode).toBe(EXIT.OK);
    expect(() => JSON.parse(pretty.stdout)).toThrow();
    for (const fact of ["Sword", "Shield", "status", "owned", "lost"]) {
      expect(pretty.stdout).toContain(fact);
    }
  });

  test("a failure is readable too, and keeps its exit code and its stream", () => {
    // An Operator who asked for readable output asked for it about the whole surface. The
    // parts that make an error actionable — what went wrong and what to do next — have to
    // survive the change of form; only the JSON braces go.
    const { cwd } = spawnGraph({ namespace: "de198d" });

    const r = runCli(["query", "--graph", "no-such-graph", "--pretty"], { cwd });

    expect(r.exitCode).toBe(EXIT.NOT_FOUND);
    expect(r.stdout).toBe("");
    expect(() => JSON.parse(r.stderr)).toThrow();
    expect(r.stderr).toContain("no-such-graph");
    expect(r.stderr.trim().split("\n").length).toBeGreaterThan(1);
  });

  test("every command accepts it", () => {
    // It is a global flag or it is not one. The tell that it was never really global was
    // that nothing anywhere exercised it.
    expect(GLOBAL_FLAGS).toContain("--pretty");
    const { cwd, namespace } = spawnGraph({ namespace: "de198e" });

    for (const args of [
      ["introduce"],
      ["introduce", "--graph", namespace],
      ["query", "--graph", namespace],
      ["add-item", "--graph", namespace, "--entity", "Sword"],
      ["modify-item", "--graph", namespace, "--entity", "Sword", "--attr", "status=owned"],
      ["remove-item", "--graph", namespace, "--entity", "Sword"],
    ]) {
      const r = runCli([...args, "--pretty"], { cwd });
      expect(r.exitCode).toBe(EXIT.OK);
      expect(r.stdout.trim().length).toBeGreaterThan(0);
      expect(() => JSON.parse(r.stdout)).toThrow();
    }
  });
});
