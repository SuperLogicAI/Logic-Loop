// Self-check for decision tracking (Phase 3 extraction, Phase 33.1 dedup,
// Plan 016 descoped reconciliation, Plan 018 schema-drift tripwire).
// Run: npm run decision-integrity:check
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeQuestion } from "../src/lib/repo";
import { boundedSubmittedReply, matchAnswerNowReply, type ReconciliationCandidate } from "../src/lib/decisionReconciliation";
import { transcriptEnvelopeType } from "../src/lib/decisions";

const candidates: ReconciliationCandidate[] = [
  { id: 4, question: "Use SQLite or Postgres?", assumption: "Use SQLite", ts: 100 },
  { id: 9, question: "Ship today?", assumption: null, ts: 200 },
];

assert.equal(boundedSubmittedReply("r".repeat(12_000)).length, 8_000, "stored reply uses same bound");

// Answer-now writes exactly `Re: "<question>" — <answer>` (App.tsx's
// answerNow). Matching that prefix must close deterministically, with zero
// model calls — this is the only way an open decision closes besides manual
// dismiss (Plan 016 removed the guessed-match reconciliation path).
assert.equal(matchAnswerNowReply(candidates, 'Re: "Ship today?" — yes, ship it'), 9);
assert.equal(
  matchAnswerNowReply(candidates, 'Re: "Use SQLite or Postgres?" — Postgres'),
  4
);
assert.equal(matchAnswerNowReply(candidates, "yes, ship it"), null, "not an Answer-now reply");
assert.equal(
  matchAnswerNowReply(candidates, 'Re: "A dismissed question?" — sure'),
  null,
  "quoted text names no open candidate"
);

// Insert dedup: normalizeQuestion collapses the phrasing differences a second
// extraction pass over a restated question is likely to introduce.
assert.equal(normalizeQuestion("Use SQLite or Postgres?"), "use sqlite or postgres");
assert.equal(
  normalizeQuestion("  Use   SQLite or Postgres?  "),
  normalizeQuestion("Use SQLite or Postgres?"),
  "whitespace differences must collapse to the same key"
);
assert.equal(
  normalizeQuestion("USE SQLITE OR POSTGRES"),
  normalizeQuestion("use sqlite or postgres?"),
  "case and trailing punctuation differences must collapse to the same key"
);
assert.notEqual(
  normalizeQuestion("Use SQLite or Postgres?"),
  normalizeQuestion("Ship today?"),
  "distinct questions must not collapse"
);

const root = join(import.meta.dirname, "..");
const repoSource = readFileSync(join(root, "src/lib/repo.ts"), "utf8");
const decisionsSource = readFileSync(join(root, "src/lib/decisions.ts"), "utf8");
const appSource = readFileSync(join(root, "src/App.tsx"), "utf8");

const openQuery = repoSource.match(/export async function openDecisionsForSession[\s\S]*?\n}/)?.[0] ?? "";
assert.match(openQuery, /session_id = \$1/);
assert.match(openQuery, /status = 'open'/);
assert.match(openQuery, /ORDER BY ts DESC, id DESC LIMIT 20/, "fetches newest 20 (Phase 33.1 cap)");
assert.match(openQuery, /\.reverse\(\)/, "restores oldest-first order for the prompt");

const answerWrite = repoSource.match(/export async function answerOpenDecisions[\s\S]*?\n}/)?.[0] ?? "";
assert.match(answerWrite, /session_id = \$1/);
assert.match(answerWrite, /status = 'open'/);
assert.match(answerWrite, /user_answer = \$2/);
assert.match(answerWrite, /boundedSubmittedReply\(submittedReply\)/);

