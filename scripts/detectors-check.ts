// Self-check for Plan 053 detector precision: detectors scan only structured
// failure signals, never a successful command's output.
// Run: npm run detectors:check
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { detectBlockers, detectorTextFor, detectorTextForTranscript } from "../src/lib/detectors";
import type { HookPayload } from "../src/types";

const ev = (hook_event_name: string, rest: Record<string, unknown>): HookPayload => ({
  hook_event_name,
  session_id: "s",
  ...rest,
});
const labels = (t: string | null) => (t ? detectBlockers(t).map((d) => d.label) : []);

// The motivating bug: a successful Bash that reads detectors.ts itself.
const ownSource = readFileSync(join(import.meta.dirname, "../src/lib/detectors.ts"), "utf-8");
assert.ok(detectBlockers(ownSource).length > 0, "fixture must contain detector strings");
assert.equal(detectorTextFor(ev("PostToolUse", { tool_name: "Bash", tool_response: { stdout: ownSource, stderr: "", interrupted: false } })), null);

// Claude failure -> text and label; interrupt and non-Bash -> null.
const fail = ev("PostToolUseFailure", { tool_name: "Bash", error: "Exit code 1\nError: listen EADDRINUSE", is_interrupt: false });
assert.deepEqual(labels(detectorTextFor(fail)), ["Port in use"]);
assert.equal(detectorTextFor({ ...fail, is_interrupt: true }), null);
assert.equal(detectorTextFor({ ...fail, tool_name: "Read" }), null);
assert.equal(detectorTextFor({ ...fail, error: undefined }), null);

// Decision 2: a missing path alone is no longer a blocker; the rest stay.
assert.deepEqual(labels("ls: x: No such file or directory"), []);
assert.deepEqual(labels("zsh: command not found: foo"), ["Missing file/module"]);
assert.deepEqual(labels("Error: Cannot find module 'nope'"), ["Missing file/module"]);

// Hook text without a structured failure signal: null.
assert.equal(detectorTextFor(ev("PostToolUse", { tool_name: "Bash", agent: "codex", tool_response: "rate limit exceeded" })), null);
assert.equal(detectorTextFor(ev("PostToolUse", { tool_name: "bash", agent: "deepseek", tool_response: { is_error: true } })), null);
assert.equal(detectorTextFor(ev("PostToolUse", { tool_name: "bash", agent: "pi", tool_response: { is_error: true } })), null);
assert.equal(detectorTextFor(ev("PostToolUse", { tool_name: "run_command", agent: "antigravity", tool_response: { output: "ok" } })), null);

// OpenCode: non-zero metadata.exit -> output; exit 0 -> null.
const oc = (exit: number) =>
  ev("PostToolUse", { tool_name: "bash", agent: "opencode", tool_response: { title: "t", output: "EADDRINUSE", metadata: { exit, truncated: false } } });
assert.equal(detectorTextFor(oc(0)), null);
assert.deepEqual(labels(detectorTextFor(oc(1))), ["Port in use"]);

// Antigravity tool-level error: is_error + text.
assert.deepEqual(
  labels(detectorTextFor(ev("PostToolUse", { tool_name: "run_command", agent: "antigravity", tool_response: { is_error: true, error: "EACCES" } }))),
  ["Permission denied"]
);

// Non-shell tools never scan, even with a failure shape.
assert.equal(detectorTextFor(ev("PostToolUse", { tool_name: "Read", tool_response: { is_error: true, error: "EACCES" } })), null);


// Codex rollout completion: the observed persisted shape, not hook free text.
const codexItem = { type: "CommandExecution", exit_code: 1, aggregated_output: "Error: listen EADDRINUSE" };
const codexRecord = (item: unknown, eventType = "item_completed") => ({
  type: "event_msg", payload: { type: eventType, item },
});
const codexFailure = { ...codexRecord(codexItem), agent: "codex" };
assert.equal(detectorTextFor(codexFailure), codexItem.aggregated_output);
assert.deepEqual(labels(detectorTextFor(codexFailure)), ["Port in use"]);
assert.equal(detectorTextFor({ ...codexRecord({ ...codexItem, exit_code: 0, aggregated_output: ownSource }), agent: "codex" }), null);
for (const exit_code of [undefined, null, "1", true, 1.5, NaN, Infinity]) {
  assert.equal(detectorTextFor({ ...codexRecord({ ...codexItem, exit_code }), agent: "codex" }), null);
}
for (const item of [null, [], {}, { ...codexItem, aggregated_output: undefined }, { ...codexItem, aggregated_output: {} }, { ...codexItem, type: "AgentMessage" }]) {
  assert.equal(detectorTextFor({ ...codexRecord(item), agent: "codex" }), null);
}
assert.equal(detectorTextFor({ ...codexRecord(codexItem, "item_started"), agent: "codex" }), null);
assert.equal(detectorTextFor({ ...codexFailure, type: "response_item" }), null);
assert.equal(detectorTextFor({ ...codexFailure, agent: "claude" }), null);

// Existing transcript route: session adapter required, malformed/prose ignored.
const failedLine = JSON.stringify(codexRecord(codexItem));
assert.equal(detectorTextForTranscript(failedLine, "codex"), codexItem.aggregated_output);
assert.deepEqual(labels(detectorTextForTranscript(failedLine, "codex")), ["Port in use"]);
assert.equal(detectorTextForTranscript(JSON.stringify(codexRecord({ ...codexItem, exit_code: 0, aggregated_output: ownSource })), "codex"), null);
for (const line of ["not json EADDRINUSE", "null", "[]", JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "EADDRINUSE" } })]) {
  assert.equal(detectorTextForTranscript(line, "codex"), null);
}
assert.equal(detectorTextForTranscript(failedLine), null);
assert.equal(detectorTextForTranscript(JSON.stringify({ ...codexFailure }), "claude"), null);
assert.equal(detectorTextForTranscript(JSON.stringify({ ...codexFailure, agent: "claude" }), "codex"), codexItem.aggregated_output);

// Guard the integration: the one existing listener feeds the same persistence
// function with the session context; no second transcript ingestion route.
const appSource = readFileSync(join(import.meta.dirname, "../src/App.tsx"), "utf-8");
assert.ok(appSource.includes("detectorTextForTranscript(p.line, context.agent)"));
assert.ok(appSource.includes("runDetectors(p.session_id, detectText, context)"));

console.log("detectors-check ok");
