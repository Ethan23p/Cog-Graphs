import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { readdirSync } from "node:fs";
import { makeSandbox, readSidecar, runCli, spawnGraph, writeProfileYml } from "./helpers";
import { EXIT } from "./contract";

// DE-19.7.1 (minted) — the second rendered face cannot be forged either, and the
// namespace is not exempt.
//
// Two holes left by DE-19.7, both found by /code-review.
//
// The first is that DE-19.7 hardened the sidecar and DE-19.8 then added a *second*
// rendered face — `--pretty` — with no equivalent guard. prettyLines reflows any string
// containing a newline as real indented lines, so an attribute value of
// "First line.\ncount: 999\nentity: Ghost" renders `count:` and `entity:` at the same
// visual level as genuine payload fields. DE-19.7's own argument applies verbatim: this
// is not primarily an attack, it is what ordinary pasted text does by accident. And
// DE-23's fixture carries a real newline but never runs --pretty, so nothing caught it.
//
// The second is that `inline()` was applied to entity names, attribute names and values,
// profile values and convention text — and not to the namespace, which is interpolated
// into the sidecar's H1 and into the prose line that tells the reader how to open the
// graph. The namespace validator rejects separators and dots but permits a control
// character, and on POSIX a filename containing a newline is creatable. That forges an H1
// and a `##` section, which is exactly what DE-19.7's heading count exists to rule out.
//
// Numbered off DE-19.7, whose claim these complete. Same deviation from the mint-by-slice
// rule as DE-7.1, flagged the same way.
describe("DE-19.7.1 (minted) — --pretty cannot forge structure", () => {
  const forged = "First line.\ncount: 999\nentity: Ghost\n  nested: yes";

  function graphWith(namespace: string) {
    const g = spawnGraph({ namespace });
    expect(
      runCli(["add-item", "--graph", g.namespace, "--entity", "Helm", "--attr", `review=${forged}`], {
        cwd: g.cwd,
      }).exitCode,
    ).toBe(EXIT.OK);
    return g;
  }

  test("a value's newlines do not become payload lines", () => {
    const g = graphWith("pretty-forge");

    const r = runCli(["query", "--graph", g.namespace, "--pretty"], { cwd: g.cwd });

    expect(r.exitCode).toBe(EXIT.OK);
    // The claim stated over the document: no line of the human-readable form may be a
    // field the payload does not actually have. `count` and `entity: Ghost` are the
    // give-aways because they read exactly like the real labels beside them.
    const lines = r.stdout.split("\n").map((l) => l.trim());
    expect(lines).not.toContain("count: 999");
    expect(lines).not.toContain("entity: Ghost");
    expect(lines).not.toContain("nested: yes");
  });

  test("and the value is still legible in the pretty form", () => {
    // Neutralized, not censored — the same bargain DE-19.7 struck for the sidecar. A
    // human-readable form that hides the data is not more readable.
    const g = graphWith("pretty-legible");

    const r = runCli(["query", "--graph", g.namespace, "--pretty"], { cwd: g.cwd });

    expect(r.stdout).toContain("First line.");
    expect(r.stdout).toContain("count: 999");
  });

  test("genuine multi-line prose is still reflowed", () => {
    // The reason --pretty exists at all (DE-19.8): the primer is one enormous JSON line
    // and the pretty form breaks it into paragraphs. That must survive the guard, or the
    // fix has removed the feature.
    const cwd = makeSandbox();

    const r = runCli(["introduce", "--interface-skill", "--pretty"], { cwd });

    expect(r.exitCode).toBe(EXIT.OK);
    expect(r.stdout.split("\n").length).toBeGreaterThan(10);
    expect(r.stdout.includes("\\n")).toBe(false);
  });
});

describe("DE-19.7.1 (minted) — a namespace cannot carry line structure", () => {
  // The narrow fix is to reject the character rather than escape it downstream. A
  // namespace is a filename and an identifier an Operator types back; a control character
  // in it is never anything but a mistake or an attack, and unlike an attribute value
  // there is no legitimate content being refused.
  for (const [label, namespace] of [
    ["a newline", "demo\n\n## Contents\n\n### Ghost"],
    ["a carriage return", "demo\rmore"],
    ["a tab", "demo\tmore"],
  ] as const) {
    test(`refuses ${label}`, () => {
      const cwd = makeSandbox();
      const profilePath = path.join(cwd, "profile.yml");
      writeProfileYml(
        profilePath,
        { namespace, "use-pattern": "manual", description: "Control characters." },
        "Every entity carries a status.",
      );

      const r = runCli(["initialize", "--profile", profilePath], { cwd });

      expect(r.exitCode).toBe(EXIT.USAGE);
      expect(JSON.parse(r.stderr).code).toBe("invalid_namespace");
      expect(readdirSync(cwd).filter((f) => f.endsWith(".sqlite"))).toEqual([]);
    });
  }

  test("the sidecar's own heading is escaped regardless", () => {
    // Belt and braces, and cheap. The validator is the guard; escaping the interpolation
    // means a future namespace rule that lets something through cannot forge a heading on
    // its way to the page.
    const g = spawnGraph({ namespace: "plain-name" });

    const sidecar = readSidecar(g.sidecar);

    const h1 = sidecar.split("\n").filter((l) => l.startsWith("# "));
    expect(h1).toEqual(["# plain-name"]);
  });
});
