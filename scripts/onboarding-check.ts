// Phase 31 onboarding contract. Run: npm run onboarding:check
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  ADAPTERS,
  adapterIdForHook,
  adapterProgress,
  formatAdapterError,
  ONBOARDING_VERSION,
  parseOnboardingVersion,
  startupAction,
  type AdapterRuntimeState,
} from "../src/lib/onboarding";

assert.equal(ONBOARDING_VERSION, 2);
assert.deepEqual(
  ADAPTERS.map(({ id, command, capabilities }) => ({ id, command, capabilities })),
  [
    { id: "claude", command: "claude", capabilities: { activity: true, decisions: true, reentry: true } },
    { id: "codex", command: "codex", capabilities: { activity: true, decisions: true, reentry: true } },
    { id: "opencode", command: "opencode", capabilities: { activity: true, decisions: false, reentry: false } },
    { id: "antigravity", command: "agy", capabilities: { activity: true, decisions: false, reentry: false } },
  ]
);

assert.equal(adapterIdForHook(undefined), "claude");
assert.equal(adapterIdForHook("codex"), "codex");
assert.equal(adapterIdForHook("opencode"), "opencode");
assert.equal(adapterIdForHook("antigravity"), "antigravity");
assert.equal(adapterIdForHook("future-agent"), null);

const state = (overrides: Partial<AdapterRuntimeState> = {}): AdapterRuntimeState => ({
  available: true,
  enabled: true,
  operation: null,
  error: null,
  ...overrides,
});
assert.equal(adapterProgress(state({ available: null, enabled: null, operation: "checking" }), false), "checking");
assert.equal(adapterProgress(state({ available: false, enabled: false }), false), "not-detected");
assert.equal(adapterProgress(state({ enabled: false }), false), "not-enabled");
assert.equal(adapterProgress(state({ operation: "enabling" }), false), "enabling");
assert.equal(adapterProgress(state(), false), "waiting");
assert.equal(adapterProgress(state(), true), "connected");
assert.equal(adapterProgress(state({ error: "bad config" }), true), "error");
assert.equal(formatAdapterError("x".repeat(500)).length, 400);
assert.equal(parseOnboardingVersion(null), 0);
assert.equal(parseOnboardingVersion("garbage"), 0);
assert.equal(parseOnboardingVersion("1"), 1);
assert.equal(startupAction(1, 0), "restore");
assert.equal(startupAction(0, 0), "show-setup");
assert.equal(startupAction(0, 2), "open-home");
assert.equal(startupAction(0, null), "open-home-with-setup-error");

const notifySource = readFileSync("src/lib/notify.ts", "utf8");
const initBody = notifySource.slice(
  notifySource.indexOf("export async function initNotifications"),
  notifySource.indexOf("export async function requestNotifications")
);
assert.doesNotMatch(initBody, /requestPermission\s*\(/, "startup must not request OS permission");
assert.match(notifySource, /export async function requestNotifications[\s\S]*requestPermission\s*\(/);

const appSource = readFileSync("src/App.tsx", "utf8");
assert.match(appSource, /if \(p\.tab_id\)[\s\S]*adapterIdForHook\(p\.agent\)/);
assert.ok(appSource.includes("observedAdapters={observedAdapters}"));
assert.match(appSource, /getOnboardingVersion\(\)[\s\S]*startupAction/);
assert.match(appSource, /preflightDirectory\(path\)[\s\S]*openTab\(\{ cwd: path \}\)/);
assert.match(appSource, /tabsRef\.current\.length === 0[\s\S]*openHomeTerminal/);

const statusSource = readFileSync("src/components/AgentStatusBar.tsx", "utf8");
assert.equal(statusSource.match(/const toggleAdapter/g)?.length, 1, "header and modal need one toggle path");
assert.doesNotMatch(statusSource, /getOnboardingVersion|setOnboardingVersion/);
assert.match(statusSource, />\s*Setup\s*</);

const modalSource = readFileSync("src/components/OnboardingModal.tsx", "utf8");
assert.ok(modalSource.includes('role="dialog"'));
assert.ok(modalSource.includes("Waiting for first event"));
assert.ok(modalSource.includes('src="/loop.png"'));
assert.ok(modalSource.includes("developed by Super Logic AI"));
assert.ok(modalSource.includes('href="https://superlogicai.com"'));
assert.match(modalSource, /open\(\{ directory: true, multiple: false \}\)/);
assert.ok(modalSource.includes("Open project folder"));
assert.ok(modalSource.includes("Open home terminal"));
assert.doesNotMatch(modalSource, /invoke\(|ptyWrite|SELECT |INSERT |UPDATE /);

const rustSource = readFileSync("src-tauri/src/ingest.rs", "utf8");
assert.match(rustSource, /pub fn claude_detect\(\) -> bool/);
assert.ok(readFileSync("src-tauri/src/lib.rs", "utf8").includes("ingest::claude_detect"));
assert.ok(readFileSync("src/lib/ingest.ts", "utf8").includes('invoke<boolean>("claude_detect")'));

const ptySource = readFileSync("src-tauri/src/pty.rs", "utf8");
assert.match(ptySource, /pub fn preflight_directory\(path: String\) -> DirectoryPreflight/);
assert.match(ptySource, /std::fs::metadata\(target\)[\s\S]*std::fs::read_dir\(target\)/);
assert.ok(readFileSync("src-tauri/src/lib.rs", "utf8").includes("pty::preflight_directory"));

console.log("onboarding-check: all assertions passed");
