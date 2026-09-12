// The rubric layer's offline judge (testing/rubrics/DRAFTS.md). Paid: one claude-sonnet-5
// call per rubric per conversation, pennies each. No agent runs.
//
//   bun run eval:judge --references [RU-1 …]   calibrate: judge every reference pair, and
//                                               fail unless each verdict matches its label
//   bun run eval:judge <artifact dir> [RU-1 …]  judge a stored run against the rubrics whose
//                                               scenario it is (or the ones named)
//   bun run eval:judge --scenario <name> --last <k> [RU-…]
//                                               judge the k most recent stored runs of one
//                                               scenario, and pass only if every one passes
//
// The third form is what pass^k means (Anthropic, "Demystifying evals for AI agents"): a
// trial is one attempt at the task graded by *all* of its graders, and pass^k is the
// probability that all k trials succeed. RU-3 is scored pass^3, and until 2026-09-12 only
// its deterministic gates ran three times while the judge ran once — so the thing scored
// pass^3 was the gates, not the case. The scenario file is frozen and ends in process.exit,
// so the judging cannot be appended to it; it belongs here, where the stored runs are.
//
// Every view, judgment and judge session is written under testing/artifacts/judge-<stamp>/,
// so a verdict can be read against exactly what the judge was shown. An error is never a
// pass, and `unknown` is reported apart from `fail`. A judge's harness_issue is printed in
// full: it is the judge telling us the test itself looks broken.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { RUBRICS } from "../rubrics/rubrics";
import { LABELS, REFERENCES } from "../rubrics/references";
import { renderJudgeView } from "./judge-view";
import { judgeRubric, type JudgeRun } from "./judge";
import { buildReference } from "./reference";
import { createArtifactsDir, type RunRecord } from "./report";
import type { Judgment, Rubric, Verdict } from "./rubric";

const ARTIFACTS_ROOT = path.resolve(import.meta.dir, "..", "artifacts");

interface Task {
  rubric: Rubric;
  conversation: string;
  view: string;
  expected?: Exclude<Verdict, "unknown">;
}

const args = process.argv.slice(2);
const named = args.filter((a) => /^RU-/.test(a));
const pick = (r: Rubric) => named.length === 0 || named.includes(r.id);
const unknownIds = named.filter((id) => !RUBRICS.some((r) => r.id === id));
if (unknownIds.length) {
  console.error(`eval:judge: no such rubric: ${unknownIds.join(", ")}`);
  process.exit(2);
}

/** A flag's value, and the values themselves so they are never mistaken for a directory. */
const flagValues = new Set<string>();
function flag(name: string): string | undefined {
  const at = args.indexOf(name);
  if (at === -1) return undefined;
  const value = args[at + 1];
  if (value === undefined || value.startsWith("--")) {
    console.error(`eval:judge: ${name} needs a value`);
    process.exit(2);
  }
  flagValues.add(value);
  return value;
}

const scenario = flag("--scenario");
const lastRaw = flag("--last");
const trials = lastRaw === undefined ? 1 : Number(lastRaw);
if (lastRaw !== undefined && (!Number.isInteger(trials) || trials < 1)) {
  console.error(`eval:judge: --last takes a whole number of trials, not "${lastRaw}"`);
  process.exit(2);
}

/**
 * The k most recent stored runs of one scenario, newest first. The scenario is read from
 * each run's own run.json rather than from the directory name, so a renamed or re-stamped
 * directory cannot quietly enter or leave a pass^k batch.
 */
function recentRuns(name: string, k: number): string[] {
  if (!existsSync(ARTIFACTS_ROOT)) return [];
  const dirs = readdirSync(ARTIFACTS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(ARTIFACTS_ROOT, d.name))
    .filter((dir) => {
      const record = path.join(dir, "run.json");
      if (!existsSync(record)) return false;
      try {
        return (JSON.parse(readFileSync(record, "utf8")) as RunRecord).scenario === name;
      } catch {
        return false;
      }
    })
    // The stamp is in the directory name and is ISO-8601, so a lexical sort is chronological.
    .sort((a, b) => path.basename(b).localeCompare(path.basename(a)));
  return dirs.slice(0, k);
}

const tasks: Task[] = [];
let outDir: string;

