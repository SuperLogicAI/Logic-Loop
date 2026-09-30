// Self-check for Plan 048's surface/visibility plumbing. Run: npm run dashboard:check
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { effectiveVisibleTerminalIds, visibleTerminalIds } from "../src/lib/splitView";
import { shouldFlagUnclaimed } from "../src/lib/ingest";
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

console.log("dashboard-check: all assertions passed");
