# Eval Harness Runtime — Design

> **Status**: adapted 2026-08-28 for Cog-Graphs from the DKB Library harness
> (v1 design authored 2026-07-17 by Fable with Ethan). Ported near-verbatim; the
> substantive change is plugin/skill plumbing (see "What changed in the port").
> **Purpose**: the scenario-agnostic runtime that bears ALL Claude Agent SDK knowledge.
> Eval definitions (e.g. the walking-skeleton scenario) are ordinary TypeScript written
> against this runtime's API and must never import the SDK directly.

## Why this exists

Cog-Graphs is test-&-evaluation driven — tests and evals are a second layer of the
spec, never edited to fit the implementation. Its evals work by **invoking a fresh,
controlled instance of Claude** (the "in-loop" agent) that operates the CLI under
test via Bash, while scripted user turns drive a multi-turn scenario and deterministic
gates assert Cog Graph correctness between turns. This runtime front-loads the
Agent-SDK comprehension so later build agents write plain TS, not SDK code.

The in-loop agent is standing in for the **Operator** — the entity directly
interfacing with the CLI. That is the thing actually under evaluation: not just
"does the CLI work" but "can an agent with zero priming reach fluency from the
CLI's own self-documentation."

## The three roles

| Role | Intelligence | Where it lives |
|---|---|---|
| In-loop Claude (the Operator) | Full agentic loop (the component under indirect evaluation) | one `query()` session, streaming input |
| Simulated User | ~zero — scripted lines | the eval definition's `turns[]` |
| Grader | deterministic gates (no LLM) + optional LLM-as-judge over the transcript | gate callbacks; `grade()` hook |

## Mapping to the spec's four test buckets

The design doc sorts v0.3.1 test cases into IN / DE / RU / JU. Three have a home here:

| Bucket | Where it runs |
|---|---|
| **IN** — invariants | `testing/tests/` (bun, deterministic, no API spend) |
| **DE** — code/deterministic | `testing/tests/` + per-turn `gate()` callbacks in evals |
| **RU** — AI w/ rubric | the `grade()` slot + `judge()` helper (structured verdicts) |
| **JU** — Ethan's judgement | not automatable — the Polish Phase manual pass |

## Runtime API (contract for eval definitions)

```ts
// eval definitions import ONLY from harness/runtime.ts
import { runScenario, type ScenarioDefinition } from "../harness/runtime";

const scenario: ScenarioDefinition = {
  name: "walking-skeleton",
  sandbox: { fixtures: "./fixtures" },      // copied into a fresh temp dir; cwd of the session
  agent: {
    model: "claude-opus-4-8",               // in-loop model, configurable
    systemPrompt: "...",                    // optional priming
    tools: ["Bash", "Read"],                // default minimal
    plugins: [{ type: "local", path: pluginDir }],  // the Cog-Graphs plugin under test
    skills: "all",                          // expose its skill(s) to the in-loop agent
    maxTurnsPerMessage: 25,                 // runaway brake per user turn
    maxBudgetUsd: 2.0,                      // runaway brake per scenario
  },
  turns: [
    {
      user: "Hey Claude! Let's set up a list to track these files.",
      gate: async (ctx) => {                 // runs AFTER the agent finishes responding
        ctx.assert(await fileExists(ctx.sandboxPath("file-reports.sqlite")), "graph file created");
        ctx.assert(ctx.lastTurn.bashCommands.some(c => c.includes("initialize")), "agent ran initialize");
      },
    },
    // ...more turns; a gate failure marks the scenario failed; `haltOnGateFailure` decides continue/stop
  ],
  grade: async (transcript) => ({ ... }),    // optional LLM-as-judge slot (runtime provides `judge()` helper)
};

const result = await runScenario(scenario);
process.exit(result.pass ? 0 : 1);
```

### What the runtime guarantees

1. **Fresh sandbox** per run: temp dir (`cog-eval-<scenario>-*`), fixtures copied in,
   session `cwd` set there; directory snapshot before/after (supports the "no stray
   files" contract test).
2. **One persistent session** across all turns (shared agent context — the point of
   multi-turn), via streaming input; turn N+1 is not sent until turn N's `result`
   message arrives AND its gate has run.
3. **Isolation** from the developer's own Claude config (`settingSources: []`,
   `persistSession: false`, stripped env, scenario-local `CLAUDE_CONFIG_DIR`).
