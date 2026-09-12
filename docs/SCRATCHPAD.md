# Scratchpad: RU-3, RU-6, RU-7

Working notes from the session of 2026-09-12. All three are now **resolved and landed**;
what remains is one edit to the design doc, which is Ethan's. The decisions live in
`testing/rubrics/DRAFTS.md`, `testing/CASES.md`, `testing/DISPUTES.md` and the code — this
file is the record of how they were reached.

---

## RU-3 — zero-priming fluency — RESOLVED

**The problem I found while writing this up.** RU-3 is scored pass^3, but the three trials
were three *gate* runs; the judge ran once, over one artifact. So the thing scored pass^3
was "a graph exists with both plants", and the rubric's actual claim was judged on a single
trial.

**Ethan, 2026-09-12:** *"'pass^k' has a formal definition, you can pull it via
`/tacit-frames:evaluating-ai-agents`. My understanding is that RU-3 is supposed to be like
the other evals, grading the transcript, so, yeah, let's try to get that resolved."*

**The definition, confirmed** (Anthropic, *Demystifying evals for AI agents*, Jan 2026):
a **trial** is one attempt at a task; a task's graders all apply to it; **pass^k measures
the probability that all k trials succeed**. So every grader — gates *and* judge — has to
run on every trial. The old arrangement was not pass^3 of the case.

**What landed.** `eval:judge` gained a third form:

```
bun run eval:judge --scenario zero-priming --last 3
```

It finds the k most recent stored runs of a scenario, judges each against the rubrics that
cover it, and passes only if every trial passes. The scenario is read from each run's own
`run.json`, not from the directory name, so a renamed directory cannot quietly enter or
leave a batch. Asking for more trials than exist is an error rather than a quiet pass over
fewer — pass^3 over two trials is not pass^3.

The scenario file itself is frozen and ends in `process.exit`, so the judging could not be
appended to it. That is why this lives in the harness, where the stored runs are.

**Result, 2026-09-12:** `zero-priming pass^3: 3/3 trial(s) judged pass`, $0.16. One trial
needed two attempts at structured output, which is the known and documented behavior.

**3.2, the dropped read-back gate — closed, no action.** Ethan: *"If we're assessing Agents
using query, the agents should be facing an unfamiliar graph, not one they've just
constructed."* That is the sharper version of the point, and it says the concern does not
belong in RU-3 at all: an agent reading back a graph it built a moment ago is not being
tested on retrieval. RU-2's cold thread is where that claim already lives.

---

## RU-6 — one ingestion to confirm, then bulk — WITHDRAWN

**Ethan, 2026-09-12:** *"We're not really interested in evaluating *implicit* behavior. I
might even remove RU-6; but the solution would be to include instruction which tells the
agent to be careful with bulk import, to ensure they understand… I think I'd rather remove
it, I'm not interested in evaluating this behavior."*

**What that resolves.** The rubric was grading the agent's restraint. The program's job is
to *guide* an agent that is about to bulk-import something it has not checked; whether the
agent restrains itself unprompted is the agent's taste, and a rubric that grades taste is
measuring the wrong system. The live failure was real — the judge's rationale named the
unchecked interpretive calls (`Le Guin` → `Ursula K. Le Guin`, which free text became a
`note`) — but a real failure of the wrong subject is still the wrong subject.

**What was removed** (commit `d303682`): the RU-6 rubric, both reference conversations and
their two labels, `testing/evals/eval_ingestion.ts`, and the `eval:ingestion` script.

**Why it needed a blessing.** Three of those files are frozen, and the doc's non-negotiable
is that rubrics are *"never edited to meet the implementation; exceptions must be explicitly
covered with Ethan, clearly recorded, and timestamped."* So `bun run guard` rejected the
tree by design, and the removal landed in the same commit as a timestamped entry in
`testing/DISPUTES.md` — the precedent set for `eval_smoke.ts` on 2026-09-09. The entry is
explicit that RU-6 was not removed for failing.

**The doc — done, by Ethan, the same day.** Block 60258 on `Cog-Graphs: Test Inventory,
Walking Skeleton` now carries RU-6 in strikethrough rather than deleted. Verified
2026-09-12. That is the better shape than deletion: this file, `DISPUTES.md` and two commit
messages all point at RU-6, and a struck block keeps those pointers landing somewhere while
still being unmistakably out of scope. Doc and repo agree; nothing is outstanding here.

**The follow-up your ruling implies, not yet filed.** *"the solution would be to include
instruction which tells the agent to be careful with bulk import, to ensure they
understand"* — that is engine work on the primer or on `import --help`, and it is graded by
DE-2/DE-5 (the help is a deliverable), not by a rubric. Tell me if you want it as a slice
and I'll mint it.

---

## RU-7 — `next_step` is worth reading — RESOLVED AND GREEN

**Ethan, 2026-09-12:** *"I don't really see an issue to resolve, I'd say let's just create a
procedure for automatically checking the existing error codes, which I think is the 'sweep'
you've already implemented. This procedure can be manually kicked-off after major updates to
code or something."* And on scoring: *"this should be resolved by making it manually
invoked… They are super small-scale inference calls, so cost is probably fine."*

**What that dissolves.** I had framed 7.1 as "the pair rule needs a new shape". It doesn't.
RU-7 is not the kind of thing the pair rule is about: everything in `RUBRICS` is judged over
a *conversation* and calibrated by a pair of them, and `references.test.ts` enforces that
over exactly that list. RU-7 is judged over one provoked error with no agent in it, so there
is no conversation to calibrate against. It is exported as `ERROR_RUBRIC`, deliberately
outside `RUBRICS`, and the rule stays absolute for everything it applies to — no exception
carved anywhere.

**What landed.** `bun run eval:errors` — manually invoked, not in `bun run check`, not in
any loop. One judge call per error code, each shown exactly what an Operator meets: the
command, the whole error, and that command's `--help`. Not the setup that provoked it,
because an Operator would not have that either. Separate calls per code, so a weak
`next_step` cannot hide in a batch beside nineteen strong ones.

**First run, 2026-09-12: 20/20 pass, $0.57.** Including the two I had flagged as the ones a
judge would argue with — `missing_option` (redirects to `--help` rather than naming the
missing option) and `profile_unparseable` ("Fix the YAML…"). Both were judged actionable.
`not_implemented` is not judged, because the sweep declares it unreachable with a reason.

**7.3 — closed.** Ethan: *"you reviewing these even just once is basically the spirit of the
eval, we good."* My read of the 20 strings stands as RU-7's human calibration, which is what
the article's advice about calibrating model graders against human judgement asks for.

---

## One mistake worth recording

Checking what the judge would see, I ran `bun -e 'import { renderErrorView } from
"./testing/harness/eval-errors"'`. That file is a script: its body runs on import, so the
import executed the full paid sweep — **$0.57 I did not intend to spend**. It happened to be
the run reported above, so nothing was wasted, but the hazard is real and is exactly the
"paid run used to check progress" anti-pattern arriving through a side door.

Fixed: `renderErrorView` now lives in `error-sweep.ts`, beside the entries it renders, which
has no top-level effects. Both files carry a comment saying why, with the date and the cost.

---

## Spend this session

| What | Cost |
|---|---|
| RU-7 over the whole sweep, 20 codes | $0.57 |
| RU-3 pass^3, three trials judged | $0.16 |
| **Total** | **$0.73** |
