// Self-check for the unclaimed-results flag/claim predicate. Run: npm run unclaimed:check
import { strict as assert } from "node:assert";
import { seedUnclaimedTabs, shouldFlagUnclaimed } from "../src/lib/ingest";

// Background Stop on a non-active tab flags, app focused or not.
assert.equal(shouldFlagUnclaimed("tab-2", "tab-1", true), true, "background tab Stop did not flag");
assert.equal(shouldFlagUnclaimed("tab-2", "tab-1", false), true);
// Stop on the active tab, app focused: never flags — the human is looking at it.
assert.equal(shouldFlagUnclaimed("tab-1", "tab-1", true), false, "active+focused Stop wrongly flagged");
// Active tab but the whole app is backgrounded: still flags — no eyes on it.
assert.equal(shouldFlagUnclaimed("tab-1", "tab-1", false), true);
// No active tab yet (startup race): flags.
assert.equal(shouldFlagUnclaimed("tab-1", null, true), true);

// Switching to a flagged tab claims only that one; others stay flagged. This
// mirrors App.tsx's claimTab: a Set, delete-if-present, nothing else touched.
let unseen = new Set(["tab-1", "tab-2", "tab-3"]);
const claim = (id: string) => {
  if (!unseen.has(id)) return;
  unseen = new Set(unseen);
  unseen.delete(id);
};
claim("tab-2");
assert.deepEqual(
  [...unseen].sort(),
  ["tab-1", "tab-3"],
  "claiming tab-2 should leave the other flagged tabs untouched"
);
// Claiming an already-unflagged tab is a no-op, not an error.
claim("tab-2");
assert.deepEqual([...unseen].sort(), ["tab-1", "tab-3"]);

// Restart seeding: a result that landed before the last quit must come back
// flagged, or claimTab's flag-set lookup makes it permanently unclaimable.
const ghosts = [
  { id: "tether-1", sessionId: "sess-a" },
  { id: "tether-2", sessionId: "sess-b" },
  { id: "tether-3" }, // bound tab that never got a session id
];
const seeded = seedUnclaimedTabs(ghosts, new Set(["sess-b"]));
assert.deepEqual([...seeded], ["tether-2"], "restored tab with an unclaimed result was not flagged");
// And once seeded it claims through the same path as a live flag.
unseen = seeded;
claim("tether-2");
assert.deepEqual([...unseen], [], "seeded flag did not clear on claim");
// Nothing unclaimed, or a session id that no restored tab owns: no flags.
assert.equal(seedUnclaimedTabs(ghosts, new Set()).size, 0);
assert.equal(seedUnclaimedTabs(ghosts, new Set(["sess-gone"])).size, 0);

console.log("unclaimed-check: all assertions passed");
