// DE-23 — source-fidelity round-trip.
//
// Case text: design doc > Technical Specification > Testing & Evaluation > v0.3.1.
// The spec's second layer; never edited to fit the engine. See testing/DISPUTES.md.
//
// "Source data at source fidelity is the default assumption" is a guiding value, and
// this is the case that makes it mechanical. Every character class below is one an
// Operator will hand the CLI in the first week: filenames have spaces and
// apostrophes, prose has accents, and an `=` inside a value is what breaks a naive
// `--attr k=v` split.

import { test, expect } from "bun:test";
import { EXIT } from "./contract";
import { runCli, sandboxWithGraph, storeItem, queriedItem, readSidecar, norm } from "./helpers";

const ENTITY = "Ethan's café notes = final ☕";
const ATTRS = {
  spaces: "a value with several spaces",
  apostrophe: "Ethan's own phrasing",
  "non-ascii": "café ☕ naïve",
  equals: "left=right=both",
  newline: "line one\nline two",
};

test("DE-23 an entity name and attribute values with awkward characters survive add → query → sidecar unchanged", () => {
  const { dir, ns } = sandboxWithGraph();

  const args = ["add-item", "--graph", ns, "--entity", ENTITY];
  for (const [k, v] of Object.entries(ATTRS)) args.push("--attr", `${k}=${v}`);
  const r = runCli(args, { cwd: dir });
  expect(r.exitCode).toBe(EXIT.OK);

  // The store holds them verbatim. Note `equals`: splitting on the FIRST `=` is what
  // makes "left=right=both" survive; splitting on every `=` silently truncates it.
  expect(storeItem(dir, ns, ENTITY)).toEqual(ATTRS);

  // The CLI returns them verbatim.
  expect(queriedItem(dir, ns, ENTITY)).toEqual(ATTRS);

  // The sidecar renders them without losing them. A multi-line value is the case a
  // naive markdown table drops on the floor, so it is checked line by line.
  const sidecar = norm(readSidecar(dir, ns));
  expect(sidecar).toContain(ENTITY);
  for (const [k, v] of Object.entries(ATTRS)) {
    for (const line of v.split("\n")) {
      expect(sidecar, `sidecar lost ${k}: ${JSON.stringify(line)}`).toContain(line);
    }
  }
});

test("DE-23 the same values survive a modification", () => {
  const { dir, ns } = sandboxWithGraph();
  runCli(["add-item", "--graph", ns, "--entity", ENTITY, "--attr", "status=draft"], { cwd: dir });

  const args = ["modify-item", "--graph", ns, "--entity", ENTITY];
  for (const [k, v] of Object.entries(ATTRS)) args.push("--attr", `${k}=${v}`);
  expect(runCli(args, { cwd: dir }).exitCode).toBe(EXIT.OK);

  expect(storeItem(dir, ns, ENTITY)).toEqual({ status: "draft", ...ATTRS });
});
