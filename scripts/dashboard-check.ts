// Self-check for Plan 048's dashboard plumbing. Run: npm run dashboard:check
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { effectiveVisibleTerminalIds, visibleTerminalIds } from "../src/lib/splitView";
import { shouldFlagUnclaimed } from "../src/lib/ingest";
import { buildProjectCatalog } from "../src/lib/repo";
import { buildUpdateMarkdown, observedAgentTime } from "../src/lib/dashboard";
import type { SplitPaneIds } from "../src/lib/splitView";

const pair: SplitPaneIds = ["left", "right"];

// workspace surface: identical to the existing visibleTerminalIds — no split,
// solo tab, and the split-pair case all pass through unchanged.
assert.deepEqual(effectiveVisibleTerminalIds({ kind: "workspace" }, "solo", null), ["solo"]);
assert.deepEqual(effectiveVisibleTerminalIds({ kind: "workspace" }, "left", pair), pair);
assert.deepEqual(
  effectiveVisibleTerminalIds({ kind: "workspace" }, "solo", null),
  visibleTerminalIds("solo", null)
);

// Home and Project Overview: no pane counts as visible, even though activeId
// and the split pair are both still set (so returning restores them).
assert.deepEqual(effectiveVisibleTerminalIds({ kind: "home" }, "solo", null), []);
assert.deepEqual(effectiveVisibleTerminalIds({ kind: "home" }, "left", pair), []);
assert.deepEqual(
  effectiveVisibleTerminalIds({ kind: "project", projectKey: "/repo" }, "solo", null),
  []
);

// The bug this phase's Step 1 fixes: viewedId() must not fall back to
// activeIdRef.current when the active tab is outside the (possibly empty)
// visible set — that fallback would silently mark a Home-surface background
// result as "viewed" since activeId never changes when Home opens. A `null`
// viewedId, by contrast, can never equal a real tabId, so shouldFlagUnclaimed
// correctly flags it regardless of what activeId secretly still points at.
const resolveViewedId = (tabId: string, visible: Set<string>): string | null =>
  visible.has(tabId) ? tabId : null;

const visibleOnHome = new Set(effectiveVisibleTerminalIds({ kind: "home" }, "tab-1", null));
assert.equal(resolveViewedId("tab-1", visibleOnHome), null, "Home must not resolve a viewed tab");
assert.equal(
  shouldFlagUnclaimed("tab-1", resolveViewedId("tab-1", visibleOnHome), true),
  true,
  "a Stop on the tab behind Home must still flag as unclaimed"
);

// Same shape in workspace mode, unchanged from before this phase: the active
// tab resolves as viewed, a background split-less tab does not.
const visibleInWorkspace = new Set(effectiveVisibleTerminalIds({ kind: "workspace" }, "tab-1", null));
assert.equal(resolveViewedId("tab-1", visibleInWorkspace), "tab-1");
assert.equal(resolveViewedId("tab-2", visibleInWorkspace), null);
assert.equal(shouldFlagUnclaimed("tab-1", resolveViewedId("tab-1", visibleInWorkspace), true), false);
assert.equal(shouldFlagUnclaimed("tab-2", resolveViewedId("tab-1", visibleInWorkspace), true), true);

// Pin the actual App.tsx fix in place: no remaining ": activeIdRef.current"
// fallback on either viewedId computation (the pattern this bug lived in).
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
assert.doesNotMatch(
  app,
  /visibleTabIdsRef\.current\.has\([^)]*\)\s*\?\s*[^:]*:\s*activeIdRef\.current/,
  "viewedId must not fall back to activeIdRef.current (Plan 048 Step 1)"
);
assert.match(app, /visibleTabIdsRef\.current\.has\(tabId\) \? tabId : null/);
assert.match(app, /visibleTabIdsRef\.current\.has\(tab\.id\) \? tab\.id : null/);

// --- listProjectCatalog's pure merge step (Step 3) ---

// Same-name folders at different paths must stay distinct catalog entries —
// nothing collapses by basename here, only by the full canonical key string.
const sameName = buildProjectCatalog(
  [
    { key: "/Users/a/proj", first_seen_at: 100, last_activity_at: 100 },
    { key: "/Users/b/proj", first_seen_at: 200, last_activity_at: 200 },
  ],
  [],
  [],
  []
);
assert.deepEqual(
  sameName.map((e) => e.projectKey).sort(),
  ["/Users/a/proj", "/Users/b/proj"].sort()
);

// A bookmark resolved to a subdirectory's repo root (the caller's job, via
// projectKeyOf — see listProjectCatalog) must land on the SAME catalog entry
// as activity already recorded at that root, not a second row.
const subdirMerge = buildProjectCatalog(
  [{ key: "/repo", first_seen_at: 100, last_activity_at: 500 }],
  ["/repo"], // already-resolved: projectKeyOf("/repo/src/sub") -> "/repo"
  [],
  []
);
assert.equal(subdirMerge.length, 1, "a resolved bookmark key must merge into the existing root entry");
assert.equal(subdirMerge[0].lastActivityAt, 500, "merge must not clobber the activity already on record");

// Archived and "has an active session binding" are independent flags —
// archiving a project must not erase or hide that it still has one.
const archivedWithSession = buildProjectCatalog(
  [{ key: "/repo", first_seen_at: 100, last_activity_at: 100 }],
  [],
  [{ project_key: "/repo", any_active: 1 }],
  [{ key: "project_archived:/repo", value: "1" }]
);
assert.equal(archivedWithSession.length, 1);
assert.equal(archivedWithSession[0].archived, true);
assert.equal(
  archivedWithSession[0].hasActiveSessionBinding,
  true,
  "archiving must not suppress the active-session-binding fact"
);

