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

console.log("tab-identity-check: all assertions passed");
