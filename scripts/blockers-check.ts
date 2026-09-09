// Self-check for Phase 24 blocker bulk-clear repository/UI wiring.
// Run: npm run blockers:check
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoSource = readFileSync(join(import.meta.dirname, "../src/lib/repo.ts"), "utf-8");
const panelSource = readFileSync(join(import.meta.dirname, "../src/components/SidePanel.tsx"), "utf-8");

assert.match(
  repoSource,
  /export async function resolveAllBlockers\(cwd: string\)[\s\S]*UPDATE blockers SET resolved = 1 WHERE cwd = \$1 AND resolved = 0[\s\S]*\[cwd\]/,
  "bulk resolve must update only open blockers for the supplied cwd"
);
assert.ok(
  panelSource.includes("await repo.resolveAllBlockers(cwd)"),
  "Blockers clear-all handler must use the project-scoped repository operation"
);
assert.match(
  panelSource,
  /open\.length > 1[\s\S]*title="Resolve all open blockers"[\s\S]*e\.stopPropagation\(\)[\s\S]*void clearAllBlockers\(\)/,
  "clear all must require multiple open blockers and remain separate from the collapse target"
);

console.log("blockers-check: all assertions passed");
