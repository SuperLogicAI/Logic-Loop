// Self-check for the landing-draft parser. Run: npm run landing:check
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { parseLandingDraft } from "../src/lib/landing";
import { landingDepartureAction, parseLandingNoteMode } from "../src/lib/landingMode";

assert.equal(parseLandingDraft("run the migration then check the badge"), "run the migration then check the badge");
assert.equal(parseLandingDraft("```\nreply to the agent\n```"), "reply to the agent");
assert.equal(parseLandingDraft('"quoted action"'), "quoted action");
assert.equal(parseLandingDraft("first line\nsecond line ignored"), "first line");
assert.equal(parseLandingDraft("(no clear next step)"), "");
assert.equal(parseLandingDraft("  (NO CLEAR NEXT STEP)  "), "");
assert.equal(parseLandingDraft("   "), "");
assert.equal(parseLandingDraft("x".repeat(300)).length, 200);

assert.equal(parseLandingNoteMode("auto"), "auto");
assert.equal(parseLandingNoteMode("manual"), "manual");
assert.equal(parseLandingNoteMode(null), "auto");
assert.equal(parseLandingNoteMode("invalid"), "auto");

const now = 1_000_000;
assert.equal(
  landingDepartureAction({ mode: "auto", activity: 900_000, lastPrompt: 0, now, modalOpen: false }),
  "prompt"
);
assert.equal(
  landingDepartureAction({ mode: "manual", activity: 900_000, lastPrompt: 0, now, modalOpen: false }),
  "consume"
);
assert.equal(
  landingDepartureAction({ mode: "auto", activity: undefined, lastPrompt: 0, now, modalOpen: false }),
  "none"
);
assert.equal(
  landingDepartureAction({ mode: "auto", activity: 900_000, lastPrompt: 0, now, modalOpen: true }),
  "none"
);
assert.equal(
  landingDepartureAction({ mode: "auto", activity: 950_000, lastPrompt: 900_000, now, modalOpen: false }),
  "none"
);
// Manual consumed the old marker; returning to Auto needs genuinely new activity.
assert.equal(
  landingDepartureAction({ mode: "auto", activity: undefined, lastPrompt: 0, now, modalOpen: false }),
  "none"
);
assert.equal(
  landingDepartureAction({ mode: "auto", activity: now + 1, lastPrompt: 0, now: now + 700_000, modalOpen: false }),
  "prompt"
);

const sidePanelSource = readFileSync(new URL("../src/components/SidePanel.tsx", import.meta.url), "utf8");
const modalSource = readFileSync(new URL("../src/components/LandingNoteModal.tsx", import.meta.url), "utf8");
assert.match(sidePanelSource, /landingCapture \? "landing" : "residue"/);
assert.match(sidePanelSource, /What's the next physical action here when you come back\?/);
assert.match(sidePanelSource, /Set landing note/);
assert.match(sidePanelSource, /SUBTLE_RAINBOW_BORDER.*border-box/);
assert.match(modalSource, /CARD_GRADIENT.*border-box/);
assert.match(modalSource, /cycle\(i, 0\.3\)/);
assert.match(modalSource, /cycle\(i, 0\.6\)/);
assert.match(modalSource, />Landing note<\/h3>/);
assert.doesNotMatch(modalSource, /<RainbowText|projectName/);

console.log("landing-check: all assertions passed");
