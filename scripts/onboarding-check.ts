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
  type AdapterRuntimeState,
} from "../src/lib/onboarding";

assert.equal(ONBOARDING_VERSION, 3);
assert.deepEqual(
  ADAPTERS.map(({ id, command, capabilities }) => ({ id, command, capabilities })),
  [
    { id: "claude", command: "claude", capabilities: { activity: true, decisions: true, reentry: true } },
    { id: "codex", command: "codex", capabilities: { activity: true, decisions: true, reentry: true } },
    { id: "opencode", command: "opencode", capabilities: { activity: true, decisions: true, reentry: true } },
    { id: "antigravity", command: "agy", capabilities: { activity: true, decisions: false, reentry: true } },
    { id: "pi", command: "pi", capabilities: { activity: true, decisions: false, reentry: true } },
    { id: "deepseek", command: "dsh --profile logic-loop", capabilities: { activity: true, decisions: false, reentry: true } },
  ]
);

assert.equal(adapterIdForHook(undefined), "claude");
assert.equal(adapterIdForHook("codex"), "codex");
assert.equal(adapterIdForHook("opencode"), "opencode");
assert.equal(adapterIdForHook("antigravity"), "antigravity");
assert.equal(adapterIdForHook("pi"), "pi");
assert.equal(adapterIdForHook("deepseek"), "deepseek");
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

const statusSource = readFileSync("src/components/AgentStatusBar.tsx", "utf8");
assert.equal(statusSource.match(/const toggleAdapter/g)?.length, 1, "header and modal need one toggle path");
assert.ok(statusSource.includes("getOnboardingVersion"));
assert.ok(statusSource.includes("setOnboardingVersion"));
assert.match(statusSource, />\s*Setup\s*</);
assert.match(statusSource, /const command = adapter\?\.command\.split\(" "\)\[0\] \?\? id;/);
assert.match(statusSource, /\{command\} \{state\.enabled/);

const modalSource = readFileSync("src/components/OnboardingModal.tsx", "utf8");
assert.ok(modalSource.includes('role="dialog"'));
assert.ok(modalSource.includes("Waiting for first event"));
assert.match(modalSource, /installUrl\s*\?\s*"Install"/);
assert.ok(modalSource.includes("installation instructions"));
assert.ok(modalSource.includes('src="/loop.png"'));
assert.ok(modalSource.includes("developed by Super Logic AI"));
assert.ok(modalSource.includes('href="https://superlogicai.com"'));
assert.doesNotMatch(modalSource, /invoke\(|ptyWrite|SELECT |INSERT |UPDATE /);

// Plan 033: launch flow contract. Structural checks only (no DOM harness
// wired into `check` yet — see plans/033-first-useful-session.md Step 4);
// npm run test:ui covers the rendered-interaction cases once approved.
assert.match(modalSource, /Choose folder/, "Setup needs a folder picker");
assert.match(modalSource, /directory:\s*true/, "folder picker must be a directory dialog, not a file picker");
assert.match(modalSource, /validateProjectDir/, "folder pick must go through the strict validator, not canonicalizeCwd's silent fallback");
assert.match(modalSource, /setFolderError/, "an invalid folder pick must surface an error, not silently substitute home");
assert.match(modalSource, /startingRef\.current/, "Start must guard against a double-click spawning two tabs");
assert.doesNotMatch(modalSource, /invoke\(|ptyWrite|SELECT |INSERT |UPDATE /);

const repoSource = readFileSync("src/lib/repo.ts", "utf8");
assert.match(repoSource, /export async function hasLaunchedSession/);
assert.match(repoSource, /export async function setHasLaunchedSession/);
assert.match(appSource, /hasLaunchedSession\(\)/, "startup must consult hasLaunchedSession before the home-tab fallback");
assert.match(appSource, /setForceSetupOpen\(true\)/, "a true first run must force Setup open instead of a silent home spawn");

const bookmarksSource = readFileSync("src/components/BookmarksBar.tsx", "utf8");
assert.match(
  bookmarksSource,
  /onAdd:\s*\(name: string, cwd: string, color: string\) => Promise<void>/,
  "bookmark save callbacks must be awaited, not fire-and-forget"
);
assert.match(bookmarksSource, /catch \(error\) \{\s*setSaveError/, "a rejected save must show a retryable error, not silently clear the form");
assert.doesNotMatch(
  bookmarksSource.slice(bookmarksSource.indexOf("const submit"), bookmarksSource.indexOf("const submit") + 400),
  /setForm\(null\);[\s\S]*await/,
  "setForm(null) must not run before the save actually resolves"
);

const rustSource = readFileSync("src-tauri/src/ingest.rs", "utf8");
assert.match(rustSource, /pub fn claude_detect\(\) -> bool/);
const libRsSource = readFileSync("src-tauri/src/lib.rs", "utf8");
assert.ok(libRsSource.includes("ingest::claude_detect"));
assert.ok(readFileSync("src/lib/ingest.ts", "utf8").includes('invoke<boolean>("claude_detect")'));

const ptyRsSource = readFileSync("src-tauri/src/pty.rs", "utf8");
assert.match(ptyRsSource, /pub fn validate_project_dir\(path: String\) -> Result<String, String>/);
assert.ok(libRsSource.includes("pty::validate_project_dir"));
assert.ok(readFileSync("src/lib/pty.ts", "utf8").includes('invoke<string>("validate_project_dir"'));

console.log("onboarding-check: all assertions passed");
