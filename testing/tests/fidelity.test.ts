import { describe, expect, test } from "bun:test";
import { readItems, readSidecar, runCli, spawnGraph } from "./helpers";
import { EXIT } from "./contract";

// DE-23 — Source-fidelity round-trip: an entity name and attribute values containing
// spaces, an apostrophe, a non-ASCII character, an `=`, and an internal newline survive
// add → query → sidecar unchanged.
//
// "Source data at source fidelity" is the doc's default assumption, and it is a stronger
// claim than it sounds. Every one of these characters is a character that *something* in
// the path has an opinion about: the shell splits on spaces, `parseAttrs` splits on `=`,
// the sidecar is Markdown, JSON escapes quotes and newlines, and SQLite is the only layer
// with no opinion at all. A store that quietly normalizes what it was given is worse than
// one that refuses, because the User's own words come back subtly not theirs and nothing
// says so.
//
// The internal newline is the interesting one after DE-19.7. The sidecar necessarily
// renders it on one line — it is Markdown, and a real break there would forge structure —
// so "unchanged" is asserted where the data lives and where it round-trips, and the
// sidecar is held to the weaker claim it can actually honor: the value is present and
// legible. The artifact is the authority; the inspectable face is a view of it.
describe("DE-23 — source fidelity through add → query → sidecar", () => {
  const entity = "Assassin's Creed: Odyssey — Ultimate Edition";
  const values: Record<string, string> = {
    "taste-alignment": "very high",
    note: "Ethan's own words: “worth it” — 9/10",
    formula: "score=weight*2",
    "shell-ish": "run with --flag and $VAR and `backticks`",
    review: "First line.\nSecond line, after a real newline.",
  };

  function populated() {
    const g = spawnGraph({ namespace: "fidelity" });
    const attrs = Object.entries(values).flatMap(([k, v]) => ["--attr", `${k}=${v}`]);
    const r = runCli(["add-item", "--graph", g.namespace, "--entity", entity, ...attrs], {
      cwd: g.cwd,
    });
    expect(r.exitCode).toBe(EXIT.OK);
    return g;
  }

  test("the artifact holds exactly what was given", () => {
    // Read straight out of the `.sqlite`, not through the CLI: if the engine normalized on
    // the way in, no amount of consistency further down would reveal it.
    const g = populated();

    const items = readItems(g.db);

    expect(items.length).toBe(1);
    expect(items[0].entity).toBe(entity);
    expect(items[0].attributes).toEqual(values);
  });

  test("query returns it unchanged, character for character", () => {
    const g = populated();

    const r = runCli(["query", "--graph", g.namespace], { cwd: g.cwd });

    expect(r.exitCode).toBe(EXIT.OK);
    const items = JSON.parse(r.stdout).items as {
      entity: string;
      attributes: Record<string, string>;
    }[];
    expect(items[0].entity).toBe(entity);
    expect(items[0].attributes).toEqual(values);
  });

  test("the value may contain '=' — only the first one separates", () => {
    // Named separately because it is the one place the engine has to make a choice rather
    // than simply not interfere. Splitting on every `=` would refuse an ordinary value; a
    // URL with a query string is the everyday version of this.
    const g = populated();

    const r = runCli(["query", "--graph", g.namespace], { cwd: g.cwd });

    const attrs = (JSON.parse(r.stdout).items as { attributes: Record<string, string> }[])[0]
      .attributes;
    expect(attrs.formula).toBe("score=weight*2");
    expect(Object.keys(attrs)).toContain("formula");
  });

  test("the value survives a modify round-trip too", () => {
    // add is not the only door in. An engine that stored faithfully and rewrote on update
    // would pass everything above and still lose the User's text on their second edit.
    const g = populated();
    const replacement = "Rewritten — still Ethan's words, still “quoted”, still a=b";

    expect(
      runCli(["modify-item", "--graph", g.namespace, "--entity", entity, "--attr", `note=${replacement}`], {
        cwd: g.cwd,
      }).exitCode,
    ).toBe(EXIT.OK);

    expect(readItems(g.db)[0].attributes.note).toBe(replacement);
    // And the attributes that were not named are untouched, at full fidelity.
    expect(readItems(g.db)[0].attributes.review).toBe(values.review);
  });

  test("the sidecar shows every value legibly, and the entity by its real name", () => {
    // The weaker claim, and the honest one: the inspectable face is Markdown, so a value
    // carrying a newline is rendered on one line (DE-19.7). Everything else appears as
    // written — no smart quotes undone, no dash normalized, no apostrophe escaped.
    const g = populated();

    const sidecar = readSidecar(g.sidecar);

    expect(sidecar).toContain(`### ${entity}`);
    for (const [key, value] of Object.entries(values)) {
      if (value.includes("\n")) {
        expect(sidecar).toContain(`- **${key}**: ${value.replaceAll("\n", "\\n")}`);
      } else {
        expect(sidecar).toContain(`- **${key}**: ${value}`);
      }
    }
  });
});
