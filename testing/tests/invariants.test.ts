import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { makeSandbox, runCli, spawnGraph, writeProfileYml } from "./helpers";
import { COMMANDS, ERROR_FIELDS, EXIT, GLOBAL_FLAGS } from "./contract";

// IN-9, IN-10, IN-11 — the interface invariants, which are the ones an agent actually
// programs against.
//
// These are swept rather than sampled on purpose. Every other case in this suite pins one
// behavior; these three pin a *property of the whole surface*, and a property that holds
// for the five invocations somebody remembered to check is not a property. The value of
// the sweep is entirely in the invocations nobody would have chosen — the error paths, the
// unbuilt commands, the malformed input — because those are where a CLI stops being
// uniform and an agent's parser stops working.
//
// The invocation table below is therefore built to be *unpleasant*: successes and failures
// of every class the exit alphabet names, plus the ways an agent gets it wrong.
/**
 * The unbuilt-command row, asked of the CLI rather than named in a literal.
 *
 * Returns at most one invocation — one is enough to pin the property, and every unbuilt
 * command answers identically by construction — and returns none once the set empties,
 * at which point there is no such thing as an unbuilt command to grade.
 *
 * Invoked with no options at all, so the answer cannot come from anything but the
 * command's build status. Giving it plausible-looking flags is what let the old row
 * drift: `import --from ./items.yml` graded a missing *file* the moment `import` landed,
 * while still being labelled and scored as an unbuilt command.
 */
function unbuiltInvocation(cwd: string, namespace: string): { label: string; args: string[]; cwd: string }[] {
  void namespace;
  for (const command of COMMANDS) {
    const help = JSON.parse(runCli([command.name, "--help"], { cwd }).stdout);
    if (help.status === "not_implemented") {
      return [{ label: "unbuilt command", args: [command.name], cwd }];
    }
  }
  return [];
}

function invocations(): { label: string; args: string[]; cwd: string }[] {
  const g = spawnGraph({ namespace: "invariants" });
  runCli(["add-item", "--graph", g.namespace, "--entity", "Sword", "--attr", "status=owned"], {
    cwd: g.cwd,
  });
  const empty = makeSandbox();
  const untouched = makeSandbox();
  const profilePath = path.join(empty, "p.yml");
  writeProfileYml(
    profilePath,
    { namespace: "invariants", "use-pattern": "manual", description: "For the sweep." },
    "Every entity carries a status.",
  );

  const here = (label: string, args: string[]) => ({ label, args, cwd: g.cwd });
  const there = (label: string, args: string[]) => ({ label, args, cwd: empty });

  return [
    // Successes, one per command that exists.
    here("introduce", ["introduce"]),
    here("introduce --interface-skill", ["introduce", "--interface-skill"]),
    here("introduce --graph", ["introduce", "--graph", g.namespace]),
    there("initialize", ["initialize", "--profile", profilePath]),
    here("query", ["query", "--graph", g.namespace]),
    here("query --attr", ["query", "--graph", g.namespace, "--attr", "status=owned"]),
    here("query --exclude", ["query", "--graph", g.namespace, "--exclude", "status=owned"]),
    here("add-item", ["add-item", "--graph", g.namespace, "--entity", "Shield"]),
    here("modify-item", ["modify-item", "--graph", g.namespace, "--entity", "Sword", "--attr", "status=sold"]),
    here("remove-item", ["remove-item", "--graph", g.namespace, "--entity", "Shield"]),
    // Help, for every command plus the bare overview.
    here("--help", ["--help"]),
    ...COMMANDS.map((c) => here(`${c.name} --help`, [c.name, "--help"])),
    // Failures, at least one per class the exit alphabet names.
    here("unknown command", ["frobnicate"]),
    here("unknown option", ["query", "--graph", g.namespace, "--nonsense"]),
    here("missing required option", ["initialize"]),
    here("flag without a value", ["query", "--graph"]),
    here("malformed attribute", ["add-item", "--graph", g.namespace, "--entity", "X", "--attr", "novalue"]),
    here("graph not found", ["query", "--graph", "no-such-graph"]),
    { label: "no graph here", args: ["query"], cwd: untouched },
    here("entity not found", ["modify-item", "--graph", g.namespace, "--entity", "Ghost", "--attr", "a=b"]),
    here("already exists", ["add-item", "--graph", g.namespace, "--entity", "Sword"]),
    there("profile not found", ["initialize", "--profile", "./nowhere.yml"]),
    // AMENDED 2026-09-09, under Ethan's resolution of the DE-19.3 dispute (DISPUTES.md).
    // This row named `import` in a literal, and DE-19 built `import`, so the row's own
    // label stopped being true of its invocation: it exercised source_not_found and was
    // graded against not_implemented. The command is asked of the CLI now, exactly as
    // DE-19.3 and DE-19.6.1 ask it, so the row tracks whatever is actually unbuilt and
    // disappears when nothing is — which is the honest end state for a row about
    // unbuilt commands.
    ...unbuiltInvocation(g.cwd, g.namespace),
    // The empty invocation: where an agent with no priming starts.
    here("bare", []),
  ];
}

