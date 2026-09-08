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
