import { describe, expect, test } from "bun:test";
import { readItems, runCli, spawnGraph } from "./helpers";
import { EXIT } from "./contract";
import { readSidecar } from "./helpers";
import { artifactIntegrity } from "./helpers";

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

describe("DE-13 — modify-item changes what it names and nothing else", () => {
  // "Attributes not named in the command are unchanged" is the assertion with teeth. The
  // obvious wrong implementation is replace-the-item — take the pairs given and write
  // them as the whole record — which is indistinguishable from correct on a
  // single-attribute item and silently destroys everything else on a real one. Since the
  // Operator names only what changed, that failure erases exactly the accumulated
  // knowledge the graph exists to hold.
  test("named attributes take the new value, unnamed ones survive, new ones are added", () => {
    const { cwd, namespace, db } = spawnGraph({ namespace: "de13" });
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
        "--attr",
        "source=a friend",
      ],
      { cwd },
    );

    const r = runCli(
      [
        "modify-item",
        "--graph",
        namespace,
        "--entity",
        "Outer Wilds",
        "--attr",
        "status=completed",
        "--attr",
        "finished-on=2026-09-08",
      ],
      { cwd },
    );

    expect(r.exitCode).toBe(EXIT.OK);
    const expected = {
      entity: "Outer Wilds",
      attributes: {
        status: "completed",
        "taste-alignment": "very high",
        source: "a friend",
        "finished-on": "2026-09-08",
      },
    };
    // The database and the CLI are both asserted here for the same reason DE-9 and DE-10
    // are separate cases: storing it right and reporting it right are different claims.
    expect(readItems(db)).toEqual([expected]);
    const queried = JSON.parse(runCli(["query", "--graph", namespace], { cwd }).stdout);
    expect(queried.items).toEqual([expected]);
  });
});

describe("DE-14 — the sidecar reflects the modification", () => {
  // The distinct failure from DE-12: an engine can re-derive on add and not on modify,
  // and then the sidecar is not merely stale but actively wrong — it asserts an old
  // value with the same confidence as a current one. The superseded value going away is
  // the half that catches an append-only renderer.
  test("shows the new value and no longer shows the old one", () => {
    const { cwd, namespace, sidecar } = spawnGraph({ namespace: "de14" });
    runCli(["add-item", "--graph", namespace, "--entity", "Tunic", "--attr", "status=backlog"], {
      cwd,
    });

    runCli(["modify-item", "--graph", namespace, "--entity", "Tunic", "--attr", "status=completed"], {
      cwd,
    });

    const text = readSidecar(sidecar);
    expect(text).toContain("completed");
    expect(text).not.toContain("backlog");
  });
});

describe("DE-15 — modify-item on a non-existent entity", () => {
  // The mirror of DE-11, and the reason both exist: an Operator working from memory in a
  // cold thread will reach for the wrong one of these two commands, and the graph should
  // hand them the right one rather than failing opaquely or — far worse — quietly
  // creating an entity nobody meant to create. The silent create is the dangerous
  // version: it looks like success and leaves a near-duplicate of a real item behind.
  test("errors, creates nothing, and points at add item", () => {
    const { cwd, namespace, db } = spawnGraph({ namespace: "de15" });

    const r = runCli(
      ["modify-item", "--graph", namespace, "--entity", "Hollow Knight", "--attr", "status=playing"],
      { cwd },
    );

    expect(r.exitCode).toBe(EXIT.NOT_FOUND);
    const error = JSON.parse(r.stderr);
    expect(error.code).toBe("entity_not_found");
    expect(error.message).toContain("Hollow Knight");
    expect(error.next_step).toContain("add-item");
    expect(readItems(db)).toEqual([]);
  });
});

describe("DE-16 — remove-item removes the targeted item", () => {
  // Two things are being asserted and only one of them is obvious. The item is gone —
  // and the *other* items are not. Removal is the operation where a slightly wrong
  // predicate does the most damage, and a graph with one entity in it cannot tell a
  // correct delete from a delete-everything, so the case keeps a bystander around.
  //
  // Attribute rows go with it. Orphaned rows would leave IN-1 to catch quietly later,
  // and "removed" that leaves the item's data behind is not removed.
  test("the item and its pairs go; everything else stays", () => {
    const { cwd, namespace, db } = spawnGraph({ namespace: "de16" });
    runCli(
      ["add-item", "--graph", namespace, "--entity", "Tunic", "--attr", "status=abandoned"],
      { cwd },
    );
    runCli(
      ["add-item", "--graph", namespace, "--entity", "Outer Wilds", "--attr", "status=playing"],
      { cwd },
    );

    const r = runCli(["remove-item", "--graph", namespace, "--entity", "Tunic"], { cwd });

    expect(r.exitCode).toBe(EXIT.OK);
    const survivor = { entity: "Outer Wilds", attributes: { status: "playing" } };
    expect(readItems(db)).toEqual([survivor]);
    const queried = JSON.parse(runCli(["query", "--graph", namespace], { cwd }).stdout);
    expect(queried.items).toEqual([survivor]);
    expect(queried.count).toBe(1);
    // No attribute row may outlive its entity.
    expect(artifactIntegrity(db).orphanRows).toBe(0);
  });
});

describe("DE-18 — the sidecar no longer enumerates the removed item", () => {
  // The third of the derived-file cases and the one with the sharpest consequence. A
  // stale add is a missing line; a stale modify is a wrong value; a stale *removal*
  // leaves an item on display that the graph no longer holds — an observer reading the
  // inspectable face would swear the graph contains something it does not.
  test("drops the removed item and keeps the rest", () => {
    const { cwd, namespace, sidecar } = spawnGraph({ namespace: "de18" });
    runCli(["add-item", "--graph", namespace, "--entity", "Tunic", "--attr", "status=abandoned"], {
      cwd,
    });
    runCli(
      ["add-item", "--graph", namespace, "--entity", "Outer Wilds", "--attr", "status=playing"],
      { cwd },
    );

    runCli(["remove-item", "--graph", namespace, "--entity", "Tunic"], { cwd });

    const text = readSidecar(sidecar);
    expect(text).not.toContain("Tunic");
    expect(text).not.toContain("abandoned");
    expect(text).toContain("Outer Wilds");
  });
});
