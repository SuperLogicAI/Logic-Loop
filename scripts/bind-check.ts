// Self-check for session→tab binding (tether + cwd fallback).
// Run: npm run bind:check
import { strict as assert } from "node:assert";
import { bindSession, sessionBindingLocation, type BindCandidate } from "../src/lib/ingest";
import type { HookPayload } from "../src/types";

const REPO = "/Users/x/dev/proj";

const tab = (id: string, cwd = REPO): BindCandidate => ({ id, cwd, status: "live" });
function ev(extra: Record<string, unknown> = {}): HookPayload {
  return { hook_event_name: "UserPromptSubmit", session_id: "s1", ...extra };
}

// SessionStart persistence needs an exact live owner. Only Antigravity may
// recover a missing native cwd from that tab.
assert.deepEqual(
  sessionBindingLocation(ev({ agent: "antigravity", tab_id: "tab-1", cwd: `${REPO}/src` }), REPO, tab("tab-1")),
  { cwd: `${REPO}/src`, projectKey: REPO }
);
assert.deepEqual(
  sessionBindingLocation(ev({ agent: "antigravity", tab_id: "tab-1" }), undefined, tab("tab-1")),
  { cwd: REPO, projectKey: REPO }
);
for (const candidate of [undefined, tab("tab-2"), { ...tab("tab-1"), status: "dead" }]) {
  assert.equal(sessionBindingLocation(ev({ agent: "antigravity", tab_id: "tab-1" }), undefined, candidate), null);
  assert.equal(sessionBindingLocation(ev({ agent: "antigravity", tab_id: "tab-1", cwd: REPO }), REPO, candidate), null);
}
assert.equal(sessionBindingLocation(ev({ agent: "antigravity" }), undefined, tab("tab-1")), null);
assert.equal(sessionBindingLocation(ev({ agent: "codex", tab_id: "tab-1" }), undefined, tab("tab-1")), null);
assert.deepEqual(
  sessionBindingLocation(ev({ agent: "codex", tab_id: "tab-1", cwd: REPO }), REPO, tab("tab-1")),
  { cwd: REPO, projectKey: REPO }
);
for (const candidate of [undefined, tab("tab-2"), { ...tab("tab-1"), status: "dead" }, { ...tab("tab-1"), sessionId: "other" }]) {
  assert.equal(sessionBindingLocation(ev({ agent: "codex", tab_id: "tab-1", cwd: REPO }), REPO, candidate), null);
}

const bind = (
  p: HookPayload,
  tabs: BindCandidate[],
  opts: { bound?: string[]; active?: string | null; projectKey?: string } = {}
) =>
  bindSession(p, tabs, {
    boundTabIds: new Set(opts.bound ?? []),
    activeTabId: opts.active ?? null,
    // `?? REPO` would swallow an explicitly-passed undefined.
    projectKey: "projectKey" in opts ? opts.projectKey : REPO,
  });

// --- The bug this phase exists to fix: two tabs, one repo. ---
const two = [tab("tab-1"), tab("tab-2")];
assert.equal(bind(ev({ tab_id: "tab-2" }), two), "tab-2", "tether ignored");
assert.equal(bind(ev({ tab_id: "tab-1" }), two), "tab-1", "tether ignored");
assert.equal(bind(ev({ agent: "codex", tab_id: "tab-2" }), two), "tab-2", "Codex exact tether ignored");
// Tether wins even when the tab is already bound and another is free.
assert.equal(
  bind(ev({ tab_id: "tab-1" }), two, { bound: ["tab-1"] }),
  "tab-1",
  "tether lost to the unbound-tab preference"
);
// ...and even when a different tab is active.
assert.equal(
  bind(ev({ tab_id: "tab-1" }), two, { active: "tab-2" }),
  "tab-1",
  "tether lost to the active-tab fallback"
);

