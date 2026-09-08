// DE-19, DE-20 — bulk ingestion.
//
// Case text: design doc > Technical Specification > Testing & Evaluation > v0.3.1.
// The spec's second layer; never edited to fit the engine. See testing/DISPUTES.md.

import { test, expect } from "bun:test";
import { BIN, EXIT, REJECTED_FIELD, type RejectedRecord } from "./contract";
import {
  runCli,
  sandboxWithGraph,
  makeSandbox,
  writeItemsFile,
  storeEntities,
  storeItem,
  readSidecar,
  queryItems,
  errorObject,
} from "./helpers";

const FIVE = [
  { entity: "grand-theft-auto-v", attributes: { "taste-alignment": "very high", status: "completed" } },
  { entity: "disco-elysium", attributes: { "taste-alignment": "very high", status: "completed" } },
  { entity: "outer-wilds", attributes: { "taste-alignment": "high", status: "playing" } },
  { entity: "factorio", attributes: { "taste-alignment": "medium", status: "abandoned" } },
  { entity: "stardew-valley", attributes: { "taste-alignment": "low", status: "backlog" } },
];

test("DE-19 bulk ingestion of N items in one invocation yields exactly N, queryable, enumerated in the sidecar", () => {
  const { dir, ns } = sandboxWithGraph();
  const file = writeItemsFile(dir, FIVE);

  const r = runCli(["import", "--graph", ns, "--from", file], { cwd: dir });
  expect(r.exitCode).toBe(EXIT.OK);

  // Exactly N — in the store,
  expect(storeEntities(dir, ns)).toEqual(FIVE.map((f) => f.entity).sort());
  // with attribute/value pairs intact,
  for (const rec of FIVE) {
    expect(storeItem(dir, ns, rec.entity), `stored attributes for ${rec.entity}`).toEqual(rec.attributes);
  }
  // through the CLI,
  const { items } = queryItems(dir, ns);
  expect(items.length).toBe(FIVE.length);
  for (const rec of FIVE) {
    expect(items.find((i) => i.entity === rec.entity)?.attributes, `queried attributes for ${rec.entity}`).toEqual(
      rec.attributes,
    );
  }
  // and in the sidecar.
  const sidecar = readSidecar(dir, ns);
  for (const rec of FIVE) expect(sidecar, `sidecar omits ${rec.entity}`).toContain(rec.entity);
});

test("DE-20 a bulk ingestion containing one invalid record behaves as partial-with-report", () => {
  const { dir, ns } = sandboxWithGraph();
  // The offender: a record duplicating an entity already in the graph — the same
  // condition DE-11 rejects for `add-item`, so bulk and single-item agree on what
  // "invalid" means rather than each inventing a rule.
  runCli(["add-item", "--graph", ns, "--entity", "outer-wilds", "--attr", "status=completed"], { cwd: dir });
  const file = writeItemsFile(dir, FIVE);

  const r = runCli(["import", "--graph", ns, "--from", file], { cwd: dir });

  // Distinct from both clean success and total failure (IN-10).
  expect(r.exitCode).toBe(EXIT.PARTIAL);
  expect(r.exitCode).not.toBe(EXIT.OK);
  expect(r.exitCode).not.toBe(EXIT.ALREADY_EXISTS);

  // The valid records are committed.
  const valid = FIVE.filter((f) => f.entity !== "outer-wilds");
  for (const rec of valid) {
    expect(storeItem(dir, ns, rec.entity), `valid record ${rec.entity} was not committed`).toEqual(rec.attributes);
  }
  // The invalid record is rejected — the pre-existing item is untouched.
  expect(storeItem(dir, ns, "outer-wilds")).toEqual({ status: "completed" });

  // And the report names the offender by identifier and by position.
  const err = errorObject(r);
  const rejected = err[REJECTED_FIELD] as RejectedRecord[] | undefined;
  expect(Array.isArray(rejected), `error object carries no '${REJECTED_FIELD}' array`).toBe(true);
  expect(rejected!.length).toBe(1);
  expect(rejected![0].entity).toBe("outer-wilds");
  expect(rejected![0].index).toBe(FIVE.findIndex((f) => f.entity === "outer-wilds"));
});

test("DE-20 --help for the bulk command states the partial-with-report semantic explicitly", () => {
  // So an Operator is never guessing whether a batch was atomic.
  const dir = makeSandbox();
  const r = runCli(["import", "--help"], { cwd: dir });
  expect(r.exitCode).toBe(EXIT.OK);
  expect(r.stdout.toLowerCase()).toContain("partial");
  const hasExample = r.stdout.split("\n").some((l) => l.includes(BIN) && l.includes("import"));
  expect(hasExample).toBe(true);
});
