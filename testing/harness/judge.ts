// LLM-as-judge: the generic judge() slot, and judgeRubric(), the RU layer's judge (S2).
// Rubric content belongs to testing/rubrics/; this file only sends it.

import { query } from "@anthropic-ai/claude-agent-sdk";
import { JUDGMENT_SCHEMA, readJudgeResult, rubricPrompt, type Judgment, type Rubric } from "./rubric";

export async function judge(args: {
  transcript: unknown;
  rubric: string;
  schema: Record<string, unknown>;
  model?: string;
}): Promise<unknown> {
  const prompt = `${args.rubric}\n\n<transcript>\n${JSON.stringify(args.transcript, null, 2)}\n</transcript>`;
  const session = query({
    prompt,
    options: {
      tools: [],
      model: args.model,
      settingSources: [],
      persistSession: false,
      maxTurns: 2,
      outputFormat: { type: "json_schema", schema: args.schema },
      env: { ...process.env, CLAUDECODE: undefined, CLAUDE_CODE_ENTRYPOINT: undefined, ANTHROPIC_API_KEY: undefined },
      executable: "bun",
    },
  });
  for await (const msg of session) {
    if (msg.type === "result") {
      if (msg.subtype === "success") return msg.structured_output;
      throw new Error(`judge failed: ${msg.subtype}`);
    }
  }
  throw new Error("judge: stream ended without a result message");
}

/** The RU judge model (Ethan, 2026-09-11): the in-loop agent's own, so the reference pairs expose any self-preference. */
export const RUBRIC_JUDGE_MODEL = "claude-sonnet-5";

export interface JudgeRun {
  judgment?: Judgment;
  /** Why there is no judgment: the result subtype, or what was wrong with the answer. */
  error?: string;
  costUsd: number;
  /** StructuredOutput calls the judge made. More than one means validation made it try again. */
  attempts: number;
  /** Every SDK message the judge produced, so a verdict or a failure can be read at its source. */
  messages: unknown[];
}

/**
 * S2: one rubric, one judge, one call. The judge reads the rendered view as text, never the
 * raw transcript, so what it weighs is what the User was exposed to.
 *
 * No `systemPrompt`: see rubricPrompt. Each retry on a schema mismatch is a turn, and the SDK
 * stops retrying after five attempts (error_max_structured_output_retries), so six turns lets
 * the SDK's own limit be the one that ends a failing judge. At 2, a judge that retried once
 * was cut off with error_max_turns (9 of 10 calls on 2026-09-11).
 */
export async function judgeRubric(rubric: Rubric, view: string): Promise<JudgeRun> {
  const messages: unknown[] = [];
  let attempts = 0;
  let costUsd = 0;
  let read: { judgment?: Judgment; error?: string } | undefined;
  try {
    const session = query({
      prompt: rubricPrompt(rubric, view),
      options: {
        tools: [],
        model: RUBRIC_JUDGE_MODEL,
        settingSources: [],
        persistSession: false,
        maxTurns: 6,
        outputFormat: { type: "json_schema", schema: JUDGMENT_SCHEMA as unknown as Record<string, unknown> },
        env: { ...process.env, CLAUDECODE: undefined, CLAUDE_CODE_ENTRYPOINT: undefined, ANTHROPIC_API_KEY: undefined },
        executable: "bun",
      },
    });
    for await (const msg of session) {
      messages.push(msg);
      if (msg.type === "assistant") {
        for (const block of msg.message.content) if (block.type === "tool_use" && block.name === "StructuredOutput") attempts++;
      }
      if (msg.type === "result") {
        costUsd = msg.total_cost_usd;
        read = readJudgeResult(msg as { subtype: string; structured_output?: unknown });
      }
    }
  } catch (e) {
    // A single-shot query() throws after yielding an error result (per the SDK docs). When a
    // result arrived it has been read above and says more than the exception does.
    read ??= { error: String(e).slice(0, 300) };
  }
  return { ...(read ?? { error: "stream ended without a result message" }), costUsd, attempts, messages };
}
