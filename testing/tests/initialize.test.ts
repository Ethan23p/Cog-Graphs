import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { makeSandbox, readProfile, runCli, writeProfileYml } from "./helpers";
import { EXIT, PROFILE_FIELDS, graphFile } from "./contract";
import { makeOrdinarySandbox } from "./helpers";

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

describe("DE-7 — temp-directory guard, both directions", () => {
  // The failure this guards is specific and quiet: an Assistant initializes the graph in
  // its own ephemeral environment, everything appears to work, and the User never sees
  // the artifact again. The doc asks for both directions because a guard that fires
  // everywhere is one an Operator learns to scroll past — the absence of the warning in
  // an ordinary directory is what keeps its presence meaningful.
  //
  // It travels as a `warnings` array rather than on stderr so it does not turn a success
  // into something an Operator has to parse two streams to understand, and so IN-9 still
  // holds: the whole of stdout stays a single JSON object.
  const seed = "Every entity carries a status.";

  function initializeIn(cwd: string, namespace: string) {
    const profilePath = path.join(cwd, "profile.yml");
    writeProfileYml(
      profilePath,
      { namespace, "use-pattern": "manual", description: "Temp-directory guard." },
      seed,
    );
    const r = runCli(["initialize", "--profile", profilePath], { cwd });
    expect(r.exitCode).toBe(EXIT.OK);
    return JSON.parse(r.stdout);
  }

  test("warns, and names the risk, when the target is under the platform temp root", () => {
    const payload = initializeIn(makeSandbox(), "de7-temp");

    expect(Array.isArray(payload.warnings)).toBe(true);
    const warning = payload.warnings.find((w: { code: string }) => w.code === "temp_directory");
    expect(warning).toBeDefined();
    // Naming the risk is the requirement, not merely naming the condition: "this is a
    // temp directory" tells an Operator nothing they cannot see, so the message has to
    // say what goes wrong — the artifact does not survive, and the User loses it.
    expect(warning.message.toLowerCase()).toContain("temp");
    expect(warning.message.trim().length).toBeGreaterThan(40);
    expect(warning.next_step.trim().length).toBeGreaterThan(0);
  });

  test("stays quiet in an ordinary directory", () => {
    const payload = initializeIn(makeOrdinarySandbox(), "de7-ordinary");

    expect(Array.isArray(payload.warnings)).toBe(true);
    expect(payload.warnings.some((w: { code: string }) => w.code === "temp_directory")).toBe(false);
  });
});
