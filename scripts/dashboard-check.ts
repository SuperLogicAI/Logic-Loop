// Self-check for Plan 048's dashboard plumbing. Run: npm run dashboard:check
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { effectiveVisibleTerminalIds, visibleTerminalIds } from "../src/lib/splitView";
import { shouldFlagUnclaimed } from "../src/lib/ingest";
import { buildProjectCatalog, selectProjectBookmark } from "../src/lib/repo";
import { EXAMPLE_BOARD } from "../src/lib/board";
import {
  buildProjectCards,
  buildUpdateMarkdown,
  observedAgentTime,
  projectDisplayName,
  projectFolderLabel,
  sortProjectCards,
  buildProjectWorkLog,
  commitsInRange,
  dashboardRangeStart,
  resolveHomeStartSurface,
  projectWorkspaceChoices,
  exportSafeLine,
  copyDraft,
  OMITTED_LINE,
} from "../src/lib/dashboard";
import { isEditableShortcutTarget } from "../src/lib/shortcuts";
import type { ProjectCatalogEntry } from "../src/lib/repo";
import { DashboardReadCache, observeDashboardRead, type ReadDiagnostic, type ReadState } from "../src/lib/dashboardLoader";
import type { Tab } from "../src/types";
import type { ProjectWorkLogRow } from "../src/lib/repo";
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
assert.equal(settingsOnly[0].bookmarked, false);

// A bookmarked project with no other activity is flagged bookmarked, which
// Home uses to exempt it from the 30-day older-projects cutoff.
const bookmarkedOnly = buildProjectCatalog([], ["/bookmarked-repo"], [], []);
assert.equal(bookmarkedOnly.length, 1);
assert.equal(bookmarkedOnly[0].bookmarked, true);
assert.equal(bookmarkedOnly[0].pinned, false);

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

// --- buildProjectCards / sortProjectCards (closing the two Step 3 verify
// bullets deferred to land with this shaping layer) ---

function catalogEntry(overrides: Partial<ProjectCatalogEntry>): ProjectCatalogEntry {
  return {
    projectKey: "/repo",
    pinned: false,
    archived: false,
    bookmarked: false,
    purpose: null,
    hasActiveSessionBinding: false,
    firstSeenAt: null,
    lastActivityAt: null,
    ...overrides,
  };
}

const NOW = Date.parse("2026-09-29T00:00:00Z");

// Archived project with a live "working" tab: still counted as Working, and
// still labeled Archived — neither suppresses the other on the card.
const archivedCards = buildProjectCards(
  [catalogEntry({ projectKey: "/repo", archived: true, lastActivityAt: NOW })],
  [{ projectKey: "/repo", status: "live", agentState: "working" }],
  NOW
);
assert.equal(archivedCards[0].archived, true);
assert.equal(archivedCards[0].workingCount, 1, "an archived project's live working tab must still be counted");

// Older-projects cutoff: 31 days idle and unpinned/unbookmarked is eligible
// for the fold; pinned or bookmarked is exempt regardless of age; no
// activity on record at all is "no activity yet", not "old".
const DAY_MS = 24 * 60 * 60 * 1000;
const cutoffCards = buildProjectCards(
  [
    catalogEntry({ projectKey: "/old", lastActivityAt: NOW - 31 * DAY_MS }),
    catalogEntry({ projectKey: "/old-but-pinned", pinned: true, lastActivityAt: NOW - 31 * DAY_MS }),
    catalogEntry({ projectKey: "/old-but-bookmarked", bookmarked: true, lastActivityAt: NOW - 31 * DAY_MS }),
    catalogEntry({ projectKey: "/recent", lastActivityAt: NOW - 1 * DAY_MS }),
    catalogEntry({ projectKey: "/never-active", lastActivityAt: null }),
  ],
  [],
  NOW
);
const byKey = Object.fromEntries(cutoffCards.map((c) => [c.projectKey, c]));
assert.equal(byKey["/old"].olderProject, true);
assert.equal(byKey["/old-but-pinned"].olderProject, false, "pinned must exempt from the cutoff");
assert.equal(byKey["/old-but-bookmarked"].olderProject, false, "bookmarked must exempt from the cutoff");
assert.equal(byKey["/recent"].olderProject, false);
assert.equal(byKey["/never-active"].olderProject, false, "no activity on record is not the same as old");

