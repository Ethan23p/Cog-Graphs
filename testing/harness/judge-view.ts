// The judge view (S1 in testing/rubrics/DRAFTS.md): a stored run, rendered as the text an
// RU judge reads.
//
// The rubric layer grades what the User was exposed to, and it grades offline, from the
// artifact directory alone. So this renders roughly what the User saw and nothing else:
// the preamble the assistant started from, every user turn, the assistant's words and tool
// calls interleaved as they happened, every tool result verbatim, a mark where each fresh
// thread begins, and the graph's face as it stood at the end. Harness bookkeeping (session
// ids, cost and token counters, rate-limit events, the result message's copy of the final
// text) is left out, because it was never part of the conversation. Thinking blocks are
// left out too: they are hidden from the User, and in this SDK they arrive empty anyway.
//
// Deliberately SDK-free: it reads two JSON files and returns a string.

import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import type { RunRecord } from "./report";

type AnyMsg = Record<string, any>;

/** Marks where a fresh thread begins. Exported so a test can find it without pinning prose. */
export const THREAD_MARK =
  "=== A new thread begins here: a fresh session with no memory of anything above. Same working directory, same tools. ===";

export function renderJudgeView(artifactDir: string): string {
  const runPath = path.join(artifactDir, "run.json");
  if (!existsSync(runPath)) {
    throw new Error(
      `${artifactDir} has no run.json. It was recorded before the judge view existed, and ` +
        `lacks the user turns and the graph's face a judge needs.`,
    );
  }
  const run = JSON.parse(readFileSync(runPath, "utf8")) as RunRecord;
  const transcript = JSON.parse(readFileSync(path.join(artifactDir, "transcript.json"), "utf8")) as {
    message: AnyMsg;
  }[];

  const out: string[] = [...preamble(run), "", "## The conversation", ""];

  let turn = 0;
  const open = (i: number) => {
    const def = run.turns[i];
    if (!def) return;
    if (i > 0 && def.freshThread) out.push(THREAD_MARK, "");
    out.push(`**User:** ${def.user}`, "");
  };
  open(0);

  for (const { message: m } of transcript) {
    if (m?.type === "result") {
      turn++;
      open(turn);
      continue;
    }
    // Subagent traffic is the agent's own business, as invisible to the User as its thinking.
    if (m?.parent_tool_use_id) continue;
    if (m?.type === "assistant") {
      for (const block of m.message?.content ?? []) {
        if (block?.type === "text" && block.text) out.push(`**Assistant:** ${block.text}`, "");
        if (block?.type === "tool_use") {
          const input = block.input as AnyMsg;
          const shown =
            block.name === "Bash" && typeof input?.command === "string" ? input.command : JSON.stringify(input);
          out.push(`**Tool call** (${block.name}):`, fenced(shown), "");
        }
      }
    }
    if (m?.type === "user" && Array.isArray(m.message?.content)) {
      for (const block of m.message.content) {
        if (block?.type !== "tool_result") continue;
        out.push(`**Tool result**${block.is_error ? " (error)" : ""}:`, fenced(flatten(block.content)), "");
      }
    }
  }
  // A turn that was sent but never answered (a run killed mid-turn) still shows the user's
  // words, followed by nothing; one never sent is not shown at all.
  if (turn < run.turns.length && out.at(-2)?.startsWith("**User:**")) out.push("_(The run ended here.)_", "");

  out.push("## The graph at the end of the run", "");
  const faces = Object.entries(run.faces);
  if (faces.length === 0) out.push("_(No graph existed at the end of the run.)_", "");
  for (const [file, text] of faces) out.push(`### ${file}`, "", fenced(text), "");

  return out.join("\n");
}

function preamble(run: RunRecord): string[] {
  const lines = [
    "# A conversation between a User and their AI assistant",
    "",
    `Scenario: ${run.scenario}. What the assistant was given when it started:`,
    "",
    `- Working directory: ${run.workingDirectory}`,
    `- Tools: ${run.agent.tools.join(", ") || "(none)"}`,
  ];
  if (run.agent.installed.length) lines.push(`- Installed on its PATH: ${run.agent.installed.join(", ")}`);
  if (run.agent.skills) lines.push(`- Skills: ${[run.agent.skills].flat().join(", ")}`);
  if (run.agent.systemPrompt) lines.push("- System prompt:", "", fenced(run.agent.systemPrompt));
  return lines;
}

/** A code fence longer than any backtick run inside, so no content can close it early. */
function fenced(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}\n${text.replace(/\n$/, "")}\n${fence}`;
}

function flatten(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((b: AnyMsg) => (b?.type === "text" ? b.text : JSON.stringify(b))).join("\n");
  }
  return content == null ? "" : JSON.stringify(content);
}
