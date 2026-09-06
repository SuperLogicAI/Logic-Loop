// Self-check for the Phase 15 turn-provenance + loop digest. Run: npm run loop:check
import { strict as assert } from "node:assert";
import { collapseNoopRuns, groupIterations, isLoopRun } from "../src/lib/loop";
import type { EventRow, DeltaDecision } from "../src/lib/delta";
import { computeProvenance } from "../src/lib/ingest";
import { getLastInputTs, stampInput } from "../src/lib/pty";

const row = (type: string, payload: unknown, ts: number): EventRow => ({
  id: ts,
  ts,
  type,
  payload_json: typeof payload === "string" ? payload : JSON.stringify(payload),
});

const human = (ts: number) => row("hook:UserPromptSubmit", { provenance: "human" }, ts);
const auto = (ts: number) => row("hook:UserPromptSubmit", { provenance: "auto" }, ts);
const assistantLine = (text: string, ts: number) =>
  row("transcript", JSON.stringify({ type: "assistant", message: { content: text } }), ts);
const stop = (ts: number) => row("hook:Stop", {}, ts);
const tool = (ts: number, isError = false) =>
  row("hook:PostToolUse", { tool_name: "Bash", tool_response: isError ? { is_error: true } : { output: "ok" } }, ts);

// --- groupIterations ---

// Human-only session: no iterations at all.
assert.deepEqual(groupIterations([human(1), tool(2), stop(3)], []), [], "human-only session should yield zero iterations");

// 3 consecutive auto opens + stops, with tool/error counts and a no-op close on the last one.
const threeLoop: EventRow[] = [
  auto(1),
  tool(2),
  assistantLine("did the thing", 3),
  stop(4),
  auto(5),
  tool(6, true),
  assistantLine("fixed it", 7),
  stop(8),
  auto(9),
  assistantLine("no change", 10),
  stop(11),
];
const iters = groupIterations(threeLoop, []);
assert.equal(iters.length, 3, "should group into 3 iterations");
assert.equal(iters[0].toolCount, 1, "iteration 1 tool count");
assert.equal(iters[0].errorCount, 0, "iteration 1 error count");
assert.equal(iters[0].firstAssistantText, "did the thing", "iteration 1 headline");
assert.equal(iters[1].errorCount, 1, "iteration 2 should count the error");
assert.equal(iters[2].noop, true, "iteration 3 closing line is a no-op phrase");
assert.equal(iters[0].noop, false, "iteration 1 is not a no-op");
assert.equal(iters[0].endTs, 4, "iteration 1 closed by its Stop");

// Decision opened inside iteration 2's window attaches only to iteration 2.
const decisions: DeltaDecision[] = [
  { id: 1, question: "in iter 2", ts: 6 },
  { id: 2, question: "in iter 1", ts: 2 },
];
const withDecisions = groupIterations(threeLoop, decisions);
assert.deepEqual(
  withDecisions[1].decisions.map((d) => d.id),
  [1],
  "iteration 2 should get only the decision opened inside its window"
);
assert.deepEqual(
  withDecisions[0].decisions.map((d) => d.id),
  [2],
  "iteration 1 should get the decision opened inside its own window"
);
assert.equal(withDecisions[2].decisions.length, 0, "iteration 3 gets no decisions");

// Unterminated trailing auto open (no closing Stop) is marked incomplete, not dropped.
const trailing = groupIterations([auto(1), tool(2)], []);
assert.equal(trailing.length, 1, "unterminated iteration must still appear");
assert.equal(trailing[0].endTs, null, "unterminated iteration has no endTs");

// --- isLoopRun ---
assert.equal(isLoopRun(groupIterations([auto(1), stop(2)], [])), false, "1 auto turn is not a loop run");
assert.equal(isLoopRun(iters), true, "3 auto turns is a loop run");

// --- collapseNoopRuns ---
const lines = collapseNoopRuns(iters);
assert.deepEqual(
  lines.map((l) => l.kind),
  ["iteration", "iteration", "noop-run"],
  "trailing no-op iteration should collapse into its own run"
);

// --- computeProvenance ---
const now = Date.now();
assert.equal(computeProvenance(undefined, undefined, now), "human", "no tether defaults to human");
assert.equal(computeProvenance("t1", undefined, now), "human", "fresh tab with no recorded input defaults to human");
assert.equal(computeProvenance("t1", now - 1000, now), "human", "recent keystroke within window is human");
assert.equal(computeProvenance("t1", now - 6000, now), "auto", "stale keystroke beyond window is auto");

// --- pty.ts input stamp (byte-class filter) ---
stampInput("nav-tab", "\x1b[A"); // bare arrow key
assert.equal(getLastInputTs("nav-tab"), undefined, "a bare CSI escape sequence must not stamp");
stampInput("text-tab", "a");
assert.notEqual(getLastInputTs("text-tab"), undefined, "printable text must stamp");
stampInput("paste-tab", "\x1b[200~hello world\x1b[201~");
assert.notEqual(getLastInputTs("paste-tab"), undefined, "a bracketed paste must stamp");
stampInput("enter-tab", "\r");
assert.notEqual(getLastInputTs("enter-tab"), undefined, "carriage return must stamp");

console.log("loop-check: all assertions passed");
