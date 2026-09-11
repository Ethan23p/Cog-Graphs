// Offline re-verification of the SDK behavioral claims in testing/harness/IMPLEMENTATION.md (E1–E4).
//
// Every claim here is an assumption the runtime would break on silently if a
// future SDK changed it. They are checked against a captured transcript.json,
// so this costs nothing to run: no API calls, no network.
//
//   bun run verify:claims                                  # newest artifact
//   bun run verify:claims -- path/to/transcript.json       # a specific run
//
// Refresh the transcript first with `bun run eval:smoke` (~$0.02, ~40s), which
// also exercises E5 (auth) by virtue of completing at all.
//
// Exit 0 iff no claim FAILED. INCONCLUSIVE is a warning, not a failure: it means
// this particular transcript could not exercise the claim, not that it is false.

import { readdir, readFile, stat } from "node:fs/promises";
import * as path from "node:path";

type AnyMsg = Record<string, any>;
type Verdict = "PASS" | "FAIL" | "INCONCLUSIVE";

interface ClaimResult {
  id: string;
  claim: string;
  verdict: Verdict;
  detail: string;
}

const ARTIFACTS_ROOT = path.resolve(import.meta.dir, "..", "artifacts");

async function newestTranscript(): Promise<string> {
  let entries: string[];
  try {
    entries = await readdir(ARTIFACTS_ROOT);
  } catch {
    throw new Error(
      `no artifacts directory at ${ARTIFACTS_ROOT} — run \`bun run eval:smoke\` first to produce a transcript`,
    );
  }
  const dirs: { p: string; mtime: number }[] = [];
  for (const e of entries) {
    const p = path.join(ARTIFACTS_ROOT, e, "transcript.json");
    try {
      dirs.push({ p, mtime: (await stat(p)).mtimeMs });
    } catch {
      /* no transcript in that dir */
    }
  }
  if (!dirs.length) {
    throw new Error(
      `no transcript.json under ${ARTIFACTS_ROOT} — run \`bun run eval:smoke\` first to produce one`,
    );
  }
  dirs.sort((a, b) => b.mtime - a.mtime);
  return dirs[0].p;
}

/** Unwrap CapturedMessage[] ({seq, ts, message}) into the raw SDK messages. */
async function loadMessages(file: string): Promise<AnyMsg[]> {
  const raw = JSON.parse(await readFile(file, "utf8"));
  if (!Array.isArray(raw)) throw new Error(`${file}: expected a JSON array of captured messages`);
  return raw.map((m: AnyMsg) => (m && typeof m === "object" && "message" in m ? m.message : m));
}

// --- E1 -------------------------------------------------------------------
// One `result` per user turn. Checked structurally and independently of the
// runtime's own bookkeeping: each turn opens with a system/init message and
// closes with a result, so the two counts must match, and no two results may
// be adjacent with no init between them.
function checkE1(msgs: AnyMsg[]): ClaimResult {
  const claim = "exactly one `result` message per user turn";
  const inits = msgs.filter((m) => m?.type === "system" && m?.subtype === "init").length;
  const results = msgs.filter((m) => m?.type === "result").length;

  if (results === 0) {
    return { id: "E1", claim, verdict: "INCONCLUSIVE", detail: "transcript contains no result messages" };
  }
  if (inits !== results) {
    return {
      id: "E1",
      claim,
      verdict: "FAIL",
      detail: `${inits} system/init vs ${results} result messages — turns would desync from gates`,
    };
  }
  // No two results without an intervening init.
  const seq = msgs.filter((m) => (m?.type === "system" && m?.subtype === "init") || m?.type === "result");
  for (let i = 1; i < seq.length; i++) {
    if (seq[i]?.type === "result" && seq[i - 1]?.type === "result") {
      return { id: "E1", claim, verdict: "FAIL", detail: `two adjacent result messages at index ${i}` };
    }
  }
  return { id: "E1", claim, verdict: "PASS", detail: `${results} turns, each one init → one result` };
}

// --- E2 -------------------------------------------------------------------
// Per-turn, not cumulative. A cumulative counter can only ever grow, so a
// single decrease across consecutive results disproves cumulativeness. With
// one turn there is nothing to compare, hence INCONCLUSIVE.
function checkE2(msgs: AnyMsg[]): ClaimResult {
  const claim = "`usage` / `total_cost_usd` on each result are per-turn, not cumulative";
  const results = msgs.filter((m) => m?.type === "result");
  if (results.length < 2) {
    return {
      id: "E2",
      claim,
      verdict: "INCONCLUSIVE",
      detail: `needs >= 2 turns to compare; transcript has ${results.length}`,
    };
  }
  // Check every counter, not a favourite few. `cache_creation_input_tokens` is
  // in practice the likeliest to drop (a large cache write on turn 1, a small
  // one after) — omitting it made a real run read INCONCLUSIVE when the
  // evidence was sitting right there.
  const counters: { label: string; get: (r: AnyMsg) => number }[] = [
    { label: "input_tokens", get: (r) => r?.usage?.input_tokens ?? 0 },
    { label: "output_tokens", get: (r) => r?.usage?.output_tokens ?? 0 },
    { label: "cache_read_input_tokens", get: (r) => r?.usage?.cache_read_input_tokens ?? 0 },
    { label: "cache_creation_input_tokens", get: (r) => r?.usage?.cache_creation_input_tokens ?? 0 },
    { label: "total_cost_usd", get: (r) => r?.total_cost_usd ?? 0 },
  ];

  const evidence: string[] = [];
  for (let i = 1; i < results.length; i++) {
    for (const c of counters) {
      const prev = c.get(results[i - 1]);
      const cur = c.get(results[i]);
      if (cur < prev) evidence.push(`turn ${i + 1} ${c.label} ${cur} < turn ${i} ${prev}`);
    }
  }
  if (evidence.length) {
    return { id: "E2", claim, verdict: "PASS", detail: `counter decreased (impossible if cumulative): ${evidence[0]}` };
  }
  return {
    id: "E2",
    claim,
    verdict: "INCONCLUSIVE",
    detail:
      "no counter decreased in this run — consistent with per-turn but not proof. Re-run with a longer/cheaper turn following an expensive one, or compare summed costs against the provider's billing.",
  };
}

