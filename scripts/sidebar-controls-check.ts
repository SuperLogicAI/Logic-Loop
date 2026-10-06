import assert from "node:assert/strict";
import { showSidebarLm, showTraffic } from "../src/lib/sidebarControls";
import type { ExtractorSettings } from "../src/types";

const base: ExtractorSettings = {
  backend: "claude", lmstudioUrl: "", lmstudioModel: "", ollamaUrl: "", ollamaModel: "", codexModel: "", claudeModel: "",
};

// Traffic: only a definite "missing" hides it, and never after a real log was seen.
assert.equal(showTraffic(null, false), false, "not read yet: no flash for new users");
assert.equal(showTraffic(null, true), true, "seen user keeps it while loading");
assert.equal(showTraffic("missing", false), false);
assert.equal(showTraffic("missing", true), true, "transient missing log must not drop it");
assert.equal(showTraffic("error", false), true, "Unknown ≠ Absent");
assert.equal(showTraffic("v1", false), true);
assert.equal(showTraffic("ready", false), true);

// Sidebar LM: hidden until configured; unreadable settings keep it visible.
assert.equal(showSidebarLm(null), false);
assert.equal(showSidebarLm(base), false, "default Claude CLI = not configured");
assert.equal(showSidebarLm({ ...base, claudeModel: "opus" }), true);
assert.equal(showSidebarLm({ ...base, backend: "lmstudio" }), true);
assert.equal(showSidebarLm("error"), true, "Unknown ≠ Absent");

console.log("sidebar-controls-check: all assertions passed");
