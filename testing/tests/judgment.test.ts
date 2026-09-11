import { describe, expect, test } from "bun:test";
import { readJudgeResult } from "../harness/rubric";

// S2: reading an RU judge's result message into a judgment, or into an error.
//
// A judge answers through the Agent SDK's structured output (`outputFormat`, JSON Schema).
// The SDK validates the answer and re-prompts on a mismatch; when it runs out of retries the
// result is an error, and its docs add that a `success` can arrive with no
// `structured_output` at all, which is to be treated as a failure too. The first calibration
// runs (2026-09-11) showed the stakes: a judge that had exhausted its patience submitted a
// placeholder that validated, and it was scored as a pass.
//
// The failures this rules out: any result other than a success carrying a well-formed
// judgment being read as a verdict, and above all as a pass. An error is reported as an
// error, apart from `fail` and `unknown`, so a broken judge can never look like a green one.

const JUDGMENT = {
  rationale: "The profile was proposed and the User accepted it.",
  quotes: ["That's perfect! Yes, set it up right here in this directory."],
  verdict: "pass" as const,
  harness_issue: null,
};

describe("S2 — reading a judge's result", () => {
  test("a success carrying a well-formed judgment is that judgment", () => {
    const { judgment, error } = readJudgeResult({ subtype: "success", structured_output: JUDGMENT });
    expect(error).toBeUndefined();
    expect(judgment).toEqual(JUDGMENT);
  });

  test("the judge's channel to the maintainers comes through when it is used", () => {
    const issue = "The conversation ends before the new thread begins.";
    const { judgment } = readJudgeResult({
      subtype: "success",
      structured_output: { ...JUDGMENT, verdict: "unknown", harness_issue: issue },
    });
    expect(judgment?.verdict).toBe("unknown");
    expect(judgment?.harness_issue).toBe(issue);
  });

  test("anything else is an error, never a verdict", () => {
    const results = [
      { subtype: "success" },
      { subtype: "success", structured_output: undefined },
      { subtype: "error_max_structured_output_retries", structured_output: JUDGMENT },
      { subtype: "error_max_turns" },
      { subtype: "success", structured_output: { ...JUDGMENT, verdict: "maybe" } },
      { subtype: "success", structured_output: { rationale: "Looks fine." } },
    ];
    for (const result of results) {
      const { judgment, error } = readJudgeResult(result);
      expect([result, judgment]).toEqual([result, undefined]);
      expect(error).toBeTruthy();
    }
  });
});
