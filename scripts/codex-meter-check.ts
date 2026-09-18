import assert from "node:assert/strict";
import { codexMeterStale, codexWindowLabel } from "../src/components/CodexUsageBlock";

assert.equal(codexWindowLabel(300), "5h");
assert.equal(codexWindowLabel(10080), "weekly");
assert.equal(codexWindowLabel(90), "90m");
assert.equal(codexWindowLabel(2880), "2d");

const snapshot = {
  sessionId: "one",
  state: "available" as const,
  data: { state: "available" as const, model: "gpt-5.6-sol", buckets: [] },
  receivedAt: 1000,
};
assert.equal(codexMeterStale(snapshot, 120_000), false);
assert.equal(codexMeterStale(snapshot, 122_000), true);
assert.equal(codexMeterStale({ ...snapshot, receivedAt: null }, 999_999), false);
console.log("codex meter check passed");
