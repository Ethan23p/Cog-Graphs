import { describe, expect, test } from "bun:test";
import { runCli, spawnGraph } from "./helpers";
import { EXIT } from "./contract";

// DE-19.8.2 (minted) — the human-readable form must be unambiguous, not merely readable.
//
// Found by /code-review. Two renderings of nothing, both wrong in the same way:
//
//   graph: g            items:
//   entity: Helm            entity: Helm
//   attributes:             attributes:
//                           entity: Sword
//   added: true             attributes:
//                             status: owned
//
// An empty object rendered as a bare label with nothing under it — while an empty *array*
// says `(none)` — so a reader cannot tell "this entity has no attributes" from "the
// renderer stopped". And object items in an array had no delimiter, so the blank line
// after an attribute-less item is the only thing marking the boundary between two items:
// exactly the case where the reader most needs the boundary is the case where it
// disappears.
//
// DE-19.8's "still carries the same facts" check is a `toContain` per string, which cannot
// see either of these — every fact was present, and the shape around them was a lie. A
// human-readable form is a claim about what the reader will conclude, so this is the same
// class of defect as the forgery cases, arriving by omission rather than by injection.
//
// Numbered off DE-19.8. Same deviation from the mint-by-slice rule as DE-7.1.
describe("DE-19.8.2 (minted) — the pretty form is unambiguous", () => {
  function twoItems() {
    const g = spawnGraph({ namespace: "shape" });
    // The first has no attributes on purpose: that is the row that used to vanish into
    // the item boundary.
    expect(runCli(["add-item", "--graph", g.namespace, "--entity", "Helm"], { cwd: g.cwd }).exitCode).toBe(
      EXIT.OK,
    );
    expect(
      runCli(["add-item", "--graph", g.namespace, "--entity", "Sword", "--attr", "status=owned"], {
        cwd: g.cwd,
      }).exitCode,
    ).toBe(EXIT.OK);
    return g;
  }

  test("an empty collection says so, whether it is an object or an array", () => {
    const g = twoItems();

    const r = runCli(["add-item", "--graph", g.namespace, "--entity", "Boots", "--pretty"], {
      cwd: g.cwd,
    });

    expect(r.exitCode).toBe(EXIT.OK);
    // No label may be the last thing on its line with nothing beneath it. Emptiness is a
    // fact about the data and has to be rendered as one.
    const lines = r.stdout.split("\n");
    const dangling = lines.findIndex(
      (l, i) => l.trim().endsWith(":") && (lines[i + 1] ?? "").trim() === "",
    );
    expect(dangling).toBe(-1);
    expect(r.stdout).toContain("attributes: (none)");
  });

  test("items in a list are delimited, so a boundary is visible", () => {
    const g = twoItems();

    const r = runCli(["query", "--graph", g.namespace, "--pretty"], { cwd: g.cwd });

    expect(r.exitCode).toBe(EXIT.OK);
    // One marker per item, countable — which is the property a reader actually uses to
    // answer "how many are there", and the one that silently disagreed with `count`.
    const markers = r.stdout.split("\n").filter((l) => l.trimStart().startsWith("- "));
    expect(markers.length).toBe(2);
    expect(markers[0]).toContain("Helm");
    expect(markers[1]).toContain("Sword");
  });

  test("the rendered shape agrees with the count the payload reports", () => {
    // The check that makes this more than cosmetics: the pretty form and the JSON form are
    // two renderings of one answer, and a reader who counts the first must reach the same
    // number as a parser reading the second.
    const g = twoItems();

    const pretty = runCli(["query", "--graph", g.namespace, "--pretty"], { cwd: g.cwd });
    const plain = runCli(["query", "--graph", g.namespace], { cwd: g.cwd });

    const count = JSON.parse(plain.stdout).count as number;
    expect(pretty.stdout.split("\n").filter((l) => l.trimStart().startsWith("- ")).length).toBe(count);
  });

  test("an empty graph reads as empty rather than as nothing", () => {
    const g = spawnGraph({ namespace: "shape-empty" });

    const r = runCli(["query", "--graph", g.namespace, "--pretty"], { cwd: g.cwd });

    expect(r.exitCode).toBe(EXIT.OK);
    expect(r.stdout).toContain("(none)");
    expect(r.stdout.trim().length).toBeGreaterThan(0);
  });
});
