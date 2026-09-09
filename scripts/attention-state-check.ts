// Self-check for Phase 22's durable lifecycle evidence. Run: npm run attention-state:check
import { strict as assert } from "node:assert";
import {
  deriveClock,
  resetEpochGuard,
  sourceContextForHook,
  STALL_MS,
  stateForHook,
} from "../src/lib/ingest";
import { attentionObservationDedupeKey, attentionObservationPayload } from "../src/lib/repo";
import type { HookPayload } from "../src/types";

const hook = (hook_event_name: string, extra: Record<string, unknown> = {}): HookPayload => ({
  hook_event_name,
  session_id: "session-a",
  project_key: "/projects/a",
  tab_id: "tab-a",
  agent: "codex",
  ...extra,
});

// Repeated waiting remains an accepted observation. A later query can derive
// one contiguous episode because every accepted activity has source evidence.
resetEpochGuard();
assert.equal(stateForHook(hook("UserPromptSubmit")), "working");
assert.equal(stateForHook(hook("Notification")), "waiting");
assert.equal(stateForHook(hook("Notification")), "waiting");
assert.equal(stateForHook(hook("Stop")), "idle");
assert.equal(stateForHook(hook("Notification")), null, "late waiting reopened a stopped parent");
assert.equal(stateForHook(hook("UserPromptSubmit")), "working", "next turn did not create a fresh epoch");

// Subagent identity is preserved as context but cannot drive parent state.
resetEpochGuard();
const subagent = hook("Stop", { agent_id: "child-7" });
assert.equal(stateForHook(subagent), null, "subagent stop drove the parent state");
assert.deepEqual(sourceContextForHook(subagent, "fallback-tab"), {
  sessionId: "session-a",
  tabId: "tab-a",
  agent: "codex",
  actorId: "child-7",
});
assert.equal(
  sourceContextForHook(hook("Stop", { tab_id: undefined }), "fallback-tab").tabId,
  "fallback-tab",
  "cwd fallback binding was not retained when the hook had no tether"
);

// The shared stall contract is strict: exactly three minutes is not stalled.
const now = 1_000_000;
assert.equal(deriveClock({ agentState: "working", lastEventTs: now - STALL_MS }, now).stalled, false);
assert.equal(deriveClock({ agentState: "working", lastEventTs: now - STALL_MS - 1 }, now).stalled, true);

// Retries of one raw event use an id-based derivative key, not a fresh clock
// bucket, and the payload preserves only trusted source fields.
assert.equal(attentionObservationDedupeKey("session-a", 42), attentionObservationDedupeKey("session-a", 42));
assert.notEqual(attentionObservationDedupeKey("session-a", 42), attentionObservationDedupeKey("session-a", 43));
assert.deepEqual(JSON.parse(attentionObservationPayload("session-a", 42, {
  state: "waiting",
  sourceHook: "Notification",
  observedAt: 123,
  runId: "run-a",
  projectKey: "/projects/a",
  context: sourceContextForHook(hook("Notification")),
})), {
  v: 1,
  source_event_id: 42,
  session_id: "session-a",
  state: "waiting",
  source_hook: "Notification",
  observed_at: 123,
  run_id: "run-a",
  project_key: "/projects/a",
  tab_id: "tab-a",
  adapter_id: "codex",
});

console.log("attention-state-check: all assertions passed");