// Sort: pinned first, then most recently active, then project key —
// deterministic given the same input, regardless of input order.
const unsorted = buildProjectCards(
  [
    catalogEntry({ projectKey: "/b-recent", lastActivityAt: NOW - 1 * DAY_MS }),
    catalogEntry({ projectKey: "/a-pinned", pinned: true, lastActivityAt: NOW - 10 * DAY_MS }),
    catalogEntry({ projectKey: "/c-older", lastActivityAt: NOW - 5 * DAY_MS }),
  ],
  [],
  NOW
);
assert.deepEqual(
  sortProjectCards(unsorted).map((c) => c.projectKey),
  ["/a-pinned", "/b-recent", "/c-older"]
);

// --- projectDisplayName ---

const noCollision = ["/Users/a/harbor", "/Users/a/other-repo"];
assert.equal(projectDisplayName("/Users/a/harbor", noCollision), "harbor");

const collision = ["/Users/a/proj", "/Users/b/proj"];
assert.equal(projectDisplayName("/Users/a/proj", collision), "a/proj");
assert.equal(projectDisplayName("/Users/b/proj", collision), "b/proj");

// --- board.ts's EXAMPLE_BOARD mirrors board.rs's byte-for-byte. Two
// independent constants (see board.ts's comment) — this is the tripwire
// that catches one side drifting without the other. ---

