// DE-22 — graph targeting.
//
// Case text: design doc > Technical Specification > Testing & Evaluation > v0.3.1.
// The spec's second layer; never edited to fit the engine. See testing/DISPUTES.md.

import { test, expect, describe } from "bun:test";
import { EXIT } from "./contract";
import { runCli, makeSandbox, initGraph, errorObject } from "./helpers";

describe("DE-22 graph targeting", () => {
  test("with two instances in the same working directory, omitting --graph errors legibly and names the candidates", () => {
    // Note the implication, deliberate: a bare `query` that must name candidates
    // rather than "silently choosing one" is a resolution step, not a missing-flag
    // error. With exactly one instance in the directory there is nothing to
    // disambiguate — see the sibling case below.
    const dir = makeSandbox();
    initGraph(dir, { namespace: "graph-a" });
    initGraph(dir, { namespace: "graph-b" });

    const r = runCli(["query"], { cwd: dir });
    expect(r.exitCode).toBe(EXIT.AMBIGUOUS);
    const err = errorObject(r);
    const text = `${err.message} ${err.next_step}`;
    expect(text, "the error does not name graph-a").toContain("graph-a");
    expect(text, "the error does not name graph-b").toContain("graph-b");
  });

  test("with exactly one instance, omitting --graph resolves to it rather than erroring", () => {
    const dir = makeSandbox();
    const { ns } = initGraph(dir, { namespace: "only-one" });
    runCli(["add-item", "--graph", ns, "--entity", "alpha", "--attr", "a=b"], { cwd: dir });

    const r = runCli(["query"], { cwd: dir });
    expect(r.exitCode).toBe(EXIT.OK);
    expect(r.stdout).toContain("alpha");
  });

  test("--graph naming a non-existent instance errors and names what does exist, or points at initialize", () => {
    const dir = makeSandbox();
    initGraph(dir, { namespace: "graph-a" });

    const r = runCli(["query", "--graph", "no-such-graph"], { cwd: dir });
    expect(r.exitCode).toBe(EXIT.NOT_FOUND);
    const err = errorObject(r);
    const text = `${err.message} ${err.next_step}`;
    expect(text).toContain("no-such-graph");
    expect(
      text.includes("graph-a") || text.includes("initialize"),
      `the error neither names what exists nor points at initialize: ${text}`,
    ).toBe(true);
  });

  test("in an empty directory, a command needing a graph points at initialize", () => {
    const dir = makeSandbox();
    const r = runCli(["query"], { cwd: dir });
    expect(r.exitCode).not.toBe(EXIT.OK);
    expect(String(errorObject(r).next_step)).toContain("initialize");
  });
});
