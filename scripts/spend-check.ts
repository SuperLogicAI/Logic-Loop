// Self-check for the Plan 059 token spend meter. Run: npm run spend:check
import { strict as assert } from "node:assert";
import {
  addSpend,
  addSubagentStates,
  effortUnits,
  SPARK_FULL_SCALE,
  sparkHeights,
  SPEND_AMBER,
  SPEND_RED,
  spendLevel,
  spendCoverage,
  spendSummary,
  subagentLabel,
  subagentState,
  UNKNOWN_TTL_MS,
  type SubagentEventRow,
  type UsageRow,
} from "../src/lib/spend";
import { isSubagentLifecycle, isTerminalResult, stateForHook } from "../src/lib/ingest";

let id = 0;
const ev = (type: string, ts: number, agent_id: string | null = null, session_id = "s1"): SubagentEventRow => ({ id: ++id, ts, session_id, type: `hook:${type}`, agent_id });

// Counts only; `now` well inside the unknown TTL unless a test says otherwise.
const st = (rows: SubagentEventRow[], live: boolean, now = 100) => {
  const { active, unknown } = subagentState(rows, live, now);
  return { active, unknown };
};

// Start/Stop pairing.
assert.deepEqual(st([ev("SubagentStart", 1, "a"), ev("SubagentStart", 2, "b"), ev("SubagentStop", 3, "a")], true), { active: 1, unknown: 0 });
assert.deepEqual(st([ev("SubagentStart", 1, "a"), ev("SubagentStop", 2, "a")], true), { active: 0, unknown: 0 });

// Start re-fires on child resume: one ID, counted once; one Stop closes it.
assert.deepEqual(st([ev("SubagentStart", 1, "a"), ev("SubagentStart", 2, "a")], true), { active: 1, unknown: 0 });
assert.deepEqual(st([ev("SubagentStart", 1, "a"), ev("SubagentStart", 2, "a"), ev("SubagentStop", 3, "a")], true), { active: 0, unknown: 0 });

// Stop without a Start (late attach) never goes negative.
assert.deepEqual(st([ev("SubagentStop", 1, "a")], true), { active: 0, unknown: 0 });

// Missing Stop + dead tab → unknown, not a stuck count.
assert.deepEqual(st([ev("SubagentStart", 1, "a")], false), { active: 0, unknown: 1 });

// Parent SessionEnd with an open child → unknown; a child's own SessionEnd (agent_id set) is not the parent's.
assert.deepEqual(st([ev("SubagentStart", 1, "a"), ev("SessionEnd", 2)], true), { active: 0, unknown: 1 });
assert.deepEqual(st([ev("SubagentStart", 1, "a"), ev("SessionEnd", 2, "a")], true), { active: 1, unknown: 0 });

// Resume after end: old open child stays unknown, new children are active; a late Stop clears the stale one.
const resumed = [ev("SubagentStart", 1, "a"), ev("SessionEnd", 2), ev("SessionStart", 3), ev("SubagentStart", 4, "b")];
assert.deepEqual(st(resumed, true), { active: 1, unknown: 1 });
assert.deepEqual(st([...resumed, ev("SubagentStop", 5, "a")], true), { active: 1, unknown: 0 });

// A SessionStart without a prior end (Claude /compact) leaves running children alone.
assert.deepEqual(st([ev("SubagentStart", 1, "a"), ev("SessionStart", 2)], true), { active: 1, unknown: 0 });

// A different session starting in the tab (Claude /clear or in-tab /resume, no SessionEnd)
// turns the old session's open child unknown; the new session's children count normally.
const switched = [ev("SubagentStart", 1, "a", "s1"), ev("SessionStart", 2, null, "s2"), ev("SubagentStart", 3, "b", "s2")];
assert.deepEqual(st(switched, true), { active: 1, unknown: 1 });
// A same-session SessionStart right after the child started (compact) doesn't.
assert.deepEqual(st([ev("SubagentStart", 1, "a", "s2"), ev("SessionStart", 2, null, "s2")], true), { active: 1, unknown: 0 });

