// Scenario runtime — the only place (with judge.ts) that imports the Agent SDK.
// Drives one persistent streaming-input session across scripted user turns,
// running deterministic gates between turns.

import { query, type SDKMessage, type SDKUserMessage, type Options } from "@anthropic-ai/claude-agent-sdk";
import { exec } from "node:child_process";
import { mkdtemp, mkdir, cp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { Transcript } from "./transcript";
import { writeArtifacts, writePartialArtifacts, createArtifactsDir, printReport } from "./report";
import type {
  GateContext,
  GateResult,
  ScenarioDefinition,
  ScenarioResult,
  Stats,
  TurnView,
} from "./types";

export type { ScenarioDefinition, ScenarioResult, GateContext, TurnView, PluginConfig } from "./types";
export { judge } from "./judge";

const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const CONFIG_DIR_NAME = ".claude-harness-config"; // excluded from sandbox snapshots

// Minimal promise-backed queue so the consumer loop can gate when the next
// user message is released: turn N+1 is pushed only after turn N's result
// message arrived AND its gate ran. close() ends the iterable, which ends
// the streaming-input session.
class AsyncQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiters: ((r: IteratorResult<T>) => void)[] = [];
  private closed = false;

  push(item: T): void {
    const w = this.waiters.shift();
    if (w) w({ value: item, done: false });
    else this.items.push(item);
  }

  close(): void {
    this.closed = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined as never, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.items.length) return Promise.resolve({ value: this.items.shift()!, done: false });
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((res) => this.waiters.push(res));
      },
    };
  }
}

function userMessage(text: string): SDKUserMessage {
  return {
    type: "user",
    message: { role: "user", content: text },
    parent_tool_use_id: null,
  };
}

async function snapshotDir(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true });
  return entries
    .map((e) => String(e).replaceAll("\\", "/"))
    .filter((e) => !e.startsWith(CONFIG_DIR_NAME))
    .sort();
}

function execInSandbox(cmd: string, cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    exec(cmd, { cwd, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ stdout, stderr, exitCode: err ? (err.code as number) ?? 1 : 0 });
    });
  });
}

/**
 * Credential preflight (E5). The SDK accepts either a Claude Code OAuth token
 * (`claude setup-token`) or an Anthropic API key. Fail here with a legible
 * message rather than letting a missing credential surface as an opaque
 * mid-stream SDK error.
 */
function assertCredential(): void {
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN && !process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "No credential found. Set CLAUDE_CODE_OAUTH_TOKEN (run `claude setup-token`) or " +
        "ANTHROPIC_API_KEY, in your environment or .env. See DESIGN.md (E5).",
    );
  }
}

/**
 * Keep exactly one auth path live so a failure names the right cause. When an
 * OAuth token is present it wins and the API key is stripped; when only the key
 * is present it passes through untouched.
 */
function credentialEnv(): Record<string, string | undefined> {
  return process.env.CLAUDE_CODE_OAUTH_TOKEN ? { ANTHROPIC_API_KEY: undefined } : {};
}

