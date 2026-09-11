import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { makeSandbox, readProfile, runCli, writeProfileYml } from "./helpers";
import { EXIT, PROFILE_FIELDS, graphFile } from "./contract";
import { makeOrdinarySandbox } from "./helpers";
import { existsSync, readdirSync } from "node:fs";
import { readFileSync, writeFileSync } from "node:fs";
import { sidecarFile } from "./contract";

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

describe("DE-19.4 (minted) — the namespace must be a single path segment", () => {
  // MINTED at the DE-17 → DE-19 boundary, found by /code-review. PROFILE_FIELDS were
  // only checked with `typeof === "string"`, so the namespace went straight into a path
  // join: `namespace: ../escaped` run from one directory created the graph in its
  // *parent* and reported success, with the escaped path in the payload.
  //
  // This is the same failure DE-7 exists to prevent, arriving through a different door.
  // The temp-directory guard is about an artifact the User cannot find; so is this, and
  // it is worse, because it silently contradicts the `--dir` the Operator explicitly
  // gave. A namespace that escapes is also invisible to `listGraphs`, which reads one
  // directory, so the graph cannot be introduced or queried afterwards — it is written
  // and lost in the same command.
  const bad: { label: string; namespace: string }[] = [
    { label: "a parent-directory traversal", namespace: "../escaped" },
    { label: "a nested path", namespace: "sub/graph" },
    { label: "a Windows-style path", namespace: "sub\\graph" },
    { label: "an absolute path", namespace: "/tmp/absolute" },
    { label: "whitespace only", namespace: "   " },
    { label: "empty", namespace: "" },
  ];

  for (const { label, namespace } of bad) {
    test(`refuses ${label}`, () => {
      const cwd = makeOrdinarySandbox();
      const profilePath = path.join(cwd, "profile.yml");
      writeProfileYml(
        profilePath,
        { namespace, "use-pattern": "manual", description: "Namespace validation." },
        "Every entity carries a status.",
      );

      const r = runCli(["initialize", "--profile", profilePath], { cwd });

      expect(r.exitCode).toBe(EXIT.USAGE);
      const error = JSON.parse(r.stderr);
      expect(error.code).toBe("invalid_namespace");
      expect(error.next_step.trim().length).toBeGreaterThan(0);
      // Refusing while still writing the file would be the worst of both.
      expect(readdirSync(cwd).filter((f) => f.endsWith(".sqlite"))).toEqual([]);
    });
  }

  // The guard has to stay narrow. Dots, dashes and underscores are how real namespaces
  // read — `game-recs-Ethan`, `file-reports`, `notes.2026` — and a validator that
  // rejected them would push Operators toward worse names to satisfy the tool.
  //
  // One test per name rather than a loop inside one test: each of these writes a
  // database into `testing/.scratch/`, which is ~1.8s a time on this machine (see
  // makeOrdinarySandbox), so a four-name loop is a single ~7s test for no benefit and
  // reports only the first name that breaks.
  for (const namespace of ["game-recs", "file_reports", "notes.2026", "Graph1"]) {
    test(`accepts the ordinary namespace '${namespace}'`, () => {
      const cwd = makeOrdinarySandbox();
      const profilePath = path.join(cwd, "profile.yml");
      writeProfileYml(
        profilePath,
        { namespace, "use-pattern": "manual", description: "Ordinary namespace." },
        "Every entity carries a status.",
      );

      const r = runCli(["initialize", "--profile", profilePath], { cwd });

      expect(r.exitCode).toBe(EXIT.OK);
      expect(existsSync(graphFile(cwd, namespace))).toBe(true);
    });
  }
});

describe("DE-19.5 (minted) — initialize will not overwrite either face", () => {
  // MINTED at the DE-17 → DE-19 boundary, found by /code-review. The already-exists
  // check covered only the `.sqlite`, while writeSidecar did an unconditional write.
  //
  // The scenario is ordinary and the loss is total: a User keeps `notes.md` in a
  // directory, their Assistant initializes a graph and reasonably picks the namespace
  // `notes`, and the file is gone. Exit 0, no warning, nothing in the payload. The
  // sidecar is derived and disposable *to the engine*, which is exactly why the engine
  // must not assume a file at that path is one of its own — everything the artifact
  // owns, it created.
  const seed = "Every entity carries a status.";

  function profileFor(cwd: string, namespace: string) {
    const profilePath = path.join(cwd, "profile.yml");
    writeProfileYml(
      profilePath,
      { namespace, "use-pattern": "manual", description: "Overwrite guard." },
      seed,
    );
    return profilePath;
  }

  test("refuses when a file already holds the sidecar's name, and leaves it untouched", () => {
    const cwd = makeSandbox();
    const theirs = "# The User's own notes\n\nNothing to do with any graph.\n";
    writeFileSync(sidecarFile(cwd, "notes"), theirs);

    const r = runCli(["initialize", "--profile", profileFor(cwd, "notes")], { cwd });

    expect(r.exitCode).toBe(EXIT.ALREADY_EXISTS);
    const error = JSON.parse(r.stderr);
    expect(error.code).toBe("artifact_exists");
    expect(error.next_step.trim().length).toBeGreaterThan(0);
    // The whole point: their file is exactly as they left it.
    expect(readFileSync(sidecarFile(cwd, "notes"), "utf8")).toBe(theirs);
    // And no half-built graph was left beside it.
    expect(existsSync(graphFile(cwd, "notes"))).toBe(false);
  });

  test("still refuses when the .sqlite is the one in the way", () => {
    // The pre-existing behavior, kept green: widening the check must not narrow it.
    const cwd = makeSandbox();
    runCli(["initialize", "--profile", profileFor(cwd, "twice")], { cwd });

    const r = runCli(["initialize", "--profile", profileFor(cwd, "twice")], { cwd });

    expect(r.exitCode).toBe(EXIT.ALREADY_EXISTS);
    expect(JSON.parse(r.stderr).code).toBe("artifact_exists");
  });
});
