# Eval Harness Runtime — Implementation

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
| **RU** — AI w/ rubric | offline, over the stored record: `renderJudgeView` + one judge call per rubric (see *Gates read the live run; judges read the stored record*) |
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
| **G6** | **Do not pipe an eval's output through `tail`/`head`.** The scenario finishes and the process exits, but subprocesses the in-loop agent started inherit stdout, so the pipe never reaches EOF and the shell appears to hang forever. | Redirect to a file (`bun run eval:skeleton > run.log 2>&1`) and read that, or read `summary.json` in the artifacts dir — it is written before the process exits and carries every gate. Observed 2026-09-09: the first Walking Skeleton run completed all 6 turns and wrote final artifacts at 13:42, and the piped shell was still waiting at 13:55. *Probe:* run any Bash-using scenario piped to `tail`; the report never appears, while the same run redirected to a file returns immediately. |
| **G7** | A turn marked `freshThread` opens a **new session** over the same sandbox. `maxTurnsPerMessage` is a per-session brake (G3), so it resets at that boundary. | Budget it per segment, not per run. The Walking Skeleton's fresh thread is the only place this currently applies. |

### Checkpoints and IN-5

`checkpoint.ts` is deliberately free of the SDK and of `types.ts`: `capture()` reads every
graph in a directory into a plain object and `regressions()` compares consecutive
checkpoints. IN-5 runs in the **free** layer against a scripted lifecycle
(`testing/tests/checkpoints.test.ts`) and every paid scenario gets the same check between
turns from the same two functions. An invariant checked two different ways is two
invariants.

**Permission to change an entity is declared in advance and scoped to one step.**
`TurnDef.mayChange` names entities; the function form is handed the checkpoint taken
*before* the turn, because an agentic scenario's entities are named by the agent and the
scenario cannot know whether it wrote "Portal 2" or "Portal 2 (2011)". Resolved late,
declared in advance. A `mayChange` that returns every name has turned the invariant off for
that step, and that is the thing to look for when reviewing one.
*Probe:* delete `taken.add`-style bookkeeping — no; the real probe is
`bun test testing/tests/checkpoints.test.ts` with `regressions()` stubbed to return `[]`,
which reds 4 of its 6 cases (run 2026-09-09).

**The IN-5 gate's label carries its counts.** A scenario that never made a graph satisfies
IN-5 perfectly; a gate reporting a bare pass would read identically to one that checked two
hundred items. The smoke eval passes it vacuously and says so.

### Where the sandbox lives, and why the path is part of the scenario

Sandboxes are created in `~/cog-graph-workspaces/<scenario>-<random>` — not under the
platform temp root, not inside the repo, and with no "temp", "scratch", "test" or "eval" in
the path. That is not fastidiousness; it cost two paid runs to learn.

Under the temp root, DE-7 makes the engine warn that the graph will vanish, so **every**
scenario tripped a warning that existed only because of the harness. On 2026-09-09T20-54 the
agent handled it exactly right — stopped, explained that Windows cleans that directory
without telling anyone, and asked the User whether to move the graph first — and so did not
run the query the turn was about. A gate went red for the agent behaving well.

Moving to `testing/.scratch/` removed the engine's warning and not the problem. On
2026-09-09T20-56 the agent read the path itself, decided ".scratch" inside a git worktree
looked disposable, and declined to create anything for three turns while it asked where the
data should really live. No engine change prevents that, and none should: an agent reasoning
about where its User's durable data is going is the system working.

**The finding is about the product, not just the harness.** Location is part of this
interface's UX, and an agent will spend real turns on it when the location looks wrong. In
the neutral workspace the same scenario passed at 21 agent turns / 15 tool calls / 186,382
tokens, against 24 / 18 / 245,997 under the temp root — roughly a sixth of the budget was
going on the argument.
*Probe:* point `sandbox` back at `tmpdir()` and run `bun run eval:skeleton`; expect the
turn-2 gates to go red with the agent asking about the directory rather than querying.

Sandboxes are kept rather than deleted — a failed run is only diagnosable from what it left
behind — so `~/cog-graph-workspaces` accumulates and is the operator's to prune.

