// Self-check for the Phase 17 decisions-by-session grouping. Run: npm run decisions:check
import { strict as assert } from "node:assert";
import { groupDecisionsBySession } from "../src/lib/repo";
import type { Decision } from "../src/types";

const d = (id: number, session_id: string, ts: number): Decision => ({
  id,
  session_id,
  cwd: "/repo",
  question: `q${id}`,
  status: "open",
  user_answer: null,
  assumption: null,
  context_json: "{}",
  ts,
});

// Empty project: no clusters.
assert.deepEqual(groupDecisionsBySession([]), []);

// Single session, single decision: no dismiss-all implied (n === 1 is the
// component's cue to hide the button).
const single = groupDecisionsBySession([d(1, "s1", 100)]);
assert.equal(single.length, 1);
assert.equal(single[0].n, 1);
assert.equal(single[0].min_ts, 100);
assert.equal(single[0].max_ts, 100);

// Multiple sessions: newest max_ts first, counts and ts range correct per
// cluster, and clusters don't bleed into each other.
const grouped = groupDecisionsBySession([
  d(1, "old", 100),
  d(2, "old", 200),
  d(3, "new", 500),
  d(4, "mid", 300),
  d(5, "mid", 350),
  d(6, "mid", 320),
]);
assert.deepEqual(
  grouped.map((g) => g.session_id),
  ["new", "mid", "old"],
  "clusters sort by max_ts desc"
);
const mid = grouped.find((g) => g.session_id === "mid")!;
assert.equal(mid.n, 3);
assert.equal(mid.min_ts, 300);
assert.equal(mid.max_ts, 350);
const old = grouped.find((g) => g.session_id === "old")!;
assert.equal(old.n, 2);
assert.equal(old.min_ts, 100);
assert.equal(old.max_ts, 200);

console.log("decisions-check: all assertions passed");
