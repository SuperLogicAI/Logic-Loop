// Self-check for stored tool-payload capping (Plan 069). Run: npm run payload-trim:check
import { strict as assert } from "node:assert";
import { STORED_STRING_CAP, trimForStorage } from "../src/lib/payloadTrim";

const big = "x".repeat(300_000);
const post = (tool_response: unknown, tool_input: unknown = { file_path: "/repo/src/a.ts" }) => ({
  session_id: "s1",
  tab_id: "t1",
  cwd: "/repo",
  hook_event_name: "PostToolUse",
  tool_name: "Read",
  tool_use_id: "toolu_1",
  tool_input,
  tool_response,
});
const size = (v: unknown) => JSON.stringify(v).length;
const clone = (v: unknown) => JSON.parse(JSON.stringify(v));

// A 300 KB Read result is stored under 5 KB; routing fields untouched.
const read = post({ type: "text", file: { filePath: "/repo/src/a.ts", content: big } });
const before = clone(read);
const trimmed = trimForStorage(read) as typeof read & { tool_response: { file: { content: string } } };
assert.ok(size(trimmed) < 5_000, `stored ${size(trimmed)} bytes`);
assert.ok(trimmed.tool_response.file.content.startsWith("x".repeat(STORED_STRING_CAP) + " … [+298000 chars not stored]"));
for (const k of ["tool_name", "tool_use_id", "cwd", "session_id", "tab_id", "hook_event_name"] as const) {
  assert.equal(trimmed[k], read[k], k);
}
assert.deepEqual(trimmed.tool_input, { file_path: "/repo/src/a.ts" });
// Input never mutated.
assert.deepEqual(read, before);

// Nested arrays of text blocks (MCP-style results, image payloads).
const blocks = post([{ type: "text", text: big }, [{ type: "image", data: big }]]);
const tb = trimForStorage(blocks) as { tool_response: [{ text: string }, [{ data: string }]] };
assert.ok(tb.tool_response[0].text.length < STORED_STRING_CAP + 50);
assert.ok(tb.tool_response[1][0].data.length < STORED_STRING_CAP + 50);
assert.ok(size(tb) < 5_000);

// Long tool_input strings are capped too (e.g. a huge Write's content).
const write = trimForStorage(post({ success: true }, { file_path: "/repo/b.ts", content: big })) as {
  tool_input: { file_path: string; content: string };
};
assert.equal(write.tool_input.file_path, "/repo/b.ts");
assert.ok(write.tool_input.content.length < STORED_STRING_CAP + 50);

// Failures keep their response whole.
const isError = post({ is_error: true, error: big });
assert.deepEqual(trimForStorage(isError), isError);
const exitCode = post({ output: big, metadata: { exit: 1 } });
assert.deepEqual(trimForStorage(exitCode), exitCode);
const exitZero = trimForStorage(post({ output: big, metadata: { exit: 0 } })) as { tool_response: { output: string } };
assert.ok(exitZero.tool_response.output.length < STORED_STRING_CAP + 50);

// Non-PostToolUse payloads returned as is (same object).
const stop = { session_id: "s1", hook_event_name: "Stop", last_assistant_message: big };
assert.equal(trimForStorage(stop), stop);
const pre = { ...post({}), hook_event_name: "PreToolUse", tool_input: { questions: [big] } };
assert.equal(trimForStorage(pre), pre);
for (const v of [null, undefined, "str", 42]) assert.equal(trimForStorage(v), v);

// A short payload is stored byte-identical.
const short = post({ stdout: "ok", stderr: "", interrupted: false, isImage: false }, { command: "ls", description: "List" });
assert.equal(JSON.stringify(trimForStorage(short)), JSON.stringify(short));

// Fail open: a throwing getter returns the original.
const hostile = post({});
Object.defineProperty(hostile, "tool_response", { enumerable: true, get() { throw new Error("boom"); } });
assert.equal(trimForStorage(hostile), hostile);

console.log("payload-trim: ok");
