import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import * as path from "node:path";
import { makeSandbox, runCli, writeProfileYml } from "./helpers";
import { EXIT, graphFile } from "./contract";

// DE-7.1 (minted) — `--dir` must not invent a directory tree, and must say when it makes
// one.
//
// Found while sweeping IN-9/10/11. Numbered off DE-7 rather than off the slice in
// progress because it is the same failure DE-7 exists to prevent — an artifact the User
// never sees again — and an ID that says where to look is worth more here than an ID
// that says when it was found. Flagged as a deviation from the minting rule.
//
// `initialize --profile p.yml --dir ./no/such/dir` created all three levels and reported
// success at exit 0, warnings empty. The scenario is not exotic: an Assistant writes
// `--dir ./Documnets/graphs`, the typo is silently made real, and the graph is in a
// directory nobody will ever open. DE-7 warns about a directory the operating system
// will delete; this is a directory that only ever existed because of a mistake, which is
// the same loss arriving through a different door.
//
// One new level with an existing parent is a different act — `--dir ./graphs` from a
// directory the User chose is an ordinary "make me a folder for this", and refusing it
// would be officious. So the line is drawn at the parent: create one level and say so,
// refuse a path whose parent is missing too.
describe("DE-7.1 (minted) — the target directory is not invented silently", () => {
  const seed = "Every entity carries a status.";

  function profileFor(cwd: string, namespace: string) {
    const profilePath = path.join(cwd, "profile.yml");
    writeProfileYml(
      profilePath,
      { namespace, "use-pattern": "manual", description: "Target directory." },
      seed,
    );
    return profilePath;
  }

  test("a --dir whose parent is missing too is refused", () => {
    const cwd = makeSandbox();

    const r = runCli(["initialize", "--profile", profileFor(cwd, "deep"), "--dir", "./no/such/dir"], {
      cwd,
    });

    expect(r.exitCode).toBe(EXIT.NOT_FOUND);
    const error = JSON.parse(r.stderr);
    expect(error.code).toBe("directory_not_found");
    // The path has to appear, because the whole failure is that the Operator wrote a path
    // they did not mean and cannot see their mistake without reading it back.
    expect(error.message).toContain("no");
    expect(error.next_step.trim().length).toBeGreaterThan(0);
    // Refusing while still creating the tree would be the worst of both.
    expect(existsSync(path.join(cwd, "no"))).toBe(false);
  });

  test("one new level under an existing parent is created, and reported", () => {
    const cwd = makeSandbox();

    const r = runCli(["initialize", "--profile", profileFor(cwd, "fresh"), "--dir", "./graphs"], {
      cwd,
    });

    expect(r.exitCode).toBe(EXIT.OK);
    const payload = JSON.parse(r.stdout);
    // Created, but never silently: an Operator who mistyped one level still gets told a
    // directory came into existence, which is the cheapest possible chance to notice.
    const warning = payload.warnings.find((w: { code: string }) => w.code === "created_directory");
    expect(warning).toBeDefined();
    expect(warning.message).toContain("graphs");
    expect(warning.next_step.trim().length).toBeGreaterThan(0);
    expect(existsSync(graphFile(path.join(cwd, "graphs"), "fresh"))).toBe(true);
  });

  test("an existing directory is used without comment", () => {
    // The common case must stay quiet, or the warning is one an Operator learns to
    // scroll past — the same argument DE-7 makes for its own guard.
    const cwd = makeSandbox();
    const r0 = runCli(["initialize", "--profile", profileFor(cwd, "here")], { cwd });

    expect(r0.exitCode).toBe(EXIT.OK);
    const payload = JSON.parse(r0.stdout);
    expect(payload.warnings.some((w: { code: string }) => w.code === "created_directory")).toBe(false);
  });

  test("the temp-directory guard still fires on a directory that did not exist yet", () => {
    // The blind spot this shares with DE-7: a directory that does not exist cannot be
    // realpath'd, so on a platform where the temp root is a symlink (macOS) the guard
    // compared an unresolved path against a resolved one and missed. Evaluated against
    // the nearest existing ancestor instead, which does resolve.
    const cwd = makeSandbox(); // makeSandbox is under the platform temp root by design.

    const r = runCli(["initialize", "--profile", profileFor(cwd, "tempnew"), "--dir", "./scratch"], {
      cwd,
    });

    expect(r.exitCode).toBe(EXIT.OK);
    const codes = (JSON.parse(r.stdout).warnings as { code: string }[]).map((w) => w.code);
    expect(codes).toContain("temp_directory");
    expect(codes).toContain("created_directory");
  });

  test("nothing is left behind when the path is refused", () => {
    const cwd = makeSandbox();
    // The fixture is written first so it is part of the baseline; otherwise this asserts
    // that writing the profile left a file behind, which is true and not the point.
    const profilePath = profileFor(cwd, "deep2");
    const before = readdirSync(cwd).sort();

    runCli(["initialize", "--profile", profilePath, "--dir", "./a/b/c"], { cwd });

    expect(readdirSync(cwd).sort()).toEqual(before);
  });
});
