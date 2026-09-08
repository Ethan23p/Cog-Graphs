import { describe, expect, test } from "bun:test";
import { readItems, runCli, spawnGraph } from "./helpers";
import { EXIT } from "./contract";

describe("DE-9 — what add-item stores, read straight from the .sqlite", () => {
  // Read from the database rather than through `query`, deliberately. The doc's promise
  // for the functional face is that it stands alone — "neatly contains everything
  // functional" — so the thing worth asserting is what is actually in the file, not what
  // the engine is willing to say about it. An engine that stores a normalized,
  // lowercased, or otherwise helpfully-adjusted copy would pass a round-trip through its
  // own reader and still have quietly lost the Operator's data.
  test("exactly the entities and pairs supplied — no more, no fewer", () => {
    const { cwd, namespace, db } = spawnGraph({ namespace: "de9" });

    const first = runCli(
      [
        "add-item",
        "--graph",
        namespace,
        "--entity",
        "Grand Theft Auto V",
        "--attr",
        "status=completed",
        "--attr",
        "taste-alignment=very high",
      ],
      { cwd },
    );
    expect(first.exitCode).toBe(EXIT.OK);

    const second = runCli(
      ["add-item", "--graph", namespace, "--entity", "Outer Wilds", "--attr", "status=playing"],
      { cwd },
    );
    expect(second.exitCode).toBe(EXIT.OK);

    // toEqual over the whole collection is the "no more, no fewer" half: an inferred
    // attribute, a bookkeeping row, or a helpfully-added default would all fail here,
    // and each of them is the engine putting words in the Operator's mouth.
    expect(readItems(db)).toEqual([
      { entity: "Grand Theft Auto V", attributes: { status: "completed", "taste-alignment": "very high" } },
      { entity: "Outer Wilds", attributes: { status: "playing" } },
    ]);
  });

  test("an entity with no attributes is still an entity", () => {
    // The doc warns that a User "may legitimately provide 90% of the information about
    // an item but leave out which item they are referring to" — the mirror case is an
    // Operator who knows the item and nothing else yet. Refusing it, or storing it as
    // nothing, would make the graph unusable as the scratchpad the doc asks for.
    const { cwd, namespace, db } = spawnGraph({ namespace: "de9-bare" });

    const r = runCli(["add-item", "--graph", namespace, "--entity", "Tunic"], { cwd });

    expect(r.exitCode).toBe(EXIT.OK);
    expect(readItems(db)).toEqual([{ entity: "Tunic", attributes: {} }]);
  });
});