// --- E3 -------------------------------------------------------------------
function checkE3(msgs: AnyMsg[]): ClaimResult {
  const claim = "`session_state_changed` is never emitted in streaming-input mode";
  const hits = msgs.filter(
    (m) => m?.subtype === "session_state_changed" || m?.type === "session_state_changed",
  ).length;
  if (hits > 0) {
    return {
      id: "E3",
      claim,
      verdict: "FAIL",
      detail: `${hits} session_state_changed message(s) present — the documented fallback turn-over signal is now live; revisit testing/harness/IMPLEMENTATION.md E1/E3`,
    };
  }
  return { id: "E3", claim, verdict: "PASS", detail: "none present, as documented" };
}

// --- E4 -------------------------------------------------------------------
// Bash exit codes are not exposed. transcript.ts::bashExitCode derives them
// instead; if the SDK starts supplying a real one, that derivation should be
// replaced rather than left to shadow the truth.
function checkE4(msgs: AnyMsg[]): ClaimResult {
  const claim = "Bash exit codes are NOT exposed by the SDK";
  const bashIds = new Set<string>();
  for (const m of msgs) {
    if (m?.type === "assistant" && !m.parent_tool_use_id) {
      for (const b of m.message?.content ?? []) {
        if (b?.type === "tool_use" && b.name === "Bash") bashIds.add(b.id);
      }
    }
  }
  if (!bashIds.size) {
    return { id: "E4", claim, verdict: "INCONCLUSIVE", detail: "transcript contains no Bash tool calls" };
  }

  const keysSeen = new Set<string>();
  let inspected = 0;
  const offenders: string[] = [];
  for (const m of msgs) {
    if (m?.type !== "user" || !Array.isArray(m.message?.content)) continue;
    for (const b of m.message.content) {
      if (b?.type !== "tool_result" || !bashIds.has(b.tool_use_id)) continue;
      inspected++;
      // The structured payload may ride on the message or the block, depending
      // on SDK build; check both, plus the block itself.
      for (const payload of [m.tool_use_result, b.tool_use_result, b]) {
        if (payload && typeof payload === "object" && !Array.isArray(payload)) {
          for (const k of Object.keys(payload)) {
            keysSeen.add(k);
            if (/exit.?code|returncode|status_code/i.test(k)) offenders.push(k);
          }
        }
      }
    }
  }
  if (!inspected) {
    return { id: "E4", claim, verdict: "INCONCLUSIVE", detail: "no Bash tool results found to inspect" };
  }
  if (offenders.length) {
    return {
      id: "E4",
      claim,
      verdict: "FAIL",
      detail: `exit-code-like field(s) now present: ${[...new Set(offenders)].join(", ")} — replace the derivation in transcript.ts::bashExitCode with the real value`,
    };
  }
  return {
    id: "E4",
    claim,
    verdict: "PASS",
    detail: `${inspected} Bash result(s), no exit-code field. Keys seen: ${[...keysSeen].sort().join(", ") || "(none)"}`,
  };
}

// --- main -----------------------------------------------------------------
const arg = process.argv[2];
const file = arg ? path.resolve(arg) : await newestTranscript();
const msgs = await loadMessages(file);

console.log(`\n=== testing/harness/IMPLEMENTATION.md claim verification ===`);
console.log(`transcript: ${file}`);
console.log(`messages:   ${msgs.length}\n`);

const results = [checkE1(msgs), checkE2(msgs), checkE3(msgs), checkE4(msgs)];
const mark: Record<Verdict, string> = { PASS: "pass", FAIL: "FAIL", INCONCLUSIVE: "n/a " };

for (const r of results) {
  console.log(`  [${mark[r.verdict]}] ${r.id}: ${r.claim}`);
  console.log(`         ${r.detail}\n`);
}

const failed = results.filter((r) => r.verdict === "FAIL");
const inconclusive = results.filter((r) => r.verdict === "INCONCLUSIVE");
console.log(
  `${results.length - failed.length - inconclusive.length} verified, ${inconclusive.length} inconclusive, ${failed.length} failed`,
);
if (inconclusive.length && !failed.length) {
  console.log("(inconclusive = this transcript could not exercise the claim, not that it is false)");
}
console.log(
  "\nE5 (auth) is verified by `bun run eval:smoke` completing at all.\nU1 (plugins/skills under settingSources: []) needs the Cog-Graphs plugin — see testing/harness/IMPLEMENTATION.md.",
);

process.exit(failed.length ? 1 : 0);
