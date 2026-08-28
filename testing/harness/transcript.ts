// Message capture and parsing into per-turn views, plus markdown rendering.
// Works over raw SDK messages as `unknown` — structural reads only, no SDK imports.

import type { CapturedMessage, ToolCall, ToolResult, TurnView } from "./types";

type AnyMsg = Record<string, any>;

export class Transcript {
  readonly messages: CapturedMessage[] = [];
  readonly turns: TurnView[] = [];
  private seq = 0;
  private turnStart = 0; // index into messages where the current turn began

  record(message: unknown): void {
    this.messages.push({ seq: this.seq++, ts: new Date().toISOString(), message });
  }

  /** Call when a user turn is sent, so the turn view scopes to the right message window. */
  beginTurn(): void {
    this.turnStart = this.messages.length;
  }

  /** Call when the turn's result message has been recorded; builds and stores the TurnView. */
  endTurn(userText: string, resultMsg: unknown): TurnView {
    const window = this.messages.slice(this.turnStart).map((c) => c.message as AnyMsg);
    const view = buildTurnView(this.turns.length, userText, window, resultMsg as AnyMsg);
    this.turns.push(view);
    return view;
  }
}

function buildTurnView(index: number, userText: string, msgs: AnyMsg[], result: AnyMsg): TurnView {
  const toolCalls: ToolCall[] = [];
  const bashCommands: string[] = [];
  const toolResults: ToolResult[] = [];
  let assistantText = "";

  // Pass 1: assistant content (text + tool_use), so tool results can be
  // matched to the tool that produced them regardless of stream interleaving.
  for (const m of msgs) {
    if (m?.type === "assistant" && !m.parent_tool_use_id) {
      for (const block of m.message?.content ?? []) {
        if (block?.type === "text") assistantText += (assistantText ? "\n" : "") + block.text;
        if (block?.type === "tool_use") {
          toolCalls.push({ id: block.id, name: block.name, input: block.input });
          if (block.name === "Bash" && typeof block.input?.command === "string") {
            bashCommands.push(block.input.command);
          }
        }
      }
    }
  }
  const toolNameById = new Map(toolCalls.map((c) => [c.id, c.name]));

  // Pass 2: tool results.
  for (const m of msgs) {
    if (m?.type === "user" && Array.isArray(m.message?.content)) {
      for (const block of m.message.content) {
        if (block?.type === "tool_result") {
          const isError = block.is_error === true;
          const content = flattenContent(block.content);
          toolResults.push({
            toolUseId: block.tool_use_id,
            content,
            isError,
            exitCode:
              toolNameById.get(block.tool_use_id) === "Bash"
                ? bashExitCode(isError, content)
                : undefined,
          });
        }
      }
    }
  }

  const usage = result?.usage ?? {};
  return {
    index,
    user: userText,
    assistantText,
    toolCalls,
    bashCommands,
    toolResults,
    numTurns: result?.num_turns ?? 0,
    costUsd: result?.total_cost_usd ?? 0,
    durationMs: result?.duration_ms ?? 0,
    usage: {
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
    },
    resultSubtype: result?.subtype ?? "unknown",
    isError: result?.is_error === true,
  };
}

function flattenContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b: AnyMsg) => (b?.type === "text" ? b.text : JSON.stringify(b)))
      .join("\n");
  }
  return content == null ? "" : JSON.stringify(content);
}

// Verified against SDK 0.3.214: the Bash tool_use_result carries only
// {stdout, stderr, interrupted, isImage, noOutputExpected} — no exit code.
// So: not-error => 0; error => parse "Exit code N" from the result text,
// falling back to 1 (nonzero-but-unknown).
function bashExitCode(isError: boolean, content: string): number {
  if (!isError) return 0;
  const m = content.match(/exit code:?\s*(\d+)/i);
  return m ? Number(m[1]) : 1;
}

export function renderMarkdown(scenarioName: string, turns: TurnView[]): string {
  const lines: string[] = [`# Transcript — ${scenarioName}`, ""];
  for (const t of turns) {
    lines.push(`## Turn ${t.index + 1}`, "");
    lines.push(`**User:** ${t.user}`, "");
    for (const call of t.toolCalls) {
      const input =
        call.name === "Bash" && typeof (call.input as AnyMsg)?.command === "string"
          ? (call.input as AnyMsg).command
          : JSON.stringify(call.input);
      lines.push(`- tool_use \`${call.name}\`: \`${truncate(input, 300)}\``);
      const res = t.toolResults.find((r) => r.toolUseId === call.id);
      if (res) {
        const tag = res.isError ? "error" : res.exitCode !== undefined ? `exit ${res.exitCode}` : "ok";
        lines.push(`  - result (${tag}): \`${truncate(res.content.trim(), 300)}\``);
      }
    }
    if (t.toolCalls.length) lines.push("");
    lines.push(`**Assistant:** ${t.assistantText || "(no text)"}`, "");
    lines.push(
      `_result: ${t.resultSubtype}, agent turns: ${t.numTurns}, cost: $${t.costUsd.toFixed(4)}, ${t.durationMs} ms_`,
      "",
    );
  }
  return lines.join("\n");
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
