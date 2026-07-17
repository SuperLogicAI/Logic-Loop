// Self-check for the hook→state epoch guard. Run: npm run epoch:check
import { strict as assert } from "node:assert";
import { resetEpochGuard, stateForHook } from "../src/lib/ingest";
import type { HookPayload } from "../src/types";

const ev = (hook_event_name: string, extra: Record<string, unknown> = {}): HookPayload => ({
  hook_event_name,
  session_id: "s1",
  ...extra,
});

// Normal turn lifecycle.
resetEpochGuard();
assert.equal(stateForHook(ev("UserPromptSubmit")), "working");
assert.equal(stateForHook(ev("PostToolUse")), "working");
assert.equal(stateForHook(ev("Notification")), "waiting");
assert.equal(stateForHook(ev("Stop")), "idle");

// Late events after Stop must not revive the session.
assert.equal(stateForHook(ev("PostToolUse")), null, "late PostToolUse revived idle");
assert.equal(stateForHook(ev("Notification")), null, "idle-reminder Notification revived idle");
assert.equal(
  stateForHook(ev("PostToolUse", { tool_response: { is_error: true } })),
  null,
  "late error PostToolUse revived idle"
);

// A new human-initiated turn reopens the epoch.
assert.equal(stateForHook(ev("UserPromptSubmit")), "working");
assert.equal(stateForHook(ev("PostToolUse")), "working");
assert.equal(stateForHook(ev("Stop")), "idle");

// Mid-turn attach (app started after the turn began): open by default.
resetEpochGuard();
assert.equal(stateForHook(ev("PostToolUse")), "working");
assert.equal(stateForHook(ev("Notification")), "waiting");

// Error surfacing still works inside an open turn.
resetEpochGuard();
assert.equal(stateForHook(ev("UserPromptSubmit")), "working");
assert.equal(stateForHook(ev("PostToolUse", { tool_response: { is_error: true } })), "error");

// Subagent events never drive tab state, in or out of a turn.
resetEpochGuard();
assert.equal(stateForHook(ev("UserPromptSubmit")), "working");
assert.equal(stateForHook(ev("PostToolUse", { agent_id: "sub1" })), null, "subagent drove state");
assert.equal(stateForHook(ev("Stop", { agent_id: "sub1" })), null, "subagent Stop drove state");
assert.equal(stateForHook(ev("Stop")), "idle");

// Sessions are independent.
resetEpochGuard();
assert.equal(stateForHook(ev("Stop")), "idle");
assert.equal(stateForHook({ hook_event_name: "PostToolUse", session_id: "s2" }), "working");
assert.equal(stateForHook(ev("PostToolUse")), null);

console.log("epoch-check: all assertions passed");
