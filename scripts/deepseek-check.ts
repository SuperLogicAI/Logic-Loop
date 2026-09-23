// Characterization check for the DeepSeek Harness terminal adapter (plans/028).
// Run: npm run deepseek:check
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resetEpochGuard, stateForHook } from "../src/lib/ingest";
import type { HookPayload } from "../src/types";

const rust = readFileSync("src-tauri/src/deepseek.rs", "utf8");

assert.match(rust, /const MARKER_FIELD: &str = "logicLoopAdapterVersion";/);
assert.match(rust, /const DEEPSEEK_ADAPTER_VERSION: u64 = 4;/);

const bundledPackage = JSON.parse(readFileSync("dsh-terminal-app/package.json", "utf8"));
assert.equal(bundledPackage.logicLoopAdapterVersion, 4);
assert.match(rust, /pub\(crate\) const PROFILE_NAME: &str = "logic-loop";/);

// The 9 core @deepseek-ai/* packages this plugin depends on directly, all
// of which must be pinned to the target profile's own resolved version
// (an unpinned `*` range previously resolved dsh-session to an ancient,
// incompatible 0.0.1-rc.1 published under the same name — plans/028).
for (const pkg of [
  "cordis",
  "cordis-plugin-loader",
  "dsh-agent",
  "dsh-agent-default-model",
  "dsh-llm",
  "dsh-session",
  "dsh-cmdline",
  "dsh-util-values",
  "schemastery",
]) {
  assert.ok(rust.includes(`"${pkg}"`), `deepseek.rs must list core package "${pkg}"`);
}

// Symlink-vs-copy: the real bug found live (plans/028) was that a plugin
// installed via `dsh plugin add -w <path>` is left as a symlink, which
// can't see the profile's own hoisted dependency tree. The fix must stay:
// replace it with a real copy before installing the plugin's own deps.
assert.ok(rust.includes("copy_dir_recursive"), "setup must copy the plugin, not leave dsh plugin add's symlink");
assert.match(rust, /npm install/, "setup must install the plugin's own dependencies");
assert.ok(rust.includes("--legacy-peer-deps"), "npm install must use --legacy-peer-deps (plans/028)");

// The foreign-directory guard mirrors every other adapter module's own-file
// protection (e.g. pi.rs's plan_setup / is_ours).
assert.ok(
  rust.includes("isn't a Logic Loop install"),
  "setup/remove must refuse to touch a foreign dsh-terminal-app directory",
);

// Bundled resource resolution — must use the documented BaseDirectory path
// (works under `tauri dev`, not only a built app), not a raw resource_dir().
assert.match(rust, /resolve\("dsh-terminal-app", BaseDirectory::Resource\)/);

// Part A: setup shells out to `dsh` and then `npm install`, so it must run off
// the app's main/event-loop thread via pty::spawn_blocking_result — the same
// beachball class Plans 017 fixed for the git_* commands.
assert.match(rust, /pub async fn deepseek_hooks_setup/);
assert.ok(
  rust.includes('spawn_blocking_result("deepseek_hooks_setup"'),
  "deepseek_hooks_setup must be routed through pty::spawn_blocking_result",
);

// Cross-file wiring.
assert.ok(readFileSync("src-tauri/src/lib.rs", "utf8").includes("deepseek::deepseek_hooks_setup"));

const tauriConf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const resources = tauriConf.bundle?.resources ?? {};
assert.ok(
  Object.keys(resources).some((k) => k.includes("dsh-terminal-app/package.json")),
  "tauri.conf.json must bundle dsh-terminal-app as a resource",
);
for (const file of ["src/index.js", "src/messages.js", "src/startup.js"]) {
  assert.ok(
    Object.keys(resources).some((k) => k.endsWith(`dsh-terminal-app/${file}`)),
    `tauri.conf.json must bundle dsh-terminal-app/${file}`,
  );
}
assert.ok(
  !Object.keys(resources).some((k) => k.includes("node_modules")),
  "tauri.conf.json must never bundle dsh-terminal-app/node_modules",
);
assert.ok(
  rust.includes('dir.join("src/messages.js").is_file()'),
  "status must reject an incomplete installed plugin even when its marker is current",
);

const tsIngest = readFileSync("src/lib/ingest.ts", "utf8");
for (const fn of [
  'invoke<boolean>("deepseek_detect")',
  'invoke("deepseek_hooks_setup")',
  'invoke("deepseek_hooks_remove")',
  'invoke<boolean>("deepseek_hooks_status")',
]) {
  assert.ok(tsIngest.includes(fn), `src/lib/ingest.ts missing ${fn}`);
}

const onboarding = readFileSync("src/lib/onboarding.ts", "utf8");
assert.match(onboarding, /"pi"\s*\|\s*"deepseek"/, 'AdapterId union must include "deepseek"');
assert.ok(onboarding.includes('id: "deepseek"'));
assert.match(onboarding, /agent === "deepseek"/, 'adapterIdForHook must accept "deepseek"');

const ingestRust = readFileSync("src-tauri/src/ingest.rs", "utf8");
assert.match(ingestRust, /"pi", "deepseek"/, 'RECOGNIZED_AGENTS must include "deepseek"');

const ptyRust = readFileSync("src-tauri/src/pty.rs", "utf8");
assert.match(ptyRust, /Some\("deepseek"\) => format!\(/, "resume_command must have a deepseek arm");
assert.ok(
  ptyRust.includes("npx --yes @deepseek-ai/dsh --profile logic-loop --resume"),
  "resume_command's deepseek arm must use the proven npx invocation, not a bare `dsh`",
);

const statusBar = readFileSync("src/components/AgentStatusBar.tsx", "utf8");
assert.ok(statusBar.includes("deepseek: {"));
assert.ok(statusBar.includes('"deepseek"'));

// stateForHook is agent-agnostic (keys on hook_event_name only) — this is a
// parity check, not new deepseek-specific branching.
const event = (hook_event_name: string): HookPayload => ({
  hook_event_name,
  session_id: "deepseek-session",
  agent: "deepseek",
});

resetEpochGuard();
assert.equal(stateForHook(event("SessionStart")), null);
assert.equal(stateForHook(event("UserPromptSubmit")), "working");
assert.equal(stateForHook(event("PostToolUse")), "working");
assert.equal(stateForHook(event("Stop")), "idle");
assert.equal(stateForHook(event("PostToolUse")), null);

// Part 0 contract: readline must be paused while the agent owns stdout, and
// resumed only after the next question is set up, or type-ahead leaks into the
// reply uncolored. Source-order check; the live behavior is a manual test.
const runner = readFileSync("dsh-terminal-app/src/index.js", "utf8");
const questionAt = runner.indexOf("rl.question(");
const resumeAt = runner.indexOf("rl.resume()");
const pauseAt = runner.indexOf("rl.pause()");
assert.ok(questionAt >= 0, "runner must call rl.question");
assert.ok(resumeAt > questionAt, "runner must resume after setting up the prompt");
assert.ok(pauseAt > resumeAt, "runner must pause readline for the agent turn");

console.log("deepseek-check: all assertions passed");