4. **Captured artifacts** on every run, pass or fail, under `artifacts/<name>-<timestamp>/`:
   - `transcript.json` — every SDK message, ordered
   - `transcript.md` — human-readable rendering (user lines, assistant text, tool calls + results)
   - `summary.json` — pass/fail per gate + stats
5. **Stats** (the spec's "instrument from early on" list): agent turns per user
   message, tool-call count, Bash commands extracted, token spend, `total_cost_usd`,
   wall-clock per turn and total, exit-code tally of Bash invocations.
6. **Actionable exit**: process exit 0 iff all gates (and grade, if present) pass;
   failures print which gate, which turn, what was asserted.

### GateContext (what gates can see/do)

- `ctx.sandboxPath(rel)` — absolute path into the sandbox
- `ctx.lastTurn` — parsed view of the just-finished turn: assistant text, tool calls,
  `bashCommands`, tool results, usage
- `ctx.transcript` — everything so far
- `ctx.assert(cond, label)` / `ctx.fail(label)` — record gate outcomes (collected, not thrown)
- `ctx.exec(cmd)` — run a subprocess in the sandbox (for Cog Graph introspection, e.g.
  sqlite queries, and for any gate that needs a real exit code — see **E4**)

## What changed in the port

The DKB harness was genuinely scenario-agnostic: a repo-wide grep for coupling
returned two hits (a temp-dir prefix string and one comment). Changes made:

1. **Sandbox prefix** `dkb-eval-` → `cog-eval-`.
2. **`plugins` / `skills` plumbed through** `ScenarioDefinition.agent` into SDK
   `Options`. DKB v0.2.1 had no plugin, so it primed the in-loop agent with a
   `systemPrompt` preamble. Cog-Graphs v0.3.1 ships a `skill.md`, and the whole
   Introduction/Orientation path (`introduce --interface-skill`) is part of the
   Walking Skeleton — priming by preamble would test a surface the real Operator
   never sees. Verified present in `Options` (sdk.d.ts L1391–2211) at **0.3.251**:
   `plugins?: SdkPluginConfig[]` (L1860), `skills?: string[] | 'all'` (L2079),
   `SdkPluginConfig = { type: 'local'; path: string; ... }` (L4696).
   `bun run typecheck` is clean, so the wiring is type-valid; whether the skill
   actually *loads* under `settingSources: []` is still open — see **U1**.
3. `transcript.ts` and `judge.ts` copied **byte-for-byte**.
4. **`report.ts` — one bug fixed.** `writePartialArtifacts` typed its transcript
   param as `SDKMessage[]` but is called with `CapturedMessage[]`. It never
   surfaced because DKB had no typecheck step; adding one (`bun run typecheck`)
   caught it immediately. Fixing it also removed the SDK import from `report.ts`,
   restoring this design's own rule that only `runtime.ts` and `judge.ts` touch
   the SDK.
5. Empirical claims below carry executable verification steps (see next section).

## SDK facts

> Originally verified against `@anthropic-ai/claude-agent-sdk@0.3.214` (DKB,
> 2026-07-17). Cog-Graphs resolves **0.3.251**. The static facts below were
> re-checked against 0.3.251 in the port; the *behavioral* claims (E1–E5) have not
> been re-run on it yet — see **U2**.

- Entry: `query({ prompt, options }): Query`. `prompt: string | AsyncIterable<SDKUserMessage>`.
  **Streaming-input mode** (AsyncIterable) is the multi-turn mechanism: yield one
  `SDKUserMessage` per scripted turn; hold the iterable open until scenario end.
- `SDKUserMessage`: `{ type: 'user', message: MessageParam, parent_tool_use_id: null, session_id?: string }`.
- Turn completion: a `result` message (`SDKResultMessage`) per user turn.
  `SDKResultSuccess` carries `num_turns`, `usage`, `modelUsage`, `total_cost_usd`,
  `duration_ms`, `permission_denials`, `result` (final text). Error subtypes:
  `error_during_execution | error_max_turns | error_max_budget_usd | error_max_structured_output_retries`.
- Key `Options`: `cwd`, `tools`, `permissionMode: 'bypassPermissions'` +
  `allowDangerouslySkipPermissions`, `settingSources: []`, `persistSession: false`,
  `model`, `maxTurns`, `maxBudgetUsd`, `env` (**replaces** subprocess env entirely —
  spread `process.env` and strip nested-session vars), `executable: 'bun'`,
  `systemPrompt`, `outputFormat: { type: 'json_schema', schema }`, `mcpServers`,
  `agents`, `skills`, `plugins`.
- Auth: `CLAUDE_CODE_OAUTH_TOKEN` in env (from `claude setup-token`); Bun auto-loads
  `.env`. Strip `ANTHROPIC_API_KEY` to avoid auth-path ambiguity.

---

## Empirical claims and how to re-verify them

Every claim below was observed, not assumed — and every one is a load-bearing
assumption the runtime would silently break on if a future SDK changed it. Each
carries a verification step.

**Most claims re-verify offline and for free**, because `transcript.json` captures
every raw SDK message. Run:

```bash
bun run verify:claims                       # newest artifact
bun run verify:claims -- <path/to/transcript.json>   # a specific run
```

That script (`testing/harness/verify-claims.ts`) checks **E1–E4** against a captured
transcript — no API spend, no network. To refresh the transcript first (~$0.02,
~40s on Haiku), run `bun run eval:smoke`, which also exercises **E5**.

| ID | Claim | Why it matters | Verification |
|---|---|---|---|
| **E1** | Exactly one `result` message per user turn, after that turn's assistant messages. | This is the turn-over signal the runtime keys on. If a turn emitted zero or two, turns would desync from gates. | `verify:claims` — counts `result` messages and compares to the count of scripted user turns. |
| **E2** | `usage` and `total_cost_usd` on each `result` are **per-turn, not cumulative**. | `buildStats` sums them. If they were cumulative, every reported cost would be inflated. | `verify:claims` — asserts the summed per-turn costs exceed the last turn's cost alone, and that at least one turn's `input_tokens` is not ≥ its predecessor's (cumulative counters only ever grow). Originally verified by cache-counter reset. |
| **E3** | `session_state_changed` is **never emitted** in streaming-input mode. | It is typed as the authoritative turn-over signal; keying on it would hang forever. Documented as an untested fallback only. | `verify:claims` — asserts no message has `subtype === 'session_state_changed'`. If one ever appears, the fallback becomes viable and this claim needs revisiting. |
| **E4** | **Bash exit codes are NOT exposed by the SDK.** `tool_use_result` for Bash carries only `{stdout, stderr, interrupted, isImage, noOutputExpected}`. | `transcript.ts::bashExitCode` therefore *derives* 0 from non-error results and parses `"Exit code N"` from error text. Gates needing precise exit codes must use `ctx.exec()`. | `verify:claims` — inspects the key set of every Bash tool result and asserts no exit-code field is present. **Cog-Graphs cares about this more than DKB did** (the spec commits to "intuitive/useful error & exit codes"), so `ctx.exec()` is the required path for exit-code assertions — which is also spec-correct, since it exercises the CLI-as-subprocess contract directly. |
| **E5** | Auth via `CLAUDE_CODE_OAUTH_TOKEN` from repo `.env` works; smoke run ≈ $0.016, ~38 s. | The only live-credential dependency. | `bun run eval:smoke` — a run that completes at all proves auth. A missing/expired token surfaces as a fatal runtime error in the report, not a gate failure. |

### Unverified — checks that need something that doesn't exist yet

| ID | Claim | Verification (once available) |
|---|---|---|
| **U1** | `plugins` + `skills` load correctly **under `settingSources: []`**. Isolation blocks skills *discovered* from user/project settings; these are passed explicitly, so they should still load. Not yet exercised. | Once the Cog-Graphs plugin exists: a scenario with `plugins: [{type:'local', path: pluginDir}], skills: 'all'` and a turn whose gate asserts the agent invoked the skill (or ran `introduce --interface-skill`). Until then, treat the plumbing as untested wiring. Cheap early check: an eval whose first turn asks the agent to list its available skills. |
| **U2** | ~~E1–E5 unverified on 0.3.251.~~ **CLOSED 2026-08-28**: smoke eval passed on 0.3.251 (4/4 gates, $0.038, 18s) and `verify:claims` returned 4/4 on the resulting transcript. E1–E5 now hold at both 0.3.214 and 0.3.251. | `bun run eval:smoke && bun run verify:claims` — one live run (~$0.04, ~20s) re-settles all five. Repeat after any SDK bump; E1–E4 are precisely the claims a bump can silently break, which is why they are executable rather than prose. |

### Gotchas for eval authors

| ID | Gotcha | Verification / handling |
|---|---|---|
| **G1** | **Normalize CRLF + trailing newline** in content gates (`echo >` appends `\n`; Windows tools emit `\r\n`). | Use a `norm()` helper — see `testing/evals/eval_smoke.ts`. Its turn-1 gate asserts exact content and would fail on Windows without it, so the smoke eval *is* the regression test for this. |
| **G2** | For "no stray files" gates, use `stats.sandboxBefore/After`, not a raw `readdir` — the harness config dir is already filtered out. | Assert against the stats arrays; a raw `readdir` will spuriously report `.claude-harness-config`. |
| **G3** | `maxTurnsPerMessage` maps to SDK `maxTurns`, which is a **global brake across the whole streaming session**, not per-message. | Budget it for the whole scenario, not one turn. Symptom of getting it wrong: a late turn ends with `result.subtype === 'error_max_turns'`, which the runtime records as a failing gate and halts on. |
| **G4** | `haltOnGateFailure` defaults to **false** (all turns still run); a non-success `result` subtype always halts regardless. | Set it `true` when later turns are meaningless after an early failure. |
| **G5** | `Read` tool failures return a plain **string** `tool_use_result`, not an object. | `flattenContent` in `transcript.ts` handles both shapes; don't assume object access in gates reading `toolResults[].content`. |

## File layout

```
testing/harness/
  DESIGN.md          # this file
  runtime.ts         # runScenario + session driver (ALL SDK imports live here)
  types.ts           # ScenarioDefinition, TurnDef, GateContext, ScenarioResult, Stats
  transcript.ts      # message capture, parsing into per-turn views, md rendering
  report.ts          # artifacts dir, summary, console output
  judge.ts           # optional LLM-as-judge helper (outputFormat json_schema)
  verify-claims.ts   # offline re-verification of E1–E4 against a transcript
testing/evals/       # agentic scenarios (RU + cross-cutting DE)
  eval_smoke.ts      # trivial scenario proving the loop (no Cog-Graphs CLI needed)
testing/tests/       # bun unit/contract suite (IN + DE), CLI-as-subprocess
  helpers.ts         # CLI_ENTRY resolution + runCli, with a red-first guard
testing/artifacts/   # gitignored run outputs
```

## Smoke eval (validates the harness itself)

Scenario with no Cog-Graphs dependency: sandbox contains a `notes.txt` fixture; turns
(1) "create greeting.txt containing exactly 'hello cog-graphs'" → gate: file exists,
content exact; (2) "append the first line of notes.txt to it" → gate: content correct,
fixture byte-identical. Proves session persistence across turns, gating, transcript
capture, stats, sandbox isolation, and auth (**E5**) — and produces the transcript
that `verify:claims` reads for **E1–E4**.

## Deliberately deferred

- The walking-skeleton eval definition + its fixtures
- Cog-Graph-correctness helper library (sqlite EAV introspection) — belongs with the
  eval, not the runtime
- Transcript-grading rubric content (runtime provides only the `grade()` slot)
- Cost/cadence tagging taxonomy for test cases
- pass@k / trial repetition (the runtime's single-run contract keeps the door open)

## Progress & partial artifacts

Motivated by DKB's first walking-skeleton run being a ~4-minute black box (and a
timed-out run leaving zero artifacts):

- The runtime prints per-turn progress to **stderr** (`[<scenario>] turn i/N done in
  Xs — gates: … — $… so far`); stdout carries only the final report.
- The artifacts dir is created at run start; after every completed turn the transcript
  (json+md) and a `summary.json` with `partial: true` are flushed. The final
  `writeArtifacts` overwrites them, so a `partial: true` summary on disk always means
  the run died before completing.
