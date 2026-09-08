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
