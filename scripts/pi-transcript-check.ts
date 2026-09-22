// Characterization checks for Pi's synthetic finalized-message envelope
// (Plan 039). Pi 0.85.1 live evidence shows message_end emits block arrays:
// user text once; tool-call-only assistant messages; toolResult messages; and
// the final visible assistant text once. The extension admits only text from
// user/assistant roles before posting this already-reduced shape.
import { strict as assert } from "node:assert";
import { textFromTranscriptLine, transcriptEnvelopeType } from "../src/lib/decisions";

function line(role: string, text: unknown): string {
  return JSON.stringify({ type: "pi_message", role, text });
}

assert.deepEqual(textFromTranscriptLine(line("user", "Please inspect the parser.")), {
  role: "user",
  text: "Please inspect the parser.",
});
assert.deepEqual(textFromTranscriptLine(line("assistant", "Which format should I preserve?")), {
  role: "assistant",
  text: "Which format should I preserve?",
});

for (const invalid of [
  line("assistant", ""),
  line("assistant", "   "),
  line("toolResult", "private tool output"),
  line("system", "system text"),
  line("assistant", null),
  JSON.stringify({ type: "pi_message", role: "user" }),
  JSON.stringify({ type: "pi_message", text: "missing role" }),
  "not json",
]) {
  assert.equal(textFromTranscriptLine(invalid), null);
}

assert.equal(transcriptEnvelopeType(line("user", "hi")), "recognized");
assert.equal(transcriptEnvelopeType(line("assistant", "hello")), "recognized");
assert.equal(
  transcriptEnvelopeType(JSON.stringify({ type: "future_pi_message", role: "assistant", text: "x" })),
  "unrecognized"
);

// Explicit envelopes remain isolated: neither parser should accept an
// arbitrary role/text object with no known type.
assert.equal(textFromTranscriptLine(JSON.stringify({ role: "assistant", text: "question?" })), null);

console.log("pi-transcript-check: all assertions passed");