export async function runScenario(def: ScenarioDefinition): Promise<ScenarioResult> {
  assertCredential();

  const startedAt = Date.now();
  const transcript = new Transcript();
  const gates: GateResult[] = [];
  let fatalError: string | undefined;

  // Fresh sandbox, unless the scenario is deliberately continuing in an existing
  // directory (a fresh thread over the same cwd — see ScenarioDefinition.sandbox.reuse).
  const sandbox = def.sandbox?.reuse
    ? path.resolve(def.sandbox.reuse)
    : await mkdtemp(path.join(tmpdir(), `cog-eval-${def.name}-`));
  const configDir = path.join(sandbox, CONFIG_DIR_NAME);
  await mkdir(configDir, { recursive: true });
  if (def.sandbox?.fixtures) {
    await cp(path.resolve(def.sandbox.fixtures), sandbox, { recursive: true });
  }
  const sandboxBefore = await snapshotDir(sandbox);

  // Progress goes to stderr so it never pollutes stdout consumers; artifacts
  // dir exists from the start so every partial flush has a home.
  const artifactsDir = await createArtifactsDir(def.name);
  const progress = (line: string) => console.error(`[${def.name}] ${line}`);
  progress(`run started — ${def.turns.length} turns, artifacts: ${artifactsDir}`);

  const abort = new AbortController();
  const timeoutMs = def.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => abort.abort(new Error(`scenario timeout after ${timeoutMs} ms`)), timeoutMs);

  const options: Options = {
    cwd: sandbox,
    tools: def.agent.tools ?? ["Bash", "Read"],
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    settingSources: [], // SDK isolation: no user/project settings, no CLAUDE.md
    persistSession: false,
    model: def.agent.model,
    maxTurns: def.agent.maxTurnsPerMessage,
    maxBudgetUsd: def.agent.maxBudgetUsd,
    systemPrompt: def.agent.systemPrompt,
    // Plugin/skill interface under test. `settingSources: []` blocks skills that
    // would be *discovered* from user/project settings; these are passed
    // explicitly, so isolation is preserved and the skill under test still loads.
    // Unverified until the plugin exists — see DESIGN.md U1 for the check.
    plugins: def.agent.plugins,
    skills: def.agent.skills,
    executable: "bun",
    abortController: abort,
    env: {
      ...process.env,
      // Nested-session hygiene: the harness may itself run inside a Claude Code
      // session, and these leak the parent's identity into the child.
      CLAUDECODE: undefined,
      CLAUDE_CODE_ENTRYPOINT: undefined,
      CLAUDE_CONFIG_DIR: configDir,
      ...credentialEnv(),
    },
  };

  const inbox = new AsyncQueue<SDKUserMessage>();
  const wallClockMsPerTurn: number[] = [];

  let turnIndex = 0;
  let halted = false;
  transcript.beginTurn();
  let turnStartedAt = Date.now();
  inbox.push(userMessage(def.turns[0].user));

  const makeGateContext = (lastTurn: TurnView): GateContext => ({
    sandboxPath: (rel) => path.join(sandbox, rel),
    lastTurn,
    transcript: transcript.messages,
    assert: (cond, label) => gates.push({ turn: lastTurn.index, label, pass: !!cond }),
    fail: (label) => gates.push({ turn: lastTurn.index, label, pass: false }),
    exec: (cmd) => execInSandbox(cmd, sandbox),
  });

  try {
    const session = query({ prompt: inbox, options });
    for await (const msg of session as AsyncIterable<SDKMessage>) {
      transcript.record(msg);

      // Turn-completion signal. Empirically: exactly one `result` message per
      // user turn, after that turn's assistant messages; per-turn (not
      // cumulative) usage/cost. No `session_state_changed` message was observed
      // at all in this mode, so `result` is the signal we key on.
      // Claims E1/E2/E3 in DESIGN.md carry the steps to re-verify this against a
      // new SDK build. If a future SDK stops emitting per-turn results, fall back
      // to `system/session_state_changed {state:'idle'}`.
      if (msg.type === "result") {
        wallClockMsPerTurn.push(Date.now() - turnStartedAt);
        const turnDef = def.turns[turnIndex];
        const view = transcript.endTurn(turnDef.user, msg);

        const gate = turnDef.gate;
        if (gate) {
          const before = gates.length;
          try {
            await gate(makeGateContext(view));
          } catch (e) {
            gates.push({ turn: turnIndex, label: `gate threw: ${e instanceof Error ? e.message : String(e)}`, pass: false });
          }
          if (gates.slice(before).some((g) => !g.pass) && def.haltOnGateFailure) halted = true;
        }
        if (msg.subtype !== "success") {
          gates.push({ turn: turnIndex, label: `result was ${msg.subtype}`, pass: false });
          halted = true; // budget/turn-cap errors end the session anyway
        }

        const turnGates = gates.filter((g) => g.turn === turnIndex);
        const nFail = turnGates.filter((g) => !g.pass).length;
        const costSoFar = transcript.turns.reduce((c, t) => c + t.costUsd, 0);
        progress(
          `turn ${turnIndex + 1}/${def.turns.length} done in ${((Date.now() - turnStartedAt) / 1000).toFixed(1)}s — gates: ${turnGates.length - nFail} pass${nFail ? `, ${nFail} FAIL` : ""} — $${costSoFar.toFixed(2)} so far`,
        );
        await writePartialArtifacts(artifactsDir, def.name, transcript.messages, transcript.turns, gates);

        turnIndex++;
        if (!halted && turnIndex < def.turns.length) {
          transcript.beginTurn();
          turnStartedAt = Date.now();
          inbox.push(userMessage(def.turns[turnIndex].user));
        } else {
          inbox.close();
        }
      }
    }
  } catch (e) {
    fatalError = e instanceof Error ? e.message : String(e);
    gates.push({ turn: turnIndex, label: `runtime error: ${fatalError}`, pass: false });
  } finally {
    clearTimeout(timer);
    inbox.close();
  }

  const sandboxAfter = await snapshotDir(sandbox);
  const stats = buildStats(transcript.turns, wallClockMsPerTurn, Date.now() - startedAt, sandboxBefore, sandboxAfter);

  let gradeVerdict;
  if (def.grade && !fatalError) {
    try {
      progress("grading transcript…");
      gradeVerdict = await def.grade(transcript.messages);
      gates.push({ turn: -1, label: "grade", pass: gradeVerdict.pass });
      progress(`grade: ${gradeVerdict.pass ? "pass" : "FAIL"}`);
    } catch (e) {
      gates.push({ turn: -1, label: `grade threw: ${e instanceof Error ? e.message : String(e)}`, pass: false });
    }
  }

  const pass = gates.length > 0 && gates.every((g) => g.pass) && !fatalError && transcript.turns.length === def.turns.length;

  const result: ScenarioResult = {
    pass,
    gates,
    stats,
    artifactsDir: "",
    sandboxPath: sandbox,
    transcript: transcript.messages,
    turns: transcript.turns,
    gradeVerdict,
    error: fatalError,
  };
  result.artifactsDir = await writeArtifacts(def.name, result, artifactsDir);
  printReport(def.name, result);
  return result;
}

