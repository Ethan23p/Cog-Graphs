// RU-7, judged over the error sweep. Paid: one claude-sonnet-5 call per error code, pennies
// each, so the whole sweep is well under a dollar.
//
//   bun run eval:errors                  judge every code the sweep provokes
//   bun run eval:errors entity_exists …  judge only the codes named
//
// MANUALLY INVOKED, BY DESIGN (Ethan, 2026-09-12): "let's just create a procedure for
// automatically checking the existing error codes … This procedure can be manually
// kicked-off after major updates to code or something." So this is not in `bun run check`
// and not in any loop. Run it after changing an error, adding a command, or touching the
// `next_step` strings — the sweep's own free test (testing/tests/error-sweep.test.ts) is
// what runs constantly, and it already fails the moment a code ships without a provocation.
//
// WHAT THE JUDGE IS SHOWN. One error, alone, exactly as an Operator meets it: the command,
// everything the program wrote, and that command's `--help`. No conversation, no agent, and
// not the setup that made the command fail — an Operator meeting this error would not have
// that either, and showing it would let the judge grade the sweep's staging instead of the
// error. Each error is its own call: a weak `next_step` cannot hide in a batch beside
// nineteen strong ones, and every verdict is attributable to one code.

import { mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { ERROR_RUBRIC } from "../rubrics/rubrics";
import { errorSweep, renderErrorView, unreachableCodes, type SweepEntry } from "./error-sweep";
import { judgeRubric } from "./judge";
import { createArtifactsDir } from "./report";
import type { Verdict } from "./rubric";

/** At most this many judge calls in flight. The calls are small; the rate limit is the cap. */
const CONCURRENCY = 4;

// renderErrorView lives in error-sweep.ts, beside the entries it renders: this file is a
// script whose body runs on import, so keeping the renderer here made importing it cost
// money. It did, once — $0.57 on 2026-09-12.

const wanted = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const entries = errorSweep().filter((e) => wanted.length === 0 || wanted.includes(e.code));
if (entries.length === 0) {
  console.error(
    wanted.length
      ? `eval:errors: the sweep provokes no such code: ${wanted.join(", ")}`
      : "eval:errors: the sweep provoked nothing at all, which is itself the bug.",
  );
  process.exit(2);
}

const declared = unreachableCodes();
const outDir = await createArtifactsDir("judge-errors");
const judgesDir = path.join(outDir, "judges");
mkdirSync(judgesDir);

interface Graded {
  entry: SweepEntry;
  verdict: Verdict | "error";
  rationale?: string;
  harnessIssue?: string | null;
  error?: string;
  attempts: number;
  costUsd: number;
}

const graded: Graded[] = [];
for (let i = 0; i < entries.length; i += CONCURRENCY) {
  const batch = entries.slice(i, i + CONCURRENCY);
  const done = await Promise.all(
    batch.map(async (entry) => {
      const view = renderErrorView(entry);
      writeFileSync(path.join(outDir, `view-${entry.code}.md`), view);
      const run = await judgeRubric(ERROR_RUBRIC, view);
      writeFileSync(path.join(judgesDir, `RU-7__${entry.code}.json`), JSON.stringify(run.messages, null, 2));
      const g: Graded = {
        entry,
        verdict: run.judgment?.verdict ?? "error",
        rationale: run.judgment?.rationale,
        harnessIssue: run.judgment?.harness_issue ?? null,
        error: run.error,
        attempts: run.attempts,
        costUsd: run.costUsd,
      };
      return g;
    }),
  );
  graded.push(...done);
}

console.log("");
let cost = 0;
let ok = true;
for (const g of graded) {
  cost += g.costUsd;
  // An error is never a pass, and neither is `unknown` — a judge that could not reach a
  // verdict over a single error has been shown something broken, not something acceptable.
  const passed = g.verdict === "pass";
  if (!passed) ok = false;
  const retried = g.attempts > 1 ? `  [${g.attempts} attempts: read this one]` : "";
  console.log(`[${passed ? "ok" : "FAIL"}] ${g.entry.code} — ${g.entry.label}: ${g.verdict}${retried}`);
  if (!passed) {
    console.log(`       $ ${g.entry.command}`);
    if (g.error) console.log(`       error: ${g.error}`);
    // The rationale is the whole value of a failure here: it says what an Operator could
    // not do with the string, which is the edit to make.
    if (g.rationale) console.log(`       ${g.rationale.replace(/\s+/g, " ").trim()}`);
  }
  if (g.harnessIssue) console.log(`       harness_issue: ${g.harnessIssue}`);
}

const skipped = Object.entries(declared);
if (skipped.length) {
  console.log(`\nnot judged, declared unreachable by the sweep:`);
  for (const [code, why] of skipped) console.log(`  ${code} — ${why}`);
}

writeFileSync(
  path.join(outDir, "judgments.json"),
  JSON.stringify(
    graded.map((g) => ({ code: g.entry.code, label: g.entry.label, command: g.entry.command, ...g, entry: undefined })),
    null,
    2,
  ),
);

const passed = graded.filter((g) => g.verdict === "pass").length;
console.log(`\nRU-7: ${passed}/${graded.length} errors carry a next_step worth reading — $${cost.toFixed(4)}`);
console.log(`artifacts: ${outDir}`);
process.exit(ok ? 0 : 1);
