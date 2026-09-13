// S4 — the error sweep RU-7 is judged over (docs/3.1/dev-loop.md, "Rubric layer").
//
// Every error code the engine can raise, provoked once by direct invocation, with exactly
// what an Operator meeting it would have in front of them: the command they ran, the whole
// error, and that command's `--help`. No live agent is involved — RU-7's claim is about the
// error's text, and putting an agent in front of it would grade the agent instead.
//
// Each provocation is written to produce its code and nothing else. Where a code needs a
// prepared graph or file, the preparation happens here and is not part of what the judge
// sees: the judge is shown the failing invocation, not the setup that made it fail.
//
// Coverage is asserted for free in testing/tests/error-sweep.test.ts, against the engine's own
// error registry (engine/errors.ts), so a code added to the engine cannot ship ungraded.

import { mkdtempSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { mkdirSync } from "node:fs";

const REPO_ROOT = path.resolve(import.meta.dir, "..", "..");
const CLI_ENTRY = process.env.COG_CLI_ENTRY ?? path.join(REPO_ROOT, "engine", "main.ts");

export interface SweepEntry {
  /** The error code this invocation provokes. */
  code: string;
  /** A short name for the situation, for reports. */
  label: string;
  /** The command as an Operator would have typed it. */
  command: string;
  exitCode: number;
  /** The whole of what the engine wrote to stderr. */
  error: string;
  /** The `--help` of the command that failed: what an Operator meeting this has to hand. */
  help: string;
}

function run(argv: string[], cwd: string): { stdout: string; stderr: string; exitCode: number } {
  const proc = Bun.spawnSync(["bun", CLI_ENTRY, ...argv], { cwd, env: { ...process.env }, stdout: "pipe", stderr: "pipe" });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? -1 };
}

function profileYml(dir: string, name: string, body: string): string {
  const file = path.join(dir, name);
  writeFileSync(file, body);
  return file;
}

function spawnGraph(dir: string, namespace: string): void {
  const file = profileYml(
    dir,
    `${namespace}.profile.yml`,
    `profile:\n  namespace: ${namespace}\n  description: A graph for provoking errors.\nconvention: Every item carries a status.\n`,
  );
  const r = run(["initialize", "--profile", file], dir);
  if (r.exitCode !== 0) throw new Error(`sweep setup: initialize failed (${r.exitCode}): ${r.stderr}`);
}

/**
 * A sandbox outside the platform temp root, for the same reason the paid scenarios use one:
 * under the temp root the engine warns that the graph will vanish (DE-7), and a warning that
 * exists only because of the harness would land in front of the judge as part of the error.
 */
function sandbox(name: string): string {
  const root = path.join(homedir(), "cog-graph-workspaces");
  mkdirSync(root, { recursive: true });
  return mkdtempSync(path.join(root, `error-sweep-${name}-`));
}

interface Provocation {
  code: string;
  label: string;
  /** Prepares a directory and returns the argv that fails in it. */
  setUp: (dir: string) => string[];
}

