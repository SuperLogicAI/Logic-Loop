// Self-check for the Phase 19 decisions-empty-state priority order.
// Run: npm run empty-state:check
import { strict as assert } from "node:assert";
import { decisionsEmptyReason } from "../src/components/SidePanel";

const base = { isUnboundFanOutChild: false, sessionBlind: false, agent: undefined as string | undefined };

// Confirmed empty: Claude, bound, transcript readable.
assert.match(decisionsEmptyReason(base), /^Nothing waiting on you\.$/);

// Non-Claude agent: never extracts, but not "blind" or "unbound" — its own reason.
assert.match(decisionsEmptyReason({ ...base, agent: "codex" }), /isn't available for this agent/);

// Blind session outranks the non-Claude-agent reason (transcript absence is
// the more specific, more actionable fact when both are true).
assert.match(
  decisionsEmptyReason({ ...base, sessionBlind: true, agent: "codex" }),
  /no transcript/
);

// Unbound fan-out child outranks everything else.
assert.match(
  decisionsEmptyReason({ isUnboundFanOutChild: true, sessionBlind: true, agent: "codex" }),
  /isn't bound to a tracked session/
);

console.log("empty-state-check: all assertions passed");
