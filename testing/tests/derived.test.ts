import { describe, expect, test } from "bun:test";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { readItems, readSidecar, runCli, spawnGraph } from "./helpers";
import { EXIT } from "./contract";

// IN-4 — The sidecar is derived and never read: delete it *or* overwrite it with garbage,
// run any command, and the engine behaves identically and regenerates it.
//
// This is the invariant that makes the two-face design safe rather than merely
// convenient. The sidecar sits in the User's directory in a format that invites editing —
// it is Markdown, it opens in anything, and it is *about* their data. So it will be
// edited, and it will be deleted, and neither of those may change what the graph holds.
// The moment the engine reads it back, the artifact stops being self-contained and the
// User has two sources of truth that can disagree.
//
// "Behaves identically" is the strong half of the claim, and it is asserted by running
// the same command against a mutilated sidecar and an intact one and comparing the
// answers, rather than by checking the command merely succeeded.
describe("IN-4 — the sidecar is derived and never read", () => {
  const garbage = "# NOT THE GRAPH\n\n### Ghost\n\n- **status**: invented\n\nnonsense ((((\n";

  function populated(namespace: string) {
    const g = spawnGraph({ namespace });
    for (const [entity, status] of [
      ["Sword", "owned"],
      ["Shield", "lost"],
    ]) {
      expect(
        runCli(["add-item", "--graph", g.namespace, "--entity", entity, "--attr", `status=${status}`], {
          cwd: g.cwd,
        }).exitCode,
      ).toBe(EXIT.OK);
    }
    return g;
  }

  test("a deleted sidecar changes nothing, and comes back", () => {
    const g = populated("in4-deleted");
    const before = runCli(["query", "--graph", g.namespace], { cwd: g.cwd });
    const rendered = readSidecar(g.sidecar);

    rmSync(g.sidecar);
    expect(existsSync(g.sidecar)).toBe(false);
    const after = runCli(["query", "--graph", g.namespace], { cwd: g.cwd });

    // Identical answer, not merely a successful one.
    expect(after.exitCode).toBe(before.exitCode);
    expect(after.stdout).toBe(before.stdout);
    // Regenerated, and byte-identical to what it was: the sidecar is a pure function of
    // the artifact, so nothing about having been away can show up in it.
    expect(existsSync(g.sidecar)).toBe(true);
    expect(readSidecar(g.sidecar)).toBe(rendered);
  });

  test("a sidecar overwritten with garbage is ignored and replaced", () => {
    const g = populated("in4-garbage");
    const before = runCli(["query", "--graph", g.namespace], { cwd: g.cwd });
    const rendered = readSidecar(g.sidecar);

    writeFileSync(g.sidecar, garbage);
    const after = runCli(["query", "--graph", g.namespace], { cwd: g.cwd });

    expect(after.stdout).toBe(before.stdout);
    // The invented entity must not survive into the regenerated face, and must never
    // have reached the artifact.
    expect(readSidecar(g.sidecar)).toBe(rendered);
    expect(readItems(g.db).map((i) => i.entity)).toEqual(["Shield", "Sword"]);
  });

  test("a write command against a garbage sidecar lands correctly", () => {
    // The read path is the easy half. If anything ever did read the sidecar back, this is
    // where it would corrupt the artifact rather than merely report wrongly.
    const g = populated("in4-write");
    writeFileSync(g.sidecar, garbage);

    const r = runCli(["add-item", "--graph", g.namespace, "--entity", "Helm", "--attr", "status=owned"], {
      cwd: g.cwd,
    });

    expect(r.exitCode).toBe(EXIT.OK);
    expect(readItems(g.db).map((i) => i.entity)).toEqual(["Helm", "Shield", "Sword"]);
    expect(readSidecar(g.sidecar)).toContain("### Helm");
    expect(readSidecar(g.sidecar)).not.toContain("Ghost");
  });

  test("every command regenerates it, not just the writers", () => {
    // A sweep, because "the engine regenerates it" is only true if the one command an
    // Operator runs happens to be one that does. A reader that leaves the User staring at
    // a missing or stale face has satisfied the letter of the invariant and none of its
    // point.
    const g = populated("in4-sweep");
    const invocations: string[][] = [
      ["query", "--graph", g.namespace],
      ["introduce", "--graph", g.namespace],
      ["add-item", "--graph", g.namespace, "--entity", "Boots"],
      ["modify-item", "--graph", g.namespace, "--entity", "Boots", "--attr", "status=worn"],
      ["remove-item", "--graph", g.namespace, "--entity", "Boots"],
    ];

    for (const args of invocations) {
      rmSync(g.sidecar, { force: true });
      const r = runCli(args, { cwd: g.cwd });
      expect(r.exitCode).toBe(EXIT.OK);
      expect(existsSync(g.sidecar)).toBe(true);
      expect(readSidecar(g.sidecar)).toContain("### Sword");
    }
  });

  test("the sidecar says so, on its own face", () => {
    // An invariant the engine keeps and the artifact does not mention is one the User
    // breaks in good faith. The file has to tell whoever opens it that editing is futile.
    const g = populated("in4-selfdoc");

    const sidecar = readSidecar(g.sidecar).toLowerCase();

    expect(sidecar).toContain("derived");
    expect(sidecar).toContain("do not edit");
  });
});
