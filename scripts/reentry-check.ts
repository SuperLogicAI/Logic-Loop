// Self-check for re-entry's tether-keyed row shaping. Run: npm run reentry:check
import { strict as assert } from "node:assert";
import { latestPerTether } from "../src/lib/repo";

const row = (tether: string, sessionId: string, updatedAt: number, agent?: string) => ({
  session_id: sessionId,
  tab_tether: tether,
  project_key: `/Users/x/dev/${tether}`,
  cwd: `/Users/x/dev/${tether}`,
  transcript_path: `/Users/x/.claude/projects/${sessionId}.jsonl`,
  updated_at: updatedAt,
  agent,
});

// One tether, one session: passes through untouched.
assert.deepEqual(
  latestPerTether([row("tab-1", "s1", 1000)]).map((c) => c.session_id),
  ["s1"]
);

// A tether resumed more than once: only the most recent session row survives,
// regardless of insertion order.
const resumed = [row("tab-1", "s1", 1000), row("tab-1", "s2", 3000), row("tab-1", "s3", 2000)];
assert.deepEqual(
  latestPerTether(resumed).map((c) => c.session_id),
  ["s2"],
  "did not pick the most recently updated row for a resumed tether"
);

// Two independent tethers: one row each, never merged.
const two = [row("tab-1", "s1", 1000), row("tab-2", "s2", 1000)];
assert.deepEqual(
  latestPerTether(two)
    .map((c) => c.tab_tether)
    .sort(),
  ["tab-1", "tab-2"]
);

// Adapter identity survives the tether round trip.
assert.deepEqual(
  latestPerTether([row("tab-1", "s1", 1000, "codex")]).map((c) => c.agent),
  ["codex"],
  "agent field did not survive latestPerTether"
);

// A legacy/no-marker row keeps agent undefined, not fabricated.
assert.deepEqual(
  latestPerTether([row("tab-1", "s1", 1000)]).map((c) => c.agent),
  [undefined],
  "a row with no agent must not gain one"
);

console.log("reentry-check: all assertions passed");
