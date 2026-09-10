// Self-check for the Lock-in / Do Not Disturb sidequest.
// Run: npm run lock-in:check
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { shouldFlagUnclaimed, shouldNotify } from "../src/lib/ingest";
import {
  isLockInActive,
  shouldExpireTimedLockIn,
  TIMED_LOCK_IN_MS,
  visibleDockBadgeCount,
} from "../src/lib/lockIn";

assert.equal(shouldNotify("tab-2", "tab-1", true, false, false), true);
assert.equal(shouldNotify("tab-2", "tab-1", true, false, true), false);
assert.equal(shouldNotify("tab-1", "tab-1", false, false, true), false);
assert.equal(
  shouldFlagUnclaimed("tab-2", "tab-1", true),
  true,
  "Lock-in must not alter unclaimed-result evidence"
);
assert.equal(visibleDockBadgeCount(4, false), 4);
assert.equal(visibleDockBadgeCount(4, true), 0);
assert.equal(visibleDockBadgeCount(0, true), 0);
assert.equal(TIMED_LOCK_IN_MS, 60 * 60 * 1000);
assert.equal(isLockInActive("off"), false);
assert.equal(isLockInActive("indefinite"), true);
assert.equal(isLockInActive("timed"), true);
assert.equal(shouldExpireTimedLockIn("timed", 4, 4), true);
assert.equal(shouldExpireTimedLockIn("timed", 5, 4), false, "a stale timer must not unlock a newer session");
assert.equal(shouldExpireTimedLockIn("indefinite", 4, 4), false);

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const panelSource = readFileSync(new URL("../src/components/SidePanel.tsx", import.meta.url), "utf8");
const statusBarSource = readFileSync(new URL("../src/components/AgentStatusBar.tsx", import.meta.url), "utf8");
const iconSource = readFileSync(new URL("../src/components/PanelIcon.tsx", import.meta.url), "utf8");
const cssSource = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

assert.match(appSource, /const \[lockInMode, setLockInMode\] = useState<LockInMode>\("off"\)/);
assert.match(appSource, /shouldNotify\([\s\S]*lockInRef\.current\)/);
assert.match(appSource, /visibleDockBadgeCount\(waitingCount, lockIn\)/);
assert.match(appSource, /lockIn=\{lockIn\}/);
assert.match(appSource, /window\.setTimeout\([\s\S]*TIMED_LOCK_IN_MS\)/);
assert.match(appSource, /shouldExpireTimedLockIn\(/);
assert.match(appSource, /lockInMode=\{lockInMode\}/);
assert.match(appSource, /onTimedLockIn=\{\(\) => activateLockIn\("timed"\)\}/);
assert.match(panelSource, /data-rail-section=\{section\}/);
assert.match(panelSource, /count=\{!lockIn \?/);
assert.match(panelSource, /lock-in-panel/);
assert.doesNotMatch(panelSource, /onToggleLockIn|section="lock-in"/);
assert.match(
  statusBarSource,
  /onClick=\{onTogglePanel\}[\s\S]*data-lock-in-control/,
  "the Lock-in pill must follow Fold/Expand in the header"
);
assert.match(statusBarSource, /aria-label="Enter Lock-in until manually unlocked"/);
assert.match(statusBarSource, /aria-label="Enter Lock-in for 60 minutes"/);
assert.match(statusBarSource, /lockInMode === "off"/);
assert.match(statusBarSource, /name="unlock"/);
assert.match(iconSource, /"lock-in"/);
assert.match(iconSource, /"timed-lock"/);
assert.match(iconSource, /unlock/);
assert.match(cssSource, /\.lock-in-panel/);

console.log("lock-in-check: all assertions passed");