### Installing a binary for the in-loop agent

`agent.install` writes files to a temp directory **outside the sandbox** and prepends it to
the agent's PATH — and to `ctx.exec`'s, so a gate runs the same binary the agent does.
Outside, because "installed" means a program the agent can name from anywhere without
knowing where it lives, and because a file in the working directory would show up in the
listing IN-6 checks for strays.

Entries are written verbatim, with no platform translation: a scenario needing both a POSIX
shim and a `.cmd` twin lists both. Claude Code's Bash is a POSIX shell even on Windows
while `ctx.exec` goes through cmd.exe there, so guessing which one the shell resolves is
how this fails silently, on one platform, in the middle of a paid run.
*Probe:* install only the POSIX form and run the Walking Skeleton's turn 2 gate on Windows —
`cog-graphs introduce` returns a non-zero exit and the convention assertion fails for a
reason that has nothing to do with the convention.

### Gates read the live run; judges read the stored record

The two graders get their evidence from different places, and the difference is the whole
reason `run.json` exists.

- **Gates** run inside the run, between turns. They see `ctx.lastTurn`, which is parsed live
  and includes the user's text. They also see the `.sqlite` through `sandboxPath` and the
  CLI's real exit codes through `exec`. They never read the artifacts.
- **RU judges** run offline, after the run, from the artifact directory alone. That way a
  rubric can be re-judged or iterated without paying for another agent run. Each judge is
  still a live model call; "offline" means detached from the scenario, not model-free.

Until 2026-09-11 nothing read a run after it ended, so nothing noticed that the stored record
was incomplete:
- **The user turns were missing.** They go into the session as input and are never echoed
  back as SDK messages, so `transcript.json` held none of them.
- **Fresh threads were unmarked.** The SDK emits `system/init` on every turn, not only on a
  new session, so the transcript cannot mark where a thread began.
- **The graph's face was never copied out of the sandbox.**
- **Tool results were truncated.** `transcript.md` cuts every one to 300 characters.

`writeRunRecord` in `report.ts` now writes `run.json` beside the transcript. It holds the
preamble, every user turn with its `freshThread` flag, and every graph's `.md` face. It is
written at the start, after every turn and at the end, so a killed run still leaves one.
`renderJudgeView` in `judge-view.ts` joins the two files into the text a judge reads:
- **Kept:** the conversation as it happened, every tool result verbatim.
- **Left out:** bookkeeping and thinking.

A run recorded before `run.json` existed is refused with a message rather than rendered
without its user turns.

The `grade()` slot on `ScenarioDefinition` has the same blind spot: it is handed
`transcript.messages`, which has no user turns. No scenario uses it, and RU judging
goes through the stored record instead.

*Probes* (S1, `testing/tests/judge-view.test.ts`, run 2026-09-11; each reds exactly one of
its four cases):
- cut tool results to 300 characters in `renderJudgeView` → "appears in full" goes red;
- drop the `THREAD_MARK` push → "a fresh thread is marked" goes red;
- write `faces: {}` in `writeRunRecord` → "the graph's face" goes red;
- render the `result` message's text → "bookkeeping stays out" goes red.

A file the agent wrote reaches the judge as it reads: a `Write` call renders as its path and
its content, fenced, rather than as JSON whose newlines are `\n` escapes. The judges had been
decoding those escapes themselves, and a judge quoting a profile back quoted text the view
never showed. *Probe:* disable the `Write` branch in `renderJudgeView` → "a written file
reaches the judge as it reads" goes red (run 2026-09-11).

### How an RU judge answers

`judgeRubric` (`judge.ts`) sends one rubric and one rendered view to `claude-sonnet-5` and
reads back a `Judgment`: `verdict`, `harness_issue`, `quotes`, `rationale`. The words it is
given are `JUDGE_INSTRUCTIONS` and `rubricPrompt` in `rubric.ts`, which is SDK-free so both
can be read and tested without a paid call. `bun run eval:judge` drives it; each judge's
whole session is written to `judges/<RU>__<conversation>.json` beside the verdicts, so a
surprising verdict or a failed call can be read at its source.

