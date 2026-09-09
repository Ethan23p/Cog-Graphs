import { describe, expect, test } from "bun:test";
import { makeSandbox, readItems, runCli, spawnGraph } from "./helpers";
import { ERROR_FIELDS, EXIT } from "./contract";

// DE-22 — With two instances in the same working directory, omitting `--graph` errors
// legibly and names the candidates rather than silently choosing one; `--graph` naming a
// non-existent instance errors and names what does exist, or points at `initialize`.
//
// The failure mode this forbids is the quiet one. An Assistant that keeps a graph per
// use-case will have two in a directory sooner than it expects — `game-recs` and
// `file-reports` side by side is the doc's own picture — and an engine that picks the
// first one alphabetically writes the User's data into the wrong store while reporting
// success. Nothing downstream can detect that; the artifact is well-formed, it is just
// the wrong artifact.
//
// So the case is written as much about the *report* as the refusal: naming the
// candidates is what turns a dead end into one more turn, which is the whole standard
// this CLI is held to.
describe("DE-22 — graph targeting with more than one instance present", () => {
  function twoGraphs() {
    const first = spawnGraph({ namespace: "game-recs" });
    const second = spawnGraph({ namespace: "file-reports", cwd: first.cwd });
    return { cwd: first.cwd, first, second };
  }

  // Every command that operates on a graph, not just the one that was convenient to
  // write. Ambiguity is a property of the directory, so an engine that guards `query`
  // and forgets `add-item` has guarded the harmless one and left the writer open.
  const invocations: { label: string; args: string[] }[] = [
    { label: "query", args: ["query"] },
    { label: "add-item", args: ["add-item", "--entity", "Sword"] },
    { label: "modify-item", args: ["modify-item", "--entity", "Sword", "--attr", "status=owned"] },
    { label: "remove-item", args: ["remove-item", "--entity", "Sword"] },
    { label: "introduce", args: ["introduce"] },
  ];

  for (const { label, args } of invocations) {
    test(`${label} without --graph refuses and names both candidates`, () => {
      const { cwd } = twoGraphs();

      const r = runCli(args, { cwd });

      // A distinct code, per the doc's alphabet: 5 is ambiguous target, and it is not the
      // same situation as "not found" — the Operator's next move differs.
      expect(r.exitCode).toBe(EXIT.AMBIGUOUS);
      const error = JSON.parse(r.stderr);
      for (const field of ERROR_FIELDS) {
        expect(error[field]?.length ?? 0).toBeGreaterThan(0);
      }
      expect(error.message).toContain("game-recs");
      expect(error.message).toContain("file-reports");
      // The recovery has to be spelled, not implied. An agent reading only next_step
      // should be able to write the corrected command.
      expect(error.next_step).toContain("--graph");
    });
  }

  test("refusing means refusing: neither graph is written to", () => {
    // The assertion that makes the rest of this case worth anything. An error message is
    // no comfort if the write already happened.
    const { cwd, first, second } = twoGraphs();

    runCli(["add-item", "--entity", "Sword", "--attr", "status=owned"], { cwd });

    expect(readItems(first.db)).toEqual([]);
    expect(readItems(second.db)).toEqual([]);
  });

  test("--graph names the one meant, and the other is untouched", () => {
    // The other direction, and the reason the refusal is acceptable: naming the graph is
    // a short, obvious fix, and it lands where it was told to.
    const { cwd, first, second } = twoGraphs();

    const r = runCli(["add-item", "--graph", "file-reports", "--entity", "Sword"], { cwd });

    expect(r.exitCode).toBe(EXIT.OK);
    expect(readItems(second.db).map((i) => i.entity)).toEqual(["Sword"]);
    expect(readItems(first.db)).toEqual([]);
  });

  test("a --graph that does not exist errors and names what does", () => {
    const { cwd } = twoGraphs();

    const r = runCli(["query", "--graph", "grocery-list"], { cwd });

    expect(r.exitCode).toBe(EXIT.NOT_FOUND);
    const error = JSON.parse(r.stderr);
    expect(error.message).toContain("grocery-list");
    // Naming what does exist is the difference between "wrong" and "wrong, and here is
    // right" — a misremembered namespace is the likeliest cause, and the list is the fix.
    expect(error.next_step).toContain("game-recs");
    expect(error.next_step).toContain("file-reports");
  });

  test("in a directory with no graph at all, the error points at initialize", () => {
    // The doc's "or": with nothing to list, the useful answer is the command that makes
    // one. Reporting an empty list and stopping there would be true and useless.
    const cwd = makeSandbox();

    const r = runCli(["query", "--graph", "nothing-here"], { cwd });

    expect(r.exitCode).toBe(EXIT.NOT_FOUND);
    expect(JSON.parse(r.stderr).next_step).toContain("initialize");
  });
});
