// Check for the Plan 052 momentum cascade: computeMomentum picks latest open
// landing note → Now-starred card → oldest open decision → unstarred planned
// card. Blockers are not an input. Run: npm run momentum:check
import { strict as assert } from "node:assert";
import { computeMomentum } from "../src/lib/momentum";
import type { Decision, Note } from "../src/types";
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
const nowCard: Card = {
  title: "Now card",
  status: "planned",
  body: "",
  link: null,
  next: "do the next thing",
  now: true,
  color: null,
  start: 0,
  end: 0,
};
const plannedCard: Card = { ...nowCard, title: "Planned card", next: "planned next", now: false };
const cardNoNext: Card = { ...nowCard, title: "No-next card", next: null };

const resolvers = {
  onLandingDone: async () => {},
  onDecisionDone: async () => {},
  onPlannedCardDone: async () => {},
};

// Nothing open → null, no card.
assert.equal(computeMomentum({ landing: null, decisions: [], plannedCard: null, ...resolvers }), null);

// Answered decisions never win.
assert.equal(computeMomentum({ landing: null, decisions: [decisionAnswered], plannedCard: null, ...resolvers }), null);

// Landing note beats everything, including a Now card.
const withLanding = computeMomentum({ landing: note, decisions: [decisionOld], plannedCard: nowCard, ...resolvers });
assert.equal(withLanding?.label, "landing note");
assert.equal(withLanding?.text, note.body);

// Now-starred card beats open decisions.
const withNow = computeMomentum({ landing: null, decisions: [decisionOld], plannedCard: nowCard, ...resolvers });
assert.equal(withNow?.label, "planned");
assert.equal(withNow?.text, nowCard.next, "a starred card outranks extracted decisions");

// Oldest open decision beats an unstarred planned card.
const withDecisions = computeMomentum({
  landing: null,
  decisions: [decisionNew, decisionOld],
  plannedCard,
  ...resolvers,
});
assert.equal(withDecisions?.label, "decision");
assert.equal(
  withDecisions?.text,
  `Re: "${decisionOld.question}" — `,
  "oldest (lowest ts) decision wins, not first-in-array, and text is reply-framed not verbatim"
);

// Unstarred planned card is the last resort, using next when present.
const withCard = computeMomentum({ landing: null, decisions: [decisionAnswered], plannedCard, ...resolvers });
assert.equal(withCard?.label, "planned");
assert.equal(withCard?.text, plannedCard.next);

// Card text falls back to title when next is absent.
const withCardNoNext = computeMomentum({ landing: null, decisions: [], plannedCard: cardNoNext, ...resolvers });
assert.equal(withCardNoNext?.text, cardNoNext.title);

// The picked item's done() calls exactly its own resolver, with the winning
// row — not a fixed/first row.
let doneCalledWith: unknown = null;
const spied = computeMomentum({
  landing: null,
  decisions: [decisionNew, decisionOld],
  plannedCard: null,
  ...resolvers,
  onDecisionDone: async (d: Decision) => {
    doneCalledWith = d;
  },
});
await spied?.done();
assert.equal(doneCalledWith, decisionOld, "done() resolves the exact winning decision, not just any decision");

let cardDoneWith: unknown = null;
const spiedCard = computeMomentum({
  landing: null,
  decisions: [decisionOld],
  plannedCard: nowCard,
  ...resolvers,
  onPlannedCardDone: async (c: Card) => {
    cardDoneWith = c;
  },
});
await spiedCard?.done();
assert.equal(cardDoneWith, nowCard, "done() on a Now pick resolves that card, not the decision");

console.log("momentum-check: all assertions passed");