// insertDecision: dedup check must run against OPEN rows only, and must
// return (skip the INSERT) strictly before the INSERT statement executes.
const insertFn = repoSource.match(/export async function insertDecision[\s\S]*?\n}/)?.[0] ?? "";
const dedupCheckIdx = insertFn.indexOf("openDecisionsForSession(sessionId)");
const dedupReturnIdx = insertFn.indexOf("if (alreadyOpen) return;");
const insertSqlIdx = insertFn.indexOf("INSERT INTO decisions");
assert.ok(
  dedupCheckIdx >= 0 && dedupReturnIdx >= 0 && insertSqlIdx >= 0,
  "insertDecision checks open rows and can skip before the INSERT"
);
assert.ok(dedupCheckIdx < dedupReturnIdx && dedupReturnIdx < insertSqlIdx, "dedup check runs before the INSERT");
assert.match(insertFn, /normalizeQuestion\(candidate\.question\)/, "dedup compares normalized questions, not raw text");

const userBranch = decisionsSource.slice(decisionsSource.indexOf("enqueueReconciliation(sessionId"));
assert.ok(userBranch.indexOf("enqueueReconciliation") < userBranch.indexOf("enqueue(sessionId"), "reconcile queues first");

// Plan 016 contract lock: reconcile() must never spawn a model. It may only
// try the deterministic Answer-now match and otherwise return false.
const reconcileFn = decisionsSource.match(/async function reconcile\([\s\S]*?\n}/)?.[0] ?? "";
assert.match(reconcileFn, /matchAnswerNowReply\(/, "reconcile() still checks the deterministic Answer-now match");
assert.doesNotMatch(
  reconcileFn,
  /run_extractor/,
  "reconcile() must never call run_extractor — guessed reconciliation was removed (Plan 016)"
);

const answerNowSource = appSource.match(/const answerNow = useCallback\([\s\S]*?\n  \);/)?.[0] ?? "";
assert.match(answerNowSource, /ptyWrite/);
assert.doesNotMatch(answerNowSource, /setDecisionStatus|answerOpenDecisions/);

// Plan 018 schema-drift tripwire: real old-format Claude/Codex lines must
// read as recognized, the actual new v2.1.270 "bridge session" line types
// found live 2026-09-12 must read as unrecognized (this is the regression
// test for the exact break that motivated this feature), and a line that
// isn't valid JSON at all must be its own third case — never counted toward
// drift, since a partial line mid-flush is ordinary tailing noise.
assert.equal(
  transcriptEnvelopeType('{"type":"assistant","message":{"content":"hi"}}'),
  "recognized"
);
assert.equal(transcriptEnvelopeType('{"type":"user","message":{"content":"hi"}}'), "recognized");
assert.equal(
  transcriptEnvelopeType('{"type":"response_item","payload":{"type":"message","role":"assistant"}}'),
  "recognized",
  "Codex-shaped lines are recognized too"
);
for (const line of [
  '{"type":"last-prompt","leafUuid":"x","sessionId":"s"}',
  '{"type":"mode","mode":"normal","sessionId":"s"}',
  '{"type":"permission-mode","permissionMode":"auto","sessionId":"s"}',
  '{"type":"atis-latch","atis":"","sessionId":"s"}',
  '{"type":"bridge-session","sessionId":"s","bridgeSessionId":"cse_01QP9PcQR"}',
]) {
  assert.equal(transcriptEnvelopeType(line), "unrecognized", `${line} must be flagged, not silently ignored`);
}
assert.equal(transcriptEnvelopeType("not json"), "unparseable");
assert.equal(transcriptEnvelopeType('{"type":"assistant"'), "unparseable", "a partial line mid-flush is not drift");

// onTranscript must track every line's envelope before it ever looks at
// extractable text — the drift signal must not depend on a turn's content.
const onTranscriptFn = decisionsSource.match(/export function onTranscript\([\s\S]*?\n}/)?.[0] ?? "";
const driftCallIdx = onTranscriptFn.indexOf("trackSchemaDrift(");
const textExtractIdx = onTranscriptFn.indexOf("textFromTranscriptLine(line)");
assert.ok(driftCallIdx >= 0 && textExtractIdx >= 0, "onTranscript calls both trackSchemaDrift and textFromTranscriptLine");
assert.ok(driftCallIdx < textExtractIdx, "drift tracking runs unconditionally, before the early-return on unparsed text");

console.log("decision-integrity-check: all assertions passed");
