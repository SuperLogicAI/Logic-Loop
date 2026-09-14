import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TrafficRowItem } from "../src/components/ModelTraffic";
import { trafficStateMessage, trafficTime, trafficToken } from "../src/lib/modelTraffic";
import type { TrafficSnapshot } from "../src/lib/repo";

const cases: Array<[TrafficSnapshot, string]> = [
  [{ kind: "missing" }, "Safe Router log not found on this Mac."],
  [{ kind: "v1" }, "Older Safe Router log; this view requires v2."],
  [{ kind: "error" }, "Traffic unavailable — could not read the router log."],
  [{ kind: "ready", rows: [] }, "Log opened; no routed requests recorded."],
];
for (const [snapshot, expected] of cases) assert.equal(trafficStateMessage(snapshot), expected);
assert.equal(trafficToken(null), "unknown");
assert.equal(trafficToken(0), "0");
assert.equal(trafficToken(1234), "1,234");
assert.equal(trafficTime("not-a-date"), "not-a-date");

const hostileTag = '<img src=x onerror="alert(1)">';
const rowHtml = renderToStaticMarkup(createElement(TrafficRowItem, { row: {
  id: 1, ts: "2026-09-13T00:00:00Z", plane: "safe", keyId: "key-1",
  modelReq: "alias", modelServed: "model", backend: "backend", disposition: "served",
  status: 200, tokensIn: 0, tokensOut: null, usageState: "partial", clientTag: hostileTag,
} }));
assert.ok(rowHtml.includes("&lt;img"));
assert.ok(!rowHtml.includes("<img"));
assert.ok(rowHtml.includes("0 / unknown"));
assert.ok(rowHtml.includes("Unattributed"));

console.log("model traffic check passed");
