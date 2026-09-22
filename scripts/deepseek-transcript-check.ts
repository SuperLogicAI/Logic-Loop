// Behavioral checks for DeepSeek Harness committed-message reduction and its
// explicit synthetic transcript envelope (Plan 040).
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  assistantMessagesSince,
  visibleText,
} from "../dsh-terminal-app/src/messages.js";
import { textFromTranscriptLine, transcriptEnvelopeType } from "../src/lib/decisions";

type FixtureEvent = Record<string, unknown>;

function assistant(content: unknown[], extras: Record<string, unknown> = {}): FixtureEvent {
  return {
    type: "assistant/message",
    surfaceOp: "append",
    data: { message: { role: "assistant", content, ...extras } },
  };
}

function session(events: Array<FixtureEvent | undefined>) {
  return {
    seq: events.length,
    eventAt(seq: unknown) {
      return events[Number(seq)];
    },
  };
}

assert.equal(visibleText({ content: [{ type: "text", text: "hello" }] }), "hello");
assert.equal(
  visibleText({ content: [{ type: "text", text: "first" }, { type: "text", text: " second" }] }),
  "first second",
);
assert.equal(
  visibleText({
    content: [
      { type: "reasoning", reasoning: "private" },
      { type: "tool-call", name: "pwd" },
      { type: "text", text: "visible" },
    ],
  }),
  "visible",
);
assert.equal(visibleText({ content: [{ type: "tool-call", name: "pwd" }] }), null);
assert.equal(visibleText({ content: [{ type: "text", text: "  " }] }), null);
assert.equal(visibleText({ content: "wrong shape" }), null);

const events: Array<FixtureEvent | undefined> = [
  assistant([{ type: "text", text: "before boundary" }]),
  { type: "assistant/attempt", surfaceOp: "append", data: { message: { content: [{ type: "text", text: "failed" }] } } },
  assistant([{ type: "tool-call", name: "pwd" }]),
  { type: "tool/result", surfaceOp: "append", data: { message: { role: "user", content: [{ type: "tool-result" }] } } },
  assistant([{ type: "text", text: "first visible" }, { type: "reasoning", reasoning: "private" }]),
  assistant([{ type: "text", text: "replacement" }]),
  assistant([{ type: "text", text: "wrong role" }]),
  assistant([{ type: "text", text: "interrupted" }], { interrupted: true }),
  undefined,
  assistant([{ type: "text", text: "second visible" }]),
];
(events[5] as { surfaceOp: string }).surfaceOp = "replace";
((events[6] as { data: { message: { role: string } } }).data.message).role = "user";

assert.deepEqual(assistantMessagesSince(session(events), 1), ["first visible", "second visible"]);
assert.deepEqual(assistantMessagesSince(session(events), events.length), []);

const line = (role: string, text: unknown) => JSON.stringify({ type: "deepseek_message", role, text });
assert.deepEqual(textFromTranscriptLine(line("user", "Inspect this.")), { role: "user", text: "Inspect this." });
assert.deepEqual(textFromTranscriptLine(line("assistant", "Which format?")), {
  role: "assistant",
  text: "Which format?",
});
for (const invalid of [
  line("assistant", ""),
  line("assistant", "   "),
  line("tool", "private output"),
  line("assistant", null),
  JSON.stringify({ type: "deepseek_message", role: "user" }),
  JSON.stringify({ role: "assistant", text: "missing type" }),
  "not json",
]) {
  assert.equal(textFromTranscriptLine(invalid), null);
}
assert.equal(transcriptEnvelopeType(line("assistant", "hello")), "recognized");
assert.equal(
  transcriptEnvelopeType(JSON.stringify({ type: "future_deepseek_message", role: "assistant", text: "x" })),
  "unrecognized",
);

// Keep the lifecycle ordering explicit: the exact user line is posted before
// followup; committed assistants are scanned only after idle and posted before
// Stop. This complements the behavioral reducers without invoking a provider.
const runner = readFileSync("dsh-terminal-app/src/index.js", "utf8");
const userPost = runner.indexOf('postTranscriptLine(sessionId, "user", text)');
const followup = runner.indexOf("agent.followup(createUserMessage", userPost);
const idle = runner.indexOf("await agent.whenIdle()", followup);
const assistantScan = runner.indexOf("assistantMessagesSince(messageSession, firstSeq)", idle);
const stop = runner.indexOf('postEvent({ hook_event_name: "Stop"', assistantScan);
assert.ok(userPost >= 0 && userPost < followup);
assert.ok(followup < idle && idle < assistantScan && assistantScan < stop);

console.log("deepseek-transcript-check: all assertions passed");
