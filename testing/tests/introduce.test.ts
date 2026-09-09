import { describe, expect, test } from "bun:test";
import { makeSandbox, runCli } from "./helpers";
import { EXIT, INTRO_SCOPE } from "./contract";
import { BIN, WALKING_SKELETON_COMMANDS } from "./contract";
import { spawnGraph } from "./helpers";

describe("DE-1 — introduce with no instance present", () => {
  // The doc: introduce returns an introduction to this instantiation, "unless there's no
  // instantiation to be found, in which case it introduces this system and how to use
  // it". An empty directory is the first thing an Operator meets, so erroring there
  // would put a wall exactly where the self-documentation is supposed to start.
  test("returns the system introduction rather than erroring", () => {
    const cwd = makeSandbox();

    const r = runCli(["introduce"], { cwd });

    expect(r.exitCode).toBe(EXIT.OK);
    const payload = JSON.parse(r.stdout);
    expect(payload.scope).toBe(INTRO_SCOPE.SYSTEM);
    // "how to use it" is the load-bearing half: an introduction that does not point at
    // the first command leaves the Operator to guess it.
    expect(payload.introduction).toContain("initialize");
  });
});

describe("DE-2 — introduce --interface-skill", () => {
  // The doc: the flag exists "specifically for instances in which the external AI Agent
  // needs to operate the CLI directly", and it "includes all relevant information for
  // initializing and using a Cog-Graph". A primer that omits a command the scenario
  // needs sends the Operator back to guessing, which is the failure the flag exists to
  // prevent. The assertion is on the invocation form rather than the bare word, so a
  // primer that merely mentions "query" in prose does not pass for one that shows how
  // to run it.
  test("returns non-empty primer content naming every Walking Skeleton command", () => {
    const cwd = makeSandbox();

    const r = runCli(["introduce", "--interface-skill"], { cwd });

    expect(r.exitCode).toBe(EXIT.OK);
    const payload = JSON.parse(r.stdout);
    expect(typeof payload.primer).toBe("string");
    expect(payload.primer.trim().length).toBeGreaterThan(0);
    for (const command of WALKING_SKELETON_COMMANDS) {
      expect(payload.primer).toContain(BIN + " " + command);
    }
  });
});

describe("DE-19.1 (minted) — introduce against an existing graph", () => {
  // MINTED at the DE-17 → DE-19 boundary, found by /code-review. The engine accepted
  // --graph, listed it in help, and ignored it: in a directory holding the graph, it
  // returned exit 0 and "There is no Cog Graph here yet."
  //
  // DE-1 pins only the empty-directory half, so the doc's actual sentence — introduce
  // returns an introduction to *this instantiation*, "unless there's no instantiation to
  // be found" — was graded on the exception and not the rule. The rule is the Walking
  // Skeleton's seventh step: a fresh thread, no shared context, same working directory.
  // An introduction that denies the graph exists is worse than an error there, because
  // the cold agent believes it and starts over.
  //
  // contract.ts has declared INTRO_SCOPE.INSTANCE since day one and nothing ever emitted
  // it. That is the shape of this kind of hole: the contract knew, and no case asked.
  const description = "Games Ethan has played and what he thought of them.";
  const convention = "Every game carries a status and a taste-alignment.";

  test("returns the instance introduction, not the system one", () => {
    const { cwd, namespace } = spawnGraph({ namespace: "de191", description, convention });

    const r = runCli(["introduce", "--graph", namespace], { cwd });

    expect(r.exitCode).toBe(EXIT.OK);
    const payload = JSON.parse(r.stdout);
    expect(payload.scope).toBe(INTRO_SCOPE.INSTANCE);
    expect(payload.graph).toBe(namespace);
  });

  test("says what the graph is for and what convention it keeps", () => {
    const { cwd, namespace } = spawnGraph({ namespace: "de191b", description, convention });
    runCli(["add-item", "--graph", namespace, "--entity", "Tunic", "--attr", "status=backlog"], {
      cwd,
    });

    const payload = JSON.parse(runCli(["introduce", "--graph", namespace], { cwd }).stdout);

    // The description is the User's own words about the graph's purpose, and the
    // convention is the shape it expects. Together they are what a cold agent needs
    // before it touches anything — without them it will invent its own attribute names
    // beside the established ones, and the graph degrades quietly.
    const text = JSON.stringify(payload);
    expect(text).toContain(description);
    expect(text).toContain(convention);
  });

  test("resolves the sole graph in the directory without being named", () => {
    // The cold thread arrives with a working directory and nothing else. Requiring it to
    // already know the namespace to be told the namespace is a closed loop.
    const { cwd, namespace } = spawnGraph({ namespace: "de191c", description, convention });

    const payload = JSON.parse(runCli(["introduce"], { cwd }).stdout);

    expect(payload.scope).toBe(INTRO_SCOPE.INSTANCE);
    expect(payload.graph).toBe(namespace);
  });
});
