import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { readItems, readSidecar, runCli, spawnGraph, writeRecordsYml } from "./helpers";
import { EXIT, ERROR_FIELDS } from "./contract";

// DE-20 — A bulk ingestion containing one invalid record is partial-with-report: the
// valid records are committed, the invalid one is rejected, and the report names the
// offender by identifier and by position. The exit code is distinct from both clean
// success (DE-19) and total failure.
//
// What counts as invalid is owned here, and the answer is taken from `add-item` rather
// than invented: `add-item` refuses an entity the graph already holds (EXIT.ALREADY_EXISTS,
// reason `entity_exists`). A bulk path that accepted what the single path refuses would
// be a second, laxer model of what an item is — the exact drift DE-19's file shape was
// chosen to prevent. So the canonical invalid record is one naming an entity already in
// the graph, and it is rejected under the same reason code the single path uses.
//
// WHERE THE REPORT GOES, AND WHY IT IS AN ERROR OBJECT
// The obvious shape is a success payload on stdout with a `rejected` array in it. IN-9
// forbids it: every non-zero exit puts one parseable object on stderr and leaves stdout
// empty, and IN-11 requires that object to carry code / message / next_step. Those are
// frozen invariants and they are right — an agent that pipes stdout into a parser must
// never have a partial run corrupt the parse, and "some of it worked" is precisely the
// outcome an Operator has to act on. So the report *is* the error object, with the counts
// and the rejects carried as extra fields on it. That keeps one rule for the whole
// surface instead of one rule plus an exception for the only command that can be
// half-right.
//
// "By position" is pinned as `index`, zero-based, into the source's `items` list. The
// word "position" is ambiguous between the ordinal a human counts and the subscript an
// agent indexes with, and the report's reader is an agent that is about to go back into
// the array it just wrote. The field name says which one it is; a field called `position`
// would not.
describe("DE-20 — partial ingestion with report", () => {
  const HAND_ADDED = "Grand Theft Auto V";
  const N = 12;
  const OFFENDER_AT = 5;

  // Twelve good records with the offender sitting in the middle of them. Mid-list is
  // deliberate: an engine that stops at the first bad record, and one that commits only
  // what preceded it, both survive a source whose offender is last.
  const records = Array.from({ length: N + 1 }, (_, i) =>
    i === OFFENDER_AT
      ? { entity: HAND_ADDED, attributes: { status: "backlog" } }
      : {
          entity: `Game ${String(i + 1).padStart(2, "0")}`,
          attributes: { status: i % 2 === 0 ? "completed" : "backlog" },
        },
  );

  function ingest() {
    const g = spawnGraph({ namespace: "game-recs" });
    expect(
      runCli(
        ["add-item", "--graph", g.namespace, "--entity", HAND_ADDED, "--attr", "status=completed"],
        { cwd: g.cwd },
      ).exitCode,
    ).toBe(EXIT.OK);

    const source = path.join(g.cwd, "games.yml");
    writeRecordsYml(source, records);
    const r = runCli(["import", "--graph", g.namespace, "--from", source], { cwd: g.cwd });
    return { g, r };
  }

  test("the exit code is partial — neither clean success nor total failure", () => {
    const { r } = ingest();

    expect(r.exitCode).toBe(EXIT.PARTIAL);
    // Stated against the alphabet rather than against a number, because the whole point
    // of a distinct code is that a caller can branch on it: an Operator that treated
    // partial as success would go on to trust a graph missing a record it offered.
    expect(r.exitCode).not.toBe(EXIT.OK);
  });

  test("the report is a structured error, and stdout stays clean", () => {
    const { r } = ingest();

    expect(r.stdout).toBe("");
    const report = JSON.parse(r.stderr);
    for (const field of ERROR_FIELDS) {
      expect(typeof report[field]).toBe("string");
      expect(report[field].trim().length).toBeGreaterThan(0);
    }
    expect(report.code).toBe("partial_ingestion");
    // The message has to say how much of the batch survived. An Operator re-running a
    // whole source because the message only said "some records were rejected" would
    // duplicate everything that did land.
    expect(report.message).toContain(String(N));
  });

  test("the report names the offender by identifier and by position", () => {
    const { r } = ingest();

    const report = JSON.parse(r.stderr);
    expect(report.ingested).toBe(N);
    expect(report.rejected).toEqual([
      { index: OFFENDER_AT, entity: HAND_ADDED, reason: "entity_exists" },
    ]);
  });

  test("every valid record is committed, and the offender changed nothing", () => {
    const { g } = ingest();

    const items = readItems(g.db);

    expect(items.length).toBe(N + 1);
    // The hand-added item keeps the attributes it was added with. A bulk path that
    // treated a colliding record as an update would leave the count correct and this
    // value wrong, which is the quieter of the two failures.
    expect(items.find((i) => i.entity === HAND_ADDED)?.attributes).toEqual({
      status: "completed",
    });
    for (const record of records.filter((_, i) => i !== OFFENDER_AT)) {
      expect(items.find((i) => i.entity === record.entity)?.attributes).toEqual(record.attributes);
    }
  });

  test("the inspectable face shows what landed, not what was offered", () => {
    const { g } = ingest();

    const sidecar = readSidecar(g.sidecar);

    const headings = sidecar.split("\n").filter((l) => l.startsWith("### "));
    expect(headings.length).toBe(N + 1);
    expect(sidecar).toContain(`${N + 1} entities.`);
    // Named once, never twice: a rejected duplicate that still reached the derived view
    // would make the inspectable face disagree with the artifact it is derived from.
    expect(headings.filter((h) => h === `### ${HAND_ADDED}`).length).toBe(1);
  });

  test("--help states the partial semantic, so a batch is never guessed at", () => {
    const { g } = ingest();

    const help = JSON.parse(runCli(["import", "--help"], { cwd: g.cwd }).stdout);

    const notes = (help.notes as string[]).join(" ").toLowerCase();
    // An Operator deciding whether to re-run a failed batch needs to know it was not
    // atomic before it runs it; reading that off the exit code after the fact is too late.
    expect(notes).toContain("partial");
    expect(notes).toContain("index");
  });
});
