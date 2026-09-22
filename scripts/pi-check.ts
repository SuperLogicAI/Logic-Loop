// Characterization check for the Pi Agent adapter (Plan 026).
// Run: npm run pi:check
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resetEpochGuard, stateForHook } from "../src/lib/ingest";
import type { HookPayload } from "../src/types";

const fullSource = readFileSync("src-tauri/src/pi.rs", "utf8");
assert.match(fullSource, /const MARKER: &str = "logic-loop-pi-extension";/);
assert.match(fullSource, /const PI_EXTENSION_VERSION: u32 = 2;/);

// Isolate the generated extension's raw string body so these checks can't
// accidentally pass (or fail) on the surrounding Rust test code, which
// legitimately mentions "agent_end"/"turn_end" as negative-assertion text.
const rawStart = fullSource.indexOf('r#"');
const rawEnd = fullSource.indexOf('"#', rawStart + 3);
assert.ok(rawStart >= 0 && rawEnd > rawStart, "could not isolate extension_source()'s raw string");
const source = fullSource.slice(rawStart, rawEnd);

assert.ok(source.includes('"X-Logic-Loop-Agent": "pi'));
assert.ok(source.includes("X-Logic-Loop-Tab"));
assert.ok(source.includes("LOGIC_LOOP_TAB_ID"));
assert.ok(source.includes("ingest.env"));

for (const mapping of [
  'hook_event_name: "SessionStart"',
  'hook_event_name: "UserPromptSubmit"',
  'hook_event_name: "PostToolUse"',
  'hook_event_name: "Stop"',
  'hook_event_name: "TranscriptLine"',
]) {
  assert.ok(source.includes(mapping), `missing Pi event mapping: ${mapping}`);
}
assert.ok(!source.includes("agent_end"), "must never wire agent_end to anything");
assert.ok(!source.includes("turn_end"), "must never wire turn_end to anything");
assert.ok(source.includes('pi.on("message_end"'), "finalized messages must feed extraction");
assert.ok(source.includes('type: "pi_message"'), "Pi needs its own explicit transcript envelope");
assert.ok(source.includes('message?.role !== "user" && message?.role !== "assistant"'));
assert.ok(source.includes('block?.type === "text"'));

for (const pick of [
  'pick("command", ["command"]);',
  'pick("file_path", ["path", "file_path"]);',
  'pick("description", ["description"]);',
]) {
  assert.ok(source.includes(pick), `missing Pi tool_input allowlist entry: ${pick}`);
}

function handlerBody(start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `could not isolate ${start} handler`);
  return source.slice(from, to);
}

for (const [start, end] of [
  ['pi.on("session_start"', 'pi.on("before_agent_start"'],
  ['pi.on("before_agent_start"', 'pi.on("tool_execution_start"'],
  ['pi.on("message_end"', 'pi.on("tool_execution_start"'],
  ['pi.on("tool_execution_end"', 'pi.on("agent_settled"'],
  ['pi.on("agent_settled"', 'pi.on("session_shutdown"'],
] as const) {
  const body = handlerBody(start, end);
  assert.match(body, /post\(\{/, `${start} must post its translated event`);
  assert.doesNotMatch(body, /await\s+post\(/, `${start} must remain fire-and-forget`);
}

// Cross-file wiring: installer registered, TS wrappers present, adapter
// metadata/marker parsing extended, allowlist extended, tailer gate untouched.
assert.ok(readFileSync("src-tauri/src/lib.rs", "utf8").includes("pi::pi_hooks_setup"));
const tsIngest = readFileSync("src/lib/ingest.ts", "utf8");
for (const fn of ['invoke<boolean>("pi_detect")', 'invoke("pi_hooks_setup")', 'invoke("pi_hooks_remove")', 'invoke<boolean>("pi_hooks_status")']) {
  assert.ok(tsIngest.includes(fn), `src/lib/ingest.ts missing ${fn}`);
}
const onboarding = readFileSync("src/lib/onboarding.ts", "utf8");
assert.match(onboarding, /"antigravity"\s*\|\s*"pi"/, "AdapterId union must include \"pi\"");
assert.ok(onboarding.includes('id: "pi"'));
assert.match(onboarding, /agent === "pi"/, "adapterIdForHook must accept \"pi\"");

const ingestRust = readFileSync("src-tauri/src/ingest.rs", "utf8");
// Widened to 5 when Plan 028 added "deepseek" — this assertion only needs
// "pi" present in the allowlist, not that the array stops there.
assert.match(ingestRust, /const RECOGNIZED_AGENTS: \[&str; \d+\] = \[[^\]]*"pi"[^\]]*\];/);
assert.match(ingestRust, /Some\(_\) => false,/, "tailer gate must stay closed for every non-codex agent, including pi");

const statusBar = readFileSync("src/components/AgentStatusBar.tsx", "utf8");
assert.ok(statusBar.includes("pi: { detect: piDetect"));

// stateForHook is agent-agnostic (keys on hook_event_name only) — this is a
// parity check, not new Pi-specific branching.
const event = (hook_event_name: string): HookPayload => ({
  hook_event_name,
  session_id: "pi-session",
  agent: "pi",
});

resetEpochGuard();
assert.equal(stateForHook(event("SessionStart")), null);
assert.equal(stateForHook(event("UserPromptSubmit")), "working");
assert.equal(stateForHook(event("PostToolUse")), "working");
assert.equal(stateForHook(event("Stop")), "idle");
assert.equal(stateForHook(event("PostToolUse")), null);

console.log("pi-check: all assertions passed");