if (args.includes("--references")) {
  outDir = await createArtifactsDir("judge-references");
  // Kept, like every sandbox: a surprising verdict is only diagnosable from what it read.
  const workspaces = path.join(homedir(), "cog-graph-workspaces");
  mkdirSync(workspaces, { recursive: true });
  const views = new Map<string, string>();
  for (const ref of REFERENCES) {
    if (!LABELS.some((l) => l.reference === ref.id && pick(RUBRICS.find((r) => r.id === l.rubric)!))) continue;
    const artifacts = path.join(outDir, ref.id);
    mkdirSync(artifacts);
    buildReference(ref, mkdtempSync(path.join(workspaces, `reference-${ref.id}-`)), artifacts);
    const view = renderJudgeView(artifacts);
    writeFileSync(path.join(artifacts, "view.md"), view);
    views.set(ref.id, view);
  }
  for (const label of LABELS) {
    const rubric = RUBRICS.find((r) => r.id === label.rubric)!;
    if (!pick(rubric)) continue;
    tasks.push({ rubric, conversation: label.reference, view: views.get(label.reference)!, expected: label.expected });
  }
} else if (scenario) {
  const runDirs = recentRuns(scenario, trials);
  if (runDirs.length < trials) {
    // Never silently judge fewer trials than were asked for: pass^3 over two trials is not
    // pass^3, and reporting it as a pass would be the eval lying about its own score.
    console.error(
      `eval:judge: asked for ${trials} trial(s) of "${scenario}" but only ${runDirs.length} stored run(s) exist. ` +
        `Run the scenario first.`,
    );
    process.exit(1);
  }
  outDir = await createArtifactsDir(`judge-${scenario}-last${trials}`);
  const rubrics = RUBRICS.filter((r) => (named.length ? pick(r) : r.scenarios.includes(scenario)));
  if (rubrics.length === 0) {
    console.error(`eval:judge: no rubric covers scenario "${scenario}"; name one to judge it anyway.`);
    process.exit(1);
  }
  for (const dir of runDirs) {
    const view = renderJudgeView(dir);
    const trial = path.basename(path.resolve(dir));
    writeFileSync(path.join(outDir, `view-${trial}.md`), view);
    for (const rubric of rubrics) tasks.push({ rubric, conversation: trial, view });
  }
} else {
  const runDir = args.find((a) => !/^(RU-|--)/.test(a) && !flagValues.has(a));
  if (!runDir) {
    console.error(
      "usage: bun run eval:judge --references [RU-…]\n" +
        "       bun run eval:judge <artifact dir> [RU-…]\n" +
        "       bun run eval:judge --scenario <name> --last <k> [RU-…]",
    );
    process.exit(1);
  }
  const view = renderJudgeView(runDir);
  const run = JSON.parse(readFileSync(path.join(runDir, "run.json"), "utf8")) as RunRecord;
  outDir = await createArtifactsDir(`judge-${path.basename(path.resolve(runDir))}`);
  writeFileSync(path.join(outDir, "view.md"), view);
  const rubrics = RUBRICS.filter((r) => (named.length ? pick(r) : r.scenarios.includes(run.scenario)));
  if (rubrics.length === 0) {
    console.error(`eval:judge: no rubric covers scenario "${run.scenario}"; name one to judge it anyway.`);
    process.exit(1);
  }
  for (const rubric of rubrics) tasks.push({ rubric, conversation: path.basename(path.resolve(runDir)), view });
}

const judgesDir = path.join(outDir, "judges");
mkdirSync(judgesDir);
const results = await Promise.all(
  tasks.map(async (t) => {
    const run: JudgeRun = await judgeRubric(t.rubric, t.view);
    // The judge's own session, whole: what it wrote, and why a failed one failed.
    writeFileSync(path.join(judgesDir, `${t.rubric.id}__${t.conversation}.json`), JSON.stringify(run.messages, null, 2));
    return { ...t, ...run };
  }),
);

let ok = true;
let cost = 0;
console.log("");
for (const r of results) {
  const verdict: Verdict | "error" = r.judgment?.verdict ?? "error";
  cost += r.costUsd;
  const good = r.expected ? verdict === r.expected : verdict === "pass";
  if (!good) ok = false;
  const expect = r.expected ? ` (expected ${r.expected})` : "";
  const retried = r.attempts > 1 ? `  [${r.attempts} attempts: read this one]` : "";
  console.log(`[${good ? "ok" : "MISS"}] ${r.rubric.id} × ${r.conversation}: ${verdict}${expect}${retried}`);
  if (r.error) console.log(`       error: ${r.error}`);
  if (r.judgment?.harness_issue) console.log(`       harness_issue: ${r.judgment.harness_issue}`);
  for (const q of r.judgment ? unfoundQuotes(r.judgment, r.view) : []) {
    console.log(`       quote not in the view: "${q.slice(0, 100)}"`);
  }
}
const unknowns = results.filter((r) => r.judgment?.verdict === "unknown");
if (unknowns.length) {
  console.log(`\n${unknowns.length} unknown (never a pass): ${unknowns.map((r) => `${r.rubric.id} × ${r.conversation}`).join(", ")}`);
}

// pass^k: a trial counts only when every rubric judged over it passed, and the score is the
// number of trials where that held. Reported as k/k because that is the claim being made.
if (scenario) {
  const byTrial = new Map<string, boolean>();
  for (const r of results) {
    const passed = r.judgment?.verdict === "pass";
    byTrial.set(r.conversation, (byTrial.get(r.conversation) ?? true) && passed);
  }
  const passed = [...byTrial.values()].filter(Boolean).length;
  console.log(`\n${scenario} pass^${trials}: ${passed}/${trials} trial(s) judged pass`);
}

writeFileSync(
  path.join(outDir, "judgments.json"),
  JSON.stringify(
    results.map(({ view: _view, messages: _messages, rubric, ...rest }) => ({ rubric: rubric.id, ...rest })),
    null,
    2,
  ),
);
console.log(`\ncost $${cost.toFixed(4)} across ${results.length} judge call(s)`);
console.log(`artifacts: ${outDir}`);
process.exit(ok ? 0 : 1);

/** Quotes the judge gave that the view does not contain, whitespace aside: worth reading, not a failure. */
function unfoundQuotes(j: Judgment, view: string): string[] {
  const flat = (s: string) => s.replace(/\s+/g, " ").trim();
  const haystack = flat(view);
  return j.quotes.filter((q) => !haystack.includes(flat(q).replace(/^(\.\.\.|…)|(\.\.\.|…)$/g, "").trim()));
}
