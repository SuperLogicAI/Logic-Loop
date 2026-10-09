// Self-check for the Phase 14a since-you-left digest. Run: npm run delta:check
import { strict as assert } from "node:assert";
import { buildBrief, describeDelta, hasDelta, summarizeDelta, type Delta, type EventRow } from "../src/lib/delta";

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

// Antigravity's own tool names (Phase 16) — normalized fields, not Claude's
// tool names — must count the same as their Claude/Codex equivalents.
const agyRows: EventRow[] = [
  row("hook:PostToolUse", { tool_name: "write_to_file", tool_input: { file_path: "/c.ts" } }, 1),
  row("hook:PostToolUse", { tool_name: "run_command", tool_input: { command: "ls" } }, 2),
  row(
    "hook:PostToolUse",
    { tool_name: "run_command", tool_input: { command: "false" }, tool_response: { is_error: true } },
    3
  ),
];
const agyDelta = summarizeDelta(agyRows, []);
assert.deepEqual(agyDelta.files, ["/c.ts"], "Antigravity write_to_file not counted as a file change");
assert.equal(agyDelta.bashRuns, 2, "Antigravity run_command not counted as a command run");
assert.equal(agyDelta.bashErrors, 1, "Antigravity run_command error not counted");

const empty = summarizeDelta([], []);
assert.deepEqual(empty.files, [], "empty input should yield no files");
assert.equal(empty.bashRuns, 0, "empty input should yield zero bash runs");
assert.equal(empty.bashErrors, 0, "empty input should yield zero bash errors");
assert.equal(empty.turns, 0, "empty input should yield zero turns");
assert.equal(empty.stops, 0, "empty input should yield zero stops");
assert.equal(empty.lastWords, "", "empty input should yield empty lastWords");

// Plan 050 Part C: dashboard card helpers.
assert.equal(hasDelta(empty), false, "empty delta has nothing to show");
assert.equal(hasDelta({ ...empty, lastWords: "done" }), true, "last words alone counts");
assert.equal(describeDelta({ ...empty, lastWords: "done" }), "Agent activity");
assert.equal(
  describeDelta({ ...empty, files: ["a", "b"], turns: 1, decisions: [{ id: 1, question: "q", ts: 1 }], bashErrors: 3 }),
  "2 files · 1 turn · 1 new decision · 3 failed commands"
);

// Claude Code's PostToolUseFailure: a failed command counts as run + failed;
// an interrupt counts as run only; a failed Edit is not a changed file.
const failed = summarizeDelta(
  [
    row("hook:PostToolUse", { tool_name: "Bash", tool_input: { command: "ls" }, tool_response: {} }, 1),
    row("hook:PostToolUseFailure", { tool_name: "Bash", tool_input: { command: "ls /nope" }, error: "No such file" }, 2),
    row("hook:PostToolUseFailure", { tool_name: "Bash", tool_input: { command: "sleep 99" }, error: "x", is_interrupt: true }, 3),
    row("hook:PostToolUseFailure", { tool_name: "Edit", tool_input: { file_path: "/p/x.ts" }, error: "no match" }, 4),
  ],
  []
);
assert.equal(failed.bashRuns, 3);
assert.equal(failed.bashErrors, 1);
assert.deepEqual(failed.files, []);

// --- buildBrief (Plan 058) ---
const emptyDelta: Delta = { files: [], bashRuns: 0, bashErrors: 0, turns: 0, stops: 0, decisions: [], lastWords: "" };
const busy: Delta = {
  ...emptyDelta,
  files: ["/p/a.ts", "/p/b.ts", "/p/c.ts"],
  bashRuns: 5,
  bashErrors: 1,
  turns: 4,
  stops: 1,
  decisions: [{ id: 1, question: "Q1", ts: 1 }, { id: 2, question: "Q2", ts: 2 }],
  lastWords: "Done.",
};
const base = {
  delta: busy, loopIterations: null, project: "Logic Loop", agent: "claude", branch: "feat/x", dirty: true,
  goal: "Re-entry brief", landing: "Write plan 058", agentWaiting: true, next: "Answer Q1",
};
assert.deepEqual(buildBrief(base), {
  context: "Logic Loop · claude · feat/x ●",
  goal: "Re-entry brief",
  youLeft: "Write plan 058",
  changed: "3 files · 5 commands (1 failed) · 4 turns",
  needsYou: "2 new decisions · agent waiting",
  next: "Answer Q1",
});
assert.equal(buildBrief({ ...base, goal: null })?.goal, null, "no Now card → goal hidden");
assert.equal(buildBrief({ ...base, dirty: false })?.context, "Logic Loop · claude · feat/x", "clean branch has no dot");
assert.equal(buildBrief({ ...base, branch: "" })?.context, "Logic Loop · claude", "no git → no branch");
assert.equal(buildBrief({ ...base, landing: null })?.youLeft, null);
assert.equal(buildBrief({ ...base, next: "Write plan 058" })?.next, null, "Next repeating the landing note is hidden");
assert.equal(buildBrief({ ...base, next: "Re-entry brief" })?.next, null, "Next repeating the Goal is hidden");
assert.equal(buildBrief({ ...base, delta: { ...busy, decisions: [] }, agentWaiting: false })?.needsYou, null);
assert.equal(buildBrief({ ...base, loopIterations: 3 })?.changed, "3 iterations while away");
assert.equal(buildBrief({ ...base, delta: { ...emptyDelta, lastWords: "hi" } })?.changed, "agent replied");
// Decision 3: a note alone, no agent activity, still brings the brief back.
assert.equal(buildBrief({ ...base, delta: emptyDelta, agentWaiting: false })?.youLeft, "Write plan 058");
assert.equal(buildBrief({ ...base, delta: emptyDelta, agentWaiting: false })?.changed, null);
// Nothing to come back to → no card.
assert.equal(buildBrief({ ...base, delta: emptyDelta, agentWaiting: false, landing: null }), null);
assert.equal(buildBrief({ ...base, delta: emptyDelta, agentWaiting: false, landing: "  " }), null, "blank note is no note");

console.log("delta-check: all assertions passed");
