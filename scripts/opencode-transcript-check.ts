// Characterization checks for the synthetic `opencode_message` transcript
// envelope (Plan 038 Part 1). Unlike Claude/Codex, OpenCode has no real
// transcript file — its in-process plugin (opencode.rs's `plugin_source`)
// buffers message.part.updated text parts and posts one already-reduced
// {type: "opencode_message", role, text} line per completed message via
// the existing ingest://transcript path (ingest.rs's TranscriptLine
// branch). These fixtures mirror the real shape confirmed by a live
// opencode 1.18.32 spike, 2026-09-21 — not a real transcript file, since
// none exists for this adapter.
import { strict as assert } from "node:assert";
import { textFromTranscriptLine, transcriptEnvelopeType } from "../src/lib/decisions";

function line(role: string, text: string): string {
  return JSON.stringify({ type: "opencode_message", role, text });
}

const user = textFromTranscriptLine(line("user", "Read sample.txt and tell me its exact contents."));
assert.deepEqual(user, { role: "user", text: "Read sample.txt and tell me its exact contents." });

const assistant = textFromTranscriptLine(line("assistant", "sample.txt contains exactly `hello world`."));
assert.deepEqual(assistant, { role: "assistant", text: "sample.txt contains exactly `hello world`." });

// Empty/whitespace-only text (e.g. a tool-call-only message with no text
// part) must not enter the turn stream as a false empty reply.
assert.equal(textFromTranscriptLine(line("assistant", "")), null);
assert.equal(textFromTranscriptLine(line("assistant", "   ")), null);

// Only user/assistant roles are recognized — a malformed or future role
// value must be dropped, not guessed at.
assert.equal(textFromTranscriptLine(line("system", "some text")), null);
assert.equal(textFromTranscriptLine(JSON.stringify({ type: "opencode_message", text: "no role at all" })), null);

// Malformed input stays a silent no-op, matching every other envelope.
assert.equal(textFromTranscriptLine("not json"), null);
assert.equal(textFromTranscriptLine(JSON.stringify({ type: "opencode_message", role: "user" })), null);

// The schema-drift tripwire must recognize this envelope type, or a normal
// OpenCode session would falsely trip the "transcript schema changed"
// warning that exists for real file-tailed adapters.
assert.equal(transcriptEnvelopeType(line("user", "hi")), "recognized");
assert.equal(transcriptEnvelopeType(JSON.stringify({ type: "something_else" })), "unrecognized");

console.log("opencode-transcript-check: all assertions passed");