function buildStats(
  turns: TurnView[],
  wallClockMsPerTurn: number[],
  wallClockMsTotal: number,
  sandboxBefore: string[],
  sandboxAfter: string[],
): Stats {
  const bashExitCodes: Record<string, number> = {};
  let toolCallCount = 0;
  let bashCommandCount = 0;
  const totals = { in: 0, out: 0, cacheRead: 0, cacheCreate: 0, cost: 0 };
  for (const t of turns) {
    toolCallCount += t.toolCalls.length;
    bashCommandCount += t.bashCommands.length;
    for (const r of t.toolResults) {
      if (r.exitCode !== undefined) bashExitCodes[String(r.exitCode)] = (bashExitCodes[String(r.exitCode)] ?? 0) + 1;
    }
    totals.in += t.usage.inputTokens;
    totals.out += t.usage.outputTokens;
    totals.cacheRead += t.usage.cacheReadInputTokens;
    totals.cacheCreate += t.usage.cacheCreationInputTokens;
    totals.cost += t.costUsd;
  }
  return {
    turns: turns.length,
    agentTurnsPerMessage: turns.map((t) => t.numTurns),
    toolCallCount,
    bashCommandCount,
    bashExitCodes,
    totalInputTokens: totals.in,
    totalOutputTokens: totals.out,
    totalCacheReadTokens: totals.cacheRead,
    totalCacheCreationTokens: totals.cacheCreate,
    totalCostUsd: totals.cost,
    wallClockMsPerTurn,
    wallClockMsTotal,
    sandboxBefore,
    sandboxAfter,
  };
}
