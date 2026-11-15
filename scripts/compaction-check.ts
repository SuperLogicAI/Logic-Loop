// Self-check for the one-time storage cleanup. Run: npm run compaction:check
import { strict as assert } from "node:assert";
import { compactEvents, formatBytes, NUDGE_MIN_BYTES, shouldNudge, type CompactionStore } from "../src/lib/compaction";
import { dedupeKey } from "../src/lib/repo";

const json = (value: unknown) => JSON.stringify(value);
const agy = (type: string, status: string, content?: string) => json({ type, status, content });

// Real line shapes for all six adapters. `keep` lines are what a reader can use.
const keep = [
  json({ type: "assistant", message: { content: [{ type: "text", text: "Claude reply" }] } }),
  json({ type: "user", message: { content: "Claude prompt" } }),
  json({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Codex reply" }] } }),
  json({ type: "opencode_message", role: "assistant", text: "OpenCode reply" }),
  json({ type: "pi_message", role: "user", text: "Pi prompt" }),
  json({ type: "deepseek_message", role: "assistant", text: "DeepSeek reply" }),
  agy("USER_INPUT", "DONE", "<USER_REQUEST>Antigravity prompt</USER_REQUEST>"),
];
const drop = [
  json({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read" }] } }),
  json({ type: "user", message: { content: [{ type: "tool_result", content: "<redacted>" }] } }),
  json({ type: "api-request-blob", hash: "x" }),
  json({ type: "attachment" }),
  json({ type: "response_item", payload: { type: "function_call", arguments: "<redacted>" } }),
  json({ type: "event_msg", payload: { type: "task_complete" } }),
  json({ type: "opencode_message", role: "assistant" }),
  json({ type: "pi_message", role: "user" }),
  agy("USER_INPUT", "RUNNING", "<USER_REQUEST>not done yet</USER_REQUEST>"),
  "not json {{{",
];

interface Row { id: number; type: string; payload_json: string }

function fakeStore(rows: Row[], bytes = [100, 40]) {
  const calls: string[] = [];
  let failDeletes = 0;
  const reads = [...bytes];
  const store: CompactionStore = {
    async transcriptPage(afterId, limit) {
      return rows.filter((r) => r.type === "transcript" && r.id > afterId).slice(0, limit);
    },
    async deleteTranscriptRows(ids) {
      if (failDeletes-- > 0) throw new Error("database is locked");
      calls.push("delete");
      for (const id of ids) rows.splice(rows.findIndex((r) => r.id === id), 1);
    },
    async clearTranscriptKeys() { calls.push("keys"); },
    async databaseBytes() { return reads.length > 1 ? reads.shift()! : reads[0]; },
    async vacuumDatabase() { calls.push("vacuum"); },
    async markEventsCompacted() { calls.push("mark"); },
  };
  return { store, calls, failNextDeletes: (n: number) => { failDeletes = n; } };
}

// Enough rows to cross a page boundary, mixed with rows that must survive.
const seed = (): Row[] => {
  const lines = [...keep, ...drop];
  const rows: Row[] = [];
  for (let i = 0; i < 510; i++) rows.push({ id: i + 1, type: "transcript", payload_json: lines[i % lines.length] });
  rows.push({ id: 1000, type: "hook:PostToolUse", payload_json: "not json {{{" });
  return rows;
};
const expectedRemoved = seed().filter((r) => r.type === "transcript" && drop.includes(r.payload_json)).length;

async function main(): Promise<void> {
  // Readable lines stay across every adapter; everything else goes.
  const rows = seed();
  const { store, calls } = fakeStore(rows);
  const progress: number[] = [];
  const result = await compactEvents(store, (n) => progress.push(n), 1_000_000);
  assert.equal(result.removed, expectedRemoved);
  assert.equal(result.reclaimedBytes, 60);
  assert.ok(rows.filter((r) => r.type === "transcript").every((r) => keep.includes(r.payload_json)), "an unreadable line survived");
  for (const line of keep) assert.ok(rows.some((r) => r.payload_json === line), `a readable line was deleted: ${line}`);
  assert.ok(rows.some((r) => r.id === 1000), "a non-transcript row was deleted");
  assert.deepEqual(calls.slice(-3), ["keys", "vacuum", "mark"], "VACUUM must follow deletes, and success is marked last");
  assert.equal(progress.at(-1), expectedRemoved);

  // A failed run isn't marked done, and a rerun finishes the job.
  const retryRows = seed();
  const retry = fakeStore(retryRows);
  retry.failNextDeletes(1);
  await assert.rejects(compactEvents(retry.store), /locked/);
  assert.ok(!retry.calls.includes("mark"), "a failed run must not be marked done");
  assert.ok(!retry.calls.includes("vacuum"), "a failed run must not reach VACUUM");
  const rerun = await compactEvents(retry.store);
  assert.equal(rerun.removed, expectedRemoved, "a rerun must finish the job");
  assert.ok(retry.calls.includes("mark"));

  // Nudge: shows once, only when it's useful and safe.
  const base = { bytes: NUDGE_MIN_BYTES, compactedAt: null, snoozedUntil: null, agentsWorking: false, now: 1_000 };
  assert.equal(shouldNudge(base), true);
  assert.equal(shouldNudge({ ...base, bytes: null }), false, "unknown size must fail open");
  assert.equal(shouldNudge({ ...base, bytes: NUDGE_MIN_BYTES - 1 }), false, "below threshold");
  assert.equal(shouldNudge({ ...base, compactedAt: 1 }), false, "never returns after a run");
  assert.equal(shouldNudge({ ...base, snoozedUntil: 2_000 }), false, "snoozed");
  assert.equal(shouldNudge({ ...base, snoozedUntil: 1_000 }), true, "snooze expired");
  assert.equal(shouldNudge({ ...base, agentsWorking: true }), false, "VACUUM isn't safe while an agent works");

  assert.equal(formatBytes(18.3 * 1024 ** 3), "18.3 GB");
  assert.equal(formatBytes(40 * 1024 ** 2), "40 MB");

  // Dedupe keys stay small however large the payload is.
  const payload = "x".repeat(1024 * 1024);
  assert.ok(dedupeKey("s1", "transcript", payload, 1_000).length < 200, "key grew with the payload");
  assert.equal(dedupeKey("s1", "transcript", payload, 1_000), dedupeKey("s1", "transcript", payload, 1_050));
  assert.notEqual(
    dedupeKey("s1", "transcript", `${payload}a`, 1_000),
    dedupeKey("s1", "transcript", `${payload}b`, 1_000),
    "same-length payloads collided"
  );

  console.log("compaction-check: all assertions passed");
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
