// Characterization check for the Plan 043 momentum extraction: computeMomentum
// must pick exactly what SidePanel's prior inline cascade picked — latest
// open landing note → oldest open decision → oldest open blocker → planned
// board card. Run: npm run momentum:check
import { strict as assert } from "node:assert";
import { computeMomentum } from "../src/lib/momentum";
import type { Blocker, Decision, Note } from "../src/types";
import type { Card } from "../src/lib/board";

const note: Note = { id: 1, cwd: "/p", kind: "landing", body: "landing text", status: "open", session_id: null, ts: 1 };
const decisionOld: Decision = {
  id: 1,
  session_id: "s",
  cwd: "/p",
  tab_id: null,
  agent: null,
  actor_id: null,
  question: "old decision",
  status: "open",
  user_answer: null,
  assumption: null,
  context_json: "{}",
  ts: 10,
};
const decisionNew: Decision = { ...decisionOld, id: 2, question: "new decision", ts: 20 };
const decisionAnswered: Decision = { ...decisionOld, id: 3, question: "answered decision", status: "answered", ts: 5 };
const blockerOld: Blocker = {
  id: 1,
  cwd: "/p",
  session_id: null,
  tab_id: null,
  agent: null,
  actor_id: null,
  text: "old blocker",
  source: "manual",
  resolved: 0,
  ts: 10,
};
const blockerNew: Blocker = { ...blockerOld, id: 2, text: "new blocker", ts: 20 };
const blockerResolved: Blocker = { ...blockerOld, id: 3, text: "resolved blocker", resolved: 1, ts: 1 };
const card: Card = {
  title: "Planned card",
  status: "planned",
  body: "",
  link: null,
  next: "do the next thing",
  now: true,
  color: null,
  start: 0,
  end: 0,
};
const cardNoNext: Card = { ...card, title: "No-next card", next: null };

const resolvers = {
  onLandingDone: async () => {},
  onDecisionDone: async () => {},
  onBlockerDone: async () => {},
  onPlannedCardDone: async () => {},
};

// Nothing open → null, no card.
assert.equal(
  computeMomentum({ landing: null, decisions: [], blockers: [], plannedCard: null, ...resolvers }),
  null
);

// Answered decisions and resolved blockers never win.
assert.equal(
  computeMomentum({
    landing: null,
    decisions: [decisionAnswered],
    blockers: [blockerResolved],
    plannedCard: null,
    ...resolvers,
  }),
  null
);

// Landing note beats everything.
const withLanding = computeMomentum({
  landing: note,
  decisions: [decisionOld],
  blockers: [blockerOld],
  plannedCard: card,
  ...resolvers,
});
assert.equal(withLanding?.label, "landing note");
assert.equal(withLanding?.text, note.body);

// Oldest open decision beats blockers and planned card.
const withDecisions = computeMomentum({
  landing: null,
  decisions: [decisionNew, decisionOld],
  blockers: [blockerOld],
  plannedCard: card,
  ...resolvers,
});
assert.equal(withDecisions?.label, "decision");
assert.equal(withDecisions?.text, decisionOld.question, "oldest (lowest ts) decision wins, not first-in-array");

// Oldest open blocker beats planned card when no note/decision is open.
const withBlockers = computeMomentum({
  landing: null,
  decisions: [decisionAnswered],
  blockers: [blockerNew, blockerOld],
  plannedCard: card,
  ...resolvers,
});
assert.equal(withBlockers?.label, "blocker");
assert.equal(withBlockers?.text, blockerOld.text, "oldest (lowest ts) blocker wins, not first-in-array");

// Planned card is the last resort, using next when present.
const withCard = computeMomentum({ landing: null, decisions: [], blockers: [], plannedCard: card, ...resolvers });
assert.equal(withCard?.label, "planned");
assert.equal(withCard?.text, card.next);

// Planned card falls back to title when next is absent.
const withCardNoNext = computeMomentum({
  landing: null,
  decisions: [],
  blockers: [],
  plannedCard: cardNoNext,
  ...resolvers,
});
assert.equal(withCardNoNext?.text, cardNoNext.title);

// The picked item's done() calls exactly its own resolver, with the winning
// row — not a fixed/first row.
let doneCalledWith: unknown = null;
const spyResolvers = {
  onLandingDone: async () => {},
  onDecisionDone: async (d: Decision) => {
    doneCalledWith = d;
  },
  onBlockerDone: async () => {},
  onPlannedCardDone: async () => {},
};
const spied = computeMomentum({
  landing: null,
  decisions: [decisionNew, decisionOld],
  blockers: [],
  plannedCard: null,
  ...spyResolvers,
});
await spied?.done();
assert.equal(doneCalledWith, decisionOld, "done() resolves the exact winning decision, not just any decision");

console.log("momentum-check: all assertions passed");
