// Self-check for session→tab binding (tether + cwd fallback).
// Run: npm run bind:check
import { strict as assert } from "node:assert";
import { bindSession, type BindCandidate } from "../src/lib/ingest";
import type { HookPayload } from "../src/types";

const REPO = "/Users/x/dev/proj";

const tab = (id: string, cwd = REPO): BindCandidate => ({ id, cwd, status: "live" });

const ev = (extra: Record<string, unknown> = {}): HookPayload => ({
  hook_event_name: "UserPromptSubmit",
  session_id: "s1",
  ...extra,
});

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
// All candidates bound → reuse the match rather than dropping the session.
assert.equal(bind(ev(), two, { bound: ["tab-1", "tab-2"] }), "tab-1");

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
// A dead tab is never a fallback target.
assert.equal(
  bind(ev(), [{ id: "tab-1", cwd: "/Users/x/dev/other", status: "exited" }], { active: "tab-1" }),
  null,
  "bound a session to an exited tab"
);

console.log("bind-check: all assertions passed");
