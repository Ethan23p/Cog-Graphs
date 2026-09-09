import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { readItems, readSidecar, runCli, spawnGraph, writeItemsYml } from "./helpers";
import { EXIT } from "./contract";

// DE-19 — Bulk ingestion of N items in one invocation yields exactly N items; a
// subsequent query returns all N with attribute/value pairs intact; the sidecar
// enumerates all N.
//
// The doc ratifies the grammar (`cog-graphs import --graph <ns> --from <items.yml>`) and
// the flow it serves (RU-6: the Assistant does one ingestion to confirm its
// understanding, then bulk-ingests the rest) but not the file's shape. Owned here: it
// mirrors `add-item` in data form — an entity and its attribute map — so an agent that
// has read `add-item --help` already knows how to write it, and the two surfaces cannot
// drift into two different models of what an item is.
//
// The case is written as the doc's own scenario rather than as a bare loop: the graph
// already holds the one item that was added by hand, because "exactly N" has to mean the
// ingestion added N and disturbed nothing, not merely that the graph ended up with a
// count somebody expected.
describe("DE-19 — bulk ingestion of N items", () => {
  const N = 12;
  const bulk = Array.from({ length: N }, (_, i) => ({
    entity: `Game ${String(i + 1).padStart(2, "0")}`,
    attributes: { status: i % 2 === 0 ? "completed" : "backlog", rating: String((i % 5) + 1) },
  }));

  function ingest() {
    const g = spawnGraph({ namespace: "game-recs" });
    // The confirming ingestion first, exactly as RU-6 describes it.
    expect(
      runCli(
        ["add-item", "--graph", g.namespace, "--entity", "Grand Theft Auto V", "--attr", "status=completed"],
        { cwd: g.cwd },
      ).exitCode,
    ).toBe(EXIT.OK);

    const source = path.join(g.cwd, "games.yml");
    writeItemsYml(source, bulk);
    const r = runCli(["import", "--graph", g.namespace, "--from", source], { cwd: g.cwd });
    return { g, r };
  }

  test("reports how many it took, and the count is the truth", () => {
    const { r } = ingest();

    expect(r.exitCode).toBe(EXIT.OK);
    const payload = JSON.parse(r.stdout);
    // An Operator ingesting in bulk cannot read the result item by item — the count is
    // the whole of what they get back, so it has to be the count of what actually landed
    // rather than the count of what was offered.
    expect(payload.ingested).toBe(N);
  });

  test("the graph holds exactly N more items, and the hand-added one is untouched", () => {
    const { g } = ingest();

    const items = readItems(g.db);

    expect(items.length).toBe(N + 1);
    expect(items.find((i) => i.entity === "Grand Theft Auto V")?.attributes).toEqual({
      status: "completed",
    });
  });

  test("query returns all N with their attribute/value pairs intact", () => {
    const { g } = ingest();

    const r = runCli(["query", "--graph", g.namespace], { cwd: g.cwd });

    expect(r.exitCode).toBe(EXIT.OK);
    const items = JSON.parse(r.stdout).items as {
      entity: string;
      attributes: Record<string, string>;
    }[];
    // Every ingested item, compared whole. Checking presence by name alone would pass an
    // engine that read the entity column and dropped the attributes, which is the likelier
    // bulk-path defect than losing a row.
    for (const expected of bulk) {
      const got = items.find((i) => i.entity === expected.entity);
      expect(got?.attributes).toEqual(expected.attributes);
    }
  });

  test("the sidecar enumerates all N", () => {
    const { g } = ingest();

    const sidecar = readSidecar(g.sidecar);

    const headings = sidecar.split("\n").filter((l) => l.startsWith("### "));
    expect(headings.length).toBe(N + 1);
    for (const expected of bulk) {
      expect(headings).toContain(`### ${expected.entity}`);
    }
    // The inspectable face is rewritten from the artifact after every change, so a bulk
    // path that wrote it once per item would still land here — what this pins is that it
    // is written, and complete, at the end.
    expect(sidecar).toContain(`${N + 1} entities.`);
  });

  test("an empty source is not an error, and reports honestly", () => {
    // The boundary an agent hits when it bulk-ingests whatever it parsed and the parse
    // found nothing. Refusing would push it toward guessing; reporting zero tells it
    // plainly that its source, not the graph, is the thing to look at.
    const g = spawnGraph({ namespace: "empty-import" });
    const source = path.join(g.cwd, "none.yml");
    writeItemsYml(source, []);

    const r = runCli(["import", "--graph", g.namespace, "--from", source], { cwd: g.cwd });

    expect(r.exitCode).toBe(EXIT.OK);
    expect(JSON.parse(r.stdout).ingested).toBe(0);
    expect(readItems(g.db).length).toBe(0);
  });
});