const PROVOCATIONS: Provocation[] = [
  { code: "unknown_option", label: "an option before any command", setUp: () => ["--nonsense"] },
  { code: "unknown_command", label: "a command that does not exist", setUp: () => ["frobnicate"] },
  { code: "missing_option", label: "a command missing a required option", setUp: () => ["initialize"] },
  { code: "missing_value", label: "a flag with no value after it", setUp: () => ["query", "--graph"] },
  {
    code: "profile_not_found",
    label: "initialize pointed at a profile that is not there",
    setUp: () => ["initialize", "--profile", "./nowhere.yml"],
  },
  {
    code: "profile_unparseable",
    label: "a profile that is not YAML the engine can read",
    setUp: (dir) => ["initialize", "--profile", profileYml(dir, "broken.yml", "profile: [this is: not, valid\n")],
  },
  {
    code: "profile_incomplete",
    label: "a profile missing a field the graph needs",
    setUp: (dir) => [
      "initialize",
      "--profile",
      profileYml(dir, "incomplete.yml", "profile:\n  namespace: notes\nconvention: Every item carries a status.\n"),
    ],
  },
  {
    code: "convention_missing",
    label: "a profile with no convention at all",
    setUp: (dir) => [
      "initialize",
      "--profile",
      profileYml(dir, "no-convention.yml", "profile:\n  namespace: notes\n  description: Notes I keep.\n"),
    ],
  },
  {
    code: "invalid_namespace",
    label: "a namespace that cannot be a filename",
    setUp: (dir) => [
      "initialize",
      "--profile",
      profileYml(
        dir,
        "bad-namespace.yml",
        `profile:\n  namespace: "notes/2026"\n  description: Notes I keep.\nconvention: Every item carries a status.\n`,
      ),
    ],
  },
  {
    code: "directory_not_found",
    label: "initialize aimed at a directory that does not exist",
    setUp: (dir) => [
      "initialize",
      "--profile",
      profileYml(
        dir,
        "somewhere.yml",
        "profile:\n  namespace: notes\n  description: Notes I keep.\nconvention: Every item carries a status.\n",
      ),
      // A whole missing tree, not one missing level: one new directory under one that
      // exists is made for the Operator, with a warning (DE-7.1).
      "--dir",
      "./no-such-directory/deeper",
    ],
  },
  {
    code: "artifact_exists",
    label: "initialize over a graph that is already there",
    setUp: (dir) => {
      spawnGraph(dir, "notes");
      return ["initialize", "--profile", path.join(dir, "notes.profile.yml")];
    },
  },
  {
    code: "graph_not_found",
    label: "a graph named that is not in this directory",
    setUp: (dir) => {
      spawnGraph(dir, "notes");
      return ["query", "--graph", "no-such-graph"];
    },
  },
  { code: "no_graph_here", label: "a command run where there is no graph", setUp: () => ["query"] },
  {
    code: "ambiguous_graph",
    label: "two graphs in the directory and no --graph",
    setUp: (dir) => {
      spawnGraph(dir, "notes");
      spawnGraph(dir, "books");
      return ["query"];
    },
  },
  {
    code: "malformed_attribute",
    label: "an --attr that is not key=value",
    setUp: (dir) => {
      spawnGraph(dir, "notes");
      return ["add-item", "--graph", "notes", "--entity", "First item", "--attr", "novalue"];
    },
  },
  {
    code: "entity_exists",
    label: "add-item on an entity the graph already holds",
    setUp: (dir) => {
      spawnGraph(dir, "notes");
      run(["add-item", "--graph", "notes", "--entity", "First item", "--attr", "status=open"], dir);
      return ["add-item", "--graph", "notes", "--entity", "First item", "--attr", "status=done"];
    },
  },
  {
    code: "entity_not_found",
    label: "modify-item on an entity that is not there",
    setUp: (dir) => {
      spawnGraph(dir, "notes");
      return ["modify-item", "--graph", "notes", "--entity", "Ghost", "--attr", "status=done"];
    },
  },
  {
    code: "source_not_found",
    label: "import from a file that is not there",
    setUp: (dir) => {
      spawnGraph(dir, "notes");
      return ["import", "--graph", "notes", "--from", "./nowhere.yml"];
    },
  },
  {
    code: "source_unparseable",
    label: "import from a file the engine cannot read as items",
    setUp: (dir) => {
      spawnGraph(dir, "notes");
      writeFileSync(path.join(dir, "items.yml"), "items: [not, a, list, of: records\n");
      return ["import", "--graph", "notes", "--from", "./items.yml"];
    },
  },
  {
    code: "partial_ingestion",
    label: "an import where some records are good and some are not",
    setUp: (dir) => {
      spawnGraph(dir, "notes");
      run(["add-item", "--graph", "notes", "--entity", "First item", "--attr", "status=open"], dir);
      writeFileSync(
        path.join(dir, "batch.yml"),
        `items:\n  - entity: "Second item"\n    attributes:\n      status: "open"\n  - entity: "First item"\n    attributes:\n      status: "done"\n`,
      );
      return ["import", "--graph", "notes", "--from", "./batch.yml"];
    },
  },
  {
    code: "not_implemented",
    label: "a command the help documents but this build does not have",
    setUp: () => {
      // Derived from the CLI, never from a literal: DE-19.3's resolution. When nothing is
      // unbuilt this provocation has no invocation, and the sweep says so by omitting it —
      // which is also why the free test derives its expectations from the engine's registry.
      return [];
    },
  },
];

