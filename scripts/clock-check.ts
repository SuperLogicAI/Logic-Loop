// Self-check for the Phase 14b clock. Run: npm run clock:check
import { strict as assert } from "node:assert";
import { deriveClock, STALL_MS } from "../src/lib/ingest";

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

console.log(`clock-check: all assertions passed (STALL_MS=${STALL_MS})`);
