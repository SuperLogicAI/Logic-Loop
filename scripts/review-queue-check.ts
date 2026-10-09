// Phase 60: execute the production queue SQL and actual migration on SQLite.
// Run: npm run review-queue:check
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { RESULTS_TO_REVIEW_SQL, type ReviewResult } from "../src/lib/reviewQueue";
import { computeProvenance } from "../src/lib/ingest";

const rust = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
function migrationSql(version: number): string {
  const block = rust.split(`version: ${version},`)[1]?.split("kind: MigrationKind::Up")[0] ?? "";
  const raw = block.match(/sql: r#"([\s\S]*?)"#,/);
  if (raw) return raw[1];
  const quoted = block.match(/sql: "((?:\\.|[^"\\])*)",/s);
  assert.ok(quoted, `migration ${version} SQL not found`);
  return JSON.parse(`"${quoted[1].replace(/\n/g, "\\n")}"`) as string;
}

const db = new DatabaseSync(":memory:");
db.exec(migrationSql(2));
db.exec(migrationSql(6));
const insert = db.prepare("INSERT INTO events (session_id, type, payload_json, ts, dedupe_key) VALUES (?, ?, ?, ?, ?)");
let dedupe = 0;
const event = (session: string, type: string, ts: number, payload: Record<string, unknown> = {}) =>
  Number(insert.run(session, type, JSON.stringify(payload), ts, `fixture:${++dedupe}`).lastInsertRowid);
const landed = (session: string, ts: number, project = "/p") =>
  event(session, "result_landed", ts, { project_key: project, tab_id: `tab-${session}`, adapter_id: "codex" });
const rows = (project = "/p") => db.prepare(RESULTS_TO_REVIEW_SQL).all({ "$1": project }) as unknown as ReviewResult[];
const review = (session: string, id: number, ts: number, action = "reviewed") =>
  event(session, "result_reviewed", ts, { landed_id: id, action });

landed("old", 100);
assert.deepEqual(rows(), [], "no marker means no backfill");
const before = Date.now();
db.exec(migrationSql(14));
const after = Date.now();
const marker = db.prepare("SELECT id, ts FROM events WHERE type = 'result_review_tracking_started'").get() as { id: number; ts: number };
assert.ok(marker.ts >= before && marker.ts <= after, "actual migration timestamp must be milliseconds");
assert.deepEqual(rows(), [], "migration excludes old results");
db.exec(migrationSql(14));
assert.deepEqual(db.prepare("SELECT id, ts FROM events WHERE type = 'result_review_tracking_started'").all(), [marker], "replaying migration cannot move cutoff");
assert.throws(() => db.exec("INSERT INTO events (session_id, type, payload_json, ts, dedupe_key) SELECT session_id, type, payload_json, ts + 1000, dedupe_key FROM events WHERE type = 'result_review_tracking_started'"), /UNIQUE/);

const start = marker.ts + 10;
const a = landed("a", start);
assert.equal(rows()[0].id, a);
assert.equal(rows()[0].claimed_ts, null, "new result unseen");
event("a", "result_claimed", start + 1);
assert.equal(rows()[0].claimed_ts, start + 1, "seen is still to review");
review("a", a, start + 2);
assert.deepEqual(rows(), [], "explicit review closes its row");
const b = landed("a", start + 3);
review("a", a, start + 4);
assert.equal(rows()[0].id, b, "clicking stale A cannot close newer B");
review("a", b, start + 5);
assert.deepEqual(rows(), [], "reviewing B never resurfaces superseded A");

const c = landed("a", start + 6);
event("a", "hook:UserPromptSubmit", start + 7, { provenance: "auto" });
assert.equal(rows()[0].id, c, "automatic prompt leaves result open");
event("a", "hook:UserPromptSubmit", start + 8);
assert.equal(rows()[0].id, c, "missing provenance leaves result open");
event("elsewhere", "hook:UserPromptSubmit", start + 9, { provenance: "human" });
assert.equal(rows()[0].id, c, "another session's prompt cannot close it");
event("a", "hook:UserPromptSubmit", start + 10, { provenance: "human" });
assert.deepEqual(rows(), [], "explicit human provenance closes result");
const d = landed("a", start + 11);
review("a", d, start + 12, "dismissed");
assert.deepEqual(rows(), [], "dismissed is resolved");

const e = landed("a", start + 13);
const f = landed("b", start + 13);
landed("other", start + 14, "/other");
assert.deepEqual(rows().map((r) => [r.id, r.tab_id, r.adapter_id]), [[f, "tab-b", "codex"], [e, "tab-a", "codex"]], "project queue preserves each session's identity and stable order");
const newer = landed("a", start + 13);
assert.deepEqual(rows().map((r) => r.id), [newer, f], "latest result uses id to break timestamp ties");
review("a", newer, start + 13);
assert.deepEqual(rows().map((r) => r.id), [f], "same-ms review never resurfaces A");
event("b", "hook:UserPromptSubmit", start + 13, { provenance: "human" });
assert.deepEqual(rows(), [], "later event id orders same-ms prompts");
landed("superseded", start + 20);
const replacement = landed("superseded", start + 21);
review("superseded", replacement, start + 22);
assert.deepEqual(rows(), [], "reviewing latest B must not resurrect UNREVIEWED earlier A");
landed("edge", marker.ts);
assert.equal(rows()[0].session_id, "edge", "result inserted after marker at same timestamp is tracked");
event("edge", "result_claimed", marker.ts);
assert.equal(rows()[0].claimed_ts, marker.ts, "same-ms claim counts as seen");

// This phase deliberately inherits these heuristic limitations.
assert.equal(computeProvenance("tab-a", undefined, start), "human", "no input history (including restart) defaults human");
assert.equal(computeProvenance(undefined, undefined, start), "human", "untethered prompt defaults human");
assert.equal(computeProvenance("tab-a", start, start + 1), "human", "automatic prompt near a keystroke can read human");
assert.equal(computeProvenance("tab-a", start, start + 6000), "auto", "delayed typed prompt can read auto");

console.log("review-queue-check: all assertions passed");
