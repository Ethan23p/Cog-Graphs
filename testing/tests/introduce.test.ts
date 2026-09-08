// DE-1 … DE-7 — introduction & initialization.
//
// Case text: design doc > Technical Specification > Testing & Evaluation > v0.3.1.
// The spec's second layer; never edited to fit the engine. See testing/DISPUTES.md.

import { test, expect, describe } from "bun:test";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
  BIN,
  EXIT,
  COMMANDS,
  WITHHELD_FLAG,
  WALKING_SKELETON_COMMANDS,
  WARNINGS_FIELD,
  PROFILE_FIELDS,
} from "./contract";
import {
  runCli,
  makeSandbox,
  makeTempRootSandbox,
  sandboxWithGraph,
  initConfig,
  writeInitConfig,
  readProfile,
  parseJson,
  shown,
} from "./helpers";

test("DE-1 `introduce` with no instance present returns the system introduction rather than erroring", () => {
  const dir = makeSandbox();
  const r = runCli(["introduce"], { cwd: dir });
  expect(r.exitCode).toBe(EXIT.OK);
  const payload = parseJson(r.stdout, "introduce stdout");
  // "How to use the system" — with nothing to introduce, the only useful next move
  // is creating an instance, so the introduction has to say so.
  expect(JSON.stringify(payload)).toContain("initialize");
});

test("DE-2 `introduce --interface-skill` returns non-empty primer content at exit 0, naming every command the Walking Skeleton requires", () => {
  const { dir } = sandboxWithGraph();
  const r = runCli(["introduce", "--interface-skill"], { cwd: dir });
  expect(r.exitCode).toBe(EXIT.OK);
  expect(r.stdout.trim().length).toBeGreaterThan(0);
  const text = JSON.stringify(parseJson(r.stdout, "primer stdout"));
  for (const cmd of WALKING_SKELETON_COMMANDS) {
    expect(text, `primer does not name the '${cmd}' command`).toContain(cmd);
  }
});

describe("DE-3 `--managed` appears in no user-facing output", () => {
  test("not in any command's --help", () => {
    const dir = makeSandbox();
    for (const { name } of COMMANDS) {
      const r = runCli([name, "--help"], { cwd: dir });
      expect(r.stdout + r.stderr, `${name} --help leaks ${WITHHELD_FLAG}`).not.toContain(WITHHELD_FLAG);
    }
    const top = runCli(["--help"], { cwd: dir });
    expect(top.stdout + top.stderr, `${BIN} --help leaks ${WITHHELD_FLAG}`).not.toContain(WITHHELD_FLAG);
  });

  test("not in success output, not in error output", () => {
    const { dir, ns } = sandboxWithGraph();
    const invocations = [
      ["introduce"],
      ["introduce", "--interface-skill"],
      ["query", "--graph", ns],
      ["add-item", "--graph", ns, "--entity", "alpha", "--attr", "a=b"],
      ["modify-item", "--graph", ns, "--entity", "ghost", "--attr", "a=b"],
      ["nonsense-command"],
    ];
    for (const args of invocations) {
      const r = runCli(args, { cwd: dir });
      expect(r.stdout + r.stderr, `${shown(args)} leaks ${WITHHELD_FLAG}`).not.toContain(WITHHELD_FLAG);
    }
  });
});

test("DE-4 `--managed` supplied on input is rejected — it never silently succeeds", () => {
  const { dir, ns } = sandboxWithGraph();
  const r = runCli(["query", "--graph", ns, WITHHELD_FLAG], { cwd: dir });
  expect(r.exitCode).toBe(EXIT.USAGE);
  const err = parseJson(r.stderr, "stderr");
  expect(String(err.message).toLowerCase()).toContain("unrecognized");
});

test("DE-5 every command answers --help at exit 0, naming its required flags and carrying a runnable example", () => {
  const dir = makeSandbox();
  for (const cmd of COMMANDS) {
    const r = runCli([cmd.name, "--help"], { cwd: dir });
    expect(r.exitCode, `${cmd.name} --help should exit 0`).toBe(EXIT.OK);
    const help = r.stdout;
    for (const flag of cmd.required) {
      expect(help, `${cmd.name} --help does not name required flag ${flag}`).toContain(flag);
    }
    // A runnable example: a line an Operator could copy, naming binary and command.
    const hasExample = help
      .split("\n")
      .some((line) => line.includes(BIN) && line.includes(cmd.name));
    expect(hasExample, `${cmd.name} --help carries no runnable example`).toBe(true);
  }
});

test("DE-6 the profile stored in the artifact matches the imported .yml field for field", () => {
  const dir = makeSandbox();
  const cfg = initConfig({
    namespace: "field-for-field",
    description: "A description with distinguishing words in it.",
  });
  const profile = writeInitConfig(dir, cfg);
  expect(runCli(["initialize", "--profile", profile], { cwd: dir }).exitCode).toBe(EXIT.OK);

  const stored = readProfile(dir, cfg.namespace);
  for (const field of PROFILE_FIELDS) {
    expect(stored[field], `profile field ${field}`).toBe(String(cfg[field as keyof typeof cfg]));
  }
  // Field for field, in both directions: nothing invented that was not supplied.
  expect(Object.keys(stored).sort()).toEqual([...PROFILE_FIELDS].sort());
});

describe("DE-7 temp-directory guard, both directions", () => {
  // The warning travels as a `warnings` array in the JSON output, so it does not
  // break IN-9.
  const warningsOf = (stdout: string): string[] => {
    const payload = parseJson(stdout, "initialize stdout");
    const w = payload[WARNINGS_FIELD];
    return Array.isArray(w) ? w.map((x) => String(x)) : [];
  };

  test("initialize under the platform temp root warns, naming the risk", () => {
    const dir = makeTempRootSandbox();
    const cfg = initConfig({ namespace: "in-temp" });
    const profile = writeInitConfig(dir, cfg);
    const r = runCli(["initialize", "--profile", profile], { cwd: dir });

    expect(r.exitCode).toBe(EXIT.OK); // a warning, not a refusal
    const warnings = warningsOf(r.stdout);
    expect(warnings.length, "no warning emitted for a temp-root target").toBeGreaterThan(0);
    expect(
      warnings.some((w) => /temp/i.test(w)),
      `no warning names the temp-directory risk: ${JSON.stringify(warnings)}`,
    ).toBe(true);
  });

  test("initialize in an ordinary directory emits no such warning", () => {
    const dir = makeSandbox();
    expect(dir.startsWith(path.resolve(tmpdir()))).toBe(false); // guard the guard
    const cfg = initConfig({ namespace: "ordinary" });
    const profile = writeInitConfig(dir, cfg);
    const r = runCli(["initialize", "--profile", profile], { cwd: dir });

    expect(r.exitCode).toBe(EXIT.OK);
    expect(warningsOf(r.stdout).filter((w) => /temp/i.test(w))).toEqual([]);
  });

  test("`--dir` is what is judged, not the process cwd", () => {
    // The failure mode the doc names is an Assistant initializing into its own
    // ephemeral environment. That is a decision about the target path, so the guard
    // has to follow --dir rather than where the process happened to start.
    const cwd = makeSandbox();
    const target = makeTempRootSandbox();
    const cfg = initConfig({ namespace: "elsewhere" });
    const profile = writeInitConfig(cwd, cfg);
    const r = runCli(["initialize", "--profile", profile, "--dir", target], { cwd });

    expect(r.exitCode).toBe(EXIT.OK);
    expect(warningsOf(r.stdout).some((w) => /temp/i.test(w))).toBe(true);
  });
});
