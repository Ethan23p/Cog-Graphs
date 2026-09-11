import { describe, expect, test } from "bun:test";
import { runCli, spawnGraph } from "./helpers";
import { EXIT } from "./contract";

describe("DE-8 — query against the empty instance", () => {
  // This is the fourth step of the Walking Skeleton and the first thing an Operator does
  // to a graph they just made: "attempting to query the new instance (it's empty)". An
  // error here would teach exactly the wrong lesson — that an empty graph is a broken
  // one — right at the moment the Operator is deciding whether the tool works. Empty is
  // an answer, and the answer has the same shape as any other.
  test("succeeds with a well-formed empty result rather than erroring", () => {
    const { cwd, namespace } = spawnGraph({ namespace: "de8" });

    const r = runCli(["query", "--graph", namespace], { cwd });

    expect(r.exitCode).toBe(EXIT.OK);
    const payload = JSON.parse(r.stdout);
    expect(payload.graph).toBe(namespace);
    // Well-formed means the caller can treat this like any other result: the same
    // fields, the same types, nothing to special-case. An engine that answers `{}` or
    // `{items: null}` when empty forces every caller to write the branch twice.
    expect(Array.isArray(payload.items)).toBe(true);
    expect(payload.items).toEqual([]);
    expect(payload.count).toBe(0);
  });
});

describe("DE-10 — query returns the items with their pairs intact", () => {
  // The twin of DE-9, and kept separate on purpose: DE-9 reads the database, this reads
  // through the CLI, and they fail for different reasons. DE-9 catches an engine that
  // stores the wrong thing; this catches an engine that stores the right thing and then
  // reports it wrong — drops an attribute on the way out, flattens a value, or answers
  // with a shape the Operator cannot use.
  test("every entity and every pair survives the trip back out", () => {
    const { cwd, namespace } = spawnGraph({ namespace: "de10" });
    const items = [
      { entity: "Grand Theft Auto V", attributes: { status: "completed", "taste-alignment": "very high" } },
      { entity: "Outer Wilds", attributes: { status: "playing" } },
      { entity: "Tunic", attributes: {} },
    ];
    for (const item of items) {
      const attrArgs = Object.entries(item.attributes).flatMap(([k, v]) => ["--attr", `${k}=${v}`]);
      const added = runCli(["add-item", "--graph", namespace, "--entity", item.entity, ...attrArgs], {
        cwd,
      });
      expect(added.exitCode).toBe(EXIT.OK);
    }

    const r = runCli(["query", "--graph", namespace], { cwd });

    expect(r.exitCode).toBe(EXIT.OK);
    const payload = JSON.parse(r.stdout);
    expect(payload.count).toBe(items.length);
    expect(payload.items).toEqual(items);
  });
});

describe("DE-10.1 (minted) — selection filtering over --attr and --exclude", () => {
  // MINTED at DE-10. The doc ratifies the grammar line and defines the semantics under
  // Library > search strategies > selection, and DE-5/DE-4 force both flags into --help
  // and into every error's recognized-options list — but nothing graded what they do. It
  // is the doc's only search strategy for v0.3.1, and the thing that makes iterative
  // traversal possible: each attribute is a handhold, so an engine that quietly returns
  // everything regardless of the filters does not fail loudly, it just makes every
  // narrowing query look like a graph with no structure in it.
  const library = [
    { entity: "Outer Wilds", attrs: { status: "completed", genre: "puzzle" } },
    { entity: "Tunic", attrs: { status: "completed", genre: "action" } },
    { entity: "Hollow Knight", attrs: { status: "playing", genre: "action" } },
  ];

  function stocked() {
    const graph = spawnGraph({ namespace: "de101" });
    for (const item of library) {
      const attrArgs = Object.entries(item.attrs).flatMap(([k, v]) => ["--attr", `${k}=${v}`]);
      runCli(["add-item", "--graph", graph.namespace, "--entity", item.entity, ...attrArgs], {
        cwd: graph.cwd,
      });
    }
    return graph;
  }

  function names(cwd: string, args: string[]): string[] {
    const r = runCli(["query", "--graph", "de101", ...args], { cwd });
    expect(r.exitCode).toBe(EXIT.OK);
    const payload = JSON.parse(r.stdout);
    // count and items must agree, or a caller that trusts count reads past the end.
    expect(payload.count).toBe(payload.items.length);
    return payload.items.map((i: { entity: string }) => i.entity);
  }

  test("--attr keeps only items carrying that pair", () => {
    const { cwd } = stocked();

    expect(names(cwd, ["--attr", "status=completed"]).sort()).toEqual(["Outer Wilds", "Tunic"]);
  });

  test("--exclude drops items carrying that pair", () => {
    const { cwd } = stocked();

    expect(names(cwd, ["--exclude", "status=completed"])).toEqual(["Hollow Knight"]);
  });

  test("repeated flags compose, and the two kinds compose with each other", () => {
    const { cwd } = stocked();

    // Every --attr must match: action AND completed is Tunic alone, even though each
    // half on its own matches two items. An engine that ORs repeated flags passes a
    // single-filter test and fails here, which is why the composing case is separate.
    expect(names(cwd, ["--attr", "genre=action", "--attr", "status=completed"])).toEqual(["Tunic"]);
    expect(names(cwd, ["--attr", "genre=action", "--exclude", "status=completed"])).toEqual([
      "Hollow Knight",
    ]);
  });

  test("a filter matching nothing is an empty result, not an error", () => {
    const { cwd } = stocked();

    expect(names(cwd, ["--attr", "status=abandoned"])).toEqual([]);
  });

  test("filtering never invents or mutates the pairs it returns", () => {
    // A filtered result is still the whole item. The tempting shortcut is to return only
    // the attributes that were matched on, which would silently make query lossy exactly
    // when an Operator is narrowing in on something.
    const { cwd } = stocked();

    const r = runCli(["query", "--graph", "de101", "--attr", "status=playing"], { cwd });

    expect(JSON.parse(r.stdout).items).toEqual([
      { entity: "Hollow Knight", attributes: { status: "playing", genre: "action" } },
    ]);
  });
});