// Ordering by (ts, id), not array order.
const late = ev("SubagentStop", 5, "a");
assert.deepEqual(st([late, ev("SubagentStart", 1, "a")], true), { active: 0, unknown: 0 });

// Empty agent_id is not a child.
assert.deepEqual(st([{ ...ev("SubagentStart", 1), agent_id: "" }], true), { active: 0, unknown: 0 });

// Unknown ages out after the TTL, counted from when it became unknown.
const orphan = [ev("SubagentStart", 1, "a", "s1"), ev("SessionStart", 50, null, "s2")];
assert.deepEqual(st(orphan, true, 50 + UNKNOWN_TTL_MS - 1), { active: 0, unknown: 1 });
assert.deepEqual(st(orphan, true, 50 + UNKNOWN_TTL_MS + 1), { active: 0, unknown: 0 });
assert.equal(subagentState(orphan, true, 100).recheckAt, 50 + UNKNOWN_TTL_MS);
assert.equal(subagentState([ev("SubagentStart", 1, "a")], true, 100).recheckAt, null);
// Dead tab: ages from the tab's last row.
assert.deepEqual(st([ev("SubagentStart", 1, "a"), ev("SubagentStop", 40, "z")], false, 40 + UNKNOWN_TTL_MS + 1), { active: 0, unknown: 0 });

// Two sessions in one project add up.
const proj = addSubagentStates(addSubagentStates(undefined, { active: 2, unknown: 0, recheckAt: null }), { active: 1, unknown: 1, recheckAt: 9 });
assert.deepEqual(proj, { active: 3, unknown: 1, recheckAt: 9 });

// Labels.
assert.equal(subagentLabel(undefined), null);
assert.equal(subagentLabel({ active: 0, unknown: 0 }), null);
assert.equal(subagentLabel({ active: 1, unknown: 0 }), "1 subagent");
assert.equal(subagentLabel({ active: 2, unknown: 1 }), "2 subagents · 1 ?");
assert.equal(subagentLabel({ active: 0, unknown: 2 }), "2 subagents ?");

// Lifecycle hooks are recognized and never drive parent state or land a result.
for (const name of ["SubagentStart", "SubagentStop"]) {
  const p = { hook_event_name: name, session_id: "s", agent_id: "a" };
  assert.equal(isSubagentLifecycle(p), true);
  assert.equal(stateForHook(p), null);
  assert.equal(isTerminalResult(p), false);
}
assert.equal(isSubagentLifecycle({ hook_event_name: "Stop", session_id: "s" }), false);

