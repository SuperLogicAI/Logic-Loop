// Self-check for Plan 054's context meter parsers. Run: npm run context-meter:check
import { strict as assert } from "node:assert";
import { claudeContext, codexContext, contextFill, formatTokens } from "../src/lib/contextMeter";

// Claude statusLine context_window.
const usage = { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 2000, cache_read_input_tokens: 81000 };
const cw = { used_percentage: 42, context_window_size: 200000, current_usage: usage };
assert.deepEqual(claudeContext(cw), { percent: 42, usedTokens: 84000, windowTokens: 200000 });
// Output tokens never count toward context (input-only, same as /context).
assert.equal(claudeContext({ ...cw, current_usage: { ...usage, output_tokens: 99999 } })?.usedTokens, 84000);
// Before the first response and right after /compact: hidden.
assert.equal(claudeContext({ ...cw, current_usage: null }), null);
assert.equal(claudeContext({ used_percentage: 42 }), null);
// Missing or malformed: hidden, never NaN.
for (const bad of [undefined, null, "42", [], {}, { ...cw, used_percentage: null }, { ...cw, used_percentage: NaN }, { ...cw, used_percentage: -1 }, { ...cw, used_percentage: "42" }]) {
  assert.equal(claudeContext(bad), null, JSON.stringify(bad));
}
// Partial token breakdown or bad window: percent still shown, tooltip counts dropped.
assert.deepEqual(claudeContext({ ...cw, current_usage: { input_tokens: 5 } }), { percent: 42, usedTokens: null, windowTokens: 200000 });
assert.equal(claudeContext({ ...cw, context_window_size: 0 })?.windowTokens, null);
// Above 100 is displayed as-is; only the fill clamps.
assert.equal(claudeContext({ ...cw, used_percentage: 104 })?.percent, 104);

// Codex rollout token_count.
const tokenCount = (info: unknown, type = "token_count", outer = "event_msg") =>
  JSON.stringify({ timestamp: "2026-10-07T00:00:00Z", type: outer, payload: { type, info, rate_limits: null } });
const info = { total_token_usage: { total_tokens: 781459 }, last_token_usage: { total_tokens: 80221 }, model_context_window: 258400 };
const codex = codexContext(tokenCount(info));
assert.ok(codex);
assert.equal(codex.usedTokens, 80221);
assert.equal(codex.windowTokens, 258400);
assert.ok(Math.abs(codex.percent - 31.045) < 0.01);
// Session-start token_count with info null, other events, malformed lines: ignored.
assert.equal(codexContext(tokenCount(null)), null);
assert.equal(codexContext(tokenCount(info, "agent_message")), null);
assert.equal(codexContext(tokenCount(info, "token_count", "response_item")), null);
assert.equal(codexContext('{"type":"event_msg","payload":{"type":"token_count"'), null);
assert.equal(codexContext(JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "token_count" } })), null);
assert.equal(codexContext(tokenCount({ ...info, model_context_window: 0 })), null);
assert.equal(codexContext(tokenCount({ ...info, model_context_window: null })), null);
assert.equal(codexContext(tokenCount({ ...info, last_token_usage: { total_tokens: -5 } })), null);
assert.equal(codexContext(tokenCount({ ...info, last_token_usage: { total_tokens: "80221" } })), null);
// A Claude transcript line never parses as Codex usage.
assert.equal(codexContext(JSON.stringify({ type: "assistant", message: { usage: { input_tokens: 5 } } })), null);

// Display helpers.
assert.equal(contextFill(104), 100);
assert.equal(contextFill(-3), 0);
assert.equal(formatTokens(84000), "84k");
assert.equal(formatTokens(258400), "258k");
assert.equal(formatTokens(1_000_000), "1M");
assert.equal(formatTokens(950), "950");

console.log("context-meter-check: ok");
