import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { selectIntoSplit, splitContains, visibleTerminalIds } from "../src/lib/splitView";

const pair: [string, string] = ["left", "right"];
assert.equal(splitContains(pair, "left"), true);
assert.equal(splitContains(pair, "missing"), false);
assert.deepEqual(selectIntoSplit(pair, "left", "third"), ["third", "right"]);
assert.deepEqual(selectIntoSplit(pair, "right", "third"), ["left", "third"]);
assert.equal(selectIntoSplit(pair, "left", "right"), pair);
assert.deepEqual(visibleTerminalIds("left", pair), pair);
assert.deepEqual(visibleTerminalIds("solo", null), ["solo"]);

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const status = readFileSync(new URL("../src/components/AgentStatusBar.tsx", import.meta.url), "utf8");
const terminal = readFileSync(new URL("../src/components/Terminal.tsx", import.meta.url), "utf8");
const tabBar = readFileSync(new URL("../src/components/TabBar.tsx", import.meta.url), "utf8");
assert.match(app, /openTab\(\{ cwd: expand\(source\.cwd\) \}\)/);
assert.match(app, /visibleTabIdsRef\.current\.has\(tabId\)/);
assert.match(status, /aria-pressed=\{splitActive\}/);
assert.match(status, /<PanelIcon name="split-screen"/);
assert.match(terminal, /focused: boolean/);
assert.match(terminal, /ring-\[1\.5px\] ring-inset ring-white/);
assert.match(terminal, /ring-2 ring-inset ring-sky-700/);
assert.match(tabBar, /tab\.id === activeId[\s\S]*?after:border-x-\[1\.5px\][\s\S]*?after:border-white/);
assert.match(tabBar, /visibleIds\.has\(tab\.id\)[\s\S]*?after:border-sky-700/);
assert.match(tabBar, /visibleIds\.has\(tab\.id\)[\s\S]*?after:border-x-2 after:border-b-2/);
assert.doesNotMatch(app, /setSplitPaneIds\([^\n]*repo\./);

console.log("split-view-check: all assertions passed");
