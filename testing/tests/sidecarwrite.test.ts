import { describe, expect, test } from "bun:test";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { readItems, runCli, spawnGraph } from "./helpers";
import { ERROR_FIELDS, EXIT } from "./contract";

// IN-4.1 (minted) — regenerating the derived face must never break a command.
//
// Found by /code-review after IN-4 landed. IN-4 moved sidecar regeneration into
// resolveGraph so every command leaves the face current, including the readers. The write
// was unguarded, so a sidecar that cannot be written took the whole command down with it:
// `query` died with an uncaught EPERM, a Bun stack trace on stderr, empty stdout, and an
// exit code outside the documented alphabet. Reproduced before writing this.
//
// The User in this scenario is the careful one. The sidecar's own banner says "Derived
// file — do not edit", so they protected it — and were punished for it, on a read, for a
// file the engine itself calls disposable. A read-only mount or a synced folder gets there
// the same way without anyone deciding anything.
//
// The resolution follows from which face is authoritative. The artifact is; the sidecar is
// a view of it. So a view that cannot be refreshed is a warning, not a failure: the answer
// the command gives is still correct, and the Operator is told plainly that the .md beside
// the graph is now stale and why.
describe("IN-4.1 (minted) — an unwritable sidecar does not break the command", () => {
  function lockedSidecar(namespace: string) {
    const g = spawnGraph({ namespace });
    expect(
      runCli(["add-item", "--graph", g.namespace, "--entity", "Sword", "--attr", "status=owned"], {
        cwd: g.cwd,
      }).exitCode,
    ).toBe(EXIT.OK);
    // Made stale first, then locked: an identical rewrite is skipped, so a sidecar that is
    // merely read-only and already correct never reaches the write at all.
    writeFileSync(g.sidecar, "# Edited by the User\n");
    chmodSync(g.sidecar, 0o444);
    return g;
  }

  test("query still answers, correctly, at exit 0", () => {
    const g = lockedSidecar("in41-read");

    const r = runCli(["query", "--graph", g.namespace], { cwd: g.cwd });

    expect(r.exitCode).toBe(EXIT.OK);
    const payload = JSON.parse(r.stdout);
    expect(payload.items.map((i: { entity: string }) => i.entity)).toEqual(["Sword"]);
  });

  test("and says the derived face is stale, and why", () => {
    // Silently failing to regenerate would be its own defect: IN-4 promises the face comes
    // back, so an Operator who has been told that is entitled to know when it did not.
    const g = lockedSidecar("in41-warn");

    const r = runCli(["query", "--graph", g.namespace], { cwd: g.cwd });

    const warning = (r.stdout ? JSON.parse(r.stdout).warnings : []).find(
      (w: { code: string }) => w.code === "sidecar_unwritable",
    );
    expect(warning).toBeDefined();
    for (const field of ERROR_FIELDS) {
      expect(warning[field]?.trim().length ?? 0).toBeGreaterThan(0);
    }
    // Naming the file is the whole of the recovery: the Operator has to know which one.
    expect(warning.message).toContain(`${g.namespace}.md`);
  });

  test("a write command still commits to the artifact", () => {
    // The important half. The artifact write has already succeeded by the time the sidecar
    // is rendered, so failing the command here would report a loss that did not happen and
    // invite the Operator to redo work that is already done.
    const g = lockedSidecar("in41-write");

    const r = runCli(["add-item", "--graph", g.namespace, "--entity", "Shield"], { cwd: g.cwd });

    expect(r.exitCode).toBe(EXIT.OK);
    expect(readItems(g.db).map((i) => i.entity)).toEqual(["Shield", "Sword"]);
    expect(JSON.parse(r.stdout).warnings.some((w: { code: string }) => w.code === "sidecar_unwritable")).toBe(
      true,
    );
  });

  test("the User's protected file is left exactly as they wrote it", () => {
    const g = lockedSidecar("in41-untouched");
    const theirs = readFileSync(g.sidecar, "utf8");

    runCli(["query", "--graph", g.namespace], { cwd: g.cwd });

    expect(readFileSync(g.sidecar, "utf8")).toBe(theirs);
  });

  test("the answer stays parseable JSON on one stream", () => {
    // The invariant this actually broke. IN-9/10/11 sweep every command and every failure
    // class, and none of them covered "the filesystem said no in the middle of a read".
    const g = lockedSidecar("in41-shape");

    const r = runCli(["query", "--graph", g.namespace], { cwd: g.cwd });

    expect(r.stderr).toBe("");
    expect(() => JSON.parse(r.stdout)).not.toThrow();
    expect(Object.values(EXIT) as number[]).toContain(r.exitCode);
  });
});
