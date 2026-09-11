import { describe, expect, test } from "bun:test";
import { readItems, readSidecar, runCli, spawnGraph } from "./helpers";
import { EXIT } from "./contract";

// DE-21 — The convention is amendable: after an amend, a read-back returns the amended
// convention and the sidecar reflects it.
//
// The convention is the graph's own expectations about its shape, seeded at `initialize`
// from the profile. Until now it was write-once: the only way to change what a graph
// said about itself was to rebuild it, which is exactly backwards for the thing the doc
// describes as being amended as the data changes.
//
// AMEND MEANS APPEND, and the schema already said so — `convention` is an ordered table
// with an autoincrementing `seq`, not a single row. That is the right shape and this
// slice does not change it: an Operator who learns in week three that ratings run 1-10
// rather than 1-5 is recording something that became true, and the earlier expectation is
// how the data already in the graph is to be read. Replacing the text would silently
// re-date every item recorded under the old rule. So the convention grows, in order, and
// `--append` is the whole of the amendment grammar (which is what `--help` has always
// advertised).
//
// The read-back is graded through two surfaces on purpose. `convention` is the direct
// one; `introduce --graph` also reports the convention, and it is the surface a fresh
// agent actually meets. Two readers of one table is exactly where an amendment gets lost.
describe("DE-21 — the convention is amendable", () => {
  const SEED = "Every entity carries a status.";
  const AMENDMENT = "Ratings run 1-10, not 1-5.";

  function graph() {
    return spawnGraph({ namespace: "game-recs", convention: SEED });
  }

  test("read-back returns the convention the graph was seeded with", () => {
    const g = graph();

    const r = runCli(["convention", "--graph", g.namespace], { cwd: g.cwd });

    expect(r.exitCode).toBe(EXIT.OK);
    // An ordered list, not a blob: the read path has to hand back the same structure the
    // amend path grows, or an agent cannot tell one expectation from two.
    expect(JSON.parse(r.stdout).convention).toEqual([SEED]);
  });

  test("an amendment is returned by the read-back, after what it amends", () => {
    const g = graph();

    const amend = runCli(["convention", "--graph", g.namespace, "--append", AMENDMENT], {
      cwd: g.cwd,
    });

    expect(amend.exitCode).toBe(EXIT.OK);
    const read = JSON.parse(runCli(["convention", "--graph", g.namespace], { cwd: g.cwd }).stdout);
    // Order is the claim, not membership. The earlier expectation is how the items
    // already in the graph are to be read; an amendment that sorted ahead of it, or
    // replaced it, would silently re-date every one of them.
    expect(read.convention).toEqual([SEED, AMENDMENT]);
  });

  test("the amend call itself answers with the whole convention, not just the addition", () => {
    const g = graph();

    const amend = runCli(["convention", "--graph", g.namespace, "--append", AMENDMENT], {
      cwd: g.cwd,
    });

    // So an agent that amends does not have to make a second call to learn what the
    // graph now says about itself — the one thing it needs before its next write.
    expect(JSON.parse(amend.stdout).convention).toEqual([SEED, AMENDMENT]);
  });

  test("the sidecar reflects the amendment", () => {
    const g = graph();

    runCli(["convention", "--graph", g.namespace, "--append", AMENDMENT], { cwd: g.cwd });

    const sidecar = readSidecar(g.sidecar);
    expect(sidecar).toContain(`- ${SEED}`);
    expect(sidecar).toContain(`- ${AMENDMENT}`);
    // The derived face is rewritten from the artifact after every change. A command that
    // wrote the table and forgot the sidecar would leave the inspectable face saying
    // something the graph no longer expects — and nothing else in the suite would notice,
    // because every other command that touches the convention is `initialize`.
    expect(sidecar.indexOf(SEED)).toBeLessThan(sidecar.indexOf(AMENDMENT));
  });

  test("introduce reports the amended convention too", () => {
    const g = graph();

    runCli(["convention", "--graph", g.namespace, "--append", AMENDMENT], { cwd: g.cwd });

    const intro = JSON.parse(
      runCli(["introduce", "--graph", g.namespace], { cwd: g.cwd }).stdout,
    );
    // The surface a fresh agent actually meets. Two readers of one table is where an
    // amendment gets lost, so both are graded rather than the direct one alone.
    expect(intro.convention).toEqual([SEED, AMENDMENT]);
  });

  test("amending changes the convention and nothing else", () => {
    const g = graph();
    expect(
      runCli(["add-item", "--graph", g.namespace, "--entity", "Portal", "--attr", "status=completed"], {
        cwd: g.cwd,
      }).exitCode,
    ).toBe(EXIT.OK);

    // Asserted, not assumed: without this line the case passed against an engine where
    // `convention` did not exist, because an amendment that never happened disturbs
    // nothing either. A "changed nothing else" case has to establish that something did.
    expect(
      runCli(["convention", "--graph", g.namespace, "--append", AMENDMENT], { cwd: g.cwd })
        .exitCode,
    ).toBe(EXIT.OK);

    // The convention describes the data; it does not touch it. An amend path that
    // rebuilt the graph, or that took the sidecar rewrite as licence to re-derive the
    // items, would pass every assertion above and lose the graph's contents.
    const items = readItems(g.db);
    expect(items.length).toBe(1);
    expect(items[0]?.attributes).toEqual({ status: "completed" });
    const intro = JSON.parse(runCli(["introduce", "--graph", g.namespace], { cwd: g.cwd }).stdout);
    expect(intro.profile.description).toBeTruthy();
  });

  test("no command reports itself unbuilt any more", () => {
    const g = graph();

    const help = JSON.parse(runCli(["convention", "--help"], { cwd: g.cwd }).stdout);

    // `convention` was the last entry in the engine's unbuilt set. This asserts the end
    // state directly rather than trusting the DE-19.3 sweep to notice: that sweep is
    // derived, so when the set empties it stops running and grades nothing at all. A
    // suite that goes quiet is not the same as a suite that passes.
    expect(help.status).toBeUndefined();
    expect(help.usage).toContain("--append");
  });
});
