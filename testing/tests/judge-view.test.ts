import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import * as path from "node:path";
import { makeSandbox, readSidecar, runCli, spawnGraph } from "./helpers";
import { renderJudgeView, THREAD_MARK } from "../harness/judge-view";
import { writeRunRecord } from "../harness/report";
import type { ScenarioDefinition } from "../harness/types";

// S1 (testing/rubrics/DRAFTS.md) — a stored run renders into the text an RU judge reads.
//
// The rubric layer grades what the User was exposed to, and it grades it offline: after
// the run, from the artifact directory alone, so a rubric can be re-judged without paying
// for another agent run. That makes the stored record the judge's entire world. Before
// S1 it was missing the User's own words (they go into the session, and only the SDK's
// output was recorded), any mark of where a fresh thread began, the scenario preamble,
// and the graph's face at the end, while `transcript.md` cut every tool result to 300
// characters. A judge handed that could not have weighed RU-1 or RU-4 at all.
//
// The failures this rules out: a user turn or a tool result that reaches the judge cut
// short or not at all; tool calls regrouped away from the prose around them, which changes
// what the User saw the assistant say before acting; a fresh thread the judge cannot see
// begin, which is the whole of RU-4's material; a missing face; and harness bookkeeping
// (session ids, cost, rate-limit events) leaking in as though it were part of the
// conversation.

const SYSTEM_PROMPT = "You are working in the user's directory. A program called `cog-graphs` is on your PATH.";
const USERS = [
  "Could we keep track of the things I'm reading?",
  "Great, and mark the first one as started.",
  "Picking this back up in a new chat: what's on my list?",
];
const LONG = "x".repeat(420) + " END-OF-LONG-RESULT";
const SESSION_A = "session-aaaa-1111";
const SESSION_B = "session-bbbb-2222";

const init = (session: string) => ({ type: "system", subtype: "init", session_id: session, cwd: "/sandbox" });
const say = (text: string) => ({
  type: "assistant",
  parent_tool_use_id: null,
  message: { content: [{ type: "text", text }] },
});
const think = () => ({
  type: "assistant",
  parent_tool_use_id: null,
  message: { content: [{ type: "thinking", thinking: "", signature: "sig-zzzz" }] },
});
const call = (id: string, name: string, input: unknown) => ({
  type: "assistant",
  parent_tool_use_id: null,
  message: { content: [{ type: "tool_use", id, name, input }] },
});
const answer = (id: string, content: string, isError = false) => ({
  type: "user",
  parent_tool_use_id: null,
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] },
});
const done = (session: string) => ({
  type: "result",
  subtype: "success",
  session_id: session,
  total_cost_usd: 0.4321,
  num_turns: 3,
  usage: { input_tokens: 98765 },
  result: "(final text)",
});

function storedRun(): { dir: string; face: string } {
  const g = spawnGraph({ namespace: "reading" });
  const added = runCli(["add-item", "--graph", g.namespace, "--entity", "Middlemarch", "--attr", "status=started"], {
    cwd: g.cwd,
  });
  if (added.exitCode !== 0) throw new Error(`add-item failed: ${added.stderr}`);

  const messages = [
    init(SESSION_A),
    { type: "rate_limit_event", rate_limit_info: { status: "allowed" } },
    { type: "system", subtype: "thinking_tokens", session_id: SESSION_A },
    think(),
    say("Let me see what the program offers."),
    call("tool-1", "Bash", { command: "cog-graphs --help" }),
    answer("tool-1", LONG),
    say("Here is what I suggest."),
    done(SESSION_A),
    init(SESSION_A),
    call("tool-2", "Read", { file_path: "reading.md" }),
    answer("tool-2", "File does not exist.", true),
    say("Marked it as started."),
    done(SESSION_A),
    init(SESSION_B),
    say("Your list has one book on it."),
    done(SESSION_B),
  ].map((message, seq) => ({ seq, ts: "2026-09-11T00:00:00.000Z", message }));

  const def: ScenarioDefinition = {
    name: "judge-view-fixture",
    agent: { model: "claude-sonnet-5", systemPrompt: SYSTEM_PROMPT, tools: ["Bash", "Read"] },
    turns: [{ user: USERS[0]! }, { user: USERS[1]! }, { user: USERS[2]!, freshThread: true }],
  };

  const dir = makeSandbox("judge-view-");
  writeFileSync(path.join(dir, "transcript.json"), JSON.stringify(messages, null, 2));
  writeRunRecord(dir, def, g.cwd);
  return { dir, face: readSidecar(g.sidecar) };
}

describe("S1 — a stored run renders into what the judge sees", () => {
  test("every user turn, tool call and tool result appears in full, in the order it happened", () => {
    const { dir } = storedRun();
    const view = renderJudgeView(dir);

    for (const user of USERS) expect(view).toContain(user);
    expect(view).toContain(LONG);
    expect(view).toContain("File does not exist.");
    expect(view).toContain(SYSTEM_PROMPT);

    const order = [
      USERS[0]!,
      "Let me see what the program offers.",
      "cog-graphs --help",
      "END-OF-LONG-RESULT",
      "Here is what I suggest.",
      USERS[1]!,
      "reading.md",
      "Marked it as started.",
      USERS[2]!,
      "Your list has one book on it.",
    ].map((s) => view.indexOf(s));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  test("a fresh thread is marked where it begins, and nowhere else", () => {
    const { dir } = storedRun();
    const view = renderJudgeView(dir);

    const marks = view.split(THREAD_MARK).length - 1;
    expect(marks).toBe(1);
    const at = view.indexOf(THREAD_MARK);
    expect(at).toBeGreaterThan(view.indexOf("Marked it as started."));
    expect(at).toBeLessThan(view.indexOf(USERS[2]!));
  });

  test("the graph's face at the end of the run is present, verbatim", () => {
    const { dir, face } = storedRun();
    const view = renderJudgeView(dir);

    expect(face).toContain("Middlemarch");
    expect(view).toContain(face.trim());
  });

  test("harness bookkeeping stays out of the view", () => {
    const { dir } = storedRun();
    const view = renderJudgeView(dir);

    for (const leak of [SESSION_A, SESSION_B, "0.4321", "98765", "rate_limit", "sig-zzzz", "(final text)"]) {
      expect(view).not.toContain(leak);
    }
  });
});
