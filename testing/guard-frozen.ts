// Freeze guard: proves no green case moved under the engine.
//
//   bun run guard              # working tree + index vs HEAD
//   bun run guard --since <ref>  # everything since <ref>, e.g. the branch point
//
// WHY THIS EXISTS
// "Tests and evals are never edited to fit the implementation" is a non-negotiable, and
// it is the one rule an amnesiac cannot self-enforce: a build agent that has forgotten
// why a case is worded the way it is will experience an inconvenient assertion as a
// typo. So the rule is mechanical rather than remembered.
//
// THE RULE: FROZEN FILES ARE APPEND-ONLY.
// The vertical loop adds one case per slice, so a test file legitimately grows all the
// time — whole-file hashing would flag every honest slice and teach the agent to ignore
// the guard. What must never happen is an *existing* line changing. So the guard reads
// the diff and rejects removals. Adding a case is free; touching a green one is not.
//
// WHAT IS FROZEN, AND WHAT IS NOT
// Frozen: the assertions and the contract they read from. Not frozen: `helpers.ts` and
// everything under `harness/`. Those are mechanism, not spec — a build agent that needs
// a new helper or a missing runtime feature should add one, and the harness design
// explicitly calls for extending the runtime rather than working around it.

import { spawnSync } from "node:child_process";
import * as path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dir, "..");

/** Pathspecs for the spec's second layer. */
const FROZEN_PATHS = ["testing/tests/*.test.ts", "testing/tests/contract.ts", "testing/evals/*.ts"];

function git(args: string[]): string {
  const r = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
  if (r.status !== 0 && r.stderr) throw new Error(`git ${args.join(" ")}: ${r.stderr.trim()}`);
  return r.stdout ?? "";
}

const sinceFlag = process.argv.indexOf("--since");
const base = sinceFlag !== -1 ? process.argv[sinceFlag + 1] : "HEAD";
if (sinceFlag !== -1 && !base) {
  console.error("guard: --since needs a ref");
  process.exit(2);
}

// --unified=0 keeps context lines out, so every '-' line is a real removal.
const diff = git(["diff", "--unified=0", base, "--", ...FROZEN_PATHS]);

interface Violation {
  file: string;
  line: string;
}
const violations: Violation[] = [];
const touched = new Set<string>();
let file = "";
let isNewFile = false;

for (const line of diff.split("\n")) {
  if (line.startsWith("+++ ")) {
    file = line.slice(4).replace(/^b\//, "");
    if (file !== "/dev/null") touched.add(file);
    continue;
  }
  // A file added in this range has no prior content, so nothing in it can be a removal.
  if (line.startsWith("--- ")) {
    isNewFile = line.slice(4).trim() === "/dev/null";
    continue;
  }
  if (isNewFile) continue;
  if (line.startsWith("-") && !line.startsWith("---")) {
    violations.push({ file, line: line.slice(1) });
  }
}

if (touched.size === 0) {
  console.log(`guard: no frozen files changed since ${base}.`);
  process.exit(0);
}

if (violations.length === 0) {
  console.log(`guard: ${touched.size} frozen file(s) changed since ${base}, append-only. OK.`);
  for (const f of touched) console.log(`  appended  ${f}`);
  process.exit(0);
}

console.error(`guard: ${violations.length} line(s) removed from frozen files since ${base}.\n`);
for (const v of violations) {
  console.error(`  ${v.file}`);
  console.error(`    - ${v.line.trim().slice(0, 100)}`);
}
console.error(
  `\nA green case that looks wrong is a DISPUTES.md entry, not an edit. If Ethan has already\n` +
    `resolved it, land the amendment in the same commit as the resolution, so the history shows\n` +
    `the case changed by decision and not by drift.`,
);
process.exit(1);
