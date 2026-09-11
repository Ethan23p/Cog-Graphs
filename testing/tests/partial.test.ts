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

// DE-20.1 (minted, found opening DE-20) — A record that does not name an entity is
// rejected, not ingested under an empty name.
//
// The hole: the loop read `typeof item.entity === "string" ? item.entity : ""` and
// inserted whatever came back. A record with no `entity:` key became a row named "" —
// a real entity, in the artifact, in the sidecar, that no query can name and no
// modify-item can reach. Worse, it made the *second* such record collide with the first,
// so the report blamed `entity_exists` on a name the Operator never wrote.
//
// add-item is again the reference: it refuses an absent --entity with `missing_value`,
// so a record with no name is refused for the same reason under the same code. What is
// deliberately *not* copied is a stricter rule than add-item's — a whitespace-only name
// is accepted by add-item today, so it is accepted here. The two paths agreeing matters
// more than either being tidy, because the moment they disagree an Operator has to learn
// which one it is talking to.
//
// A non-string entity gets its own code rather than being folded in. `entity: 2001` is a
// game called 2001 that YAML read as a number, and the fix is quoting it — a different
// action from "give this record a name", so it is a different code.
describe("DE-20.1 — a record that names no entity", () => {
  function ingestRecords(records: Record<string, unknown>[]) {
    const g = spawnGraph({ namespace: "nameless" });
    const source = path.join(g.cwd, "items.yml");
    writeRecordsYml(source, records);
    return { g, r: runCli(["import", "--graph", g.namespace, "--from", source], { cwd: g.cwd }) };
  }

  test("it is rejected by index, with a null identifier rather than an invented one", () => {
    const { r } = ingestRecords([
      { entity: "Portal", attributes: { status: "completed" } },
      { attributes: { status: "backlog" } },
      { entity: "", attributes: { status: "backlog" } },
    ]);

    expect(r.exitCode).toBe(EXIT.PARTIAL);
    const report = JSON.parse(r.stderr);
    expect(report.ingested).toBe(1);
    // null, not "". The report says the record had no identifier instead of reporting an
    // identifier that is indistinguishable from a genuine empty name — and the index is
    // then the only handle the Operator has, which is why it has to be exact.
    expect(report.rejected).toEqual([
      { index: 1, entity: null, reason: "missing_value" },
      { index: 2, entity: null, reason: "missing_value" },
    ]);
  });

  test("no empty-named row reaches the artifact or the derived face", () => {
    const { g } = ingestRecords([
      { entity: "Portal", attributes: { status: "completed" } },
      { attributes: { status: "backlog" } },
    ]);

    const items = readItems(g.db);

    expect(items.map((i) => i.entity)).toEqual(["Portal"]);
    // Named explicitly as well as counted: a row named "" satisfies a length check the
    // moment anything else is missing, and this is the assertion that would still fail.
    expect(items.some((i) => i.entity === "")).toBe(false);
    expect(readSidecar(g.sidecar)).not.toContain("### \n");
  });

  test("two nameless records do not collide with each other", () => {
    const { r } = ingestRecords([{ attributes: { a: "1" } }, { attributes: { b: "2" } }]);

    const report = JSON.parse(r.stderr);
    // The defect this rules out is specific and was live: the second nameless record
    // hitting the taken-names set and being reported as `entity_exists` — an error
    // blaming a duplicate name on an Operator who wrote no name at all.
    expect(report.rejected.map((x: { reason: string }) => x.reason)).toEqual([
      "missing_value",
      "missing_value",
    ]);
  });

  test("an entity YAML read as a number is rejected for quoting, not for absence", () => {
    const { r } = ingestRecords([
      { entity: "Portal", attributes: { status: "completed" } },
      { entity: 2001, attributes: { status: "backlog" } },
    ]);

    const report = JSON.parse(r.stderr);
    expect(report.ingested).toBe(1);
    // A distinct code because it is a distinct fix: quote the value, rather than supply a
    // name that is not there. Folding both into missing_value would send an Operator
    // looking for a key that is present and correct.
    expect(report.rejected).toEqual([{ index: 1, entity: null, reason: "invalid_entity" }]);
  });
});

