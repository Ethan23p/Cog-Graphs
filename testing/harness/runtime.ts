// Scenario runtime — the only place (with judge.ts) that imports the Agent SDK.
// Drives one persistent streaming-input session across scripted user turns,
// running deterministic gates between turns.

import { query, type SDKMessage, type SDKUserMessage, type Options } from "@anthropic-ai/claude-agent-sdk";
import { exec } from "node:child_process";
import { mkdtemp, mkdir, cp, readdir, writeFile, chmod } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import * as path from "node:path";
import { Transcript } from "./transcript";
import { capture, regressions, type Checkpoint, type Violation } from "./checkpoint";
import { writeArtifacts, writePartialArtifacts, createArtifactsDir, printReport } from "./report";
import type {
  GateContext,
  GateResult,
  ScenarioDefinition,
  ScenarioResult,
  Stats,
  TurnDef,
  TurnView,
} from "./types";

export type { ScenarioDefinition, ScenarioResult, GateContext, TurnView, PluginConfig } from "./types";
export { capture, regressions } from "./checkpoint";
export type { Checkpoint, Violation } from "./checkpoint";
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

function execInSandbox(
  cmd: string,
  cwd: string,
  pathPrefix?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const env = pathPrefix
    ? { ...process.env, PATH: `${pathPrefix}${path.delimiter}${process.env.PATH ?? ""}` }
    : process.env;
  return new Promise((resolve) => {
    exec(cmd, { cwd, windowsHide: true, env }, (err, stdout, stderr) => {
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
        "ANTHROPIC_API_KEY, in your environment or .env. See testing/harness/IMPLEMENTATION.md (E5).",
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

  // Fresh sandbox — in a plainly-named directory under the user's home, and the name is
  // load-bearing.
  //
  // THE PATH IS PART OF THE SCENARIO, which took two paid runs to learn. The sandbox
  // started under the platform temp root, where DE-7 makes the engine warn that the graph
  // will vanish — so every scenario tripped a warning that existed only because of the
  // harness. In the run of 2026-09-09T20-54 the agent did the right thing with it: stopped,
  // explained that Windows cleans that directory without telling anyone, and asked the User
  // whether to move the graph first. It therefore did not run the query that turn was
  // about, and a gate went red for the agent behaving well.
  //
  // Moving to `testing/.scratch/` fixed the engine warning and not the problem. In the run
  // at 2026-09-09T20-56 the agent read the path itself — ".scratch", inside a git worktree —
  // decided it looked disposable, and refused to create anything for three turns while it
  // asked where the data should really live. No engine change can prevent that: an agent
  // reasons about where its User's durable data is going, which is the system working.
  //
  // So the directory has to read the way the real one does: somewhere a person would
  // plausibly keep a graph. No "temp", no "scratch", no "test", no "eval" in the path.
  // Sandboxes are kept rather than deleted, because a failed run is only diagnosable from
  // the artifact it left behind.
  const workspaces = path.join(homedir(), "cog-graph-workspaces");
  await mkdir(workspaces, { recursive: true });
  const sandbox = await mkdtemp(path.join(workspaces, `${def.name}-`));
  const configDir = path.join(sandbox, CONFIG_DIR_NAME);
  await mkdir(configDir, { recursive: true });
  if (def.sandbox?.fixtures) {
    await cp(path.resolve(def.sandbox.fixtures), sandbox, { recursive: true });
  }
  // The "install" step of the Walking Skeleton. A temp bin directory outside the sandbox,
  // prepended to PATH: the agent can name the binary from anywhere and never learns where
  // it lives, and the working directory it is judged on stays free of it.
  let binDir: string | undefined;
  if (def.agent.install && Object.keys(def.agent.install).length > 0) {
    binDir = await mkdtemp(path.join(tmpdir(), `cog-bin-${def.name}-`));
    for (const [name, contents] of Object.entries(def.agent.install)) {
      const target = path.join(binDir, name);
      await writeFile(target, contents);
      await chmod(target, 0o755).catch(() => {});
    }
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
    // Unverified until the plugin exists — see testing/harness/IMPLEMENTATION.md U1 for the check.
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
      PATH: binDir ? `${binDir}${path.delimiter}${process.env.PATH ?? ""}` : process.env.PATH,
      ...credentialEnv(),
    },
  };

  const wallClockMsPerTurn: number[] = [];

  // Checkpoint zero is taken before the agent has said anything, so the first turn is
  // inside the comparison rather than defining the baseline it is judged against (IN-5).
  const checkpoints: Checkpoint[] = [capture(sandbox, "before turn 1")];

  let turnIndex = 0;
  let halted = false;
  let turnStartedAt = Date.now();

  const makeGateContext = (lastTurn: TurnView): GateContext => ({
    sandboxPath: (rel) => path.join(sandbox, rel),
    lastTurn,
    transcript: transcript.messages,
    assert: (cond, label) => gates.push({ turn: lastTurn.index, label, pass: !!cond }),
    fail: (label) => gates.push({ turn: lastTurn.index, label, pass: false }),
    // Same PATH the agent has, so a gate can run the installed binary the way the agent
    // does rather than reaching for one only the harness process can see.
    exec: (cmd) => execInSandbox(cmd, sandbox, binDir),
  });

  // Segments. A turn marked `freshThread` opens a new session over the same sandbox, so
  // the run is a sequence of sessions rather than one — which is what the Walking
  // Skeleton's "starting a fresh thread" step actually is. Everything else is shared:
  // cwd, tooling, and the artifact on disk, which is the whole point of the step.
  const segments: TurnDef[][] = [];
  for (const turn of def.turns) {
    if (segments.length === 0 || turn.freshThread) segments.push([]);
    segments[segments.length - 1]!.push(turn);
  }

  const runSegment = async (count: number): Promise<void> => {
    const inbox = new AsyncQueue<SDKUserMessage>();
    let remaining = count;
    transcript.beginTurn();
    turnStartedAt = Date.now();
    inbox.push(userMessage(def.turns[turnIndex]!.user));

    const session = query({ prompt: inbox, options });
    try {
      for await (const msg of session as AsyncIterable<SDKMessage>) {
        transcript.record(msg);

        // Turn-completion signal. Empirically: exactly one `result` message per
        // user turn, after that turn's assistant messages; per-turn (not
        // cumulative) usage/cost. No `session_state_changed` message was observed
        // at all in this mode, so `result` is the signal we key on.
        // Claims E1/E2/E3 in testing/harness/IMPLEMENTATION.md carry the steps to re-verify this against a
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

          // Taken after the gate, so a gate that reads the graph cannot be blamed for a
          // change it merely observed, and labelled by the turn that produced it.
          checkpoints.push(capture(sandbox, `after turn ${turnIndex + 1}`));

          turnIndex++;
          remaining--;
          if (!halted && remaining > 0) {
            transcript.beginTurn();
            turnStartedAt = Date.now();
            inbox.push(userMessage(def.turns[turnIndex]!.user));
          } else {
            inbox.close();
          }
        }
      }
    } finally {
      inbox.close();
    }
  };

  try {
    for (const segment of segments) {
      if (halted) break;
      if (turnIndex > 0) progress(`fresh thread — new session, same sandbox`);
      await runSegment(segment.length);
    }
  } catch (e) {
    fatalError = e instanceof Error ? e.message : String(e);
    gates.push({ turn: turnIndex, label: `runtime error: ${fatalError}`, pass: false });
  } finally {
    clearTimeout(timer);
  }

  // IN-5 over the whole run. Permission is read from the turn that produced the *later*
  // checkpoint, per step, so a turn allowed to modify one entity has said nothing about
  // any other turn.
  let violations: Violation[] = [];
  if (def.checkRegressions !== false) {
    violations = regressions(checkpoints, (from, to) => {
      const at = Number(/after turn (\d+)/.exec(to.label)?.[1]);
      if (!Number.isFinite(at)) return [];
      const declared = def.turns[at - 1]?.mayChange ?? [];
      return typeof declared === "function" ? declared(from) : declared;
    });
    // The counts are in the label because a vacuous pass and a real one read identically
    // otherwise: a scenario that never made a graph satisfies IN-5 perfectly, and a gate
    // saying so without saying how much it looked at is the kind of green that stops
    // meaning anything.
    const watched = new Set(checkpoints.flatMap((c) => Object.keys(c.graphs)));
    const items = checkpoints.reduce(
      (n, c) => Math.max(n, Object.values(c.graphs).reduce((m, g) => m + Object.keys(g).length, 0)),
      0,
    );
    gates.push({
      turn: -1,
      label:
        violations.length === 0
          ? `IN-5: nothing regressed across ${checkpoints.length} checkpoints (${watched.size} graph(s), up to ${items} item(s))`
          : `IN-5: ${violations.length} regression(s) — ${violations.map((v) => v.detail).join("; ")}`,
      pass: violations.length === 0,
    });
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
    checkpoints,
    regressions: violations,
    stats,
    artifactsDir: "",
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