**The SDK's structured output is a tool, not constrained decoding.** `outputFormat` adds a
`StructuredOutput` tool; the model calls it, the SDK validates the arguments against the
schema and re-prompts on a mismatch, and after five failed attempts ends with
`error_max_structured_output_retries`. The docs add that a `success` can arrive with no
`structured_output`. So:
- **Only a `success` carrying a well-formed judgment is a verdict** (`readJudgeResult`).
  Anything else is an error, reported apart from `fail` and `unknown`. In the first
  calibration a judge that had run out of patience submitted a placeholder that validated,
  and it was scored as a pass. *Probe:* skip the subtype check in `readJudgeResult` → "anything
  else is an error, never a verdict" in `testing/tests/judgment.test.ts` goes red (run
  2026-09-11).
- **`maxTurns` is 6.** Every retry is a turn. At 2, 9 of 10 calibration calls ended
  `error_max_turns` (2026-09-11). At 6, the SDK's own limit of five attempts is the one that
  ends a failing judge. *Probe (paid, reasoned):* set it to 2 and run
  `bun run eval:judge --references`; expect `error_max_turns` on any call that retried.
- **`eval:judge` flags a judgment that took more than one attempt.** It still counts, and
  it is worth reading.

**No `systemPrompt`.** The docs' prescription for "a thin tool-calling loop with no agent
persona, where you supply all behavior in the user prompt" is to leave it unset, which keeps
the SDK's minimal default and its tool-calling guidance; a custom string replaces that
guidance. An A/B on 2026-09-11 showed no measurable difference between the two at six calls
each, so this is the docs' call, adopted as such, not a measured one.

**The answer's format was measured, 2026-09-11.** Each fix below is a response to a failure
read in the judge's own session, not a guess:

| Prompt and schema | Where | First attempt valid | Verdicts |
|---|---|---|---|
| prose field `reasoning`, first | early calibration | every lost field boundary (23 of 23) began with the judge closing the field as `</reasoning>` | several `error_max_structured_output_retries`, and one placeholder pass |
| `rationale`, first; JSON example in the prompt | 18 calls | 15 of 18 | 18 of 18 |
| same | calibration, 10 calls | 9 of 10 | 9; RU-4 × walking-skeleton ran out of retries, all 5 attempts swallowing a field after `</rationale>` |
| `rationale` last; JSON example | RU-4 × walking-skeleton, ×6 | 1 of 6: the judge passed the example whole as one argument, or filled in the tool-call placeholders `$PARAMETER_NAME` / `$PARAMETER_VALUE` | 6 of 6 |
| `rationale` last; fields named in prose, no example | RU-4 × walking-skeleton, ×6 | 5 of 6 | 6 of 6 |
| same (**adopted**) | calibration, 10 calls | 5 of 10: four swallowed `verdict` after `</rationale>`, one began the arguments as JSON text and switched format mid-way | 10 of 10, every label matched |

What that settled, and what it did not:
- **The judge often closes its long prose field with a tag named after the field**
  (`</rationale>`) instead of ending the argument, and whatever field it writes next is
  swallowed into the string. It is not rare: 7 of the adopted format's 10 calibration calls
  did it at least once. The judge's thinking comes back empty in the stored messages, so why
  is not known.
- **`rationale` is last, which contains the damage only when the judge keeps the order.**
  When it does, the stray `</rationale>` (often with `</invoke>`) stays in the rationale's
  tail and the other three fields are intact. But the order in which arguments are written is
  the model's, and in 5 of those 10 calls it wrote `verdict` last anyway; then the verdict is
  swallowed, validation fails, and the SDK's retry recovers it. The tail is left as the judge
  wrote it rather than stripped: reading the judge's words back is not something to do by
  pattern-matching them.
- **The prompt names the fields and gives no example.** That is the docs' own shape: a clear
  prompt and a focused schema. Given a JSON example, the judge copied it.
- **The retry is the mechanism, and it holds.** Under the adopted format, 16 of 16 calls ended
  in a genuine verdict (one error in 10 under the format before it). A retried judgment is the
  same judgment re-submitted whole; `eval:judge` flags it so it can be read.
