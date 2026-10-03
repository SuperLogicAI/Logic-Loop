// Self-check for the Phase 14b clock. Run: npm run clock:check
import { strict as assert } from "node:assert";
import { deriveClock, sessionStatusLabel, STALL_MS } from "../src/lib/ingest";

const base = Date.now();

assert.equal(
  deriveClock({ agentState: "working", lastEventTs: base - 179_000 }, base).stalled,
  false,
  "working + 179s should not be stalled"
);
assert.equal(
  deriveClock({ agentState: "working", lastEventTs: base - 181_000 }, base).stalled,
  true,
  "working + 181s should be stalled"
);
assert.equal(
  deriveClock({ agentState: "waiting", lastEventTs: base - 3_600_000 }, base).stalled,
  false,
  "waiting never stalls, however quiet"
);
assert.equal(
  deriveClock({ agentState: "idle", lastEventTs: base - 999_999_999 }, base).stalled,
  false,
  "idle never stalls"
);
assert.equal(
  deriveClock({ agentState: "working", lastEventTs: base - 181_000 }, base).quietMs,
  181_000,
  "quietMs should equal now - lastEventTs"
);
assert.deepEqual(
  deriveClock({ agentState: "working" }, base),
  { quietMs: 0, stalled: false },
  "no lastEventTs should be quietMs 0, not stalled"
);

// Phase 48 release repair: a re-entered tab with a persisted session is
// "restored", never "no session".
assert.deepEqual(sessionStatusLabel(undefined, "s1"), { state: "session restored", noEvents: "no new activity" });
assert.deepEqual(sessionStatusLabel(undefined, null), { state: "no session", noEvents: "no events yet" });
assert.equal(sessionStatusLabel("idle", "s1").state, "idle");

console.log(`clock-check: all assertions passed (STALL_MS=${STALL_MS})`);
