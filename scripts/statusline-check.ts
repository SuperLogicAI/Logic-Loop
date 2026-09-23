// Self-check for Plan 023's Claude statusLine meter. Run: npm run statusline:check
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  claudeModelLabel,
  claudeUsageState,
  clampBarFill,
  formatResetTime,
  hasAnyRateLimitWindow,
  isStatuslineStale,
  STATUSLINE_STALE_MS,
} from "../src/components/ClaudeUsageBlock";
import type { ClaudeStatuslineStatus } from "../src/types";

const installed: ClaudeStatuslineStatus = { state: "installed", detected_command: "~/.claude/bar.sh", cli_version_ok: true };
const notInstalled: ClaudeStatuslineStatus = { state: "not-installed", detected_command: null, cli_version_ok: null };
const foreign: ClaudeStatuslineStatus = { state: "foreign", detected_command: "~/.claude/bar.sh", cli_version_ok: true };
const base = {
  agent: undefined as string | undefined,
  sessionId: "sess-1" as string | null,
  status: installed as ClaudeStatuslineStatus | null,
  sawSnapshot: false,
  hasRateLimits: false,
  stale: false,
};

// A non-Claude adapter, or no bound session at all: the block doesn't render.
assert.equal(claudeUsageState({ ...base, agent: "codex" }), "not-offered");
assert.equal(claudeUsageState({ ...base, sessionId: null }), "not-offered");

// No statusLine configured at all, or repointed away from us since install.
assert.equal(claudeUsageState({ ...base, status: notInstalled }), "wrapper-not-installed");
assert.equal(claudeUsageState({ ...base, status: foreign }), "wrapper-not-installed");
assert.equal(claudeUsageState({ ...base, status: null }), "wrapper-not-installed");

// CLI too old to ever carry rate_limits — checked before the loading/
// ineligible split, since it explains the missing field either way.
assert.equal(
  claudeUsageState({ ...base, status: { ...installed, cli_version_ok: false } }),
  "unavailable-old-cli"
);

// Missing field, disambiguated by whether a statusLine snapshot has ever
// arrived for this session: none yet = still loading; at least one with no
// rate_limits = a real ineligible account.
assert.equal(claudeUsageState({ ...base, sawSnapshot: false, hasRateLimits: false }), "wrapper-installed-loading");
assert.equal(claudeUsageState({ ...base, sawSnapshot: true, hasRateLimits: false }), "unavailable-ineligible");

assert.equal(claudeUsageState({ ...base, sawSnapshot: true, hasRateLimits: true, stale: false }), "available");
assert.equal(claudeUsageState({ ...base, sawSnapshot: true, hasRateLimits: true, stale: true }), "stale");

// Bar fill clamps; the displayed number (callers read window.used_percentage
// directly) never does — spend_limit can legitimately exceed 100.
assert.equal(clampBarFill(45.2), 45.2);
assert.equal(clampBarFill(0), 0);
assert.equal(clampBarFill(150), 100, "over-100 (spend_limit) must clamp the bar fill");
assert.equal(clampBarFill(-5), 0);
assert.equal(clampBarFill(Number.NaN), 0);

// Reset time: real number in, formatted string out; missing/invalid stays
// null rather than manufacturing a date.
assert.equal(typeof formatResetTime(1_800_000_000), "string");
assert.equal(formatResetTime(null), null);
assert.equal(formatResetTime(undefined), null);
assert.equal(formatResetTime(Number.NaN), null);

// Staleness: no cadence event observed yet -> never stale (nothing to be
// stale relative to). A snapshot at/after the cadence event -> not stale. A
// cadence event with no fresher snapshot, older than the stale window -> stale.
assert.equal(isStatuslineStale(undefined, null, 1_000_000), false);
assert.equal(isStatuslineStale(1_000_000, 1_000_500, 1_020_000), false, "snapshot after the cadence event is fresh");
assert.equal(
  isStatuslineStale(1_000_000, null, 1_000_000 + STATUSLINE_STALE_MS + 1),
  true,
  "cadence event with no snapshot at all, past the window, is stale"
);
assert.equal(
  isStatuslineStale(1_000_000, 900_000, 1_000_000 + STATUSLINE_STALE_MS + 1),
  true,
  "a snapshot strictly before the cadence event does not clear staleness"
);
assert.equal(isStatuslineStale(1_000_000, null, 1_000_000 + 100), false, "within the window is not yet stale");

// Model label: string, {display_name}, {id}-only, and absent all handled.
assert.equal(claudeModelLabel("claude-sonnet-5"), "claude-sonnet-5");
assert.equal(claudeModelLabel({ id: "claude-sonnet-5", display_name: "Claude Sonnet 5" }), "Claude Sonnet 5");
assert.equal(claudeModelLabel({ id: "claude-sonnet-5" }), "claude-sonnet-5");
assert.equal(claudeModelLabel(null), null);
assert.equal(claudeModelLabel(undefined), null);

// At least one window present counts as "has rate limits"; an empty/absent
// object does not (distinguishes wrapper-installed-loading from available).
assert.equal(hasAnyRateLimitWindow(null), false);
assert.equal(hasAnyRateLimitWindow({}), false);
assert.equal(hasAnyRateLimitWindow({ five_hour: { used_percentage: 1, resets_at: null } }), true);
assert.equal(hasAnyRateLimitWindow({ spend_limit: { used_percentage: 120, resets_at: null } }), true);

// Wiring: App.tsx must register the statusline listener and never persist it
// to SQLite; SidePanel must render the block with per-tab identity.
const appSource = readFileSync(join(import.meta.dirname, "../src/App.tsx"), "utf-8");
assert.ok(appSource.includes("onStatusline"), "App.tsx must import and register onStatusline");
assert.ok(appSource.includes("void onStatusline("), "App.tsx must subscribe to onStatusline in its listener effect");
const sidePanelSource = readFileSync(join(import.meta.dirname, "../src/components/SidePanel.tsx"), "utf-8");
assert.ok(sidePanelSource.includes("<ClaudeUsageBlock"), "SidePanel must render ClaudeUsageBlock");

// The status probe shells out to `claude --version`, so it must run off the
// app's main/event-loop thread via pty::spawn_blocking_result (Plan 017's
// beachball class).
const statuslineRust = readFileSync(join(import.meta.dirname, "../src-tauri/src/statusline.rs"), "utf-8");
assert.match(statuslineRust, /pub async fn claude_statusline_status/);
assert.ok(
  statuslineRust.includes('spawn_blocking_result("claude_statusline_status"'),
  "claude_statusline_status must be routed through pty::spawn_blocking_result",
);

console.log("statusline-check: all assertions passed");
