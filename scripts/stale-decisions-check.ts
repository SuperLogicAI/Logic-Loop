// Plan 051 self-check: the stale-decision predicate against a real SQLite.
// Run: npm run stale-decisions:check
import { strict as assert } from "node:assert";
import { DatabaseSync } from "node:sqlite";
import { STALE_DECISION_DAYS, staleDecisionSql } from "../src/lib/staleDecisions";

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;
assert.equal(STALE_DECISION_DAYS, 14);

const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE decisions (id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, cwd TEXT, status TEXT, ts INTEGER);
         CREATE TABLE events (id INTEGER PRIMARY KEY, session_id TEXT, ts INTEGER);`);
const add = (id: number, session: string, status: string, ageDays: number) =>
  db.prepare("INSERT INTO decisions VALUES (?, ?, 'p', ?, ?)").run(id, session, status, NOW - ageDays * DAY);
const ev = (session: string, ageDays: number) => db.prepare("INSERT INTO events (session_id, ts) VALUES (?, ?)").run(session, NOW - ageDays * DAY);

add(1, "recent", "open", 1);            // recent -> not stale
add(2, "dormant", "open", 20);          // old, session silent -> stale
ev("dormant", 20);
add(3, "active", "open", 20);           // old but session produced an event 2 days ago -> not stale
ev("active", 2);
add(4, "noevents", "open", 20);         // old, session has no events at all -> stale
add(5, "dormant2", "answered", 20);     // not open -> not stale
add(6, "edge-old", "open", 14.0001);    // just past the cutoff -> stale
add(7, "edge-new", "open", 13.9999);    // just inside -> not stale
add(8, "edge-ev", "open", 20);          // event exactly at the cutoff counts as activity -> not stale
db.prepare("INSERT INTO events (session_id, ts) VALUES (?, ?)").run("edge-ev", NOW - 14 * DAY);

const stale = (db.prepare(`SELECT id FROM decisions WHERE ${staleDecisionSql(NOW)} ORDER BY id`).all() as { id: number }[]).map((r) => r.id);
assert.deepEqual(stale, [2, 4, 6]);

// The complement query (what counts/Inbox use) must partition open rows exactly.
const notStale = (db.prepare(`SELECT id FROM decisions WHERE status = 'open' AND NOT ${staleDecisionSql(NOW)} ORDER BY id`).all() as { id: number }[]).map((r) => r.id);
assert.deepEqual(notStale, [1, 3, 7, 8]);

// Re-arms itself: new session activity makes a stale decision ordinary again.
ev("dormant", 0);
const after = (db.prepare(`SELECT id FROM decisions WHERE ${staleDecisionSql(NOW)} ORDER BY id`).all() as { id: number }[]).map((r) => r.id);
assert.deepEqual(after, [4, 6]);

console.log("stale-decisions-check: all assertions passed");
