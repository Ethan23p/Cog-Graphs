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

## Verification beyond the suite

`$CLAUDE_JOB_DIR/tmp/diff.ts` (job-local, not committed) runs ~100 invocations against the
original `main.ts` and the split engine in twin sandboxes and diffs exit code, stdout, stderr
and the sidecar byte for byte. Result after the split: 2 differences, both intended — see
Deferred 1 and 2.

## Deferred (for Ethan at the end)

1. **Behavior change, improvement:** `cog-graphs constructor` (any `Object.prototype` key)
   used to crash with a Bun stack trace at exit 1 — `HELP[command]` found the prototype
   member. The table lookup uses `Object.hasOwn`, so it is now `unknown_command`. No case
   pinned it.
2. **Behavior change, improvement:** a write against an unwritable, stale sidecar reported
   `sidecar_unwritable` **twice** (once at graph resolution, once after the write). The sync
   now runs once, after the command, so it reports once. IN-4.1 asserts presence only.
3. **Not changed, worth a decision:** an exception that is not a `CliError` (a SQLite error, a
   disk failure) still escapes as a Bun stack trace at exit 1. Exit 6 `internal` exists for
   this; mapping it would add a registry code the error sweep then has to provoke.
4. **Not changed:** `import` inserts without a transaction, one autocommit per row. On the E:
   hard disk (EN4) that is slow for big files; wrapping the loop in one transaction keeps
   partial-with-report semantics. Performance, not correctness.
5. **Not changed:** a profile namespace with surrounding whitespace is trimmed for the
   filename but stored untrimmed in the profile table, so the sidecar H1 and `introduce`
   show the untrimmed form.
6. **Doc hole:** moving `commandHelp` later in `STAGES` turns nothing red — no case combines
   `--help` with a bad flag. Recorded in IMPLEMENTATION.md as a hole; a case would need
   minting.
7. **Packaging, unverified live:** the plugin validates (`claude plugin validate .` and
   `engine`), the launchers and the hook pass smoke tests, but I did not install it into
   Claude Code — that writes to your user config. The Skill tool's input key (`skill` vs
   `skill_name`) and whether a plugin skill arrives namespaced (`cog-graphs:cog-graphs`) are
   unconfirmed, so the hook accepts all four spellings. Try: `/plugin marketplace add
   <path-to-worktree>` then `/plugin install cog-graphs@cog-graphs`, invoke the skill, and
   check the primer lands.
8. **Observed this session:** the `logseq-interface` primer hook did not fire when its skill
   was invoked as `logseq-interface:logseq-interface` — likely the same namespacing question,
   in your other plugin.
9. **Launcher outside the alphabet:** `bin/cog-graphs` exits 127 when Bun is missing (the
   shell's own code for "not found"), which the engine's exit alphabet can't cover because
   the engine never ran.
10. **Paid layer, yours to change:** the Walking Skeleton eval's comment says it should gain
    the skill and lose the sentence once the plugin lands. Frozen-once-green territory.
11. **Design doc:** Tech spec > Components could take the module table from IMPLEMENTATION.md
    ("The shape of the engine").
12. **Corrected on the way:** an IMPLEMENTATION.md claim about `convention` and the sidecar
    did not survive its probe; the EN8 entry is rewritten against what the probes showed.
