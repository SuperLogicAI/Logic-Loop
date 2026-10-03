import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  departedTabIds,
  effectiveVisibleTerminalIds,
  selectIntoSplit,
  splitContains,
  visibleTerminalIds,
  type SplitPaneIds,
} from "../src/lib/splitView";
import { summarizeDelta, type EventRow } from "../src/lib/delta";
import type { AppSurface } from "../src/types";

const pair: [string, string] = ["left", "right"];
assert.equal(splitContains(pair, "left"), true);
assert.equal(splitContains(pair, "missing"), false);
assert.deepEqual(selectIntoSplit(pair, "left", "third"), ["third", "right"]);
assert.deepEqual(selectIntoSplit(pair, "right", "third"), ["left", "third"]);
assert.equal(selectIntoSplit(pair, "left", "right"), pair);
assert.deepEqual(visibleTerminalIds("left", pair), pair);
assert.deepEqual(visibleTerminalIds("solo", null), ["solo"]);

// --- Phase 48 release repair: since-you-left anchors follow visibility. ---
// Replays App.tsx's visible-set effect and blur handler over a timeline.
type Step =
  | { at: number; surface: AppSurface; active: string | null; pair?: SplitPaneIds | null }
  | { at: number; blur: true };
function anchors(steps: Step[]): { id: string; at: number }[] {
  const out: { id: string; at: number }[] = [];
  let visible: string[] = [];
  for (const s of steps) {
    if ("blur" in s) {
      for (const id of visible) out.push({ id, at: s.at });
      continue;
    }
    const next = effectiveVisibleTerminalIds(s.surface, s.active, s.pair ?? null);
    for (const id of departedTabIds(visible, next)) out.push({ id, at: s.at });
    visible = next;
  }
  return out;
}
const W: AppSurface = { kind: "workspace" };
const H: AppSurface = { kind: "home" };
const P: AppSurface = { kind: "project", projectKey: "/p" };
assert.deepEqual(departedTabIds(["a", "b"], ["b"]), ["a"]);
assert.deepEqual(departedTabIds(["a"], ["a"]), []);
assert.deepEqual(anchors([{ at: 1, surface: W, active: "a" }, { at: 2, surface: W, active: "b" }]), [{ id: "a", at: 2 }]);
assert.deepEqual(
  anchors([{ at: 1, surface: W, active: "a", pair: ["a", "b"] }, { at: 2, surface: W, active: "b" }]),
  [{ id: "a", at: 2 }],
  "leaving split anchored the pane that stayed visible"
);
assert.deepEqual(anchors([{ at: 1, surface: W, active: "a" }, { at: 2, surface: H, active: "a" }]), [{ id: "a", at: 2 }]);
assert.deepEqual(anchors([{ at: 1, surface: W, active: "a" }, { at: 2, surface: P, active: "a" }]), [{ id: "a", at: 2 }]);
assert.deepEqual(
  anchors([{ at: 1, surface: W, active: "a", pair: ["a", "b"] }, { at: 2, blur: true }]),
  [{ id: "a", at: 2 }, { id: "b", at: 2 }],
  "split blur must anchor both visible panes"
);
// The bug: Home hid A, A finished, then blur / Continue into B / back to A.
const homeThenB = anchors([
  { at: 1, surface: W, active: "a" },
  { at: 2, surface: H, active: "a" },
  { at: 4, blur: true },
  { at: 5, surface: W, active: "b" },
  { at: 6, surface: H, active: "b" },
  { at: 7, surface: W, active: "a" },
]);
assert.deepEqual(
  homeThenB.filter((x) => x.id === "a"),
  [{ id: "a", at: 2 }],
  "a tab hidden behind Home was anchored again after its result"
);
assert.deepEqual(anchors([{ at: 1, surface: H, active: "a" }, { at: 2, surface: W, active: "a" }]), []);
// End to end through the digest reducer: A's turn ends at 3, unseen.
const lastLeftA = Math.max(...homeThenB.filter((x) => x.id === "a").map((x) => x.at));
const rowsA: EventRow[] = [
  { id: 1, ts: 2.5, type: "hook:UserPromptSubmit", payload_json: "{}" },
  { id: 2, ts: 3, type: "hook:Stop", payload_json: "{}" },
];
const digest = summarizeDelta(rowsA.filter((r) => r.ts > lastLeftA), []);
assert.equal(digest.turns, 1, "unseen turn missing from the digest");
assert.equal(digest.stops, 1);

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const status = readFileSync(new URL("../src/components/AgentStatusBar.tsx", import.meta.url), "utf8");
const terminal = readFileSync(new URL("../src/components/Terminal.tsx", import.meta.url), "utf8");
const tabBar = readFileSync(new URL("../src/components/TabBar.tsx", import.meta.url), "utf8");
assert.match(app, /openTab\(\{ cwd: expand\(source\.cwd\) \}\)/);
assert.match(app, /splitOrientation === orientation/);
assert.match(app, /setSplitOrientation\(orientation\);\n    const source/);
assert.match(app, /splitOrientation === "vertical" \? "flex-col"/);
assert.match(app, /visibleTabIdsRef\.current\.has\(tabId\)/);
assert.match(status, /Split terminal controls/);
assert.match(status, /split_screen_vert\.svg/);
assert.match(readFileSync("src/components/SidebarControls.tsx", "utf8"), /bounce\.svg/);
assert.match(terminal, /focused: boolean/);
assert.match(terminal, /ring-\[1\.5px\] ring-inset ring-white/);
assert.match(terminal, /ring-2 ring-inset ring-sky-700/);
assert.match(terminal, /splitOrientation === "vertical"/);
assert.match(tabBar, /tab\.id === activeId[\s\S]*?after:border-\[1\.5px\][\s\S]*?after:border-white/);
assert.match(tabBar, /visibleIds\.has\(tab\.id\)[\s\S]*?after:border-sky-700/);
assert.match(tabBar, /visibleIds\.has\(tab\.id\)[\s\S]*?after:border-2 after:border-b-0 after:border-sky-700/);
assert.doesNotMatch(app, /setSplitPaneIds\([^\n]*repo\./);

console.log("split-view-check: all assertions passed");
