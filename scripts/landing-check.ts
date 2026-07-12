// Self-check for the landing-draft parser. Run: npm run landing:check
import { strict as assert } from "node:assert";
import { parseLandingDraft } from "../src/lib/landing";

assert.equal(parseLandingDraft("run the migration then check the badge"), "run the migration then check the badge");
assert.equal(parseLandingDraft("```\nreply to the agent\n```"), "reply to the agent");
assert.equal(parseLandingDraft('"quoted action"'), "quoted action");
assert.equal(parseLandingDraft("first line\nsecond line ignored"), "first line");
assert.equal(parseLandingDraft("(no clear next step)"), "");
assert.equal(parseLandingDraft("  (NO CLEAR NEXT STEP)  "), "");
assert.equal(parseLandingDraft("   "), "");
assert.equal(parseLandingDraft("x".repeat(300)).length, 200);

console.log("landing-check: all assertions passed");
