// DE-8 … DE-18 — query and single-item operations.
//
// Case text: design doc > Technical Specification > Testing & Evaluation > v0.3.1.
// The spec's second layer; never edited to fit the engine. See testing/DISPUTES.md.

import { test, expect } from "bun:test";
import { EXIT } from "./contract";
import {
  runCli,
  sandboxWithGraph,
  storeItem,
  storeEntities,
  readSidecar,
  queryItems,
  queriedItem,
  errorObject,
  parseJson,
} from "./helpers";

test("DE-8 query against the empty instance succeeds with a well-formed empty result", () => {
  const { dir, ns } = sandboxWithGraph();
  const r = runCli(["query", "--graph", ns], { cwd: dir });
  expect(r.exitCode).toBe(EXIT.OK); // exit 0, not an error
  const payload = parseJson(r.stdout, "query stdout");
  // Well-formed: the key is present and empty. "No items" must not be
  // indistinguishable from "no such key" to whatever parses this.
  expect(Array.isArray(payload.items)).toBe(true);
  expect(payload.items).toEqual([]);
});

test("DE-9 after add-item, a direct read of the .sqlite shows exactly the entities and attribute/value pairs supplied", () => {
  const { dir, ns } = sandboxWithGraph();
  runCli(
    ["add-item", "--graph", ns, "--entity", "quarterly-report.pdf", "--attr", "type=document", "--attr", "processed=true"],
    { cwd: dir },
  );
  runCli(["add-item", "--graph", ns, "--entity", "budget.xlsx", "--attr", "type=spreadsheet"], { cwd: dir });

  expect(storeEntities(dir, ns)).toEqual(["budget.xlsx", "quarterly-report.pdf"]);
  // No more, no fewer: nothing the engine invented on the way in.
  expect(storeItem(dir, ns, "quarterly-report.pdf")).toEqual({ type: "document", processed: "true" });
  expect(storeItem(dir, ns, "budget.xlsx")).toEqual({ type: "spreadsheet" });
});

test("DE-10 query returns those items with their attribute/value pairs intact", () => {
  const { dir, ns } = sandboxWithGraph();
  runCli(
    ["add-item", "--graph", ns, "--entity", "quarterly-report.pdf", "--attr", "type=document", "--attr", "processed=true"],
    { cwd: dir },
  );
  runCli(["add-item", "--graph", ns, "--entity", "budget.xlsx", "--attr", "type=spreadsheet"], { cwd: dir });

  const { items } = queryItems(dir, ns);
  expect(items.map((i) => i.entity).sort()).toEqual(["budget.xlsx", "quarterly-report.pdf"]);
  expect(queriedItem(dir, ns, "quarterly-report.pdf")).toEqual({ type: "document", processed: "true" });
  expect(queriedItem(dir, ns, "budget.xlsx")).toEqual({ type: "spreadsheet" });
});

test("DE-11 add-item on an existing entity errors and points to `modify item`", () => {
  const { dir, ns } = sandboxWithGraph();
  runCli(["add-item", "--graph", ns, "--entity", "alpha", "--attr", "type=doc"], { cwd: dir });
  const r = runCli(["add-item", "--graph", ns, "--entity", "alpha", "--attr", "type=other"], { cwd: dir });

  expect(r.exitCode).toBe(EXIT.ALREADY_EXISTS);
  expect(String(errorObject(r).next_step)).toContain("modify-item");
  // And the failed add left the existing item alone.
  expect(storeItem(dir, ns, "alpha")).toEqual({ type: "doc" });
});

test("DE-12 the sidecar enumerates the items after the add", () => {
  const { dir, ns } = sandboxWithGraph();
  runCli(["add-item", "--graph", ns, "--entity", "quarterly-report.pdf", "--attr", "type=document"], { cwd: dir });
  runCli(["add-item", "--graph", ns, "--entity", "budget.xlsx", "--attr", "type=spreadsheet"], { cwd: dir });

  const sidecar = readSidecar(dir, ns);
  expect(sidecar).toContain("quarterly-report.pdf");
  expect(sidecar).toContain("budget.xlsx");
});

