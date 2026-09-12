# Cog-Graphs

A CLI program that lets an AI agent spawn and manipulate persistent structured stores
(Cognitive Graphs) on demand — lists, inventories, knowledge bases. Designed to be
operated by agents, not humans.

## The spec lives in Logseq, not here

The design doc is the page `Cog-Graphs` in the graph `Logseq-DB-Aurelius`. Read it before
doing anything substantive:

```bash
logseq show --graph "Logseq-DB-Aurelius" --page "Cog-Graphs" --linked-references false
```

It is the source of truth for scope, entities, capabilities, roadmap, and test cases.
Don't restate it here, and don't infer requirements from the code when the doc says
otherwise — the doc wins. One full ingestion at the start of a session is the intended way
to hold it.

## Where everything is

| Path | What it is |
|---|---|
| `engine/main.ts` | The entire CLI. One file, no framework. Override the entrypoint under test with `COG_CLI_ENTRY`. |
| `testing/tests/*.test.ts` | The cheap layer. Frozen once green. |
| `testing/tests/helpers.ts` | Fixture builders. Not frozen. |
| `testing/evals/*.ts` | The paid layer — scenarios run against a live agent. Frozen once green. |
| `testing/rubrics/*.ts` | Rubrics and their reference pairs. Frozen once green. |
| `testing/harness/` | The eval runtime. Not frozen. `HARNESS-IMPLEMENTATION.md` there covers the SDK. |
| `docs/3.1/dev-loop.md` | The record of the v0.3.1 build loop: every case including minted ones, resolved disputes, the engine's implementation decisions with their probes, and the rubric layer's drafting. **Read the engine decisions before changing engine behavior.** |

```bash
bun run check          # typecheck && guard && tests — the commit gate
bun test               # cheap layer only, ~seconds
bun run guard          # frozen-file check on its own
bun run verify:claims  # re-runs the free empirical claims in HARNESS-IMPLEMENTATION.md
bun run eval:smoke     # paid, ~$0.04 — the harness works end to end
bun run eval:skeleton  # paid, ~$0.40 — the Walking Skeleton through a live agent
```

The two facts everything else hangs off: **the `.sqlite` is authoritative, the `.md` is a
view of it, and nothing is ever taken back from the view.** And the exit alphabet:
`0 ok ; 1 usage ; 2 not found ; 3 already exists ; 4 partial ingestion ; 5 ambiguous ;
6 internal`. A new command picks from that list; it does not extend it.

Run `bun run check`, not just `bun test`: a missing key on the exit-code map exits **0**
while printing a good error, and only `tsc` sees it.

## Roles

Ethan is the designer, architect, and project manager. He decides scope, makes the design
calls, and sets the bar. You are the engineer: you build to the spec, and you say so
plainly when the spec is underspecified, internally inconsistent, or wrong. Flagging that
is part of the job, not an interruption of it.

## Sharpening the domain

- Treat the doc's `Entities` section as a glossary and its `Ideation` / `RESOLVED` blocks
  as a decision log. Use that vocabulary in code, tests and prose.
- **When the discipline slips — an ambiguity, an overloaded term — say so and resolve it**,
  whether it slipped in your response, in the code, or in Ethan's. Resolution might be a
  code change, or a new word added to the canon via Ethan.
- Stress-test proposed behavior against a concrete scenario, the way the doc's `UX Flows`
  do. Edge cases are where the boundaries get drawn.
- Surface divergence between doc and code plainly. The doc is authoritative on scope; own
  the implementation and push for clarity where it helps.

## Non-negotiables

- **Tests and evals are a second layer of the spec.** They are never edited to fit the
  implementation. If a test seems wrong, that's a conversation with Ethan, recorded and
  timestamped — not a quiet edit.
- **Data over behavior.** Data is explicit, portable, inspectable, long-lived; behavior is
  modular and replaceable. When in doubt, put the durable thing in the artifact.
- **Simple and minimal.** Few baked-in assumptions. Anything consequential is centrally
  configurable and self-documented.
- **The CLI is the UX, and its user is an AI agent.** Self-documenting, self-contained,
  token-efficient, legible errors. An agent with zero priming should reach fluency from
  `--help` alone — treat that output as a deliverable. DE-2 and DE-5 grade it; RU-3 asserts
  an agent reaches a working graph from it alone.
- **Do not enable SQLite WAL.** It leaves `-wal`/`-shm` files beside the database and breaks
  IN-6. One short-lived process per command needs no concurrency. Revisit only when
  concurrent Operators become real — and revisit IN-6 *with* it, not instead of it.

## Frozen files

`testing/tests/*.test.ts`, `testing/tests/contract.ts`, `testing/evals/*.ts` and
`testing/rubrics/*.ts` are append-only. Add cases freely; never edit a landed one.
`bun run guard` enforces it by rejecting removed lines — it is the only thing keeping the
second layer of the spec honest.

The guard compares lines, so **any** rewritten line is a removal: an extended `import`, a
reflowed comment, a fixed typo. Add *new* lines only. Comments in frozen files still name
docs that have since moved; `docs/3.1/dev-loop.md` opens with a table resolving them.

`helpers.ts` and everything under `testing/harness/` are **not** frozen. They are mechanism,
not spec.

## The paid layer

`bun test` is free and instant. Every `eval:*` script spends real money and minutes on a
live agent; run one deliberately, never inside a loop or to check progress.

- **`.env` holds `CLAUDE_CODE_OAUTH_TOKEN`, is gitignored, and must never be committed.** It
  does not follow a worktree — copy it in, and confirm with `git status --short --ignored`.
- **Never pipe an eval through `tail` or any pager.** The in-loop agent's orphaned
  subprocesses inherit stdout, so the pipe never sees EOF and a finished run looks hung.
  Redirect to a file, or read `testing/artifacts/<run>/summary.json`.
- **Sandboxes live in `~/cog-graph-workspaces/`** and are kept, not deleted — a failed run is
  only diagnosable from what it left behind, so that directory is Ethan's to prune. The path
  is part of the scenario: see `testing/harness/HARNESS-IMPLEMENTATION.md`.
