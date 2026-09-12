import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { mkdirSync } from "node:fs";
import { makeSandbox } from "./helpers";
import { RUBRICS } from "../rubrics/rubrics";
import { LABELS, REFERENCES } from "../rubrics/references";
import { buildReference } from "../harness/reference";
import { renderJudgeView } from "../harness/judge-view";

// The rubric layer's reference pairs (testing/rubrics/DRAFTS.md, "Red first").
//
// Each RU rubric is calibrated against a pair of hand-written conversations, one that
// plainly meets its claim and one that plainly breaks it, and a judge that gets either
// wrong is not yet a judge. The judging is paid; this is the free half, and it guards the
// thing a paid calibration cannot afford to discover mid-run.
//
// A reference is a script of what the User said, what the assistant said, and the
// commands it ran. The commands are executed against the real engine when the reference
// is built, so every tool result and the final face the judge reads are ones the engine
// actually produced. The failures this rules out: a rubric that lands with no pair, or
// with a pair that cannot tell a rubber stamp from a judge (two passes, say); a label
// that names a rubric or a reference that does not exist; and a reference that no longer
// happens against the engine, because a command in it is now refused, which would show
// the judge a conversation that could not have taken place.

describe("the rubric layer's reference pairs", () => {
  test("every rubric has a plainly passing and a plainly failing reference", () => {
    expect(RUBRICS.length).toBeGreaterThan(0);
    for (const rubric of RUBRICS) {
      const expected = new Set(LABELS.filter((l) => l.rubric === rubric.id).map((l) => l.expected));
      expect([rubric.id, [...expected].sort()]).toEqual([rubric.id, ["fail", "pass"]]);
    }
  });

  test("every label names a rubric and a reference that exist", () => {
    const rubrics = new Set(RUBRICS.map((r) => r.id));
    const references = new Set(REFERENCES.map((r) => r.id));
    for (const label of LABELS) {
      expect([label.rubric, rubrics.has(label.rubric)]).toEqual([label.rubric, true]);
      expect([label.reference, references.has(label.reference)]).toEqual([label.reference, true]);
    }
  });

  for (const reference of REFERENCES) {
    test(`${reference.id} still happens against the engine, and renders whole`, () => {
      const root = makeSandbox("reference-");
      const sandbox = path.join(root, "sandbox");
      const artifacts = path.join(root, "artifacts");
      mkdirSync(sandbox);
      mkdirSync(artifacts);

      // Throws, naming the command, when the engine answers a step differently.
      buildReference(reference, sandbox, artifacts);
      const view = renderJudgeView(artifacts);

      for (const turn of reference.turns) {
        expect(view).toContain(turn.user);
        for (const step of turn.steps) if ("say" in step) expect(view).toContain(step.say);
      }
      expect(view).not.toContain("No graph existed at the end of the run");
    });
  }
});