// DE-20.2 (minted, found opening DE-20) — A record colliding with an *earlier record in
// the same file* is rejected on the same terms as one colliding with the artifact.
//
// The hole is in what "already exists" is checked against. Reading the graph's names once
// and comparing against that snapshot is the obvious implementation and it is wrong: the
// snapshot does not know about the eleven rows this same invocation just inserted, so a
// file listing the same entity twice ingests it twice. SQLite's UNIQUE constraint then
// either takes the process down mid-batch, or — if the schema ever loses that constraint
// — leaves two rows the Operator has no way to tell apart, in a graph whose whole premise
// is that an entity is named once.
//
// This case is why the engine adds each landed name to the set as it goes rather than
// testing against a snapshot. It went green on arrival, so its liveness was established
// by probe instead of by a first red: deleting `taken.add(entity)` from the loop reds
// exactly this describe and nothing else (run 2026-09-09).
describe("DE-20.2 — a duplicate inside the source file", () => {
  function ingestRecords(records: Record<string, unknown>[]) {
    const g = spawnGraph({ namespace: "self-dup" });
    const source = path.join(g.cwd, "items.yml");
    writeRecordsYml(source, records);
    return { g, r: runCli(["import", "--graph", g.namespace, "--from", source], { cwd: g.cwd }) };
  }

  const records = [
    { entity: "Portal", attributes: { status: "completed" } },
    { entity: "Hades", attributes: { status: "backlog" } },
    { entity: "Portal", attributes: { status: "backlog" } },
  ];

  test("the second mention is rejected, and the first is what landed", () => {
    const { g, r } = ingestRecords(records);

    expect(r.exitCode).toBe(EXIT.PARTIAL);
    const report = JSON.parse(r.stderr);
    expect(report.ingested).toBe(2);
    expect(report.rejected).toEqual([{ index: 2, entity: "Portal", reason: "entity_exists" }]);
    // First wins, and it wins explicitly rather than by luck of iteration order: the
    // attributes are the first mention's, so a last-write-wins engine fails here even
    // though its count would be identical.
    expect(readItems(g.db).find((i) => i.entity === "Portal")?.attributes).toEqual({
      status: "completed",
    });
  });

  test("the entity is named exactly once, and the run ended rather than died", () => {
    const { g, r } = ingestRecords(records);

    const items = readItems(g.db);

    expect(items.filter((i) => i.entity === "Portal").length).toBe(1);
    expect(items.length).toBe(2);
    // The exit code is here because of what the liveness probe showed. Removing
    // `taken.add(entity)` makes the duplicate reach SQLite, the UNIQUE constraint takes
    // the process down, and the artifact is left holding exactly the two rows this test
    // asked for — so without this line the case stayed green through a crash. A count
    // that is correct because the program died before it could be wrong is not the claim.
    expect(r.exitCode).toBe(EXIT.PARTIAL);
  });
});

// DE-20.3 (minted, found opening DE-20) — A source whose every record is rejected is
// still partial-with-report, and says so with a count of zero.
//
// DE-20's sub-bullet asks for an exit distinct from "total failure", which invites a
// fourth outcome for a batch where nothing landed. Rejected, deliberately: the exit
// alphabet has no code for "nothing ingested", and inventing one would give an agent a
// branch to handle for an outcome the report already states exactly, in `ingested: 0`.
//
// "Total failure" is read instead as the import itself failing — a source that is missing
// (EXIT.NOT_FOUND) or unparseable (EXIT.USAGE) — which are already distinct codes, and
// distinct in kind: nothing was even offered, so there is nothing to report per record.
// This case pins that reading so the next reader finds the decision rather than the
// silence. It went green on arrival; the probe is DE-20's own — making `rejected.length`
// the condition for a *success* payload reds this alongside DE-20.
describe("DE-20.3 — every record rejected", () => {
  test("exit is partial with a zero count, not a fourth kind of failure", () => {
    const g = spawnGraph({ namespace: "all-bad" });
    expect(
      runCli(["add-item", "--graph", g.namespace, "--entity", "Portal"], { cwd: g.cwd }).exitCode,
    ).toBe(EXIT.OK);
    const source = path.join(g.cwd, "items.yml");
    writeRecordsYml(source, [{ entity: "Portal" }, { attributes: { status: "backlog" } }]);

    const r = runCli(["import", "--graph", g.namespace, "--from", source], { cwd: g.cwd });

    expect(r.exitCode).toBe(EXIT.PARTIAL);
    const report = JSON.parse(r.stderr);
    expect(report.ingested).toBe(0);
    expect(report.rejected.length).toBe(2);
    // The graph is untouched, which is the claim an Operator actually needs before
    // re-running: nothing landed, so the whole source can be fixed and offered again.
    expect(readItems(g.db).map((i) => i.entity)).toEqual(["Portal"]);
  });

  test("a source that cannot be read at all is a different code entirely", () => {
    const g = spawnGraph({ namespace: "no-source" });

    const missing = runCli(
      ["import", "--graph", g.namespace, "--from", path.join(g.cwd, "nope.yml")],
      { cwd: g.cwd },
    );

    // Distinct from partial, and distinct in kind: no record was offered, so there is
    // nothing to report per record. This is what DE-20's "total failure" names.
    expect(missing.exitCode).toBe(EXIT.NOT_FOUND);
    expect(missing.exitCode).not.toBe(EXIT.PARTIAL);
    expect(JSON.parse(missing.stderr).rejected).toBeUndefined();
  });
});