test("DE-13 after modify-item, both the .sqlite and the query reflect exactly the modified values, and attributes not named are unchanged", () => {
  const { dir, ns } = sandboxWithGraph();
  runCli(
    ["add-item", "--graph", ns, "--entity", "alpha", "--attr", "type=document", "--attr", "processed=false", "--attr", "owner=ethan"],
    { cwd: dir },
  );
  const r = runCli(["modify-item", "--graph", ns, "--entity", "alpha", "--attr", "processed=true"], { cwd: dir });
  expect(r.exitCode).toBe(EXIT.OK);

  const expected = { type: "document", processed: "true", owner: "ethan" };
  expect(storeItem(dir, ns, "alpha")).toEqual(expected);
  expect(queriedItem(dir, ns, "alpha")).toEqual(expected);
});

test("DE-14 the sidecar reflects the modification", () => {
  const { dir, ns } = sandboxWithGraph();
  runCli(["add-item", "--graph", ns, "--entity", "alpha", "--attr", "status=draft"], { cwd: dir });
  expect(readSidecar(dir, ns)).toContain("draft");

  runCli(["modify-item", "--graph", ns, "--entity", "alpha", "--attr", "status=published"], { cwd: dir });
  const sidecar = readSidecar(dir, ns);
  expect(sidecar).toContain("published");
  expect(sidecar).not.toContain("draft");
});

test("DE-15 modify-item on a non-existent entity errors and points to `add item`", () => {
  const { dir, ns } = sandboxWithGraph();
  const r = runCli(["modify-item", "--graph", ns, "--entity", "nonesuch", "--attr", "a=b"], { cwd: dir });

  expect(r.exitCode).toBe(EXIT.NOT_FOUND);
  expect(String(errorObject(r).next_step)).toContain("add-item");
  // The failed modify did not quietly create it.
  expect(storeEntities(dir, ns)).toEqual([]);
});

test("DE-16 remove-item removes the targeted item; a subsequent query no longer returns it", () => {
  const { dir, ns } = sandboxWithGraph();
  runCli(["add-item", "--graph", ns, "--entity", "alpha", "--attr", "type=doc"], { cwd: dir });
  runCli(["add-item", "--graph", ns, "--entity", "beta", "--attr", "type=doc"], { cwd: dir });

  const r = runCli(["remove-item", "--graph", ns, "--entity", "alpha"], { cwd: dir });
  expect(r.exitCode).toBe(EXIT.OK);

  expect(queryItems(dir, ns).items.map((i) => i.entity)).toEqual(["beta"]);
  expect(queriedItem(dir, ns, "alpha")).toBeUndefined();
});

test("DE-17 remove-item on a non-existent entity errors legibly rather than succeeding silently", () => {
  const { dir, ns } = sandboxWithGraph();
  const r = runCli(["remove-item", "--graph", ns, "--entity", "nonesuch"], { cwd: dir });

  expect(r.exitCode).toBe(EXIT.NOT_FOUND);
  const err = errorObject(r);
  expect(String(err.message)).toContain("nonesuch"); // legibly: it names what it could not find
  expect(String(err.next_step).trim().length).toBeGreaterThan(0);
});

test("DE-18 the sidecar no longer enumerates the removed item", () => {
  const { dir, ns } = sandboxWithGraph();
  runCli(["add-item", "--graph", ns, "--entity", "quarterly-report.pdf", "--attr", "type=document"], { cwd: dir });
  runCli(["add-item", "--graph", ns, "--entity", "budget.xlsx", "--attr", "type=spreadsheet"], { cwd: dir });
  runCli(["remove-item", "--graph", ns, "--entity", "quarterly-report.pdf"], { cwd: dir });

  const sidecar = readSidecar(dir, ns);
  expect(sidecar).not.toContain("quarterly-report.pdf");
  expect(sidecar).toContain("budget.xlsx");
});
