# Scratchpad — v0.3.1 Polish: implementing best practices

Working notes for an autonomous loop. Not a record: the **git log is the progress tracker**
(`git log --oneline a67ab4a..`). This file is orientation — read it first after an
interruption or compaction, then read the log.

## The ask (Ethan, 2026-09-12)

1. Split `engine/main.ts` (1,560 lines, one top-level script) into a flat set of modules, by
   implementing best practices rather than mirroring the design doc's Scope.
2. Error-sweep test (S4): **blessed** to change how it enumerates codes — deliberately.
3. Package the app as a neat, portable, installable Claude Code plugin (marketplace-ready;
   no publishing).
4. Quick autonomous loop. Issues are deferred to the end and brought back to Ethan — see
   "Deferred" below.

Branch `worktree-polish-best-practices`, worktree `.claude/worktrees/polish-best-practices`,
based on `origin/main` @ `a67ab4a`.

## Target layout

```
engine/
  main.ts      run: parse → validate → dispatch → sync sidecar → write once → exit once
  cli.ts       argv → typed Invocation; validation as an explicit ordered list
  errors.ts    CliError + the error registry (code → exit code)
  commands.ts  the command table: { help, run } per command
  docs.ts      primer, system introduction, file samples
  graph.ts     the Cog Graph: schema + all SQL, profile, convention, selection, locating graphs
  render.ts    JSON, --pretty, sidecar markdown; inline()
```

`engine/main.ts` stays the entry: `helpers.ts`, `harness/reference.ts`, `harness/error-sweep.ts`
and three evals hard-code the path.

## Best practices being implemented

| # | Practice | Replaces |
|---|---|---|
| 1 | **One exit.** Commands return a payload or throw `CliError`; only `main.ts` writes and exits. Warnings travel in the return value. | `fail`/`succeed` calling `process.exit` from anywhere; global `runtimeWarnings`. |
| 2 | **Error registry.** Each code declares its exit code once; call sites name only the code, typed as `keyof` the registry. | Exit code chosen per call site (`fail(EXIT.X, "code")`), the partial-map risk. |
| 3 | **Command table.** `{ help, run }` per command; help, overview, unknown-command list, validation and dispatch read it. Unbuilt = entry without `run`. | `if (command === …)` chain beside a separate `HELP` and `UNBUILT`. |
| 4 | **Explicit validation order.** Named, ordered array of checks. | Order implied by position in a script. |
| 5 | **Parse once.** Typed `Invocation`; commands read values, never argv. | `optionValue` re-scanning argv from inside `resolveGraph` and every command. |
| 6 | **Side effects at the edges.** Commands report the graph they touched; `main.ts` syncs the sidecar once. Renderers are pure (take data, not a db path). | Sidecar written from 7 call sites, including graph resolution. |
| 7 | **Data access in one place.** Every SQL statement in `graph.ts`. | SQL inlined in six command blocks. |

Kept deliberately: the hand-rolled flag parser (`util.parseArgs` echoes unknown option names;
the spec withholds them), help-as-data, the `.sqlite`/`.md` invariant, no WAL.

## Process notes

- Gate per commit: `bun run check` (typecheck + ~75 s suite). Probe a single file while
  iterating: `bun test --timeout 20000 testing/tests/<file>.test.ts`.
- Tests cross the process boundary, so the refactor is behavior-preserving iff the suite
  stays green. Byte-identical output is the bar — payload key order included.
- Commit per step; the commit message carries the why.
- Behavior preserved exactly. Anything that looks like a behavior bug found on the way is
  **noted under Deferred, not fixed**.
- After the split: rewrite `engine/IMPLEMENTATION.md`'s "shape of main.ts" section and any
  probe that names a symbol that moved or died; update `CLAUDE.md`'s file table.
- Paid layer: not run in the loop. At most one `eval:smoke` at the end, if packaging warrants.

## Plan

1. `errors.ts` + one exit (practices 1–2) and S4 enumerating the registry.
2. `cli.ts` + command table + parse once (3–5); `docs.ts`, `render.ts` fall out.
3. `graph.ts` (7) and sidecar sync at the edge (6).
4. Docs: IMPLEMENTATION.md, CLAUDE.md, error-sweep comments.
5. Plugin packaging.

## Deferred (for Ethan at the end)

_(appended as found)_
