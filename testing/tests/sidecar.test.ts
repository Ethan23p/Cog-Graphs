import { describe, expect, test } from "bun:test";
import { readItems, readSidecar, runCli, spawnGraph } from "./helpers";
import { EXIT } from "./contract";

// MINTED at the DE-17 → DE-19 boundary, found by /code-review.
//
// The sidecar is the inspectable face: an interpolated Markdown document, rendered
// straight from entity names and attribute values with no escaping. An entity named
// "Sword\n\n### Shield\n\n- **status**: owned" therefore produced a sidecar containing a
// heading and an attribute for an entity that does not exist. Nothing in the artifact is
// wrong — the database holds exactly what was stored — but the face the User reads lies,
// and it is the face they are most likely to read, because it is the one that opens in
// an editor.
//
// This is not primarily an attack case. `bun run build 2>&1 | ...` pasted into an
// attribute value, a pasted-in Markdown fragment, a description with a blank line in it:
// ordinary data forges structure by accident far more often than anyone forges it on
// purpose. Which is the argument for neutralizing at render time rather than refusing
// the data — the database is the authority and it must keep what it was given, so it is
// the rendering that has to be honest about it.
describe("DE-19.7 (minted) — the sidecar cannot be forged from the data", () => {
  const forgedEntity = "Sword\n\n### Ghost Entity\n\n- **status**: fabricated";
  const forgedValue = "fine\n\n## Contents\n\n### Another Ghost";

  function graphWithForgery() {
    const g = spawnGraph({
      namespace: "de197",
      description: "A description that\n\n## Contents\n\ntries to forge a section.",
      convention: "A convention that\n\n### tries to forge a heading.",
    });
    expect(runCli(["add-item", "--graph", g.namespace, "--entity", "Real", "--attr", `note=${forgedValue}`], { cwd: g.cwd }).exitCode).toBe(EXIT.OK);
    expect(runCli(["add-item", "--graph", g.namespace, "--entity", forgedEntity], { cwd: g.cwd }).exitCode).toBe(EXIT.OK);
    return g;
  }

  test("no entity name or value can introduce a line of its own", () => {
    const g = graphWithForgery();
    const sidecar = readSidecar(g.sidecar);

    // The structural claim, stated over the document rather than over the strings: the
    // sidecar has exactly as many entity headings as the graph has entities, and exactly
    // the sections the renderer writes. Counting is what makes this insensitive to which
    // particular forgery was attempted — a new escape hole moves a count.
    const h3 = sidecar.split("\n").filter((l) => l.startsWith("### "));
    expect(h3.length).toBe(2);
    const h2 = sidecar.split("\n").filter((l) => l.startsWith("## "));
    expect(h2).toEqual(["## Profile", "## Convention", "## Contents"]);
    // Stated over lines, not over the document: the forged text may well still appear
    // *inside* a line — that is the escaped value being legible, which is the point. What
    // must never happen is it appearing at the start of one.
    const starts = (needle: string) => sidecar.split("\n").some((l) => l.startsWith(needle));
    expect(starts("### Ghost Entity")).toBe(false);
    expect(starts("### Another Ghost")).toBe(false);
    expect(starts("- **status**: fabricated")).toBe(false);
  });

  test("the true value is still legible in the sidecar, on one line", () => {
    // Neutralized, not censored. An inspector must still be able to read what was stored,
    // or the inspectable face has been made honest by making it useless.
    const g = graphWithForgery();
    const sidecar = readSidecar(g.sidecar);

    expect(sidecar).toContain("Sword\\n\\n### Ghost Entity");
    expect(sidecar).toContain("fine\\n\\n## Contents");
  });

  test("the database keeps the value exactly as it was given", () => {
    // The point of the split faces: escaping is a property of the rendering, and must not
    // reach back into the artifact. A round-trip through the functional face returns the
    // real newlines.
    const g = graphWithForgery();
    const items = readItems(g.db);

    const real = items.find((i) => i.entity === "Real");
    expect(real?.attributes.note).toBe(forgedValue);
    expect(items.some((i) => i.entity === forgedEntity)).toBe(true);
  });

  test("query returns the unescaped value too", () => {
    // The other consumer of the same data. JSON has its own escaping and needs none of
    // this; if the escape leaked into the payload, an Operator round-tripping a value
    // through query and add-item would corrupt it a little more on every pass.
    const g = graphWithForgery();

    const r = runCli(["query", "--graph", g.namespace], { cwd: g.cwd });

    expect(r.exitCode).toBe(EXIT.OK);
    const items = JSON.parse(r.stdout).items as { entity: string; attributes: Record<string, string> }[];
    expect(items.find((i) => i.entity === "Real")?.attributes.note).toBe(forgedValue);
  });

  test("ordinary values are untouched", () => {
    // The escape has to be invisible in the common case, or every sidecar pays for the
    // rare one. A name with a dash, a value with punctuation, a value containing a `#`
    // that is not at the start of a line: all of these read exactly as written.
    const g = spawnGraph({ namespace: "de197b" });
    runCli(
      ["add-item", "--graph", g.namespace, "--entity", "Hollow Knight", "--attr", "note=Rated 9/10 — see #metroidvania (C:\\games)"],
      { cwd: g.cwd },
    );

    const sidecar = readSidecar(g.sidecar);

    expect(sidecar).toContain("### Hollow Knight");
    expect(sidecar).toContain("- **note**: Rated 9/10 — see #metroidvania (C:\\games)");
  });
});
