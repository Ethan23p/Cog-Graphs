// LLM-as-judge helper: one non-agentic query() with a JSON-schema-constrained verdict.
// A slot, not a product — rubric content belongs to the eval definition.

import { query } from "@anthropic-ai/claude-agent-sdk";

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
