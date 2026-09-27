// Self-check for tab identity/session ownership gating. Run: npm run tab-identity:check
import { strict as assert } from "node:assert";
import { mergeTabIdentity } from "../src/lib/ingest";
import type { HookPayload, Tab } from "../src/types";

const REPO = "/Users/x/dev/proj";
const noExpand = (c: string) => c;

const tab = (extra: Partial<Tab> = {}): Tab => ({
  id: "tab-1",
  ptyId: 1,
  title: "proj",
  cwd: REPO,
  color: "blue",
  status: "live",
  ...extra,
});

const ev = (extra: Record<string, unknown> = {}): HookPayload => ({
  hook_event_name: "SessionStart",
  session_id: "s-claude",
  ...extra,
});

// --- The bug this fix exists for: a foreign session sharing the tab's
// tether must not flip the icon, even though tabId resolution matched. ---
const bound = tab({ sessionId: "s-claude", agent: "claude" });
const hijack = mergeTabIdentity(
  bound,
  ev({ session_id: "s-opencode", agent: "opencode" }),
  undefined,
  null,
  false,
  undefined,
  noExpand
);
assert.equal(hijack.agent, "claude", "foreign session flipped tab.agent");
assert.equal(hijack.sessionId, "s-claude", "foreign session changed tab.sessionId");

// --- The silent half of the same bug: a foreign session's state-bearing
// hook (e.g. its own Stop) must not overwrite sessionId/agentState either. ---
const hijackState = mergeTabIdentity(
  bound,
  ev({ session_id: "s-opencode", agent: "opencode" }),
  undefined,
  "working",
  false,
  undefined,
  noExpand
);
assert.equal(hijackState.sessionId, "s-claude", "foreign state-bearing hook hijacked sessionId");
assert.equal(hijackState.agentState, undefined, "foreign state-bearing hook hijacked agentState");
assert.equal(hijackState.agent, "claude", "foreign state-bearing hook hijacked agent");

// --- A fresh tab (no bound session yet) still establishes identity on its
// first structured event — the Phase 35 happy path. ---
const fresh = tab();
const established = mergeTabIdentity(
  fresh,
  ev({ session_id: "s-claude", agent: "claude" }),
  undefined,
  "working",
  false,
  undefined,
  noExpand
);
assert.equal(established.agent, "claude");
assert.equal(established.sessionId, "s-claude");
assert.equal(established.agentState, "working");

// --- The bound session's own later events keep updating normally: cwd
// sync, state transitions, turn provenance. No regression on the happy path. ---
const updated = mergeTabIdentity(
  bound,
  ev({ session_id: "s-claude", agent: "claude" }),
  `${REPO}/src`,
  "waiting",
  true,
  "auto",
  noExpand
);
assert.equal(updated.cwd, `${REPO}/src`, "own session's cwd sync did not apply");
assert.equal(updated.agentState, "waiting");
assert.equal(updated.lastTurnAuto, true);

// --- Plan 044: no session takeover. Codex run by Claude's Codex plugin
// inherits the Claude tab's tether; its SessionStart must not flip the tab. ---
const claudeTab = tab({ sessionId: "s-claude", agent: "claude", agentState: "working" });
const pluginCodex = mergeTabIdentity(
  claudeTab,
  ev({ session_id: "s-codex", agent: "codex", tab_id: "tab-1" }),
  undefined,
  null,
  false,
  undefined,
  noExpand
);
assert.equal(pluginCodex.agent, "claude", "Codex plugin session flipped a Claude tab");
assert.equal(pluginCodex.sessionId, "s-claude", "Codex plugin session took over a Claude tab");

// --- Plan 045: a registered Codex launch replaces the tab's session. ---
const merge = (t: Tab, extra: Record<string, unknown>, state: Tab["agentState"] | null = null, prompt = false) =>
  mergeTabIdentity(t, ev({ agent: "codex", tab_id: "tab-1", ...extra }), undefined, state ?? null, prompt, undefined, noExpand);
const oldCodex = tab({ sessionId: "s-old", agent: "codex", launchId: "launch-a-0001", agentState: "idle", lastEventTs: 1, lastTurnAuto: true });
const replaced = merge(oldCodex, { session_id: "s-new", launch: "current", launch_id: "launch-b-0002", source: "startup" });
assert.equal(replaced.sessionId, "s-new", "relaunch did not replace the session");
assert.equal(replaced.launchId, "launch-b-0002");
assert.equal(replaced.agentState, undefined, "old state survived replacement");
assert.equal(replaced.lastEventTs, undefined);
assert.equal(replaced.lastTurnAuto, undefined);
// The new session's first prompt passes ownership.
const prompted = merge(replaced, { session_id: "s-new", hook_event_name: "UserPromptSubmit", launch: "current", launch_id: "launch-b-0002" }, "working", true);
assert.equal(prompted.agentState, "working", "new session's first prompt failed ownership");
// Late events from the old session and the old (retired) launch are ignored.
const lateOld = merge(prompted, { session_id: "s-old", hook_event_name: "Stop", launch: "retired", launch_id: "launch-a-0001" }, "idle");
assert.equal(lateOld.sessionId, "s-new");
assert.equal(lateOld.agentState, "working", "old session's late Stop changed the tab");
// A child `codex exec` in the same launch (startup) cannot take the tab.
const child = merge(prompted, { session_id: "s-child", launch: "current", launch_id: "launch-b-0002", source: "startup" });
assert.equal(child.sessionId, "s-new", "child codex exec took over the tab");
// `/clear` in the same launch does.
const cleared = merge(prompted, { session_id: "s-cleared", launch: "current", launch_id: "launch-b-0002", source: "clear" });
assert.equal(cleared.sessionId, "s-cleared");
assert.equal(cleared.agentState, undefined);
// An unknown launch never establishes identity on a fresh tab.
const ghost = merge(tab(), { session_id: "s-ghost", launch: "unknown", launch_id: "launch-x-0009" }, "working");
assert.equal(ghost.sessionId, undefined, "unknown launch bound a fresh tab");

console.log("tab-identity-check: all assertions passed");