const boardRs = readFileSync(new URL("../src-tauri/src/board.rs", import.meta.url), "utf8");
const rustConstMatch = /const EXAMPLE_BOARD: &str = "((?:[^"\\]|\\.)*)";/s.exec(boardRs);
assert.ok(rustConstMatch, "could not find EXAMPLE_BOARD in board.rs — update this check if it moved/renamed");
const rustExampleBoard = rustConstMatch![1]
  .replace(/\\n\\\n/g, "\n") // Rust's `\n\` line-continuation inside the literal
  .replace(/\\n/g, "\n")
  .replace(/\\"/g, '"');
assert.equal(EXAMPLE_BOARD, rustExampleBoard, "board.ts's EXAMPLE_BOARD has drifted from board.rs's");



// Real production observer/cache, controlled promises and injected time.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let clockNow = 0;
const timers = new Set<() => void>();
const clock = {
  now: () => clockNow,
  schedule: (callback: () => void, _ms: number) => { timers.add(callback); return () => { timers.delete(callback); }; },
};
const diagnostics: ReadDiagnostic[] = [];
const updates: { source: string; state: ReadState<unknown> }[] = [];
const choices = deferred<number[]>();
const git = deferred<number[]>();
const board = deferred<string>();
const observe = <T>(source: string, promise: Promise<T>) => observeDashboardRead(source, promise,
  (state) => updates.push({ source, state }), (event) => diagnostics.push(event), clock);
const stopChoices = observe("decisions", choices.promise);
const stopGit = observe("git", git.promise);
const stopBoard = observe("board", board.promise);
choices.resolve(Array.from({ length: 33 }, (_, i) => i));
await Promise.resolve();
assert.equal(updates.length, 1, "pending filesystem sources must not withhold resolved choices");
assert.equal(updates[0].source, "decisions");
assert.equal(diagnostics[0].count, 33);
board.reject(new Error("private error content must not appear in diagnostics"));
await Promise.resolve();
assert.deepEqual(updates[1], { source: "board", state: { state: "error", reason: "failed" } });
clockNow = 10_000;
for (const timer of [...timers]) timer();
assert.deepEqual(updates[2], { source: "git", state: { state: "error", reason: "timeout" } });
git.resolve([1]);
await Promise.resolve();
assert.equal(updates.length, 3, "late native results must not overwrite timeout state");
stopChoices(); stopGit(); stopBoard();
assert.equal(timers.size, 0);
assert.ok(!JSON.stringify(diagnostics).includes("private"));

const stale = deferred<number[]>();
const stopStale = observe("old-project", stale.promise);
stopStale();
stale.resolve([1]);
await Promise.resolve();
assert.equal(updates.length, 3, "unmounted/old project callbacks must never publish");
assert.equal(timers.size, 0, "disposing removes the timer");
assert.equal(diagnostics.at(-1)?.outcome, "cancelled");

const cache = new DashboardReadCache(() => clockNow);
const native = deferred<number[]>();
let nativeCalls = 0;
const loadNative = () => { nativeCalls++; return native.promise; };
const first = cache.read("/a:git", loadNative, 30_000);
assert.equal(cache.read("/a:git", loadNative, 30_000), first, "StrictMode must coalesce");
await Promise.resolve();
assert.equal(nativeCalls, 1);
clockNow += 45_000;
assert.equal(cache.read("/a:git", loadNative, 30_000), first, "retry after timeout cannot duplicate pending native work");
native.resolve([1]);
await first;
assert.equal(cache.read("/a:git", loadNative, 30_000), first, "settled native results cached for 30s");
clockNow += 30_000;
const second = cache.read("/a:git", loadNative, 30_000);
await second;
assert.equal(nativeCalls, 2, "expired settled reads refresh");
let attempts = 0;
await assert.rejects(cache.read("fail", async () => { attempts++; throw new Error("unavailable"); }));
await assert.rejects(cache.read("fail", async () => { attempts++; throw new Error("unavailable"); }));
assert.equal(attempts, 2, "failed reads remain retryable");

// Unit conversion and bounded windows agree with events' (since, until].
assert.deepEqual(commitsInRange([
  { hash: "old", ts: 10, subject: "old" }, { hash: "inside", ts: 11, subject: "inside" },
  { hash: "end", ts: 12, subject: "end" }, { hash: "future", ts: 13, subject: "future" },
], 10_000, 12_000).map((c) => c.hash), ["inside", "end"]);
const today = new Date(2026, 8, 30, 14, 20).getTime();
assert.equal(dashboardRangeStart("today", today), new Date(2026, 8, 30).getTime());
assert.equal(dashboardRangeStart("7d", today), today - 7 * 86_400_000);

const dayOne = new Date(2026, 8, 29, 12).getTime();
const dayTwo = new Date(2026, 8, 30, 12).getTime();
const event = (id: number, session_id: string, ts: number): ProjectWorkLogRow => ({
  id, session_id, ts, type: "hook:UserPromptSubmit", payload_json: "{}", agent: "codex",
});
const log = buildProjectWorkLog([event(1, "session-a", dayOne), event(2, "session-a", dayTwo),
  event(3, "session-b", dayTwo), event(2, "session-a", dayTwo)]);
assert.equal(log.length, 3, "each session/day is separate and duplicate event IDs are ignored");
assert.deepEqual(log.map((row) => row.turns), [1, 1, 1]);
assert.equal(new Set(log.map((row) => row.key)).size, 3);
assert.deepEqual(buildProjectWorkLog([]), []);
const reported = (id: number, ts: number, text: string): ProjectWorkLogRow => ({
  ...event(id, "session-a", ts), type: "transcript", payload_json: JSON.stringify({ type: "assistant", message: { content: text } }),
});
const dailyReports = buildProjectWorkLog([reported(10, dayOne, "First day report"), reported(11, dayTwo, "Second day report"),
  { ...event(12, "session-a", dayOne + 1), type: "hook:PostToolUse", payload_json: JSON.stringify({ tool_name: "Edit", tool_input: { file_path: "/fixture.ts" } }) }]);
assert.deepEqual(dailyReports.map((row) => row.excerpt), ["Second day report", "First day report"], "assistant excerpts stay within their own day");
assert.deepEqual(dailyReports.map((row) => row.filesEdited), [0, 1], "file counts stay within their own day");

const unsafeUpdate = buildUpdateMarkdown({
  projectName: "P", rangeLabel: "7 days", progressLines: ["Edited /Users/private/src/a.ts", "Run npm run build"],
  commitSubjects: ["Fix src/private.ts"], decisionsNeeded: [{ question: "Run `curl secret`?", assumption: "C:\\secret\\a.ts" }],
  blockerLines: ["$ rm -rf secret"], nextStep: "Check ./private/a.ts",
});
for (const secret of ["/Users/private", "npm run", "src/private.ts", "curl secret", "C:", "rm -rf", "./private"]) {
  assert.ok(!unsafeUpdate.includes(secret), `unsafe first-line detail leaked: ${secret}`);
}
assert.ok(unsafeUpdate.includes("Technical details omitted"), "omitted evidence is not rendered as none recorded");
const overviewSource = readFileSync(new URL("../src/components/ProjectOverview.tsx", import.meta.url), "utf8");
assert.doesNotMatch(overviewSource, /\[projectKey, range, now\]/, "age clock must not drive reads");
assert.doesNotMatch(overviewSource, /repo\.eventsSince|repo\.listProjectCatalog/, "Overview must not fan out tether scans or resolve unrelated bookmarks");
assert.equal(resolveHomeStartSurface(null, false), "home", "fresh profiles start on Home");
assert.equal(resolveHomeStartSurface(null, true), "workspace", "existing profiles preserve startup");
assert.equal(resolveHomeStartSurface("home", true), "home", "saved preference wins over profile history");
assert.equal(resolveHomeStartSurface("workspace", false), "workspace");
const workspaceTab = (id: string, cwd: string, status: "live" | "dead"): Tab => ({ id, cwd, status, ptyId: -1, title: id, color: "#fff" });
assert.deepEqual(projectWorkspaceChoices([workspaceTab("a", "/p", "live"), workspaceTab("b", "/p", "dead"), workspaceTab("c", "/elsewhere", "live")], "/p", (cwd) => cwd).map((tab) => tab.id), ["a", "b"], "chooser includes exact project's live and restorable tabs only");
assert.match(overviewSource, /aria-label="Continue in workspace"/);
assert.doesNotMatch(overviewSource, /onContinueTab\(liveTabs\[0\]\.id\)/, "multiple workspaces must not silently pick first live tab");
assert.match(app, /getHomeStartSurface\(\)/);
assert.match(app, /startSurface === "workspace"/);
const statusBarSource = readFileSync(new URL("../src/components/AgentStatusBar.tsx", import.meta.url), "utf8");
assert.match(statusBarSource, /setupOpen && createPortal/, "Setup must stay visible when Home hides the workspace ancestor");
const tourSource = readFileSync(new URL("../src/components/FeatureTour.tsx", import.meta.url), "utf8");
assert.match(tourSource, /getClientRects\(\)\.length > 0/, "Home tour must skip targets in hidden workspace ancestors");
const copySource = readFileSync(new URL("../src/components/CopyUpdateModal.tsx", import.meta.url), "utf8");
assert.match(copySource, /querySelector<HTMLTextAreaElement>\("textarea"\)\?\.focus\(\)/);
// --- Phase 48 release repair: export minimization (real-data leaks) ---
const mustOmit = [
  "ls: src-tauri/migrations: No such file or directory", // observed live under Blockers
  "rm -rf build",
  "npm run build failed",
  "Edited src/lib/repo.ts",
  "Moved the helpers into src/components",
  "Read config/secrets before deploying",
  "Saved it to ~/x",
  "See ../plans/x.md for details",
  "Docs at https://example.com/a",
  "Run `cmd` first",
  "make build",
  "bash deploy.sh",
  "python3 migrate.py",
  "Updated deploy.sh",
  "Compare Home/Overview counts",
  "git push failed on main",
  "Then run cargo test --lib",
  "cat: no such file",
  "Try find -name x",
];
for (const line of mustOmit) assert.equal(exportSafeLine(line), OMITTED_LINE, `leaked: ${line}`);
assert.equal(exportSafeLine("See [Plan 048](plans/048-x.md) for scope"), "See Plan 048 for scope", "link target must drop, text stays");
assert.equal(exportSafeLine("[src/a.ts](src/a.ts)"), OMITTED_LINE, "a path as link text still omits");
const mustKeep = [
  "Make sure the form works",
  "We should make sure it works",
  "Client and/or teammate update",
  "33/61 decisions closed",
  "Find a booking provider",
  "Use Stripe for now",
  "Upgrade to Node.js 22",
  "Git history looks clean",
  "Ship it w/ the new copy",
];
for (const line of mustKeep) assert.equal(exportSafeLine(line), line, `ordinary prose removed: ${line}`);
// Every exported section routes through the same minimizer.
const leakLine = "ls: src-tauri/migrations: No such file or directory";
const everySection = buildUpdateMarkdown({
  projectName: "parent/proj",
  rangeLabel: "Sep 22–29",
  progressLines: [leakLine, "See [the plan](plans/048-x.md)"],
  commitSubjects: ["python3 migrate.py", "Add form"],
  decisionsNeeded: [{ question: "bash deploy.sh now?", assumption: null }, { question: "Which provider?", assumption: "config/secrets" }],
  blockerLines: [leakLine],
  nextStep: "make build",
});
for (const secret of ["src-tauri", "plans/048", "migrate.py", "deploy.sh", "config/secrets", "make build", "parent/"]) {
  assert.ok(!everySection.includes(secret), `section leak: ${secret}`);
}
assert.ok(everySection.startsWith("## proj — update (Sep 22–29)"), "colliding display name falls back to its basename");
assert.ok(everySection.includes("- See the plan"));
assert.ok(everySection.includes("Add form"));
assert.ok(everySection.includes(`- ${OMITTED_LINE}`), "omitted lines are disclosed, not dropped as none recorded");

// --- Copy update: clipboard failure is a retryable state ---
assert.equal(await copyDraft(async () => undefined, "x"), "copied");
assert.equal(await copyDraft(async () => { throw new Error("denied"); }, "x"), "failed");
let written = "";
assert.equal(await copyDraft(async (t) => { written = t; }, "edited text"), "copied");
assert.equal(written, "edited text", "the edited draft, not the seed, is written");

// --- Shortcut isolation: text fields keep their keys, terminals keep app shortcuts ---
const el = (tagName: string, extra: Record<string, unknown> = {}) => ({
  tagName,
  classList: { contains: (c: string) => (extra.cls as string[] | undefined)?.includes(c) ?? false },
  ...extra,
});
for (const type of ["text", "search", "email", "url", "tel", "password", "number", "date", ""]) {
  assert.equal(isEditableShortcutTarget(el("INPUT", { type })), true, `input[type=${type}] must keep its keys`);
}
for (const type of ["checkbox", "radio", "button", "submit", "range", "color", "file"]) {
  assert.equal(isEditableShortcutTarget(el("INPUT", { type })), false, `input[type=${type}] is not a text field`);
}
assert.equal(isEditableShortcutTarget(el("TEXTAREA")), true, "purpose/Copy update textareas keep their keys");
assert.equal(isEditableShortcutTarget(el("TEXTAREA", { cls: ["xterm-helper-textarea"] })), false, "terminal keeps app shortcuts");
assert.equal(isEditableShortcutTarget(el("DIV", { isContentEditable: true })), true);
assert.equal(isEditableShortcutTarget(el("BUTTON")), false);
assert.equal(isEditableShortcutTarget(null), false);
assert.match(app, /isEditableShortcutTarget\(target as HTMLElement \| null\) && !\(mod && key === "v"\)\) return;/, "global shortcuts must yield to editable fields");
const homeSource = readFileSync(new URL("../src/components/HomeDashboard.tsx", import.meta.url), "utf8");
assert.match(homeSource, /aria-label=\{`Open \$\{displayName\} overview`\}/, "Home card actions must name their project");
assert.match(overviewSource, /aria-describedby=\{`needs-choice-\$\{i\}`\}/, "Go to workspace must be described by its decision");
const repoSource = readFileSync(new URL("../src/lib/repo.ts", import.meta.url), "utf8");
assert.match(repoSource, /dbLoad \?\?= Database\.load\(/, "concurrent first DB calls must share one load (fresh-profile code 5)");
assert.equal((repoSource.match(/Database\.load\(/g) ?? []).length, 1, "only getDb may load the database");
console.log("dashboard-check: all assertions passed (including async load, cache, ranges, attribution, export privacy, startup and chooser)");

// Project identity uses the same canonical key for bookmark presentation and launch.
const matchingBookmarks = [
  { projectKey: "/repo", name: "Client website", color: "#ff0000" },
  { projectKey: "/repo", name: "Other shortcut", color: "#00ff00" },
  { projectKey: "/different", name: "Other project", color: "#0000ff" },
];
assert.equal(selectProjectBookmark(matchingBookmarks, "/repo"), matchingBookmarks[0]);
assert.equal(selectProjectBookmark(matchingBookmarks, "/unknown"), undefined);
assert.equal(projectDisplayName("/repo", ["/repo"], { nickname: "  Harbor  ", bookmarkName: "Client website" }), "Harbor");
assert.equal(projectDisplayName("/repo", ["/repo"], { nickname: "  ", bookmarkName: "Client website" }), "Client website");
assert.equal(projectDisplayName("/repo", ["/repo"], { nickname: null, bookmarkName: null }), "repo");
const namedOnly = buildProjectCatalog([], [], [], [{ key: "project_nickname:/unbookmarked", value: "Personal project" }]);
assert.equal(namedOnly[0]?.nickname, "Personal project");
assert.equal(namedOnly[0]?.bookmarked, false);
const coloredCards = buildProjectCards([{ ...namedOnly[0]!, bookmarkName: "Shortcut", bookmarkColor: "#ff0000" }], [], Date.now());
assert.equal(coloredCards[0]?.nickname, "Personal project");
assert.equal(coloredCards[0]?.bookmarkColor, "#ff0000");

assert.equal(projectFolderLabel("/Users/vandershark/Desktop/dev/context_terminal"), "dev/context_terminal");
assert.equal(projectFolderLabel("/Users/vandershark/Desktop/dev/pair_agentic/"), "dev/pair_agentic");
assert.equal(projectFolderLabel("/repo"), "repo");
assert.equal(projectFolderLabel("/"), "/");
