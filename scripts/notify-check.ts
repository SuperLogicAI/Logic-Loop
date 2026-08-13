// Self-check for the nudge fire predicate. Run: npm run notify:check
import { strict as assert } from "node:assert";
import { shouldNotify } from "../src/lib/ingest";

// Background tab, app focused, unmuted: fires.
assert.equal(shouldNotify("tab-2", "tab-1", true, false), true);
// Whole app backgrounded, unmuted: fires.
assert.equal(shouldNotify("tab-1", "tab-1", false, false), true);
// Active tab, app focused: suppressed — the human is looking right at it.
assert.equal(shouldNotify("tab-1", "tab-1", true, false), false, "focused+active tab should not notify");
// Muted project: suppressed even though it would otherwise fire.
assert.equal(shouldNotify("tab-2", "tab-1", true, true), false, "muted project should not notify");
assert.equal(shouldNotify("tab-1", "tab-1", false, true), false, "muted project should not notify even backgrounded");

console.log("notify-check: all assertions passed");
