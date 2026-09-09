// Self-check for Phase 26's read-only cross-project Attention Inbox.
// Run: npm run attention-inbox:check
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  buildAttentionItems,
  filterAttentionItems,
  resolveAttentionRoute,
} from "../src/lib/attention";
import { STALL_MS } from "../src/lib/ingest";
import type { AttentionEvidence } from "../src/types";

const NOW = 2_000_000;
const base = (overrides: Partial<AttentionEvidence> = {}): AttentionEvidence => ({
  id: "decision:1",
  kind: "decision",
  projectKey: "/projects/alpha",
  sessionId: "session-a",
  tabId: "tab-a",
  adapterId: "codex",
  actorId: null,
  createdAt: NOW - 10_000,
  lastActivityAt: null,
  text: "Choose the API shape?",
  evidenceId: 1,
  runId: null,
  observedState: null,
  ...overrides,
});
const tabs = [
  { id: "tab-a", cwd: "/projects/alpha", sessionId: "session-a", agent: "codex", status: "live" as const },
  { id: "tab-b", cwd: "/projects/beta", sessionId: "session-b", agent: "opencode", status: "live" as const },
];

assert.deepEqual(resolveAttentionRoute(base(), tabs), { route: "exact", tabId: "tab-a" });
assert.deepEqual(resolveAttentionRoute(base({ tabId: null }), tabs), { route: "session", tabId: "tab-a" });
assert.deepEqual(resolveAttentionRoute(base({ tabId: null, sessionId: null }), tabs), {
  route: "project",
  tabId: "tab-a",
});
assert.equal(resolveAttentionRoute(base({ tabId: "dead", sessionId: "missing" }), tabs).route, "unavailable");
assert.equal(resolveAttentionRoute(base({ adapterId: "claude" }), tabs).route, "unavailable");
assert.equal(
  resolveAttentionRoute(base({ tabId: null, sessionId: null, adapterId: "claude" }), tabs).route,
  "unavailable"
);
assert.equal(
  resolveAttentionRoute(base({ tabId: null, sessionId: null }), [...tabs, { ...tabs[0], id: "tab-a2" }]).route,
  "unavailable"
);
assert.equal(resolveAttentionRoute(base(), [{ ...tabs[0], status: "dead" }]).route, "unavailable");

const evidence: AttentionEvidence[] = [
  base({ id: "decision:old", createdAt: NOW - 40_000 }),
  base({ id: "decision:new", createdAt: NOW - 20_000 }),
  base({
    id: "waiting:2",
    kind: "waiting",
    createdAt: NOW - 5_000,
    lastActivityAt: NOW - 5_000,
    runId: "run-current",
    observedState: "waiting",
  }),
  base({
    id: "stalled:3",
    kind: "stalled",
    createdAt: NOW - STALL_MS - 1,
    lastActivityAt: NOW - STALL_MS - 1,
    runId: "run-current",
    observedState: "working",
  }),
  base({
    id: "stalled:boundary",
    kind: "stalled",
    createdAt: NOW - STALL_MS,
    lastActivityAt: NOW - STALL_MS,
    runId: "run-current",
    observedState: "working",
  }),
  base({
    id: "waiting:prior",
    kind: "waiting",
    runId: "run-old",
    observedState: "waiting",
  }),
  base({
    id: "result:5",
    kind: "result",
    projectKey: "/projects/beta",
    sessionId: "session-b",
    tabId: "tab-b",
    adapterId: "opencode",
  }),
  base({
    id: "blocker:6",
    kind: "blocker",
    projectKey: "/projects/beta",
    sessionId: null,
    tabId: null,
    adapterId: null,
  }),
];
const items = buildAttentionItems(evidence, tabs, "run-current", NOW);
assert.deepEqual(items.map((item) => item.id), [
  "waiting:2",
  "decision:old",
  "decision:new",
  "result:5",
  "blocker:6",
  "stalled:3",
]);
assert.equal(items.some((item) => item.id === "stalled:boundary"), false, "exact STALL_MS became stalled");
assert.equal(items.some((item) => item.id === "waiting:prior"), false, "prior-run lifecycle survived");
assert.equal(filterAttentionItems(items, "BETA").length, 2);
assert.equal(filterAttentionItems(items, "api shape").length, 6);
assert.equal(filterAttentionItems(items, "").length, items.length);

const repoSource = readFileSync(new URL("../src/lib/repo.ts", import.meta.url), "utf8");
assert.match(repoSource, /WITH valid_events AS/);
assert.match(repoSource, /FROM decisions[\s\S]*status = 'open'/);
assert.match(repoSource, /FROM blockers[\s\S]*resolved = 0/);
assert.match(repoSource, /PARTITION BY l\.session_id/);
assert.match(repoSource, /attention_state_observed/);
assert.doesNotMatch(repoSource.match(/listAttentionEvidence[\s\S]*?\n}\n/)?.[0] ?? "", /LIMIT 100/);

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const sidePanelSource = readFileSync(new URL("../src/components/SidePanel.tsx", import.meta.url), "utf8");
const iconSource = readFileSync(new URL("../src/components/PanelIcon.tsx", import.meta.url), "utf8");
assert.match(appSource, /listAttentionEvidence/);
assert.equal(appSource.match(/\.listAttentionEvidence\(/g)?.length, 1, "Attention query is not App-owned once");
assert.match(appSource, /key === "k"/);
const navigation = appSource.match(/const openAttentionTab[\s\S]*?\n  }, \[\]\);/)?.[0] ?? "";
assert.match(navigation, /setActiveId/);
assert.doesNotMatch(navigation, /ptyWrite|addEvent|spawn|setDecision|setBlocker/);
assert.doesNotMatch(sidePanelSource, /listAttentionEvidence/);
assert.match(sidePanelSource, /section="attention"/);
assert.match(iconSource, /global-mail-read/);
assert.match(iconSource, /global-mail-unread/);

console.log("attention-inbox-check: all assertions passed");
