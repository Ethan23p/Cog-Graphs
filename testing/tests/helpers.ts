// Shared helpers for the deterministic suite (the IN + DE buckets).
//
// Tests invoke the CLI as a subprocess — never importing engine or library code.
// That is deliberate: the CLI is the UX and its user is an agent, so the contract
// under test is the process boundary (argv in; stdout/stderr/exit code out), which
// is also the only way to assert real exit codes (DESIGN.md E4).
//
// Contract source: the `Cog-Graphs` page in the `Logseq-DB-Aurelius` graph. There is
// no local CONTRACTS.md yet; when test cases are written, the assertions they encode
// become the second layer of the spec and are never edited to fit the implementation.

import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, existsSync, readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";

export const REPO_ROOT = path.resolve(import.meta.dir, "..", "..");

/**
 * Engine entry point, overridable via COG_CLI_ENTRY.
 *
 * The default path is provisional — the engine does not exist yet, and where it
 * lives is a build-phase decision. Set COG_CLI_ENTRY to point elsewhere without
 * touching tests.
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

/**
 * Read the artifact the way an inspector would — open the `.sqlite` directly, not
 * through the CLI. Cases that read the database and cases that read through the CLI
 * fail for different reasons, and the doc's whole "functional face" claim is that the
 * file stands on its own, so the suite has to be able to open it without the engine.
 */
export function readProfile(dbPath: string): Record<string, string> {
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db.query("SELECT field, value FROM profile").all() as {
      field: string;
      value: string;
    }[];
    return Object.fromEntries(rows.map((r) => [r.field, r.value]));
  } finally {
    db.close();
  }
}

/**
 * What SQLite itself says about the file, plus the one referential claim the schema
 * makes: every EAV row hangs off a real entity. SQLite does not enforce foreign keys
 * unless asked, so "structurally impossible" is only true if something checks — this is
 * that check (IN-1).
 */
export function artifactIntegrity(dbPath: string): { integrity: string; orphanRows: number } {
  const db = new Database(dbPath, { readonly: true });
  try {
    const [{ integrity_check }] = db.query("PRAGMA integrity_check").all() as {
      integrity_check: string;
    }[];
    const [{ orphans }] = db
      .query(
        "SELECT COUNT(*) AS orphans FROM eav LEFT JOIN entity ON entity.id = eav.entity_id WHERE entity.id IS NULL",
      )
      .all() as { orphans: number }[];
    return { integrity: integrity_check, orphanRows: orphans };
  } finally {
    db.close();
  }
}

/** The convention recorded in the artifact, oldest entry first (IN-8, DE-21). */
export function readConvention(dbPath: string): string[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db.query("SELECT text FROM convention ORDER BY seq").all() as { text: string }[];
    return rows.map((r) => r.text);
  } finally {
    db.close();
  }
}

/**
 * Write a profile `.yml` the way an Operator would: the profile map the artifact stores,
 * plus the seed convention beside it. Values are JSON-quoted, which is valid YAML and
 * survives apostrophes, `=`, non-ASCII and newlines without a YAML writer (DE-23).
 */
export function writeProfileYml(
  filePath: string,
  profile: Record<string, string>,
  convention: string,
): void {
  const lines = ["profile:"];
  for (const [field, value] of Object.entries(profile)) {
    lines.push(`  ${field}: ${JSON.stringify(value)}`);
  }
  lines.push(`convention: ${JSON.stringify(convention)}`);
  writeFileSync(filePath, lines.join("\n") + "\n");
}

/** Fresh temp sandbox per test. */
export function makeSandbox(prefix = "cog-test-"): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

/**
 * A sandbox that is deliberately *not* under the platform temp root.
 *
 * DE-7 is a two-directional case and `makeSandbox` can only test one direction — every
 * sandbox it makes is exactly the situation the guard is supposed to warn about. So the
 * "ordinary directory" side needs somewhere else to live. `testing/.scratch/` is
 * gitignored and stands in for the User's own directory.
 */
export function makeOrdinarySandbox(prefix = "cog-test-"): string {
  const scratch = path.join(REPO_ROOT, "testing", ".scratch");
  mkdirSync(scratch, { recursive: true });
  return mkdtempSync(path.join(scratch, prefix));
}

/**
 * A graph spawned in a fresh sandbox, ready to be operated on.
 *
 * Every case past initialize needs one and none of them are testing initialize, so the
 * setup lives here rather than being re-typed per file. It throws rather than returning
 * a failure: a case that silently proceeds against a graph that was never created would
 * report a confusing failure far from the real one.
 */
export function spawnGraph(
  options: {
    namespace?: string;
    description?: string;
    convention?: string;
    cwd?: string;
  } = {},
): { cwd: string; namespace: string; db: string; sidecar: string } {
  const namespace = options.namespace ?? "graph";
  const cwd = options.cwd ?? makeSandbox();
  const profilePath = path.join(cwd, `${namespace}.profile.yml`);
  writeProfileYml(
    profilePath,
    {
      namespace,
      "use-pattern": "manual",
      description: options.description ?? `A graph named ${namespace}.`,
    },
    options.convention ?? "Every entity carries a status.",
  );
  const r = runCli(["initialize", "--profile", profilePath], { cwd });
  if (r.exitCode !== 0) {
    throw new Error(`initialize failed (${r.exitCode}): ${r.stderr || r.stdout}`);
  }
  return {
    cwd,
    namespace,
    db: path.join(cwd, `${namespace}.sqlite`),
    sidecar: path.join(cwd, `${namespace}.md`),
  };
}

/** The sidecar's current text, LF-normalized. Derived, so always read fresh. */
export function readSidecar(sidecarPath: string): string {
  return norm(readFileSync(sidecarPath, "utf8"));
}

/** LF-normalize for content comparison (see DESIGN.md G1). */
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