// A project known only by a pin/archive/purpose setting (no bookmark, no
// session, no decision/blocker/note yet) still gets a catalog row.
const settingsOnly = buildProjectCatalog([], [], [], [{ key: "project_pinned:/new-repo", value: "1" }]);
assert.deepEqual(settingsOnly.map((e) => e.projectKey), ["/new-repo"]);
assert.equal(settingsOnly[0].pinned, true);
assert.equal(settingsOnly[0].hasActiveSessionBinding, false);

// --- observedAgentTime (Step 4) ---

// A closed interval (working -> waiting) counts; a trailing "working" with
// no later observation in the same run is dropped, not extended.
const closedThenOpen = observedAgentTime([
  { sessionId: "s1", runId: "run-1", state: "working", observedAt: 0 },
  { sessionId: "s1", runId: "run-1", state: "waiting", observedAt: 60_000 },
  { sessionId: "s1", runId: "run-1", state: "working", observedAt: 120_000 }, // open at run end
]);
assert.equal(closedThenOpen.totalMs, 60_000, "only the closed interval should count");
assert.equal(closedThenOpen.sessionCount, 1);
assert.equal(closedThenOpen.sinceDate, 0);

// A session whose only observation is "working" and never closes contributes
// zero time — the open-interval-at-run-end case in isolation.
const neverClosed = observedAgentTime([{ sessionId: "s2", runId: "run-1", state: "working", observedAt: 0 }]);
assert.equal(neverClosed.totalMs, 0);
assert.equal(neverClosed.sessionCount, 0, "a session with no closed interval must not be counted");

// A later run for the same session never closes the earlier run's trailing
// open interval — crossing a run boundary must not implicitly extend it.
const runBoundary = observedAgentTime([
  { sessionId: "s3", runId: "run-1", state: "working", observedAt: 0 }, // open at end of run-1
  { sessionId: "s3", runId: "run-2", state: "waiting", observedAt: 500_000 }, // new run, does not close run-1
]);
assert.equal(runBoundary.totalMs, 0, "a new run must not retroactively close a previous run's open interval");

// Parallel sessions: two sessions with overlapping closed intervals both
// contribute their full duration — no wall-clock capping/dedup.
const parallel = observedAgentTime([
  { sessionId: "a", runId: "run-1", state: "working", observedAt: 0 },
  { sessionId: "a", runId: "run-1", state: "idle", observedAt: 100_000 },
  { sessionId: "b", runId: "run-1", state: "working", observedAt: 20_000 },
  { sessionId: "b", runId: "run-1", state: "idle", observedAt: 120_000 },
]);
assert.equal(parallel.totalMs, 200_000, "overlapping sessions must sum, not cap at wall clock");
assert.equal(parallel.sessionCount, 2);

assert.deepEqual(observedAgentTime([]), { totalMs: 0, sinceDate: null, sessionCount: 0 });

// --- buildUpdateMarkdown (Step 4) ---

const fullUpdate = buildUpdateMarkdown({
  projectName: "Harbor website",
  rangeLabel: "Sep 22–29",
  progressLines: ["Booking form added (agent-reported)"],
  commitSubjects: ["Add form", "Fix date picker", "Copy tweaks"],
  decisionsNeeded: [{ question: "Which booking provider?", assumption: "Stripe" }],
  blockerLines: [],
  nextStep: "Verify the booking confirmation flow",
});
assert.equal(
  fullUpdate,
  [
    "## Harbor website — update (Sep 22–29)",
    "**Progress**",
    "- Booking form added (agent-reported)",
    "- 3 local commits: Add form; Fix date picker; Copy tweaks",
    "**Decisions needed**",
    "- Which booking provider? (current assumption: Stripe)",
    "**Blockers**",
    "- none recorded",
    "**Next**",
    "- Verify the booking confirmation flow",
  ].join("\n"),
  "update markdown must match the Plan 048 §3 example exactly"
);

// Every section empty: each says "none recorded", never omitted or implying
// health.
const emptyUpdate = buildUpdateMarkdown({
  projectName: "Quiet project",
  rangeLabel: "Sep 1–8",
  progressLines: [],
  commitSubjects: [],
  decisionsNeeded: [],
  blockerLines: [],
  nextStep: null,
});
for (const section of ["**Progress**\n- none recorded", "**Decisions needed**\n- none recorded", "**Blockers**\n- none recorded", "**Next**\n- none recorded"]) {
  assert.ok(emptyUpdate.includes(section), `expected "${section}" in an all-empty update`);
}

// Paths/commands: a progress line carrying a file path or shell command past
// its first line must not leak the rest into the draft.
const multilineProgress = buildUpdateMarkdown({
  projectName: "P",
  rangeLabel: "R",
  progressLines: ["Booking form added\n/Users/dev/repo/src/booking.ts\n$ npm test -- --watch"],
  commitSubjects: [],
  decisionsNeeded: [],
  blockerLines: [],
  nextStep: null,
});
assert.ok(multilineProgress.includes("- Booking form added"));
assert.ok(!multilineProgress.includes("/Users/dev/repo"), "a file path past the first line must not appear");
assert.ok(!multilineProgress.includes("npm test"), "command text past the first line must not appear");

console.log("dashboard-check: all assertions passed");
