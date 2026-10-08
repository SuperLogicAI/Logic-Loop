// Self-check for Plan 055's multiple-choice parsers. Run: npm run ask-user-question:check
import { strict as assert } from "node:assert";
import {
  answersFromPost,
  askContextJson,
  askOptionsFromContext,
  questionsFromPre,
} from "../src/lib/askUserQuestion";
import { resetEpochGuard, stateForHook } from "../src/lib/ingest";
import type { HookPayload } from "../src/types";

const questions = [
  {
    question: "Which store?",
    header: "Storage",
    multiSelect: false,
    options: [{ label: "SQLite", description: "local file" }, { label: "Postgres" }],
  },
  { question: "Which checks?", header: "Checks", multiSelect: true, options: [{ label: "tsc" }, { label: "clippy" }] },
];
const pre = (extra: Record<string, unknown> = {}) => ({
  hook_event_name: "PreToolUse",
  session_id: "s1",
  tool_name: "AskUserQuestion",
  tool_use_id: "toolu_1",
  tool_input: { questions },
  ...extra,
});

// PreToolUse: one entry per question, options keep label + description.
const qs = questionsFromPre(pre());
assert.equal(qs.length, 2);
assert.deepEqual(qs[0], {
  question: "Which store?",
  header: "Storage",
  options: [{ label: "SQLite", description: "local file" }, { label: "Postgres" }],
  multiSelect: false,
});
assert.equal(qs[1].multiSelect, true);

// Other tools, other events, missing or malformed input → nothing.
assert.deepEqual(questionsFromPre(pre({ tool_name: "Bash" })), []);
assert.deepEqual(questionsFromPre(pre({ hook_event_name: "PostToolUse" })), []);
for (const bad of [undefined, null, "x", {}, { questions: "x" }, { questions: [null, 3, { question: 7 }, { question: "  " }] }]) {
  assert.deepEqual(questionsFromPre(pre({ tool_input: bad })), [], JSON.stringify(bad));
}
// Non-string labels dropped, question survives with what's left.
const mixed = questionsFromPre(pre({ tool_input: { questions: [{ question: "Q?", options: [{ label: 5 }, null, { label: "ok" }] }] } }));
assert.deepEqual(mixed, [{ question: "Q?", options: [{ label: "ok" }], multiSelect: false }]);

// PostToolUse: answers keyed by question; multi-select arrives as one string.
const post = (answers: unknown, extra: Record<string, unknown> = {}) => ({
  hook_event_name: "PostToolUse",
  session_id: "s1",
  tool_name: "AskUserQuestion",
  tool_input: { questions },
  tool_response: { questions, answers },
  ...extra,
});
assert.deepEqual(
  [...answersFromPost(post({ "Which store?": "SQLite", "Which checks?": "tsc, clippy" }))],
  [["Which store?", "SQLite"], ["Which checks?", "tsc, clippy"]]
);
assert.equal(answersFromPost(post({ "Which store?": 3, x: "" })).size, 0);
for (const bad of [undefined, null, "x", ["a"]]) assert.equal(answersFromPost(post(bad)).size, 0);
assert.equal(answersFromPost(post({ q: "a" }, { tool_name: "Bash" })).size, 0);
assert.equal(answersFromPost(pre()).size, 0);

// Stored context round-trips to option labels; turn-pair context is not a card.
assert.deepEqual(askOptionsFromContext(askContextJson(qs[0], "toolu_1")), qs[0].options);
assert.equal(JSON.parse(askContextJson(qs[0], undefined)).tool_use_id, null);
assert.equal(askOptionsFromContext(JSON.stringify({ assistant: "a?", user: null })), null);
assert.equal(askOptionsFromContext("not json"), null);

// Tab state: an open picker is "waiting"; other PreToolUse is no change.
resetEpochGuard();
assert.equal(stateForHook(pre() as HookPayload), "waiting");
assert.equal(stateForHook(pre({ tool_name: "Bash" }) as HookPayload), null);
assert.equal(stateForHook(pre({ agent_id: "sub" }) as HookPayload), null);

console.log("ask-user-question: ok");
