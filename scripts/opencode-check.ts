// Characterization check for the OpenCode repo contract and adapter baseline.
// Run: npm run opencode:check
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resetEpochGuard, stateForHook } from "../src/lib/ingest";
import type { HookPayload } from "../src/types";

type OpenCodeConfig = {
  $schema?: string;
  instructions?: string[];
  permission?: {
    external_directory?: string;
    bash?: Record<string, string>;
  };
};

const config = JSON.parse(readFileSync("opencode.json", "utf8")) as OpenCodeConfig;
assert.equal(config.$schema, "https://opencode.ai/config.json");
assert.deepEqual(config.instructions, ["CONTRIBUTING.md"]);
assert.equal(config.permission?.external_directory, "ask");

const bash = config.permission?.bash;
assert.ok(bash, "bash permissions are missing");
assert.equal(Object.keys(bash)[0], "*", "catch-all bash rule must remain first");
assert.equal(bash["*"], "allow");
for (const pattern of [
  "git push*",
  "git reset*",
  "git clean*",
  "git checkout --*",
  "rm *",
  "npm install*",
  "npm uninstall*",
  "npm update*",
  "pnpm add*",
  "yarn add*",
  "cargo add*",
  "npm run tauri*build*",
  "cargo tauri build*",
  "npx tauri build*",
]) {
  assert.equal(bash[pattern], "ask", `${pattern} must require approval`);
}

const agents = readFileSync("AGENTS.md", "utf8");
assert.ok(agents.trim(), "AGENTS.md is empty");
assert.ok(Buffer.byteLength(agents) <= 3072, "AGENTS.md exceeds 3,072 bytes");
for (const concept of [
  /Never parse ANSI or PTY output/i,
  /Fail open/i,
  /Panels are simple SQL views over append-only tables/i,
  /Never send input autonomously/i,
  /untrusted data/i,
  /Tauri v2[\s\S]*portable-pty[\s\S]*React[\s\S]*SQLite/i,
]) {
  assert.match(agents, concept);
}
for (const command of [
  "npm run check",
  "npx tsc --noEmit",
  "npm run build",
  "cargo test --lib",
  "cargo clippy --all-targets -- -D warnings",
]) {
  assert.ok(agents.includes(command), `AGENTS.md is missing ${command}`);
}

const source = readFileSync("src-tauri/src/opencode.rs", "utf8");
assert.match(source, /const OPENCODE_PLUGIN_VERSION: u32 = 2;/);
assert.ok(source.includes('"X-Logic-Loop-Agent": "opencode"'));
for (const mapping of [
  '"session.created": "SessionStart"',
  '"session.idle": "Stop"',
  '"permission.asked": "Notification"',
]) {
  assert.ok(source.includes(mapping), `missing OpenCode event mapping: ${mapping}`);
}
for (const token of ["chat.message", "tool.execute.after", "UserPromptSubmit", "PostToolUse"]) {
  assert.ok(source.includes(token), `missing OpenCode adapter token: ${token}`);
}

function handlerBody(start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `could not isolate ${start} handler`);
  return source.slice(from, to);
}

for (const [start, end] of [
  ["event: async", '"chat.message": async'],
  ['"chat.message": async', '"tool.execute.after": async'],
  ['"tool.execute.after": async', "  }};"],
] as const) {
  const body = handlerBody(start, end);
  assert.match(body, /^\s*post\(/m, `${start} must post its translated event`);
  assert.doesNotMatch(body, /^\s*await\s+post\(/m, `${start} must remain fire-and-forget`);
}

const event = (hook_event_name: string): HookPayload => ({
  hook_event_name,
  session_id: "opencode-session",
});

resetEpochGuard();
assert.equal(stateForHook(event("SessionStart")), null);
assert.equal(stateForHook(event("UserPromptSubmit")), "working");
assert.equal(stateForHook(event("PostToolUse")), "working");
assert.equal(stateForHook(event("Notification")), "waiting");
assert.equal(stateForHook(event("Stop")), "idle");
assert.equal(stateForHook(event("PostToolUse")), null);

console.log("opencode-check: all assertions passed");
