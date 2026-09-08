import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { existsSync } from "node:fs";
import { artifactIntegrity, makeSandbox, runCli, writeProfileYml } from "./helpers";
import { EXIT, graphFile } from "./contract";

/** A graph in a fresh sandbox, ready for the invariants to be read off. */
function spawnGraph(namespace = "invariants") {
  const cwd = makeSandbox();
  const profilePath = path.join(cwd, "profile.yml");
  writeProfileYml(
    profilePath,
    {
      namespace,
      "use-pattern": "manual",
      description: "A graph that exists so the artifact invariants have something to read.",
    },
    "Every entity carries a status.",
  );
  const r = runCli(["initialize", "--profile", profilePath], { cwd });
  expect(r.exitCode).toBe(EXIT.OK);
  return { cwd, namespace, db: graphFile(cwd, namespace) };
}

describe("IN-1 — the functional face is a valid, readable .sqlite", () => {
  // The doc's claim for the functional face is that it is "widely compatible &
  // recognized, stable, neatly contains everything functional". That claim is only worth
  // anything if the file opens under a plain SQLite reader with no help from the engine,
  // which is how this case reads it.
  //
  // The referential half needs a check rather than a shrug: SQLite does not enforce
  // foreign keys unless asked, so an orphan EAV row is a thing the file can physically
  // hold. An attribute hanging off no entity is data nobody can ever retrieve.
  test("opens under a plain reader and holds no EAV row without an entity", () => {
    const { db } = spawnGraph();

    expect(existsSync(db)).toBe(true);
    const { integrity, orphanRows } = artifactIntegrity(db);
    expect(integrity).toBe("ok");
    expect(orphanRows).toBe(0);
  });
});