- **The judge thinks before it calls the tool**, so the verdict coming first in the answer is
  not the verdict being decided first.
- **Not tried:** a prose field name less common as a tag in prompts than `reasoning` or
  `rationale`, or carrying the rationale as an array of paragraphs, since the `quotes` array
  was never mis-closed. Either is the next experiment if retries become a cost worth paying
  down.

*Probe (paid):* `bun run eval:judge --references`; every label must match, and on the
reference set as it stood on 2026-09-11 it did, 10 of 10. For the order: put `rationale`
first in `JUDGMENT_SCHEMA` and in `JUDGE_INSTRUCTIONS` and judge RU-4 a few times
(`bun run eval:judge --references RU-4`); expect first attempts missing a field and, on the
walking-skeleton reference, a call that runs out of retries (1 of 1 did on 2026-09-11).

**`harness_issue` is the judge's channel to us** (Ethan, 2026-09-11): null, unless the rubric
or the conversation looks broken. `eval:judge` prints it in full. It is how a judge says
"this test is broken" instead of being forced to pick a verdict over bad material.

**Reference conversations are real where it matters.** `buildReference` (`reference.ts`)
takes a hand-written conversation and runs every `cog-graphs` command in it against the
engine, in a sandbox under `~/cog-graph-workspaces/`, so the tool results and the final face
the judge reads are the engine's own, and a reference that stops matching the engine throws
rather than drifting. *Probe:* change an `add-item` in `testing/rubrics/references.ts` to an
entity that already exists → "every reference builds against the real engine" in
`testing/tests/references.test.ts` goes red (reasoned: the builder throws on an unexpected exit).

### The error sweep (S4)

`error-sweep.ts` provokes every error code the engine can raise, once each, by direct
invocation — no agent, because RU-7's claim is about the text of an error and putting an
agent in front of it would grade the agent. Each entry carries what an Operator meeting that
error would have: the command, the whole of stderr, and that command's `--help`.

- **Coverage is derived, not remembered.** `testing/tests/error-sweep.test.ts` reads the codes
  out of `engine/main.ts` (every `fail(EXIT.…, "code")`) and requires an entry for each, so a
  code added to the engine cannot ship ungraded. A code with no provocation is allowed only
  where `unreachableCodes()` says so and says why — today that is `not_implemented`, which
  nothing can provoke while every documented command is built, asked of the CLI rather than
  remembered as a literal (the DE-19.3 precedent). *Probe:* delete any provocation from
  `PROVOCATIONS` → "every error code the engine can raise is provoked once, or declared
  unreachable" goes red. Break the regex that reads the engine → "the engine's codes are found
  in its source at all" goes red, which is the guard against the whole file going vacuous.
- **Each entry is checked to have actually provoked its code**, with a non-zero exit and a
  non-empty `next_step`. That is what caught three provocations that did not fail at all when
  the sweep was first run (2026-09-11): a namespace with a space in it is legal, one missing
  directory level is created for you with a warning rather than refused (DE-7.1), and a
  read-only sidecar is a warning and not a failure.
- **Warnings are out of scope, for now.** `sidecar_unwritable`, `created_directory` and
  `temp_directory` carry the same `code`/`message`/`next_step` shape but ride in a successful
  payload. The sweep covers `fail` only, which is also exactly what the coverage test derives.

### RU-7 is judged on demand, and is not in `RUBRICS`

`bun run eval:errors` judges the sweep: one `claude-sonnet-5` call per error code, each shown
one error alone — the command, the whole of stderr, and that command's `--help`, and not the
setup that provoked it, because an Operator meeting the error would not have that either.

