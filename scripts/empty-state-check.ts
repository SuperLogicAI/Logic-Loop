import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { adapterWarningMessage, decisionsEmptyReason } from "../src/components/SidePanel";

const base = { isUnboundFanOutChild: false, sessionBlind: false, agent: undefined as string | undefined };

// Confirmed empty: Claude, bound, transcript readable.
assert.match(decisionsEmptyReason(base), /^Nothing waiting on you\.$/);

// Codex now shares transcript extraction; OpenCode/Antigravity remain unsupported.
assert.match(decisionsEmptyReason({ ...base, agent: "codex" }), /^Nothing waiting on you\.$/);
assert.match(decisionsEmptyReason({ ...base, agent: "opencode" }), /isn't available for this agent/);
assert.match(decisionsEmptyReason({ ...base, agent: "antigravity" }), /isn't available for this agent/);

// Blind session outranks the non-Claude-agent reason (transcript absence is
// the more specific, more actionable fact when both are true).
assert.match(
  decisionsEmptyReason({ ...base, sessionBlind: true, agent: "codex" }),
  /no transcript/
);

// Unbound fan-out child outranks everything else.
assert.match(
  decisionsEmptyReason({ isUnboundFanOutChild: true, sessionBlind: true, agent: "codex" }),
  /isn't bound to a tracked session/
);

// Adapter warning formatting
assert.match(
  adapterWarningMessage({ agent: "antigravity", reason: "foreign_post_tool_use" }),
  /foreign PostToolUse hook detected/
);
assert.match(
  adapterWarningMessage({ agent: "antigravity", reason: "custom_reason" }),
  /antigravity: adapter warning \(custom_reason\)/
);

// Verify App.tsx registers the onAdapterWarning listener in its listener effect
const appSource = readFileSync(join(import.meta.dirname, "../src/App.tsx"), "utf-8");
assert.ok(
  appSource.includes("onAdapterWarning"),
  "App.tsx must import and register onAdapterWarning"
);
assert.ok(
  appSource.includes("void onAdapterWarning("),
  "App.tsx must subscribe to onAdapterWarning in its listener effect"
);

console.log("empty-state-check: all assertions passed");
