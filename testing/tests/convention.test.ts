// DE-21 — convention.
//
// Case text: design doc > Technical Specification > Testing & Evaluation > v0.3.1.
// The spec's second layer; never edited to fit the engine. See testing/DISPUTES.md.

import { test, expect } from "bun:test";
import { EXIT } from "./contract";
import { runCli, sandboxWithGraph, readConvention, readSidecar, parseJson } from "./helpers";

test("DE-21 the convention is amendable: a read-back returns the amended convention and the sidecar reflects it", () => {
  const { dir, ns, cfg } = sandboxWithGraph();

  // Read back the seed.
  const before = runCli(["convention", "--graph", ns], { cwd: dir });
  expect(before.exitCode).toBe(EXIT.OK);
  expect(JSON.stringify(parseJson(before.stdout, "convention stdout"))).toContain(cfg.convention);

  // Amend it — the case in the doc: a new expectation arrives mid-use ("the user is
  // asking me to start tracking POV per game").
  const amendment = "Each item also carries a POV attribute.";
  const amend = runCli(["convention", "--graph", ns, "--append", amendment], { cwd: dir });
  expect(amend.exitCode).toBe(EXIT.OK);

  // Read-back returns the amended convention — amended, not replaced.
  const after = runCli(["convention", "--graph", ns], { cwd: dir });
  expect(after.exitCode).toBe(EXIT.OK);
  const text = JSON.stringify(parseJson(after.stdout, "convention stdout"));
  expect(text).toContain(amendment);
  expect(text).toContain(cfg.convention);

  // It landed in the artifact, not just in the response.
  expect(readConvention(dir, ns)).toContain(amendment);
  // And the sidecar reflects it.
  expect(readSidecar(dir, ns)).toContain(amendment);
});
