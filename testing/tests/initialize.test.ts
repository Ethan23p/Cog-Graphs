import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { makeSandbox, readProfile, runCli, writeProfileYml } from "./helpers";
import { EXIT, PROFILE_FIELDS, graphFile } from "./contract";

describe("DE-6 — the stored profile matches the imported .yml", () => {
  // The profile is the identity of this instantiation and it lives inside the artifact,
  // so an Operator who hands over a `.yml` and gets back a graph that quietly disagrees
  // with it has lost the one thing that made the graph theirs. Field for field, not
  // field-for-some-fields: the comparison is over the whole map, so a field the engine
  // silently drops or silently adds is a failure.
  test("every field survives initialize, and nothing is added or dropped", () => {
    const cwd = makeSandbox();
    const profile = {
      namespace: "game-recs",
      "use-pattern": "manual",
      description: "Games Ethan has played and what he thought of them.",
    };
    // The suite builds the profile from PROFILE_FIELDS so the case picks up new fields
    // rather than rotting when the schema grows past the doc's "probably more - TBD".
    expect(Object.keys(profile).sort()).toEqual([...PROFILE_FIELDS].sort());
    const profilePath = path.join(cwd, "profile.yml");
    writeProfileYml(profilePath, profile, "Every game carries a status and a rating.");

    const r = runCli(["initialize", "--profile", profilePath], { cwd });

    expect(r.exitCode).toBe(EXIT.OK);
    expect(readProfile(graphFile(cwd, profile.namespace))).toEqual(profile);
  });
});
