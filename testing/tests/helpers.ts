// Shared helpers for the deterministic suite (the IN + DE buckets).
//
// Tests invoke the CLI as a subprocess — never importing engine or library code.
// That is deliberate: the CLI is the UX and its user is an agent, so the contract
// under test is the process boundary (argv in; stdout/stderr/exit code out), which
// is also the only way to assert real exit codes (harness DESIGN.md E4).
//
// Contract source: the `Cog-Graphs` page in the `Logseq-DB-Aurelius` graph, made
// concrete in ./contract.ts. The assertions here are the second layer of the spec
// and are never edited to fit the implementation — see testing/DISPUTES.md.

import { mkdtempSync, existsSync, readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { Database } from "bun:sqlite";
import { BIN, EXIT, READ_VIEWS, graphFile, sidecarFile, type InitConfig, type QueryPayload } from "./contract";

export const REPO_ROOT = path.resolve(import.meta.dir, "..", "..");

/**
 * Engine entry point, overridable via COG_CLI_ENTRY.
 *
 * The default path is provisional — where the engine lives is a build-phase decision.
 * Set COG_CLI_ENTRY to point elsewhere without touching tests.
 */
export const CLI_ENTRY = process.env.COG_CLI_ENTRY ?? path.join(REPO_ROOT, "engine", "main.ts");

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run the CLI as a subprocess. Red-first guard: if the entry point doesn't exist
 * yet, fail loudly with the reason — that is the correct day-one red, and it must
 * never be silently skipped into a false green.
 */
export function runCli(args: string[], opts: { cwd: string }): CliResult {
  if (!existsSync(CLI_ENTRY)) {
    throw new Error(
      `engine entry point not found: ${CLI_ENTRY} — set COG_CLI_ENTRY, or build the engine. ` +
        `Until it exists, every CLI test is expected to be RED.`,
    );
  }
  const proc = Bun.spawnSync(["bun", CLI_ENTRY, ...args], {
    cwd: opts.cwd,
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? -1,
  };
}

/** How the suite renders an invocation in a failure message. */
export const shown = (args: string[]) => `${BIN} ${args.join(" ")}`;

// --- Sandboxes --------------------------------------------------------------

const SCRATCH_ROOT = path.join(REPO_ROOT, "testing", ".scratch");

/**
 * Fresh sandbox for a test, under a repo-local scratch root — deliberately NOT under
 * the platform temp dir.
 *
 * DE-7 requires `initialize` to warn when it targets a path under the temp root and to
 * stay silent in an ordinary directory. A suite that ran everything in `os.tmpdir()`
 * would trip that warning in every unrelated test and could never assert the quiet
 * direction at all.
 */
export function makeSandbox(prefix = "cog-test-"): string {
  mkdirSync(SCRATCH_ROOT, { recursive: true });
  return mkdtempSync(path.join(SCRATCH_ROOT, prefix));
}

/** Sandbox under the platform temp root — only for DE-7's warning direction. */
export function makeTempRootSandbox(prefix = "cog-temproot-"): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

// --- Initialization ---------------------------------------------------------

/** A valid init config; override any field to make a targeted invalid one. */
export function initConfig(over: Partial<InitConfig> = {}): InitConfig {
  return {
    namespace: "test-graph",
    "use-pattern": "manual",
    description: "A graph used by the deterministic suite.",
    convention: "Each item is a file. Attributes: type, processed.",
    ...over,
  };
}

/**
 * Write an init config to a `.yml` in `dir`. Hand-rolled rather than pulling a YAML
 * dependency: the suite must be able to write a *deliberately malformed* config for the
 * usage cases, which a serializer would refuse to produce.
 */
export function writeInitConfig(dir: string, cfg: InitConfig, name = "profile.yml"): string {
  const yml =
    Object.entries(cfg)
      .map(([k, v]) => `${k}: ${JSON.stringify(String(v))}`)
      .join("\n") + "\n";
  const p = path.join(dir, name);
  writeFileSync(p, yml, "utf8");
  return p;
}

/**
 * Initialize a graph in `dir` and assert it worked. Most cases are about what happens
 * *after* a working graph exists; a failure here should read as setup, not as the case.
 */
export function initGraph(dir: string, over: Partial<InitConfig> = {}): { ns: string; cfg: InitConfig } {
  const cfg = initConfig(over);
  const profile = writeInitConfig(dir, cfg, `${cfg.namespace}.profile.yml`);
  const r = runCli(["initialize", "--profile", profile], { cwd: dir });
  if (r.exitCode !== EXIT.OK) {
    throw new Error(`setup: initialize failed (exit ${r.exitCode})\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  }
  return { ns: cfg.namespace, cfg };
}

/** A sandbox with one initialized graph — the common starting state. */
export function sandboxWithGraph(over: Partial<InitConfig> = {}): { dir: string; ns: string; cfg: InitConfig } {
  const dir = makeSandbox();
  const { ns, cfg } = initGraph(dir, over);
  return { dir, ns, cfg };
}

/**
 * Write a bulk-ingestion file for `import --from`. Hand-rolled for the same reason as
 * the init config: the suite has to be able to emit a deliberately invalid record.
 */
export function writeItemsFile(
  dir: string,
  records: { entity?: string; attributes?: Record<string, string> }[],
  name = "items.yml",
): string {
  const yml = records
    .map((rec) => {
      const head = rec.entity === undefined ? "- {}" : `- entity: ${JSON.stringify(rec.entity)}`;
      const attrs = Object.entries(rec.attributes ?? {});
      if (rec.entity === undefined || attrs.length === 0) return head;
      return [head, "  attributes:", ...attrs.map(([k, v]) => `    ${k}: ${JSON.stringify(v)}`)].join("\n");
    })
    .join("\n");
  const p = path.join(dir, name);
  writeFileSync(p, yml + "\n", "utf8");
  return p;
}

// --- Reading the artifact ---------------------------------------------------

/**
 * Read the store directly, through the contract's read views.
 *
 * DE-9 and DE-10 are deliberately two cases — one reads the store, one reads through
 * the CLI — "because they fail for different reasons". This is the DE-9 path.
 */
export function readStore<T = Record<string, unknown>>(dir: string, ns: string, sql: string): T[] {
  const db = new Database(graphFile(dir, ns), { readonly: true });
  try {
    return db.query(sql).all() as T[];
  } finally {
    db.close();
  }
}

export interface EavRow {
  entity: string;
  attribute: string;
  value: string;
}

export function readEav(dir: string, ns: string): EavRow[] {
  return readStore<EavRow>(dir, ns, `SELECT entity, attribute, value FROM ${READ_VIEWS.eav.name}`);
}

/** Entities present in the store, deduplicated. */
export function storeEntities(dir: string, ns: string): string[] {
  return [...new Set(readEav(dir, ns).map((r) => r.entity))].sort();
}

/** One entity's attributes as a plain object. */
export function storeItem(dir: string, ns: string, entity: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of readEav(dir, ns)) if (r.entity === entity) out[r.attribute] = r.value;
  return out;
}

export function readProfile(dir: string, ns: string): Record<string, string> {
  const rows = readStore<{ key: string; value: string }>(
    dir,
    ns,
    `SELECT key, value FROM ${READ_VIEWS.profile.name}`,
  );
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function readConvention(dir: string, ns: string): string {
  const rows = readStore<{ content: string }>(dir, ns, `SELECT content FROM ${READ_VIEWS.convention.name}`);
  return rows.map((r) => r.content).join("\n");
}

export function readSidecar(dir: string, ns: string): string {
  return norm(readFileSync(sidecarFile(dir, ns), "utf8"));
}

// --- Output ------------------------------------------------------------------

/** Parse a stream as JSON, failing with the payload rather than a bare SyntaxError. */
export function parseJson(stream: string, label: string): Record<string, unknown> {
  try {
    return JSON.parse(stream) as Record<string, unknown>;
  } catch {
    throw new Error(`${label} did not parse as JSON. Raw payload:\n${stream}`);
  }
}

/** The structured error object on a failed invocation (IN-11). */
export function errorObject(r: CliResult): Record<string, unknown> {
  return parseJson(r.stderr, "stderr");
}

/**
 * Read the graph through the CLI. This is the DE-10 path; `readEav` is the DE-9 path.
 * The two are kept apart on purpose — they fail for different reasons.
 */
export function queryItems(
  dir: string,
  ns: string,
  extraArgs: string[] = [],
): { result: CliResult; items: QueryPayload["items"] } {
  const result = runCli(["query", "--graph", ns, ...extraArgs], { cwd: dir });
  if (result.exitCode !== EXIT.OK) return { result, items: [] };
  const payload = parseJson(result.stdout, "query stdout") as unknown as QueryPayload;
  return { result, items: payload.items ?? [] };
}

/** One queried entity's attributes, or undefined if the query did not return it. */
export function queriedItem(dir: string, ns: string, entity: string): Record<string, string> | undefined {
  return queryItems(dir, ns).items.find((i) => i.entity === entity)?.attributes;
}

// --- Comparison --------------------------------------------------------------

/** LF-normalize for content comparison (see harness DESIGN.md G1). */
export function norm(s: string): string {
  return s.replaceAll("\r\n", "\n");
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function fileSha256(p: string): string {
  return sha256Hex(new Uint8Array(readFileSync(p)));
}

/**
 * Recursive listing of relative paths + size + mtime, for write-boundary snapshots.
 * Use this to assert the CLI wrote exactly what it claimed and nothing else — the
 * sidecar `.md` is derived, so an unexpected write to it is a real defect.
 */
export function snapshotTree(root: string, exclude: string[] = []): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const abs = path.join(dir, name);
      const rel = path.relative(root, abs);
      if (exclude.some((e) => rel === e || rel.startsWith(e + path.sep))) continue;
      const st = statSync(abs);
      if (st.isDirectory()) {
        out.push(`${rel}/`);
        walk(abs);
      } else {
        out.push(`${rel} ${st.size} ${st.mtimeMs}`);
      }
    }
  };
  walk(root);
  return out;
}

/** Top-level filenames in a directory. */
export function listDir(dir: string): string[] {
  return readdirSync(dir).sort();
}