// --- Untethered sessions (outside terminal) still bind by cwd. ---
assert.equal(bind(ev(), two), "tab-1", "cwd fallback did not bind");
assert.equal(bind(ev(), two, { bound: ["tab-1"] }), "tab-2", "did not prefer an unbound tab");
// All candidates hold other sessions → unbound (the caller still persists
// the hook). Reusing a match stamped this outside session's tab_id onto
// another session's tab (Phase 48 release-test contamination).
assert.equal(bind(ev(), two, { bound: ["tab-1", "tab-2"] }), null, "outside session reused a bound tab");
assert.equal(
  bind(ev(), [{ ...tab("tab-1"), sessionId: "s-other" }, { ...tab("tab-2"), sessionId: "s-third" }]),
  null,
  "outside session reused a tab owning another session"
);
// A tab carrying a persisted sessionId (re-entered ghost, absent from the
// in-memory bound set) is not "free": prefer a session-less tab.
assert.equal(bind(ev(), [{ ...tab("tab-1"), sessionId: "s-other" }, tab("tab-2")]), "tab-2");

// --- Owner recovery: the tab already owning this session wins, even with an
// empty bound set (after relaunch) and a session that cd'ed elsewhere. ---
const ownerA = { ...tab("tab-1"), sessionId: "s1" };
assert.equal(bind(ev(), [tab("tab-2"), ownerA]), "tab-1", "known owner lost to a free same-cwd tab");
assert.equal(
  bind(ev(), [tab("tab-2"), ownerA], { projectKey: "/Users/x/dev/elsewhere" }),
  "tab-1",
  "owner lost after the session changed cwd"
);
assert.equal(bind(ev(), [{ ...ownerA, status: "dead" }, tab("tab-2")]), "tab-2", "dead owner recovered");
// Untethered Codex is still never bound, owner or not.
assert.equal(bind(ev({ agent: "codex" }), [ownerA]), null, "untethered Codex recovered an owner");

// A subdir cwd is already collapsed to the repo root upstream, so a tab opened
// at the root and an agent run from src-tauri agree — the project-identity fix.
assert.equal(bind(ev(), [tab("tab-1", REPO)], { projectKey: REPO }), "tab-1");

// --- Fallbacks that must NOT fire. ---
// Tethered to a closed tab: drop it, don't leak onto a matching tab.
assert.equal(
  bind(ev({ tab_id: "tab-gone" }), two),
  null,
  "stale tether fell through to cwd matching"
);
assert.equal(bind(ev({ tab_id: "tab-1" }), [{ ...tab("tab-1"), status: "dead" }, tab("tab-2")]), null);
assert.equal(bind(ev({ tab_id: "tab-1" }), [{ ...tab("tab-1"), sessionId: "other" }, tab("tab-2")]), null);
assert.equal(bind(ev({ agent: "codex" }), two), null, "outside Codex session cannot use cwd fallback");
// No cwd and no tether → unbindable, not "whatever is active".
assert.equal(bind(ev(), two, { active: "tab-1", projectKey: undefined }), null);
// Different repo, no active tab → no bind.
assert.equal(bind(ev(), [tab("tab-1", "/Users/x/dev/other")], {}), null);
// Different repo but the user is typing in the active tab → active-tab rescue.
assert.equal(
  bind(ev(), [tab("tab-1", "/Users/x/dev/other")], { active: "tab-1" }),
  "tab-1",
  "active-tab fallback did not fire"
);
// ...but never onto an active tab owning another session: a re-entered ghost
// (persisted sessionId, not in the bound set) took an unrelated outside
// session's derived rows in the Phase 48 release test.
assert.equal(
  bind(ev(), [{ ...tab("tab-1", "/Users/x/dev/other"), sessionId: "s-ghost" }], { active: "tab-1" }),
  null,
  "active-tab rescue hijacked a re-entered tab"
);
assert.equal(
  bind(ev(), [tab("tab-1", "/Users/x/dev/other")], { active: "tab-1", bound: ["tab-1"] }),
  null,
  "active-tab rescue hijacked a bound tab"
);
// Root cwd is never a project: the app's own `claude -p` extractor children run
// with cwd `/` and post hooks back. Binding one overwrote the active tab's cwd
// with `/`, which expands to "" and blanks the whole panel.
assert.equal(
  bind(ev(), two, { active: "tab-1", projectKey: "/" }),
  null,
  "a rootless session hijacked the active tab"
);
// Same hazard on Windows: a drive root is as rootless as `/`.
for (const root of ["C:\\", "C:/", "C:", "\\", "d:\\"]) {
  assert.equal(
    bind(ev(), two, { active: "tab-1", projectKey: root }),
    null,
    `a rootless session (${root}) hijacked the active tab`
  );
}
// ...but a real Windows project must still bind. Over-rejecting here would
// silently stop every Windows session from binding — a worse bug, and a quieter
// one, than the drive root this guard exists to catch.
const win = "C:\\Users\\x\\dev\\proj";
assert.equal(
  bind(ev(), [tab("tab-1", win)], { projectKey: win }),
  "tab-1",
  "root guard over-rejected a real Windows project path"
);
assert.equal(
  bind(ev(), [tab("tab-1", "C:/Users/x/dev/proj")], { projectKey: "C:/Users/x/dev/proj" }),
  "tab-1",
  "root guard over-rejected a forward-slashed Windows path"
);
// A dead tab is never a fallback target.
assert.equal(
  bind(ev(), [{ id: "tab-1", cwd: "/Users/x/dev/other", status: "exited" }], { active: "tab-1" }),
  null,
  "bound a session to an exited tab"
);
assert.equal(bind(ev(), [{ ...tab("tab-1"), status: "dead" }]), null, "dead tab matched cwd fallback");