describe("IN-9 — every invocation answers in a parseable form", () => {
  for (const { label, args, cwd } of invocations()) {
    test(`${label}: default output is JSON on exactly one stream`, () => {
      const r = runCli(args, { cwd });

      // Success writes stdout and leaves stderr alone; failure does the reverse. The split
      // is what lets an agent pipe stdout into a parser without an error corrupting the
      // parse, so a command that writes to both has broken the contract even if both are
      // individually well-formed.
      const stream = r.exitCode === EXIT.OK ? r.stdout : r.stderr;
      const quiet = r.exitCode === EXIT.OK ? r.stderr : r.stdout;
      expect(quiet).toBe("");
      expect(stream.trim().length).toBeGreaterThan(0);
      const parsed = JSON.parse(stream);
      // A bare scalar is valid JSON and useless to a parser that wants a field; every
      // answer is an object.
      expect(typeof parsed).toBe("object");
      expect(parsed).not.toBeNull();
      expect(Array.isArray(parsed)).toBe(false);
    });
  }

  for (const { label, args, cwd } of invocations()) {
    test(`${label}: --pretty answers in the human-readable form`, () => {
      // Deliberately not compared against a second plain run: initialize, add-item and
      // remove-item are not idempotent, and answer differently the second time precisely
      // because they worked the first. So the pretty form is held to its own properties —
      // same stream discipline, same exit alphabet, and not JSON.
      const r = runCli([...args, "--pretty"], { cwd });

      expect(Object.values(EXIT) as number[]).toContain(r.exitCode);
      const stream = r.exitCode === EXIT.OK ? r.stdout : r.stderr;
      const quiet = r.exitCode === EXIT.OK ? r.stderr : r.stdout;
      expect(quiet).toBe("");
      expect(stream.trim().length).toBeGreaterThan(0);
      expect(() => JSON.parse(stream)).toThrow();
    });
  }
});

describe("IN-10 — exit codes are meaningful on every invocation", () => {
  // The alphabet is the doc's, verbatim: 0 ok; 1 usage/unknown option; 2 not found;
  // 3 already exists; 4 partial ingestion; 5 ambiguous target; 6 internal. An agent that
  // cannot tell these apart cannot choose its next move, which is the whole point of
  // having more than one.
  const expected: Record<string, number> = {
    introduce: EXIT.OK,
    "introduce --interface-skill": EXIT.OK,
    "introduce --graph": EXIT.OK,
    initialize: EXIT.OK,
    query: EXIT.OK,
    "query --attr": EXIT.OK,
    "query --exclude": EXIT.OK,
    "add-item": EXIT.OK,
    "modify-item": EXIT.OK,
    "remove-item": EXIT.OK,
    "--help": EXIT.OK,
    "unknown command": EXIT.USAGE,
    "unknown option": EXIT.USAGE,
    "missing required option": EXIT.USAGE,
    "flag without a value": EXIT.USAGE,
    "malformed attribute": EXIT.USAGE,
    "graph not found": EXIT.NOT_FOUND,
    "no graph here": EXIT.NOT_FOUND,
    "entity not found": EXIT.NOT_FOUND,
    "already exists": EXIT.ALREADY_EXISTS,
    "profile not found": EXIT.NOT_FOUND,
    "unbuilt command": EXIT.INTERNAL,
    // Exit 0, not usage. `cog-graphs` with no arguments is the front door — it answers
    // the question "what is this" with the overview, which is a success. Reporting a
    // failure code would tell a zero-priming agent it did something wrong at the exact
    // moment it did the most sensible thing available to it.
    bare: EXIT.OK,
  };

  for (const { label, args, cwd } of invocations()) {
    test(`${label}: exits with the code its failure class names`, () => {
      const r = runCli(args, { cwd });

      const want = expected[label] ?? (label.endsWith("--help") ? EXIT.OK : undefined);
      // The table has to stay exhaustive, or the sweep quietly stops covering whatever was
      // added last — the failure mode of every table-driven test.
      expect(want).toBeDefined();
      expect(r.exitCode).toBe(want as number);
      // And the codes must stay inside the documented alphabet: an exit 127 or a 255 from
      // a crashed process is not a failure class an agent can act on.
      expect(Object.values(EXIT) as number[]).toContain(r.exitCode);
    });
  }
});

describe("IN-11 — every non-zero exit emits a structured error", () => {
  for (const { label, args, cwd } of invocations()) {
    test(`${label}: a failure carries code, message and next_step`, () => {
      const r = runCli(args, { cwd });
      if (r.exitCode === EXIT.OK) return;

      const error = JSON.parse(r.stderr);
      for (const field of ERROR_FIELDS) {
        expect(typeof error[field]).toBe("string");
        expect(error[field].trim().length).toBeGreaterThan(0);
      }
      // `next_step` is the field that makes an error worth having, and the one that decays
      // into a restatement of the message. It has to name something to *do* — a command,
      // a flag, or a file — rather than describe the problem again.
      const nextStep = error.next_step as string;
      expect(
        nextStep.includes("cog-graphs") || nextStep.includes("--") || nextStep.includes(".yml"),
      ).toBe(true);
      // Codes are machine-readable identifiers, not sentences: an agent branches on them.
      expect(error.code).toMatch(/^[a-z][a-z0-9_]*$/);
    });
  }

  test("the recognized-options list in an unknown-option error is accurate", () => {
    // The one error whose text is itself a contract: it tells the agent what it may say
    // next, so a stale list sends it straight into a second failure.
    const g = spawnGraph({ namespace: "options" });

    const r = runCli(["query", "--graph", g.namespace, "--nonsense"], { cwd: g.cwd });

    expect(r.exitCode).toBe(EXIT.USAGE);
    const error = JSON.parse(r.stderr);
    const query = COMMANDS.find((c) => c.name === "query")!;
    // In `message`, which is the right home for it: the list says what would have been
    // acceptable, i.e. what went wrong. next_step points at the fuller answer.
    for (const flag of [...query.required, ...query.optional, ...GLOBAL_FLAGS]) {
      expect(error.message).toContain(flag);
    }
    expect(error.next_step).toContain("--help");
  });
});
