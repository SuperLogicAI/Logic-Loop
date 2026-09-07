// Self-check for the Phase 18 Idea Board's markdown parse/splice/append.
// Run: npm run board:check
import { strict as assert } from "node:assert";
import { appendCard, deleteCard, moveCard, NOW_CAP, parseBoard, preambleOf, spliceCard, toggleNow } from "../src/lib/board";

const fixture = `# Board

Preamble text, kept untouched by any splice.

## First card
status: idea
one-liner about the first card
link: docs/IDEAS.md
next: write the plan

## Second card
status: planned
a body with an embedded table:
| a | b |
|---|---|
| 1 | 2 |
some-unknown-line: kept verbatim
next: ship it

## Third card
status: done
`;

// --- parse ---
const cards = parseBoard(fixture);
assert.equal(cards.length, 3);
assert.equal(cards[0].title, "First card");
assert.equal(cards[0].status, "idea");
assert.equal(cards[0].link, "docs/IDEAS.md");
assert.equal(cards[0].next, "write the plan");
assert.equal(cards[1].status, "planned");
assert.ok(cards[1].body.includes("| a | b |"), "table inside a card body is preserved");
assert.ok(cards[1].body.includes("some-unknown-line: kept verbatim"), "unrecognized line kept verbatim");
assert.equal(cards[2].status, "done");
assert.equal(preambleOf(fixture), fixture.slice(0, fixture.indexOf("## First card")));

// --- splice: editing card 2 must not touch 1, 3, or the preamble ---
const edited = spliceCard(fixture, { ...cards[1], status: "building" });
const reparsed = parseBoard(edited);
assert.equal(reparsed[1].status, "building");
assert.equal(reparsed[0].title, cards[0].title, "sibling card untouched by splice");
assert.equal(reparsed[2].title, cards[2].title, "sibling card untouched by splice");
assert.equal(preambleOf(edited), preambleOf(fixture), "preamble byte-identical after splice");
assert.ok(edited.slice(0, cards[1].start) === fixture.slice(0, cards[1].start), "content before the spliced card is byte-identical");
assert.ok(edited.slice(edited.length - (fixture.length - cards[1].end)) === fixture.slice(cards[1].end), "content after the spliced card is byte-identical");

// --- moveCard: only the status line changes ---
const moved = moveCard(fixture, cards[0], "later");
const movedCard = parseBoard(moved)[0];
assert.equal(movedCard.status, "later");
assert.equal(movedCard.body, cards[0].body, "moveCard doesn't touch the body");
assert.equal(movedCard.link, cards[0].link, "moveCard doesn't touch link");
assert.equal(movedCard.next, cards[0].next, "moveCard doesn't touch next");

// --- delete ---
const deleted = deleteCard(fixture, cards[1]);
assert.equal(parseBoard(deleted).length, 2);
assert.equal(parseBoard(deleted)[0].title, "First card");
assert.equal(parseBoard(deleted)[1].title, "Third card");

// --- append: quick-add with an explicit title ---
const withTitled = appendCard(fixture, { title: "Fourth card", body: "quick note" });
const titledCards = parseBoard(withTitled);
assert.equal(titledCards.length, 4);
assert.equal(titledCards[3].title, "Fourth card");
assert.equal(titledCards[3].status, "idea", "default status is idea");
assert.equal(titledCards[3].body, "quick note");

// --- append: empty title, "Brain Dump" quick-add ---
const withBrainDump = appendCard(fixture, { title: "", body: "Remember to check the widget\nmore detail" });
const bdCards = parseBoard(withBrainDump);
assert.equal(bdCards[3].title, "Remember to check the widget", "first body line becomes the title");
assert.equal(bdCards[3].body, "more detail");

// --- append onto a file with no trailing newline doesn't glue onto the last line ---
const noTrailingNewline = "## Only card\nstatus: idea\nsome body";
const appended = appendCard(noTrailingNewline, { title: "New card", body: "" });
assert.ok(appended.includes("some body\n") && appended.includes("## New card"), "append doesn't merge into the prior line");
assert.equal(parseBoard(appended).length, 2);

// --- Phase 20: Now set ---

// A card with no `now:` line parses as not-now, and a card serialized
// without now stays byte-identical to a plain card (no stray empty line).
assert.equal(cards[0].now, false, "no now: line means not-now by default");
const noneNow = fixture; // no card in the fixture has now: true
assert.deepEqual(
  parseBoard(noneNow).map((c) => c.now),
  [false, false, false]
);

// Toggle on: round-trips as `now: true`.
const starred = toggleNow(fixture, cards[0], cards);
const starredCard = parseBoard(starred)[0];
assert.equal(starredCard.now, true);
assert.equal(starredCard.status, cards[0].status, "toggling now doesn't touch status");

// Toggle off: the now: true line disappears entirely, not now: false.
const unstarred = toggleNow(starred, starredCard, parseBoard(starred));
assert.equal(parseBoard(unstarred)[0].now, false);
assert.ok(!unstarred.includes("now:"), "turning now off removes the line rather than writing now: false");

// Cap: NOW_CAP cards starred, one more toggle-on is a no-op (md unchanged).
let capMd = fixture;
for (let i = 0; i < NOW_CAP; i++) {
  const parsed = parseBoard(capMd);
  capMd = appendCard(capMd, { title: `filler ${i}`, body: "" });
}
let withCap = capMd;
let parsedForCap = parseBoard(withCap);
for (let i = 0; i < NOW_CAP; i++) {
  withCap = toggleNow(withCap, parsedForCap[i], parsedForCap);
  parsedForCap = parseBoard(withCap);
}
assert.equal(parsedForCap.filter((c) => c.now).length, NOW_CAP, "cap reached exactly");
const beforeFourth = withCap;
const fourthAttempt = toggleNow(withCap, parsedForCap[NOW_CAP], parsedForCap);
assert.equal(fourthAttempt, beforeFourth, "toggling a 4th card on at the cap is a no-op");

// Turning one off always succeeds even while at the cap.
const oneOff = toggleNow(withCap, parsedForCap[0], parsedForCap);
assert.notEqual(oneOff, withCap, "turning a now card off succeeds regardless of the cap");
assert.equal(parseBoard(oneOff).filter((c) => c.now).length, NOW_CAP - 1);

console.log("board-check: all assertions passed");
