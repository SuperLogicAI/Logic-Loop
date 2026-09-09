// Self-check for Phase 25 panel presentation state.
// Run: npm run panel-layout:check
import { strict as assert } from "node:assert";
import {
  PANEL_DEFAULT_WIDTH,
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  clampPanelWidth,
  parsePanelMode,
  togglePanelHidden,
  togglePanelMode,
} from "../src/lib/panelLayout";

assert.equal(parsePanelMode(null), "expanded", "missing mode defaults to expanded");
assert.equal(parsePanelMode("future-mode"), "expanded", "invalid mode defaults to expanded");
assert.equal(parsePanelMode("compact"), "compact");
assert.equal(parsePanelMode("hidden"), "hidden");

assert.deepEqual(togglePanelMode("expanded", "expanded"), {
  mode: "compact",
  lastVisible: "compact",
});
assert.deepEqual(togglePanelMode("compact", "compact"), {
  mode: "expanded",
  lastVisible: "expanded",
});
assert.deepEqual(togglePanelMode("hidden", "compact"), {
  mode: "compact",
  lastVisible: "compact",
});
assert.deepEqual(togglePanelHidden("expanded", "compact"), {
  mode: "hidden",
  lastVisible: "expanded",
});
assert.deepEqual(togglePanelHidden("compact", "expanded"), {
  mode: "hidden",
  lastVisible: "compact",
});
assert.deepEqual(togglePanelHidden("hidden", "compact"), {
  mode: "compact",
  lastVisible: "compact",
});

assert.equal(clampPanelWidth(PANEL_MIN_WIDTH - 1), PANEL_MIN_WIDTH);
assert.equal(clampPanelWidth(PANEL_MAX_WIDTH + 1), PANEL_MAX_WIDTH);
assert.equal(clampPanelWidth(PANEL_MIN_WIDTH), PANEL_MIN_WIDTH);
assert.equal(clampPanelWidth(PANEL_DEFAULT_WIDTH), PANEL_DEFAULT_WIDTH);
assert.equal(clampPanelWidth(PANEL_MAX_WIDTH), PANEL_MAX_WIDTH);
assert.equal(clampPanelWidth(Number.NaN), PANEL_DEFAULT_WIDTH);
assert.equal(clampPanelWidth(Number.POSITIVE_INFINITY), PANEL_DEFAULT_WIDTH);

console.log("panel-layout-check: all assertions passed");
