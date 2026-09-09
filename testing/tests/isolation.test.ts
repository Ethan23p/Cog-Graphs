import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import * as path from "node:path";
import { fileSha256, readSidecar, runCli, snapshotTree, spawnGraph, writeProfileYml } from "./helpers";
import { EXIT } from "./contract";

// IN-6 — No stray artifacts: after a full scenario the working directory holds exactly
// the `.sqlite`, the `.md`, and the fixtures brought in — no journals, lockfiles, caches,
// or temp directories left behind.
//
// The doc's claim is that a Cog Graph is *a file* — portable, inspectable, and something
// a User can move to an external drive without being told which invisible companions have
// to come along. WAL is the specific temptation here and the reason CLAUDE.md forbids it:
// it would leave `-wal` and `-shm` beside the database, and a graph copied without them
// is a graph that silently lost its most recent writes. One short-lived process per
// command needs no concurrency, so there is nothing to trade away.
describe("IN-6 — no stray artifacts", () => {
  test("a full add / modify / remove cycle leaves exactly the two faces and the fixture", () => {
    const g = spawnGraph({ namespace: "in6" });

    for (const args of [
      ["add-item", "--graph", g.namespace, "--entity", "Sword", "--attr", "status=owned"],
      ["add-item", "--graph", g.namespace, "--entity", "Shield"],
      ["modify-item", "--graph", g.namespace, "--entity", "Sword", "--attr", "status=sold"],
      ["query", "--graph", g.namespace],
      ["remove-item", "--graph", g.namespace, "--entity", "Shield"],
      ["introduce", "--graph", g.namespace],
    ]) {
      expect(runCli(args, { cwd: g.cwd }).exitCode).toBe(EXIT.OK);
    }

    // The whole directory, sorted, compared as a set. Asserting the absence of `-wal` by
    // name would only catch the failure somebody predicted; this catches a lockfile, a
    // cache directory, a stray temp file, or anything else nobody has thought of yet.
    expect(readdirSync(g.cwd).sort()).toEqual([
      `${g.namespace}.md`,
      `${g.namespace}.profile.yml`,
      `${g.namespace}.sqlite`,
    ]);
  });

  test("nothing is left behind by a failed command either", () => {
    // The likelier place for a stray file: an error path that opened the database, or a
    // temp file written before validation refused. A directory that only stays clean when
    // everything goes right is not clean.
    const g = spawnGraph({ namespace: "in6-fail" });
    const before = readdirSync(g.cwd).sort();

    expect(runCli(["query", "--graph", "no-such-graph"], { cwd: g.cwd }).exitCode).toBe(EXIT.NOT_FOUND);
    expect(runCli(["add-item", "--graph", g.namespace, "--entity"], { cwd: g.cwd }).exitCode).toBe(EXIT.USAGE);
    expect(
      runCli(["modify-item", "--graph", g.namespace, "--entity", "Nope", "--attr", "a=b"], { cwd: g.cwd })
        .exitCode,
    ).toBe(EXIT.NOT_FOUND);

    expect(readdirSync(g.cwd).sort()).toEqual(before);
  });
});

// IN-7 — Graph isolation: a checkpoint of graph B is byte-identical before and after a
// full add / modify / remove cycle on graph A.
//
// Two graphs in one directory is the ordinary case, not the exotic one — a graph per
// use-case is the design. So the guarantee an Operator needs is that naming graph A is
// *sufficient*: no amount of work on it can reach B. Byte-identical is the right bar
// rather than "B still answers correctly", because a benign-looking rewrite of B — a
// touched mtime, a re-rendered sidecar, a vacuumed page — is the shape of a bug that
// stays invisible until the two graphs disagree about something that matters.
describe("IN-7 — graph isolation", () => {
  test("a full cycle on A leaves B byte-identical", () => {
    const a = spawnGraph({ namespace: "graph-a" });
    const b = spawnGraph({ namespace: "graph-b", cwd: a.cwd });
    expect(
      runCli(["add-item", "--graph", b.namespace, "--entity", "Bystander", "--attr", "status=quiet"], {
        cwd: b.cwd,
      }).exitCode,
    ).toBe(EXIT.OK);

    const before = { db: fileSha256(b.db), sidecar: fileSha256(b.sidecar) };
    const beforeText = readSidecar(b.sidecar);

    for (const args of [
      ["add-item", "--graph", a.namespace, "--entity", "Sword", "--attr", "status=owned"],
      ["modify-item", "--graph", a.namespace, "--entity", "Sword", "--attr", "status=sold"],
      ["query", "--graph", a.namespace],
      ["remove-item", "--graph", a.namespace, "--entity", "Sword"],
    ]) {
      expect(runCli(args, { cwd: a.cwd }).exitCode).toBe(EXIT.OK);
    }

    expect(fileSha256(b.db)).toBe(before.db);
    expect(fileSha256(b.sidecar)).toBe(before.sidecar);
    expect(readSidecar(b.sidecar)).toBe(beforeText);
  });

  test("B's mtime does not move either", () => {
    // Isolation is a claim about writes, not only about content, so it is asserted over
    // mtimes as well as hashes: B must not be *touched*, not merely left saying the same
    // thing. Probed by making the engine regenerate every sidecar in the directory and
    // write unconditionally — B's bytes never change, so the hashes above stay green and
    // only this fails. (Directory-wide regeneration alone is invisible here, and honestly
    // so: writeSidecar writes only when the rendering differs, which makes that engine
    // wasteful rather than wrong.)
    const a = spawnGraph({ namespace: "mtime-a" });
    const b = spawnGraph({ namespace: "mtime-b", cwd: a.cwd });

    const before = snapshotTree(a.cwd).filter((line) => line.startsWith("mtime-b"));
    runCli(["add-item", "--graph", a.namespace, "--entity", "Sword"], { cwd: a.cwd });
    runCli(["query", "--graph", a.namespace], { cwd: a.cwd });

    expect(snapshotTree(a.cwd).filter((line) => line.startsWith("mtime-b"))).toEqual(before);
  });

  test("initializing a second graph does not disturb the first", () => {
    // The other direction, and the one an Operator meets first: the doc's flow has a User
    // asking for a second store months after the first, in the same directory.
    const a = spawnGraph({ namespace: "first" });
    expect(
      runCli(["add-item", "--graph", a.namespace, "--entity", "Sword", "--attr", "status=owned"], {
        cwd: a.cwd,
      }).exitCode,
    ).toBe(EXIT.OK);
    const before = { db: fileSha256(a.db), sidecar: fileSha256(a.sidecar) };

    const profilePath = path.join(a.cwd, "second.yml");
    writeProfileYml(
      profilePath,
      { namespace: "second", "use-pattern": "manual", description: "A later store." },
      "Every entity carries a status.",
    );
    expect(runCli(["initialize", "--profile", profilePath], { cwd: a.cwd }).exitCode).toBe(EXIT.OK);

    expect(fileSha256(a.db)).toBe(before.db);
    expect(fileSha256(a.sidecar)).toBe(before.sidecar);
  });
});
