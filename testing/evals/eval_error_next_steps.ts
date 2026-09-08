// RU-7 — the `next_step` carried by an error is actionable.
//
//   "it names a command or a concrete next move, not a restatement of the failure."
//
// IN-11 asserts the field is present and non-empty; this asserts it is worth reading.
//
// No agent in the loop: error copy is deterministic content, so the errors are
// produced directly and judged. That makes this the cheapest eval in the suite and,
// more importantly, lets it cover *every* failure class rather than whichever one
// happened to come up in a scenario transcript.
//
//   bun run eval:errors
//
// This is the spec's second layer. Never edited to fit the engine — see
// testing/DISPUTES.md.

import { EXIT, WITHHELD_FLAG } from "../tests/contract";
import {
  runCli,
  makeSandbox,
  sandboxWithGraph,
  initGraph,
  writeItemsFile,
  errorObject,
  shown,
} from "../tests/helpers";
import { judgeRubrics, type RubricCase } from "./eval-support";

/** One failure of every class the CLI can produce, with the error it emitted. */
function collectErrors(): { invocation: string; exitCode: number; error: unknown }[] {
  const out: { invocation: string; exitCode: number; error: unknown }[] = [];
  const record = (args: string[], cwd: string) => {
    const r = runCli(args, { cwd });
    if (r.exitCode === EXIT.OK) throw new Error(`expected a failure from: ${shown(args)}`);
    out.push({ invocation: shown(args), exitCode: r.exitCode, error: errorObject(r) });
  };

  const { dir, ns } = sandboxWithGraph();
  runCli(["add-item", "--graph", ns, "--entity", "alpha", "--attr", "type=doc"], { cwd: dir });

  record(["nonsense-command"], dir);
  record(["query", "--graph", ns, "--no-such-flag"], dir);
  record(["query", "--graph", ns, WITHHELD_FLAG], dir);
  record(["initialize"], dir); // missing a required flag
  record(["add-item", "--graph", ns, "--entity", "alpha", "--attr", "type=other"], dir); // already exists
  record(["modify-item", "--graph", ns, "--entity", "nonesuch", "--attr", "a=b"], dir); // not found
  record(["remove-item", "--graph", ns, "--entity", "nonesuch"], dir); // not found
  record(["query", "--graph", "no-such-graph"], dir); // not found

  // Ambiguous target: two graphs, no --graph.
  const many = makeSandbox();
  initGraph(many, { namespace: "graph-a" });
  initGraph(many, { namespace: "graph-b" });
  record(["query"], many);

  // Empty directory: nothing to operate on at all.
  record(["query"], makeSandbox());

  // Partial ingestion — the report an Operator has to act on to re-drive a batch.
  const { dir: bulkDir, ns: bulkNs } = sandboxWithGraph({ namespace: "bulk" });
  runCli(["add-item", "--graph", bulkNs, "--entity", "dup", "--attr", "a=b"], { cwd: bulkDir });
  const file = writeItemsFile(bulkDir, [
    { entity: "fresh-one", attributes: { a: "b" } },
    { entity: "dup", attributes: { a: "c" } },
  ]);
  record(["import", "--graph", bulkNs, "--from", file], bulkDir);

  return out;
}

const RUBRICS: RubricCase[] = [
  {
    id: "RU-7",
    question:
      "For EVERY error listed, does `next_step` name a command to run or a concrete move to make — as " +
      "opposed to restating the failure, apologising, or describing the problem again in other words? " +
      "Fail if even one next_step is a restatement.",
  },
  {
    id: "RU-7b",
    question:
      "Is each `next_step` correct for its specific error — pointing at the move that would actually " +
      "resolve that failure, using flags and command names consistent with the invocation shown? Fail if " +
      "any points somewhere unhelpful or names something that does not appear elsewhere in this evidence.",
  },
];

const errors = collectErrors();
console.error(`\n=== RU-7: judging ${errors.length} error objects ===`);

const verdict = await judgeRubrics({
  evidence: errors,
  preamble:
    "Below are failures produced by a CLI called cog-graphs, whose user is an AI agent rather than a human. " +
    "Each entry shows the invocation, its exit code, and the structured error object it emitted. The error " +
    "object's `next_step` field exists so the agent knows what to do next without guessing.",
  cases: RUBRICS,
});

console.error(`\nRU-7: ${verdict.pass ? "PASS" : "FAIL"}`);
process.exit(verdict.pass ? 0 : 1);