// --- Plan 044: no session takeover. A tethered Codex SessionStart for a tab
// that already owns another session is refused: it may be a stale shared
// daemon, or Codex run by Claude's Codex plugin inside a Claude tab. ---
const start = (extra: Record<string, unknown>) =>
  ev({ hook_event_name: "SessionStart", session_id: "s-new", tab_id: "tab-1", cwd: REPO, ...extra });
const ownedOld = { ...tab("tab-1"), sessionId: "s-old" };
assert.equal(bind(start({ agent: "codex" }), [ownedOld]), null, "Codex SessionStart took over a bound tab");
assert.equal(sessionBindingLocation(start({ agent: "codex" }), REPO, ownedOld), null, "takeover persisted for re-entry");
assert.equal(bind(start({ agent: "codex" }), [tab("tab-1")]), "tab-1", "fresh Codex tab did not bind");

// --- Plan 045: launch-scoped Codex binding (Step 3 table). ---
const L1 = "launch-one-0001";
const L2 = "launch-two-0002";
const cx = (extra: Record<string, unknown>) => start({ agent: "codex", ...extra });
const ownedByL1 = { ...ownedOld, launchId: L1 };
const unbound = tab("tab-1");

// Unknown/retired launch: never binds or replaces; the tab's own session still applies.
for (const launch of ["unknown", "retired"]) {
  assert.equal(bind(cx({ launch, launch_id: L1 }), [unbound]), null, `${launch} launch bound an unbound tab`);
  assert.equal(bind(cx({ launch, launch_id: L1 }), [ownedOld]), null, `${launch} launch replaced a bound tab`);
  assert.equal(sessionBindingLocation(cx({ launch, launch_id: L1 }), REPO, unbound), null);
  assert.equal(
    bind(cx({ launch, launch_id: L1, hook_event_name: "Stop", session_id: "s-old" }), [ownedOld]),
    "tab-1",
    `${launch} launch dropped the tab's own session events`
  );
}
// Plain tether (none): Decision A — binds an unbound tab, first-session-wins otherwise.
assert.equal(bind(cx({ launch: "none" }), [unbound]), "tab-1", "Decision A: plain Codex did not bind an unbound tab");
assert.equal(bind(cx({ launch: "none" }), [ownedOld]), null, "plain Codex took over a bound tab");
// A registered launch's first SessionStart binds or replaces, and persists.
assert.equal(bind(cx({ launch: "current", launch_id: L1 }), [unbound]), "tab-1");
assert.equal(bind(cx({ launch: "current", launch_id: L1 }), [ownedOld]), "tab-1", "relaunch did not replace");
assert.equal(bind(cx({ launch: "current", launch_id: L2 }), [ownedByL1]), "tab-1", "new launch did not replace the old launch's session");
assert.deepEqual(sessionBindingLocation(cx({ launch: "current", launch_id: L2 }), REPO, ownedByL1), { cwd: REPO, projectKey: REPO });
// Within one launch: clear/resume/fork replace; startup (`/new` or a child `codex exec`) does not.
for (const source of ["clear", "resume", "fork"]) {
  assert.equal(bind(cx({ launch: "current", launch_id: L1, source }), [ownedByL1]), "tab-1", `${source} did not replace`);
}
for (const source of ["startup", "compact", undefined]) {
  assert.equal(bind(cx({ launch: "current", launch_id: L1, source }), [ownedByL1]), null, `${source} replaced within a launch`);
  assert.equal(sessionBindingLocation(cx({ launch: "current", launch_id: L1, source }), REPO, ownedByL1), null);
}
// Re-entry: a resumed ghost (own session, no launchId yet) binds its tab.
assert.equal(
  bind(cx({ launch: "current", launch_id: L1, source: "resume", session_id: "s-old" }), [ownedOld]),
  "tab-1",
  "re-entered tab lost its own resumed session"
);
// Same session (e.g. compact) is just the tab's own event.
assert.equal(bind(cx({ launch: "current", launch_id: L1, source: "compact", session_id: "s-old" }), [ownedByL1]), "tab-1");
// Non-SessionStart events never replace, even from the current launch.
assert.equal(bind(cx({ launch: "current", launch_id: L1, hook_event_name: "UserPromptSubmit" }), [ownedByL1]), null);
// Subagents never replace.
assert.equal(bind(cx({ launch: "current", launch_id: L2, agent_id: "sub-1" }), [ownedByL1]), null, "subagent replaced");
// Stale shared daemon: plain tether then an unknown launch, against bound and unbound tabs.
assert.equal(bind(cx({ launch: "none" }), [ownedByL1]), null, "stale daemon took over a bound tab");
assert.equal(bind(cx({ launch: "unknown", launch_id: "stale-launch-9" }), [ownedByL1]), null);
assert.equal(bind(cx({ launch: "unknown", launch_id: "stale-launch-9" }), [unbound]), null);
// Heal path (Decision A): a plain claim on an unbound tab is replaced by the next registered launch.
assert.equal(bind(cx({ launch: "current", launch_id: L1, session_id: "s-real" }), [{ ...unbound, sessionId: "s-stale" }]), "tab-1");
// Claude tab + Codex run by Claude's Codex plugin (plain tether) stays Claude.
assert.equal(bind(cx({ launch: "none", session_id: "s-plugin" }), [{ ...tab("tab-1"), sessionId: "s-claude" }]), null);
// Two tabs, one folder, two launches: each binds only its own tab.
const pair = [{ ...tab("tab-1"), sessionId: "a", launchId: L1 }, { ...tab("tab-2"), sessionId: "b", launchId: L2 }];
assert.equal(bind(cx({ tab_id: "tab-2", launch: "current", launch_id: "launch-new-0003" }), pair), "tab-2");
assert.equal(bind(cx({ tab_id: "tab-1", launch: "unknown", launch_id: L2 }), pair), null, "one tab's launch bound another tab");
// Other adapters keep first-session-wins even if a launch field were present.
for (const agent of [undefined, "opencode", "pi", "antigravity", "deepseek"]) {
  assert.equal(
    bind(start({ agent, launch: "current", launch_id: L2 }), [ownedByL1]),
    null,
    `${agent ?? "claude"} lost first-session-wins`
  );
}

console.log("bind-check: all assertions passed");
