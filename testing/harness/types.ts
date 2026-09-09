// Harness types — the contract for eval definitions.
//
// Checkpoint and Violation live in ./checkpoint, which is deliberately free of both the
// SDK and this file: IN-5 runs in the free layer against a scripted lifecycle, and the
// paid scenarios call the same functions between turns.
// Deliberately SDK-free: eval definitions import only from harness/runtime.ts,
// and everything they touch is defined here in plain TS.

import type { Checkpoint, Violation } from "./checkpoint";

export type { Checkpoint, Violation };

export interface ScenarioDefinition {
  name: string;
  sandbox?: {
    /** Directory copied into the fresh temp sandbox (resolved relative to the eval file's cwd if relative). */
    fixtures?: string;
  };
  agent: {
    model: string;
    systemPrompt?: string;
    /** Base toolset for the in-loop agent. Default: ['Bash', 'Read']. */
    tools?: string[];
    /**
     * Skills exposed to the in-loop agent: an explicit list, or 'all' to expose
     * every skill discoverable from the loaded plugins. Omit for none.
     *
     * Cog-Graphs ships its interface primer as a skill, so the Introduction and
     * Orientation stages of the Walking Skeleton are only testable through this
     * option — priming via `systemPrompt` tests a different thing (a preamble the
     * real operator never sees).
     */
    skills?: string[] | "all";
    /**
     * Local plugin directories loaded into the in-loop session, e.g.
     * `[{ type: 'local', path: pluginDir }]`. Mirrors the SDK's SdkPluginConfig.
     */
    plugins?: PluginConfig[];
    /** Runaway brake: max agentic turns (maps to SDK maxTurns for the whole session). */
    maxTurnsPerMessage?: number;
    /** Runaway brake: max spend for the whole scenario. */
    maxBudgetUsd?: number;
  };
  turns: TurnDef[];
  /** Stop sending further turns after a turn whose gate failed. Default: false (run all turns). */
  haltOnGateFailure?: boolean;
  /** Overall scenario wall-clock timeout in ms. Default: 5 minutes. */
  timeoutMs?: number;
  /**
   * Check IN-5 over the run's checkpoints. Default: true.
   *
   * On by default because an invariant that each scenario has to remember to ask for is an
   * invariant most scenarios will not have. Turn it off only for a scenario whose subject
   * is destruction.
   */
  checkRegressions?: boolean;
  /** Optional LLM-as-judge slot; receives the full raw transcript. */
  grade?: (transcript: CapturedMessage[]) => Promise<GradeVerdict>;
}

/** Local plugin to load into the in-loop session (structural mirror of SdkPluginConfig). */
export interface PluginConfig {
  type: "local";
  path: string;
}

export interface TurnDef {
  user: string;
  /**
   * Begin this turn in a NEW session over the same sandbox: no shared context, same
   * tooling, same cwd.
   *
   * The Walking Skeleton has this as a step of its own — "starting a fresh thread in
   * Claude Code" — and it is not decoration. Everything the first thread learned about the
   * graph is gone, so the second thread has to re-orient from the artifact and the CLI
   * alone. Simulating it with a "forget what I said" turn tests the model's compliance
   * instead of the interface's legibility, which is the opposite of the claim.
   */
  freshThread?: boolean;
  /**
   * Entity names this turn is permitted to change or remove (IN-5).
   *
   * Declared before the turn runs, and scoped to it. Deciding after the fact which changes
   * look intentional is the version of the invariant that can never fail.
   */
  mayChange?: string[];
  /** Runs after the agent finishes responding to this turn. Assertions are collected, never thrown. */
  gate?: (ctx: GateContext) => void | Promise<void>;
}

export interface GateContext {
  /** Absolute path into the sandbox. */
  sandboxPath(rel: string): string;
  /** Parsed view of the just-finished turn. */
  lastTurn: TurnView;
  /** Every SDK message captured so far, ordered. */
  transcript: CapturedMessage[];
  /** Record a labeled pass/fail outcome. */
  assert(cond: boolean, label: string): void;
  /** Record an unconditional failure. */
  fail(label: string): void;
  /**
   * Run a subprocess in the sandbox (for Cog Graph introspection, e.g. sqlite
   * queries, and for any gate that needs a real exit code — see testing/harness/IMPLEMENTATION.md E4).
   */
  exec(cmd: string): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

/** One SDK message as captured: opaque payload plus capture metadata. */
export interface CapturedMessage {
  seq: number;
  ts: string; // ISO timestamp at capture
  message: unknown; // the raw SDK message, JSON-serializable
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResult {
  toolUseId: string;
  content: string;
  isError: boolean;
  /** Bash exit code when extractable from the structured tool result. */
  exitCode?: number;
}

/** Parsed view of one user-turn round trip. */
export interface TurnView {
  index: number; // 0-based
  user: string;
  assistantText: string;
  toolCalls: ToolCall[];
  /** Commands extracted from Bash tool_use inputs, in order. */
  bashCommands: string[];
  toolResults: ToolResult[];
  /** From the turn's result message. */
  numTurns: number;
  costUsd: number;
  durationMs: number;
  usage: { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number };
  resultSubtype: string; // 'success' | error subtypes
  isError: boolean;
}

export interface GateResult {
  turn: number; // 0-based turn index
  label: string;
  pass: boolean;
}

export interface Stats {
  turns: number;
  agentTurnsPerMessage: number[];
  toolCallCount: number;
  bashCommandCount: number;
  /** Tally of Bash exit codes where extractable, e.g. { "0": 5, "1": 1 }. */
  bashExitCodes: Record<string, number>;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalCostUsd: number;
  wallClockMsPerTurn: number[];
  wallClockMsTotal: number;
  /** Sandbox top-level listing before the session vs after. */
  sandboxBefore: string[];
  sandboxAfter: string[];
}

export interface GradeVerdict {
  pass: boolean;
  [key: string]: unknown;
}

export interface ScenarioResult {
  pass: boolean;
  gates: GateResult[];
  /** One snapshot of every graph in the sandbox, taken before turn 1 and after every gate. */
  checkpoints: Checkpoint[];
  /** IN-5 violations found across those checkpoints. Empty on a passing run. */
  regressions: Violation[];
  stats: Stats;
  artifactsDir: string;
  transcript: CapturedMessage[];
  turns: TurnView[];
  gradeVerdict?: GradeVerdict;
  /** Fatal runtime error (timeout, SDK failure), if any. */
  error?: string;
}
