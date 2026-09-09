import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { runCli, spawnGraph, writeProfileYml } from "./helpers";
import { COMMANDS, EXIT, GLOBAL_FLAGS } from "./contract";

// DE-19.6.1 (minted) — the missing-value rule, swept somewhere it can actually be
// reached.
//
// Found by /code-review. DE-19.6's third case sweeps every value-taking flag on every
// command and asserts only `exitCode !== 0` and non-empty stderr — in an *empty* sandbox,
// where almost every row fails long before the option parser is reached. Verified, one
// line per row: `query --attr`, `query --exclude` and `add-item --entity` return
// `no_graph_here`; `add-item --attr`, `modify-item --attr` and `initialize --dir` return
// `missing_option`; `import --from` and `convention --append` return `not_implemented`.
// Not one returns `missing_value`. Every assertion in it held against the pre-fix engine
// too, so the case's stated purpose — that a flag added later inherits the rule rather
// than quietly reintroducing the bug — was not served by it.
//
// DE-19.6 is green and frozen, and it stays exactly as it is; this is the case it meant
// to be. The lesson is worth writing down: a sweep that only asserts "something failed"
// is not a sweep, because there are always other reasons to fail, and the likeliest one
// fires first.
describe("DE-19.6.1 (minted) — every value-taking flag reaches the missing-value rule", () => {
  // Derived from the CLI rather than from a literal, so the set empties itself as commands
  // land. This is the shape DE-19.3 claimed to have and does not — see DISPUTES.md; doing
  // it here shows the technique works.
  function unbuiltCommands(cwd: string): Set<string> {
    const unbuilt = new Set<string>();
    for (const command of COMMANDS) {
      const help = JSON.parse(runCli([command.name, "--help"], { cwd }).stdout);
      if (help.status === "not_implemented") unbuilt.add(command.name);
    }
    return unbuilt;
  }

  // The context each command needs in order to get as far as reading its options: a graph
  // to resolve, and a value for every *other* required flag. Without this the command
  // fails on something earlier and the sweep proves nothing, which is the whole defect.
  function baseArgs(command: string, profilePath: string): string[] {
    switch (command) {
      case "initialize":
        return ["--profile", profilePath];
      case "add-item":
      case "modify-item":
      case "remove-item":
        return ["--entity", "Sword"];
      default:
        return [];
    }
  }

  test("the sweep reaches the parser, and the whole grammar obeys the rule", () => {
    // One graph in the directory, so --graph resolves and `no_graph_here` cannot mask the
    // answer; the flag under test always goes last, so nothing follows it.
    const g = spawnGraph({ namespace: "sweep" });
    const profilePath = path.join(g.cwd, "sweep.yml");
    writeProfileYml(
      profilePath,
      { namespace: "other", "use-pattern": "manual", description: "For the sweep." },
      "Every entity carries a status.",
    );
    const booleans = new Set<string>(["--interface-skill", ...GLOBAL_FLAGS]);
    const unbuilt = unbuiltCommands(g.cwd);

    const checked: string[] = [];
    for (const command of COMMANDS) {
      // An unbuilt command answers `not_implemented` before it parses anything, and
      // correctly so (DE-19.3). It joins this sweep when it lands.
      if (unbuilt.has(command.name)) continue;

      for (const flag of [...command.required, ...command.optional]) {
        if (booleans.has(flag)) continue;
        const base = baseArgs(command.name, profilePath).filter(
          (_, i, all) => all[i] !== flag && all[i - 1] !== flag,
        );

        const r = runCli([command.name, ...base, flag], { cwd: g.cwd });

        const label = `${command.name} ${flag}`;
        expect(r.exitCode, label).toBe(EXIT.USAGE);
        const error = JSON.parse(r.stderr);
        expect(error.code, label).toBe("missing_value");
        expect(error.message, label).toContain(flag);
        checked.push(label);
      }
    }

    // The sweep has to be seen to have swept. A silently empty loop is the other way a
    // table-driven case reports success without testing anything.
    expect(checked.length).toBeGreaterThanOrEqual(8);
  });
});
