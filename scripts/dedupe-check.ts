// Self-check for the events-table dedupe key. Run: npm run dedupe:check
import { strict as assert } from "node:assert";
import { dedupeKey } from "../src/lib/repo";

// A Stop payload's actual current shape (docs/ROADMAP.md "Events dedupe
// key"): none of these fields change turn to turn, so content alone would
// collapse every same-session Stop into one row.
const stopPayload = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    hook_event_name: "Stop",
    session_id: "s1",
    cwd: "/Users/x/dev/proj",
    transcript_path: "/Users/x/.claude/projects/x/t.jsonl",
    project_key: "/Users/x/dev/proj",
    tab_id: "tab-1",
    ...extra,
  });

const postToolUsePayload = (toolUseId: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    hook_event_name: "PostToolUse",
    session_id: "s1",
    tool_name: "Read",
    tool_use_id: toolUseId,
    ...extra,
  });

// --- The bug this fix exists for: a genuine duplicate delivery is caught. ---
// Same session, same type, byte-identical payload, arriving within the same
// instant (e.g. Claude Code re-firing the same hook for one logical event).
assert.equal(
  dedupeKey("s1", "hook:Stop", stopPayload(), 1_000),
  dedupeKey("s1", "hook:Stop", stopPayload(), 1_050),
  "a same-instant duplicate Stop delivery was not caught"
);

// --- The failure mode the naive fix would introduce: two real Stops, several
// seconds apart, must NOT collide even though the content is identical. ---
assert.notEqual(
  dedupeKey("s1", "hook:Stop", stopPayload(), 1_000),
  dedupeKey("s1", "hook:Stop", stopPayload(), 6_000),
  "two real Stops several seconds apart were wrongly deduped"
);

// --- PostToolUse: the natural id (tool_use_id) is authoritative — two
// different real tool calls never collide, no matter how close in time or
// how similar the rest of the payload. ---
assert.notEqual(
  dedupeKey("s1", "hook:PostToolUse", postToolUsePayload("toolu_1"), 1_000),
  dedupeKey("s1", "hook:PostToolUse", postToolUsePayload("toolu_2"), 1_000),
  "two distinct tool calls collided on dedupe key"
);
// ...and a genuine duplicate delivery of the same tool call is still caught,
// even arbitrarily far apart in time (no time-bucket needed once a real id
// exists).
assert.equal(
  dedupeKey("s1", "hook:PostToolUse", postToolUsePayload("toolu_1"), 1_000),
  dedupeKey("s1", "hook:PostToolUse", postToolUsePayload("toolu_1"), 999_000),
  "a duplicate PostToolUse delivery was not caught across a wide time gap"
);

// --- Concurrent subagents share the parent session_id (confirmed gap in
// Claude Code today) and could finish in the same instant with otherwise
// identical Stop-shaped payloads — agent_id must keep them apart. ---
assert.notEqual(
  dedupeKey("s1", "hook:Stop", stopPayload({ agent_id: "sub1" }), 1_000),
  dedupeKey("s1", "hook:Stop", stopPayload({ agent_id: "sub2" }), 1_000),
  "two concurrent subagents' Stops collided on dedupe key"
);

// --- Different sessions and different hook types never collide regardless
// of identical content. ---
assert.notEqual(
  dedupeKey("s1", "hook:Stop", stopPayload(), 1_000),
  dedupeKey("s2", "hook:Stop", stopPayload(), 1_000),
  "two sessions collided on dedupe key"
);
assert.notEqual(
  dedupeKey("s1", "hook:Stop", stopPayload(), 1_000),
  dedupeKey("s1", "hook:Notification", stopPayload(), 1_000),
  "two hook types collided on dedupe key"
);

// --- Opaque payloads (e.g. a transcript line) never throw — no tool_use_id
// or agent_id to extract, falls back to content + time bucket like Stop. ---
assert.doesNotThrow(() => dedupeKey("s1", "transcript", "not json {{{", 1_000));
assert.equal(
  dedupeKey("s1", "transcript", "not json {{{", 1_000),
  dedupeKey("s1", "transcript", "not json {{{", 1_050),
  "a same-instant duplicate transcript line was not caught"
);

console.log("dedupe-check: all assertions passed");
