// Shared support for the agentic evals: putting the binary on PATH, finding the
// graph an agent created, and the judge plumbing the rubric cases share.
//
// Nothing scenario-specific lives here, and nothing here imports the SDK — that
// stays in harness/runtime.ts and harness/judge.ts.

import { readdirSync, existsSync } from "node:fs";
import * as path from "node:path";
import { judge } from "../harness/runtime";

export const REPO_ROOT = path.resolve(import.meta.dir, "..", "..");

/**
 * In-loop model. The Operator is "the User's AI Assistant", about whose capability
 * the doc is explicit that we can presuppose nothing — so this is configurable, and
 * a scenario that only passes on the strongest model has not proven much.
 */
export const IN_LOOP_MODEL = process.env.COG_EVAL_MODEL ?? "claude-sonnet-5";

/**
 * Put `bin/` on PATH so the in-loop agent invokes `cog-graphs` the way an Operator
 * would. The runtime passes `process.env` through to the session, so mutating it
 * here reaches the agent's shell.
 */
export function putBinOnPath(): void {
  const bin = path.join(REPO_ROOT, "bin");
  if (!process.env.PATH?.split(path.delimiter).includes(bin)) {
    process.env.PATH = bin + path.delimiter + process.env.PATH;
  }
}

/** The Cog-Graphs plugin the Operator meets the system through (the v0.3.1 `skill.md`). */
export const PLUGIN_DIR = path.join(REPO_ROOT, "plugin");

/**
 * Red-first guard, matching the one in tests/helpers.ts. A scenario that loads a
 * plugin directory which does not exist fails somewhere inside the SDK, which reads
 * as a harness fault rather than as the missing deliverable it is.
 */
export function assertPluginExists(): void {
  if (!existsSync(PLUGIN_DIR)) {
    throw new Error(
      `plugin directory not found: ${PLUGIN_DIR}\n` +
        `v0.3.1 ships a lightweight skill.md there — the Operator's only introduction to the system. ` +
        `Until it exists, every eval that loads the plugin is expected to be RED.`,
    );
  }
}

/**
 * Find the graph an agent created, by its functional face. The namespace is
 * established conversationally, so evals cannot hardcode it — which is the point:
 * a gate that knew the namespace in advance would not be testing RU-1.
 */
export function findGraphs(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".sqlite"))
      .map((f) => f.slice(0, -".sqlite".length))
      .sort();
  } catch {
    return [];
  }
}

export interface RubricCase {
  id: string;
  /** What the judge is asked. Anchored: state the observable, not the vibe. */
  question: string;
}

export interface RubricVerdict {
  id: string;
  pass: boolean;
  reason: string;
}

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          pass: { type: "boolean" },
          reason: { type: "string" },
        },
        required: ["id", "pass", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["verdicts"],
  additionalProperties: false,
} as const;

/**
 * Judge a set of rubric cases against some evidence. Each case is scored
 * independently and reported by id, so a failure names which rubric failed and why
 * rather than collapsing to one opaque boolean.
 */
export async function judgeRubrics(args: {
  evidence: unknown;
  preamble: string;
  cases: readonly RubricCase[];
  model?: string;
}): Promise<{ pass: boolean; verdicts: RubricVerdict[] }> {
  const rubric = [
    args.preamble,
    "",
    "Score each numbered criterion independently. Answer only from the evidence provided;",
    "if the evidence does not exercise a criterion, fail it and say so — an unexercised",
    "criterion is not a passing one.",
    "",
    ...args.cases.map((c) => `- ${c.id}: ${c.question}`),
    "",
    "Return one verdict per criterion id, each with a one-sentence reason quoting or",
    "citing the specific evidence you relied on.",
  ].join("\n");

  const raw = (await judge({
    transcript: args.evidence,
    rubric,
    schema: VERDICT_SCHEMA as unknown as Record<string, unknown>,
    model: args.model,
  })) as { verdicts?: RubricVerdict[] };

  const verdicts = raw?.verdicts ?? [];
  // A missing verdict is a failure, not a silent pass: the judge skipping a
  // criterion must not read as the criterion holding.
  const byId = new Map(verdicts.map((v) => [v.id, v]));
  const complete = args.cases.map(
    (c) => byId.get(c.id) ?? { id: c.id, pass: false, reason: "judge returned no verdict for this criterion" },
  );
  for (const v of complete) console.error(`  [${v.pass ? "pass" : "FAIL"}] ${v.id}: ${v.reason}`);
  return { pass: complete.every((v) => v.pass), verdicts: complete };
}

/**
 * DE-24 ergonomics budget. Deliberately generous to start and tightened as the
 * numbers stabilise; it is the only standing guard on the doc's stated priority of
 * token efficiency, so it exists from the first run rather than being added later.
 */
export const ERGONOMICS_CEILING = {
  agentTurns: 60,
  toolCalls: 80,
  totalTokens: 400_000,
};

export function checkErgonomics(
  label: string,
  stats: { agentTurnsPerMessage: number[]; toolCallCount: number; totalInputTokens: number; totalOutputTokens: number },
): { pass: boolean; detail: string } {
  const agentTurns = stats.agentTurnsPerMessage.reduce((a, b) => a + b, 0);
  const tokens = stats.totalInputTokens + stats.totalOutputTokens;
  const over: string[] = [];
  if (agentTurns > ERGONOMICS_CEILING.agentTurns) over.push(`agent turns ${agentTurns} > ${ERGONOMICS_CEILING.agentTurns}`);
  if (stats.toolCallCount > ERGONOMICS_CEILING.toolCalls) over.push(`tool calls ${stats.toolCallCount} > ${ERGONOMICS_CEILING.toolCalls}`);
  if (tokens > ERGONOMICS_CEILING.totalTokens) over.push(`tokens ${tokens} > ${ERGONOMICS_CEILING.totalTokens}`);
  const detail = `${label}: ${agentTurns} agent turns, ${stats.toolCallCount} tool calls, ${tokens} tokens`;
  return { pass: over.length === 0, detail: over.length ? `${detail} — OVER: ${over.join("; ")}` : detail };
}
