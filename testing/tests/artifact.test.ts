import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { existsSync } from "node:fs";
import { artifactIntegrity, makeSandbox, runCli, writeProfileYml } from "./helpers";
import { EXIT, graphFile } from "./contract";
import { readFileSync } from "node:fs";
import { norm } from "./helpers";
import { sidecarFile } from "./contract";
import { readProfile } from "./helpers";
import { PROFILE_FIELDS } from "./contract";
import { readConvention } from "./helpers";

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

describe("IN-2 — the inspectable face is a .md beside the .sqlite", () => {
  // "Beside" is the whole assertion, and it is not decoration. The doc's two faces are a
  // pair: the functional one is opaque by nature, so the inspectable one is how anybody
  // — the User, or an agent that has never met this graph — finds out what the thing in
  // their directory is for. A sidecar written anywhere but next to the database is a
  // sidecar nobody stumbles across.
  test("is written in the same directory, named for the namespace, and is not empty", () => {
    const { cwd, namespace, db } = spawnGraph();

    const sidecar = sidecarFile(cwd, namespace);
    expect(existsSync(sidecar)).toBe(true);
    expect(path.dirname(sidecar)).toBe(path.dirname(db));
    // Present-but-blank would satisfy "a .md exists" while failing everything the
    // inspectable face is for, so the case asserts it actually says something.
    const text = norm(readFileSync(sidecar, "utf8"));
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).toContain(namespace);
  });
});

describe("IN-3 — the profile is present and intact inside the artifact", () => {
  // Iterating PROFILE_FIELDS rather than naming three fields is the point of this case.
  // The doc says the profile's configuration options are "namespace, use-pattern,
  // description" and then "probably more - TBD", so a case that hardcodes the current
  // three would go quietly insensitive the moment a fourth arrives — it would keep
  // passing while asserting nothing about the field that was actually added.
  test("carries every field the schema declares, non-empty", () => {
    const { db } = spawnGraph("in3");

    const stored = readProfile(db);
    for (const field of PROFILE_FIELDS) {
      expect(Object.keys(stored)).toContain(field);
      expect(stored[field]?.trim().length ?? 0).toBeGreaterThan(0);
    }
    // Intact also means nothing extra crept in: a field in the artifact that the schema
    // does not declare is a field nobody can account for.
    expect(Object.keys(stored).sort()).toEqual([...PROFILE_FIELDS].sort());
  });
});

describe("IN-8 — a convention is present in the artifact after initialize", () => {
  // "It lives in the artifact, not the engine" is the half that needs teeth. A canned
  // default baked into the binary would satisfy "present and non-empty" while defeating
  // the entire idea: the doc has the convention improvised per graph by the agent that
  // knows the use-case, and amended over the graph's life. So the seed is a string only
  // this profile could have supplied, and the case looks for exactly it.
  test("carries the seed the profile supplied, not an engine default", () => {
    const cwd = makeSandbox();
    const seed = "Every entity carries a status; ratings are 1-5 integers; sources are URLs.";
    const profilePath = path.join(cwd, "profile.yml");
    writeProfileYml(
      profilePath,
      { namespace: "in8", "use-pattern": "manual", description: "Convention seeding." },
      seed,
    );

    const r = runCli(["initialize", "--profile", profilePath], { cwd });
    expect(r.exitCode).toBe(EXIT.OK);

    const convention = readConvention(graphFile(cwd, "in8"));
    expect(convention.length).toBeGreaterThan(0);
    expect(convention.join("\n").trim().length).toBeGreaterThan(0);
    expect(convention).toContain(seed);
  });
});
