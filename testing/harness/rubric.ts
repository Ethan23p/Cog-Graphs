// The rubric layer's shapes and the words a judge is given (S2 in testing/rubrics/DRAFTS.md).
//
// SDK-free, so what a judge reads, and how its answer is read back, can be inspected and
// tested without a paid call; judge.ts is where it is sent. Rubric content lives in
// testing/rubrics/rubrics.ts and is frozen once green; this file is mechanism.

export type RubricId = `RU-${string}`;

/**
 * One RU case, as the judge sees it. Every field is prose for the judge: the claim, the
 * intent in the design doc's own terms, which part of the conversation it is about, what to
 * weigh, and the failure it guards against. None of them is a checklist.
 */
export interface Rubric {
  id: RubricId;
  claim: string;
  intent: string;
  material: string;
  weigh: string;
  antiPattern: string;
  /** Anything the judge must know about this version of the system, e.g. what v0.3.1 leaves out. */
  note?: string;
  /** The scenarios whose runs carry this rubric's material, by `ScenarioDefinition.name`. */
  scenarios: string[];
}

export type Verdict = "pass" | "fail" | "unknown";

export interface Judgment {
  rationale: string;
  quotes: string[];
  verdict: Verdict;
  /** The judge's channel to the maintainers: null, unless the rubric or the material looks broken. */
  harness_issue: string | null;
}

// The judge answers through the SDK's structured output (outputFormat), which is a tool the
// model calls, validated and re-prompted on a mismatch; it is not constrained decoding. Three
// choices here were measured rather than assumed, on 2026-09-11 (testing/harness/IMPLEMENTATION.md,
// "How an RU judge answers", has the counts):
// - The prose field is `rationale`, not `reasoning`. The judge sometimes closes its long prose
//   field with a tag named after the field (`</reasoning>`) instead of ending the argument, and
//   the fields after it are swallowed into the string. Under `reasoning` that was every lost
//   field boundary observed; under `rationale` it is rarer, but not gone.
// - `rationale` is last. A mis-closed last field has nothing after it to swallow: the stray tag
//   stays in the rationale's tail, and the verdict, quotes and harness_issue are intact. The
//   judge does not always keep the order, and then the SDK's retry is what recovers it.
// - The instructions name the fields in prose and give no JSON example. Given one, the judge
//   copied it as a single argument, or filled in the tool-call placeholders
//   (`$PARAMETER_NAME`), and failed validation.
// The judge thinks before it answers, so putting the verdict first does not mean deciding first.
export const JUDGMENT_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["pass", "fail", "unknown"], description: "Whether the claim holds." },
    harness_issue: {
      type: ["string", "null"],
      description: "null, unless the rubric or the conversation itself looks broken; then what, briefly.",
    },
    quotes: {
      type: "array",
      items: { type: "string" },
      description: "The passages your rationale rests on, each copied verbatim from the conversation.",
    },
    rationale: { type: "string", description: "Why you reached your verdict, in prose." },
  },
  required: ["verdict", "harness_issue", "quotes", "rationale"],
  additionalProperties: false,
} as const;

export const JUDGE_INSTRUCTIONS = `You are reviewing a conversation between a User and their AI assistant.

The assistant had a command-line program called cog-graphs, which spawns and maintains Cognitive Graphs: small persistent stores of structured data that live as files in a directory the User owns. An assistant creates one with the User and keeps it on their behalf, across conversations. Each graph has a profile (what it is for, particular to this User), a convention (the graph's own record of how its data is kept, which any assistant working with the graph reads), and items (named entities, each carrying attribute/value pairs). The .sqlite file holds everything; the .md file beside it is a readable view of it.

You are judging one claim from the design document of cog-graphs. The rubric gives the claim, the intent behind it, the part of the conversation it is about, what to weigh, and the failure it guards against. It is not a checklist. Weigh the material in context, as a thoughtful reviewer who shares the design's intent would, and decide.

When you have decided, submit your judgment by calling the StructuredOutput tool once. It takes four fields:

- verdict: "pass" when the claim holds; "fail" when it does not; "unknown" only when the material cannot support a verdict, such as a conversation that ended before the moment the claim is about.
- harness_issue: the rubric and the conversation were prepared by the people who maintain this test. If something about them looks broken (the rubric contradicts itself, the conversation is cut off or garbled, the material the rubric names is missing), say what in a sentence or two; it reaches them directly. Otherwise, null.
- quotes: the passages your rationale rests on, each copied exactly as it appears in the conversation.
- rationale: why you reached your verdict. Refer to the conversation freely.`;

/**
 * The whole of what a judge is sent. It goes in the user prompt, with no system prompt: the
 * docs' prescription for "a thin tool-calling loop with no agent persona, where you supply all
 * behavior in the user prompt" is to leave `systemPrompt` unset, which keeps the SDK's
 * tool-calling guidance that a custom system prompt would replace.
 */
export function rubricPrompt(rubric: Rubric, view: string): string {
  return [
    JUDGE_INSTRUCTIONS,
    "",
    `# The rubric: ${rubric.id}`,
    "",
    `**Claim:** ${rubric.claim}`,
    "",
    `**Intent:** ${rubric.intent}`,
    ...(rubric.note ? ["", `**In this version:** ${rubric.note}`] : []),
    "",
    `**Material:** ${rubric.material}`,
    "",
    `**Weigh:** ${rubric.weigh}`,
    "",
    `**The failure it guards against:** ${rubric.antiPattern}`,
    "",
    "# The conversation under review",
    "",
    view,
  ].join("\n");
}

const VERDICTS: readonly string[] = ["pass", "fail", "unknown"];

/**
 * A judge's result message, read into a judgment or an error. Only a `success` carrying a
 * well-formed judgment counts; the SDK's docs say a `success` may arrive without
 * `structured_output`, and that is a failure like any other. An error is never a verdict.
 */
export function readJudgeResult(result: { subtype: string; structured_output?: unknown }): {
  judgment?: Judgment;
  error?: string;
} {
  if (result.subtype !== "success") return { error: result.subtype };
  const out = result.structured_output as Partial<Judgment> | undefined;
  if (!out) return { error: "success without structured_output" };
  const wellFormed =
    typeof out.rationale === "string" &&
    Array.isArray(out.quotes) &&
    out.quotes.every((q) => typeof q === "string") &&
    typeof out.verdict === "string" &&
    VERDICTS.includes(out.verdict) &&
    (out.harness_issue === null || typeof out.harness_issue === "string");
  if (!wellFormed) return { error: `malformed judgment: ${JSON.stringify(out).slice(0, 200)}` };
  return { judgment: out as Judgment };
}