- **It is manually invoked** (Ethan, 2026-09-12: "This procedure can be manually kicked-off
  after major updates to code or something"). It is deliberately absent from `bun run check`
  and from every loop. What runs constantly is the free coverage test above, which already
  fails the moment a code ships without a provocation. *Probe:* there is nothing to break —
  the claim is an absence, and `grep -r "eval:errors" package.json testing/tests` finding it
  in a test or in `check` is the falsification.
- **One call per code, not one call for the batch**, so a weak `next_step` cannot hide beside
  nineteen strong ones and every verdict is attributable. 20 codes cost $0.5728 on 2026-09-12.
- **`ERROR_RUBRIC` is exported from `rubrics.ts` and is deliberately not in `RUBRICS`.** That
  is not an exception to the reference-pair rule; it is RU-7 not being the kind of case the
  rule is about. Everything in `RUBRICS` is judged over a conversation and calibrated by a
  pair of them, and `references.test.ts` enforces that over exactly that list. RU-7 is judged
  over one provoked error with no agent in it, so there is no conversation to pair. *Probe,
  run 2026-09-12:* `RUBRICS.push(ERROR_RUBRIC)` → "every rubric has a plainly passing and a
  plainly failing reference" goes red, expecting `["fail", "pass"]` for RU-7 and finding `[]`.
  That is the rule declining to be bent rather than a bug, and it is why RU-7 living outside
  the list is a statement about RU-7 and not a hole in the enforcement.
- **Measured, 2026-09-12:** 20/20 codes pass, $0.5728, 5 of the 20 needing a second structured
  output attempt — the same rate the RU judges show. The two strings predicted to be arguable
  (`missing_option`, which redirects to `--help` rather than naming the missing option, and
  `profile_unparseable`'s "Fix the YAML") were both judged actionable.

### A script's body runs on import, and that can cost money

`renderErrorView` lives in `error-sweep.ts`, not in `eval-errors.ts`, because the latter is a
script: importing it to render one view executed the whole paid sweep. That is not a
hypothetical — it happened on 2026-09-12 and cost $0.57, arriving as the "paid run used to
check progress" anti-pattern through a side door. Anything a test or a console one-liner might
reasonably want to import belongs in a module with no top-level effects. *Probe:* move it back
into `eval-errors.ts` and import it from a one-liner → the sweep runs and bills.

### pass^k grades every trial with every grader

`bun run eval:judge --scenario <name> --last <k>` judges the k most recent stored runs of a
scenario and passes only if every one passes. It exists because RU-3 is scored pass^k, k=3, and
until 2026-09-12 only its deterministic gates ran three times while the judge ran once — so the
thing scored pass^3 was the gates, not the case. A trial is one attempt graded by *all* of a
task's graders, and pass^k is the probability that all k succeed (Anthropic, *Demystifying evals
for AI agents*, 2026-01-09). The scenario is read from each run's `run.json` rather than from the
directory name, so a renamed directory cannot silently enter or leave a batch, and asking for
more trials than exist is an error rather than a quiet pass over fewer. *Probe:* ask for
`--last 99` of any scenario → it exits 1 naming how many runs exist, rather than judging what it
found. **Measured 2026-09-12:** zero-priming 3/3 judged pass, $0.1562.

## File layout

```
testing/harness/
  HARNESS-IMPLEMENTATION.md  # this file
  runtime.ts         # runScenario + session driver (ALL SDK imports live here)
  types.ts           # ScenarioDefinition, TurnDef, GateContext, ScenarioResult, Stats
  transcript.ts      # message capture, parsing into per-turn views, md rendering
  report.ts          # artifacts dir, summary, run.json (writeRunRecord), console output
  judge-view.ts      # renderJudgeView: a stored run → the text an RU judge reads (SDK-free)
  judge.ts           # judgeRubric (the RU judge) and the generic judge() slot; outputFormat json_schema
  rubric.ts          # Rubric and Judgment shapes, JUDGE_INSTRUCTIONS, rubricPrompt, readJudgeResult (SDK-free)
  reference.ts       # buildReference: a hand-written conversation, run against the real engine
  eval-judge.ts      # bun run eval:judge: the reference pairs, a stored run, or a scenario's k trials (pass^k)
  error-sweep.ts     # errorSweep: every error code provoked once, with its command's --help (S4); renderErrorView
  eval-errors.ts     # bun run eval:errors: RU-7 over the sweep, one judge call per code, manually invoked
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
