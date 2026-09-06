// Self-check for the Phase 14a since-you-left digest. Run: npm run delta:check
import { strict as assert } from "node:assert";
import { summarizeDelta, type EventRow } from "../src/lib/delta";

const row = (type: string, payload: unknown, ts: number): EventRow => ({
  id: ts,
  ts,
  type,
  payload_json: typeof payload === "string" ? payload : JSON.stringify(payload),
});

const rows: EventRow[] = [
  row("hook:UserPromptSubmit", {}, 1),
  row("hook:PostToolUse", { tool_name: "Read", tool_input: { file_path: "/a.ts" } }, 2),
  row("hook:PostToolUse", { tool_name: "Edit", tool_input: { file_path: "/b.ts" } }, 3),
  row("hook:PostToolUse", { tool_name: "Write", tool_input: { file_path: "/b.ts" } }, 4), // duplicate path
  row("hook:PostToolUse", { tool_name: "Bash", tool_input: { command: "ls" }, tool_response: { output: "ok" } }, 5),
  row("hook:PostToolUse", { tool_name: "Bash", tool_input: { command: "false" }, tool_response: { is_error: true } }, 6),
  row("transcript", JSON.stringify({ type: "assistant", message: { content: "first pass done" } }), 7),
  row("hook:UserPromptSubmit", {}, 8),
  row("transcript", JSON.stringify({ type: "assistant", message: { content: "final answer" } }), 9),
  // trailing tool_use-only message — no text, must not win over "final answer"
  row("transcript", JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "1" }] } }), 10),
  row("hook:Stop", {}, 11),
];

const d = summarizeDelta(rows, []);
assert.deepEqual(d.files, ["/b.ts"], "Read excluded and duplicate file_path not collapsed");
assert.equal(d.bashRuns, 2, "bash run count wrong");
assert.equal(d.bashErrors, 1, "is_error not counted");
assert.equal(d.turns, 2, "UserPromptSubmit not counted as turns");
assert.equal(d.stops, 1, "Stop not counted");
assert.equal(d.lastWords, "final answer", "should pick last real text over a trailing tool_use-only line");

const empty = summarizeDelta([], []);
assert.deepEqual(empty.files, [], "empty input should yield no files");
assert.equal(empty.bashRuns, 0, "empty input should yield zero bash runs");
assert.equal(empty.bashErrors, 0, "empty input should yield zero bash errors");
assert.equal(empty.turns, 0, "empty input should yield zero turns");
assert.equal(empty.stops, 0, "empty input should yield zero stops");
assert.equal(empty.lastWords, "", "empty input should yield empty lastWords");

console.log("delta-check: all assertions passed");
