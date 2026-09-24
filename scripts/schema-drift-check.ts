// Self-check for the transcript schema-drift tripwire's envelope allowlist.
// Run: npm run schema-drift:check
import { strict as assert } from "node:assert";
import { transcriptEnvelopeType } from "../src/lib/decisions";

// --- Known message envelopes are recognized. ---
assert.equal(transcriptEnvelopeType(JSON.stringify({ type: "assistant", message: { content: "hi" } })), "recognized");
assert.equal(transcriptEnvelopeType(JSON.stringify({ type: "user", message: { content: "hi" } })), "recognized");
assert.equal(
  transcriptEnvelopeType(JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant" } })),
  "recognized"
);

// --- The bug this exists for: CLI v2.1.281's `attachment` envelope (hook_
// success/environment/model/deferred_tools_delta side-channel lines) must
// be recognized — a single ordinary session hit a 21-line unrecognized
// streak from these alone (2026-09-24), false-tripping the warning. ---
assert.equal(
  transcriptEnvelopeType(JSON.stringify({ type: "attachment", attachment: { type: "hook_success" } })),
  "recognized",
  "CLI v2.1.281's attachment envelope was wrongly flagged as drift evidence"
);

// --- Regression guard: the 2026-09-12 catastrophe types
// (decision-integrity-check.ts pins these too) must stay unrecognized. A
// shape-based heuristic ("ignore anything without a role field") was tried
// and reverted here for exactly this reason — those types have no
// role-shaped field either, and exempting role-less lines in general would
// have silently defeated the tripwire in the one scenario it exists for:
// the CLI dropping assistant/user entirely. Never add these to the
// allowlist in decisions.ts. ---
for (const line of [
  '{"type":"last-prompt","leafUuid":"x","sessionId":"s"}',
  '{"type":"mode","mode":"normal","sessionId":"s"}',
  '{"type":"permission-mode","permissionMode":"auto","sessionId":"s"}',
  '{"type":"atis-latch","atis":"","sessionId":"s"}',
  '{"type":"bridge-session","sessionId":"s","bridgeSessionId":"cse_01QP9PcQR"}',
]) {
  assert.equal(transcriptEnvelopeType(line), "unrecognized", `${line} must stay flagged, not silently ignored`);
}

// --- Unparseable lines (partial mid-flush writes) are neither — must not be
// misread as either bucket. ---
assert.equal(transcriptEnvelopeType("not json {{{"), "unparseable");

console.log("schema-drift-check: all assertions passed");
