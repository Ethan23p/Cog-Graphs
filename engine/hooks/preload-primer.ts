// PreToolUse hook: when the cog-graphs skill is invoked, hand the agent the primer as context.
//
// It fails open. Anything unexpected — another skill, an unreadable payload, an engine that
// will not answer — exits 0 with nothing written, and the skill tells the agent to run the
// command itself when the primer is missing.

import { join } from "node:path";

const SKILL = "cog-graphs";

try {
  const input = JSON.parse(await Bun.stdin.text()) as { tool_input?: Record<string, unknown> };
  // The key has been spelled both ways; a plugin skill may arrive namespaced (`plugin:skill`).
  const named = input.tool_input?.skill ?? input.tool_input?.skill_name;
  if (typeof named === "string" && (named === SKILL || named.endsWith(`:${SKILL}`))) {
    const engine = join(import.meta.dir, "..", "main.ts");
    const run = Bun.spawnSync([process.execPath, engine, "introduce", "--interface-skill"]);
    if (run.exitCode === 0) {
      const { primer } = JSON.parse(run.stdout.toString()) as { primer?: unknown };
      if (typeof primer === "string") {
        const additionalContext = `Output of \`cog-graphs introduce --interface-skill\`:\n\n${primer}`;
        process.stdout.write(
          JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext } }),
        );
      }
    }
  }
} catch {
  // Fail open.
}
process.exit(0);
