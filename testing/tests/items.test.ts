import { describe, expect, test } from "bun:test";
import { readItems, runCli, spawnGraph } from "./helpers";
import { EXIT } from "./contract";
import { readSidecar } from "./helpers";

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

describe("DE-12 — the sidecar enumerates the items after the add", () => {
  // The sidecar is derived, which means it is only true if something re-derives it. An
  // engine that writes it once at initialize and forgets is the likely failure, and it
  // is a quiet one: the file is still there, still looks right, and is simply stale. For
  // a graph this small the doc asks for each item enumerated, so the enumeration is what
  // the case reads.
  test("names each entity and its pairs", () => {
    const { cwd, namespace, sidecar } = spawnGraph({ namespace: "de12" });
    runCli(
      [
        "add-item",
        "--graph",
        namespace,
        "--entity",
        "Outer Wilds",
        "--attr",
        "status=playing",
        "--attr",
        "taste-alignment=very high",
      ],
      { cwd },
    );
    runCli(["add-item", "--graph", namespace, "--entity", "Tunic", "--attr", "status=backlog"], {
      cwd,
    });

    const text = readSidecar(sidecar);

    expect(text).toContain("Outer Wilds");
    expect(text).toContain("Tunic");
    // Enumerating the names alone would let an observer see what is tracked but not
    // what is known about it, which is most of the value of looking.
    expect(text).toContain("playing");
    expect(text).toContain("taste-alignment");
    expect(text).toContain("very high");
    expect(text).toContain("backlog");
  });
});

describe("DE-11 — add-item on an existing entity", () => {
  // The two dangerous readings of a repeat add are "quietly overwrite" and "quietly
  // merge", and both lose data the Operator did not agree to lose. Refusing keeps
  // add-item and modify-item from doing each other's job, which is what lets an Operator
  // trust either one without checking first.
  test("errors, leaves the existing item untouched, and points at modify item", () => {
    const { cwd, namespace, db } = spawnGraph({ namespace: "de11" });
    runCli(
      ["add-item", "--graph", namespace, "--entity", "Tunic", "--attr", "status=backlog"],
      { cwd },
    );

    const r = runCli(
      ["add-item", "--graph", namespace, "--entity", "Tunic", "--attr", "status=completed"],
      { cwd },
    );

    expect(r.exitCode).toBe(EXIT.ALREADY_EXISTS);
    const error = JSON.parse(r.stderr);
    expect(error.code).toBe("entity_exists");
    expect(error.message).toContain("Tunic");
    // "Points to modify item" is the actionable half — an Operator who is told only
    // that the add failed has to work out the alternative themselves.
    expect(error.next_step).toContain("modify-item");
    // A refusal that half-applied would be worse than either quiet reading.
    expect(readItems(db)).toEqual([{ entity: "Tunic", attributes: { status: "backlog" } }]);
  });
});