/** Which commands `--help` covers, for the entry's help text. `--help` itself for a bare failure. */
function helpFor(argv: string[], dir: string): string {
  const command = argv.find((a) => !a.startsWith("--"));
  const r = command ? run([command, "--help"], dir) : { stdout: "", exitCode: 1, stderr: "" };
  return r.exitCode === 0 && r.stdout.trim().length > 0 ? r.stdout : run(["--help"], dir).stdout;
}

/** Ask the CLI which commands it documents but has not built (DE-19.3's derivation). */
function unbuiltCommand(dir: string): string | undefined {
  const overview = JSON.parse(run(["--help"], dir).stdout || "{}") as { commands?: { name: string }[] };
  for (const { name } of overview.commands ?? []) {
    const help = JSON.parse(run([name, "--help"], dir).stdout || "{}") as { status?: string };
    if (help.status === "not_implemented") return name;
  }
  return undefined;
}

/**
 * Codes the engine can name that this sweep deliberately has no entry for, with why. The
 * free test reads this rather than a list of its own: a gap that has to be declared here,
 * in the sweep, is a gap a reviewer sees.
 */
export function unreachableCodes(): Record<string, string> {
  const dir = sandbox("unreachable");
  const out: Record<string, string> = {};
  if (!unbuiltCommand(dir)) {
    out.not_implemented =
      "Every command this build documents is implemented, so nothing can provoke it. Asked of the CLI, never a literal (DE-19.3).";
  }
  return out;
}

/**
 * One error as RU-7's judge reads it: the three things an Operator has, in the order they
 * meet them, and nothing of ours around them. The setup that made the command fail is
 * deliberately absent, because an Operator meeting the error would not have it either.
 *
 * It lives here, beside SweepEntry, rather than in eval-errors.ts, because that file is a
 * script: its body runs on import, so importing it to render one view spends money. That is
 * not hypothetical — it happened on 2026-09-12 and cost $0.57.
 */
export function renderErrorView(entry: SweepEntry): string {
  return [
    `# One error from cog-graphs`,
    ``,
    `An Operator ran a command and it failed. Below is everything they have: what they ran,`,
    `what the program wrote, and the \`--help\` of the command that failed.`,
    ``,
    `## What was run`,
    ``,
    "```",
    entry.command,
    "```",
    ``,
    `It exited with status ${entry.exitCode}.`,
    ``,
    `## What the program wrote`,
    ``,
    "```json",
    entry.error,
    "```",
    ``,
    `## \`--help\` for that command`,
    ``,
    "```json",
    entry.help,
    "```",
    ``,
  ].join("\n");
}

let cached: SweepEntry[] | undefined;

/**
 * Every provoked error, once. Cached: the sweep spawns a few dozen subprocesses, and both the
 * free test and the judge run want the same entries.
 */
export function errorSweep(): SweepEntry[] {
  if (cached) return cached;
  const entries: SweepEntry[] = [];
  for (const provocation of PROVOCATIONS) {
    const dir = sandbox(provocation.code);
    let argv = provocation.setUp(dir);
    if (provocation.code === "not_implemented") {
      const name = unbuiltCommand(dir);
      if (!name) continue; // Nothing is unbuilt in this build; the free test derives the same answer.
      argv = [name];
    }
    const r = run(argv, dir);
    entries.push({
      code: provocation.code,
      label: provocation.label,
      command: `cog-graphs ${argv.join(" ")}`,
      exitCode: r.exitCode,
      error: r.stderr.trim(),
      help: helpFor(argv, dir).trim(),
    });
  }
  cached = entries;
  return entries;
}
