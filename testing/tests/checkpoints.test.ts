import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { capture, regressions, type Checkpoint } from "../harness/checkpoint";
import { runCli, spawnGraph } from "./helpers";
import { EXIT } from "./contract";

// IN-5 — No item present at an earlier checkpoint is absent or corrupted at a later one,
// except where the scenario deliberately changed it.
//
// A checkpoint is a harness snapshot taken after every gate, so "earlier" and "later" are
// mechanically defined rather than left to the reader. Two things follow, and both are
// decisions rather than mechanics:
//
// DELIBERATE IS DECLARED IN ADVANCE. `regressions()` is asked, per step, which entities
// that step was permitted to change. Reading the diff and then deciding which changes look
// intentional is the version of this case that can never fail — it would rationalize the
// corruption it exists to catch. So permission is a list, written by the scenario before
// the step runs, and scoped to that step: a scenario allowed to modify `Portal` at step 4
// has said nothing about step 7.
//
// THE CHECKPOINT IS READ FROM THE ARTIFACT, NOT THROUGH `query`. A checkpoint taken with
// the CLI would go blind to exactly the class of defect that breaks the CLI — the case
// asserting the data survived would be reading the data through the thing under suspicion.
//
// This case runs free, against a scripted lifecycle rather than an agent, and the paid
// Walking Skeleton eval calls the same two functions between its turns. One implementation
// on purpose: an invariant checked two different ways is two invariants.
describe("IN-5 — nothing regresses between checkpoints", () => {
  function lifecycle() {
    const g = spawnGraph({ namespace: "game-recs", convention: "Every entity carries a status." });
    const checkpoints: Checkpoint[] = [capture(g.cwd, "initialized")];

    // The Walking Skeleton's data steps, in its order: query an empty instance, add a
    // couple of items, query them back, then modify. The empty query is a checkpoint too —
    // a read that quietly wrote would show up here and nowhere else.
    expect(runCli(["query", "--graph", g.namespace], { cwd: g.cwd }).exitCode).toBe(EXIT.OK);
    checkpoints.push(capture(g.cwd, "queried empty"));

    for (const [entity, status] of [
      ["Portal", "completed"],
      ["Hades", "backlog"],
    ]) {
      expect(
        runCli(["add-item", "--graph", g.namespace, "--entity", entity!, "--attr", `status=${status}`], {
          cwd: g.cwd,
        }).exitCode,
      ).toBe(EXIT.OK);
    }
    checkpoints.push(capture(g.cwd, "two items added"));

    expect(runCli(["query", "--graph", g.namespace], { cwd: g.cwd }).exitCode).toBe(EXIT.OK);
    checkpoints.push(capture(g.cwd, "queried both"));

    expect(
      runCli(["modify-item", "--graph", g.namespace, "--entity", "Hades", "--attr", "status=completed"], {
        cwd: g.cwd,
      }).exitCode,
    ).toBe(EXIT.OK);
    checkpoints.push(capture(g.cwd, "Hades modified"));

    return { g, checkpoints };
  }

  test("a full lifecycle regresses nothing that was not declared", () => {
    const { checkpoints } = lifecycle();

    // Only the modify step gets permission, and only for the entity it names. Portal is
    // never on the list, so an engine that rewrote it while updating Hades is caught even
    // though the scenario did contain a deliberate change.
    const found = regressions(checkpoints, (_from, to) =>
      to.label === "Hades modified" ? ["Hades"] : [],
    );

    expect(found.map((v) => v.detail)).toEqual([]);
  });

  test("a read never counts as a change", () => {
    const { checkpoints } = lifecycle();

    // The two query steps are given no permission at all, so anything a read touched
    // lands as a violation. This is the assertion that would catch a regeneration side
    // effect on the read path — the shape of the IN-4.1 defect, one layer down.
    const reads = checkpoints.filter((c) => c.label.startsWith("queried") || c.label === "two items added");
    expect(regressions(reads)).toEqual([]);
  });

  test("an undeclared modification is a violation, named by entity and attribute", () => {
    const { g, checkpoints } = lifecycle();

    const found = regressions(checkpoints);

    // The positive control, and the reason this case can fail at all: with no permission
    // granted, the modify step must be reported. A checker that returns an empty array
    // whatever it is given passes the two cases above and fails here.
    expect(found.length).toBe(1);
    expect(found[0]?.kind).toBe("corrupted");
    expect(found[0]?.entity).toBe("Hades");
    expect(found[0]?.attribute).toBe("status");
    expect(found[0]?.detail).toContain("backlog");
    expect(found[0]?.detail).toContain("completed");
    void g;
  });

  test("an item that vanishes is caught even when nothing else changed", () => {
    const { g, checkpoints } = lifecycle();

    // Straight at the artifact, behind the CLI's back — which is the failure IN-5 is
    // about. Nothing in the engine does this; the point is that if anything ever did,
    // this is the case that notices, and it must not depend on the engine reporting it.
    const db = new Database(g.db);
    db.exec("DELETE FROM eav WHERE entity_id IN (SELECT id FROM entity WHERE name = 'Portal')");
    db.exec("DELETE FROM entity WHERE name = 'Portal'");
    db.close();
    checkpoints.push(capture(g.cwd, "after corruption"));

    const found = regressions(checkpoints, (_from, to) =>
      to.label === "Hades modified" ? ["Hades"] : [],
    );

    expect(found.length).toBe(1);
    expect(found[0]?.kind).toBe("vanished");
    expect(found[0]?.entity).toBe("Portal");
    expect(found[0]?.to).toBe("after corruption");
  });

  test("a graph that disappears is its own kind of violation", () => {
    const { g, checkpoints } = lifecycle();
    const gone: Checkpoint = { label: "graph removed", graphs: {} };

    const found = regressions([...checkpoints, gone], (_from, to) =>
      to.label === "Hades modified" ? ["Hades"] : [],
    );

    // Reported once, against the graph, rather than once per item in it. A scenario that
    // lost a whole graph does not need two hundred lines telling it so, and the entity
    // rows are not evidence of anything independent.
    expect(found.length).toBe(1);
    expect(found[0]?.kind).toBe("graph_vanished");
    expect(found[0]?.graph).toBe(g.namespace);
  });

  test("permission is scoped to the step that asked for it", () => {
    const { g, checkpoints } = lifecycle();
    const db = new Database(g.db);
    db.exec("UPDATE eav SET value = 'abandoned' WHERE attribute = 'status'");
    db.close();
    checkpoints.push(capture(g.cwd, "later corruption"));

    // Permission for "Hades modified" must not carry forward. If it did, the corruption
    // at the later step would be excused by a licence granted two steps earlier, which is
    // how a blanket allowance quietly turns this invariant off.
    const found = regressions(checkpoints, (_from, to) =>
      to.label === "Hades modified" ? ["Hades"] : [],
    );

    expect(found.some((v) => v.entity === "Hades" && v.to === "later corruption")).toBe(true);
    expect(found.some((v) => v.entity === "Portal" && v.to === "later corruption")).toBe(true);
  });
});