// ---- Checkpoint 2: effort units and rate ----
// Normalized input includes caches; fresh = input − read − write, floored at 0.
assert.equal(effortUnits({ input: 2000 + 150_000, cache_read: 150_000, cache_write: 0, output: 1000 }), 2000 + 15_000 + 5000);
assert.equal(effortUnits({ input: 100, cache_read: 0, cache_write: 100, output: 0 }), 125);
assert.equal(effortUnits({ input: 10, cache_read: 50, cache_write: 0, output: 0 }), 5, "fresh floors at 0");
// The IDEAS example: 4 responses/min of 150k cached + 2k fresh + 1k output → 88k units/min.
const MIN = 60_000;
const NOW = 100 * MIN;
const row = (ts: number, over: Partial<UsageRow> = {}): UsageRow => ({
  agent: "codex", root_session_id: "R", thread_id: "T1", source_ts: ts,
  input: 152_000, cache_read: 150_000, cache_write: 0, output: 1000, ...over,
});
const steady = Array.from({ length: 24 }, (_, i) => row(NOW - i * 15_000 - 1)); // 4/min for 6 min
const sum = spendSummary(steady, NOW)!;
assert.equal(sum.windowMin, 5);
assert.equal(Math.round(sum.ratePerMin), 88_000);
assert.equal(sum.total, 24 * 22_000);
assert.equal(sum.burstPerMin, 4 * 22_000, "last 1 min = 4 responses");
// Growing window: a young session divides by its age (floor 1 min), not 5.
const young = spendSummary([row(NOW - 30_000, { input: 50_000, cache_read: 0, output: 0 })], NOW)!;
assert.equal(young.windowMin, 1);
assert.equal(young.ratePerMin, 50_000, "50k in the first 30 s reads 50k/min, not 10k");
const three = spendSummary([row(NOW - 3 * MIN + 1), row(NOW - 10)], NOW)!;
assert.ok(Math.abs(three.windowMin - 3) < 0.001);
assert.equal(Math.round(three.ratePerMin), Math.round((2 * 22_000) / three.windowMin));
// No handoff jump: the window's size is continuous as the session reaches 5 min.
const win = (age: number) => spendSummary([row(NOW - age)], NOW)!.windowMin;
assert.ok(5 - win(5 * MIN - 1) < 0.001);
assert.equal(win(5 * MIN + 1), 5);
assert.equal(win(20 * MIN), 5);
assert.equal(sum.lastSampleAt, NOW - 1);
// Backfilled history counts in the total, never in the current rate.
const old = spendSummary([row(NOW - 3 * 60 * MIN)], NOW)!;
assert.equal(old.ratePerMin, 0);
assert.equal(old.total, 22_000);
assert.ok(old.sparkline.every((v) => v === 0));
// Window edge (5-min session): just past 5 min is out; at or inside is in.
const edge = (age: number) => spendSummary([row(NOW - 10 * MIN), row(NOW - age)], NOW)!.ratePerMin;
assert.equal(edge(5 * MIN + 1), 0);
assert.ok(edge(5 * MIN) > 0);
// Sparkline: newest minute last.
const spark = spendSummary([row(NOW - 10), row(NOW - 3 * MIN - 10)], NOW)!.sparkline;
assert.equal(spark.length, 15);
assert.ok(spark[14] > 0 && spark[11] > 0 && spark[13] === 0);
// Parent + child threads aggregate; odometer is the root with the newest sample.
const kids = spendSummary([row(NOW - 10), row(NOW - 20, { thread_id: "T2" }), row(NOW - 60 * MIN, { root_session_id: "OLD" })], NOW)!;
assert.equal(kids.rootSessionId, "R");
assert.equal(kids.total, 2 * 22_000);
assert.deepEqual(kids.threads.map((t) => t.threadId).sort(), ["T1", "T2"]);
assert.equal(spendSummary([], NOW), null);
// Two tabs on the same root count once; different roots add.
const a1 = spendSummary([row(NOW - 10)], NOW)!;
assert.equal(addSpend([a1, a1])!.total, 22_000);
assert.equal(addSpend([a1, spendSummary([row(NOW - 10, { root_session_id: "S" })], NOW)!])!.total, 44_000);
// Fixed scale: 44k/min is ~a fifth of full height, not "maxed" (live check 95 finding).
assert.deepEqual(sparkHeights([0, 44_000, SPARK_FULL_SCALE, 3 * SPARK_FULL_SCALE, -5]), [0, 0.22, 1, 1, 0]);
// Bar colors by each minute's own level: the 39k run in check 95 stays blue.
assert.deepEqual([0, 39_000, SPEND_AMBER - 1, SPEND_AMBER, SPEND_RED - 1, SPEND_RED, 900_000].map(spendLevel),
  ["zero", "normal", "normal", "high", "high", "peak", "peak"]);
// Coverage counts this root's threads only.
const th = (thread_id: string, root: string, status: "pending" | "recorded" | "unsupported" | "unreadable") =>
  ({ agent: "codex", root_session_id: root, thread_id, kind: "main", tab_id: null, project_key: null, status });
assert.deepEqual(spendCoverage([th("T1", "R", "recorded"), th("T2", "R", "pending"), th("X", "Q", "recorded")], "R"), { recorded: 1, seen: 2 });

console.log("spend-check: all assertions passed");
