// Formatting checks for the dsh terminal runner's display helpers (Plan 042
// Part B). Pure functions only — no PTY, no provider. Run:
// npm run deepseek-format:check
import { strict as assert } from "node:assert";
import {
  SGR,
  createStyler,
  paint,
  sanitizeForTerminal,
  shouldUseColor,
} from "../dsh-terminal-app/src/format.js";

// Color gate truth table: FORCE_COLOR="0" and a non-empty NO_COLOR both win;
// a non-TTY never emits SGR.
assert.equal(shouldUseColor({ isTTY: true }), true);
assert.equal(shouldUseColor({ isTTY: true, noColor: "" }), true);
assert.equal(shouldUseColor({ isTTY: true, noColor: "1" }), false);
assert.equal(shouldUseColor({ isTTY: false }), false);
assert.equal(shouldUseColor({ isTTY: true, forceColor: "0" }), false);

// Sanitizer removes OSC/CSI/CR/NUL/C1 while preserving newline and tab
// byte-for-byte, and never throws on a non-string.
const dirty = "\x1b[31mred\x1b[2K\x1b]0;title\x07mid\rnul\x00c1\x9bdone";
const clean = sanitizeForTerminal(dirty);
for (const removed of ["\x1b[31m", "\x1b[2K", "\x1b]0;title\x07", "\r", "\x00", "\x9b"]) {
  assert.ok(!clean.includes(removed), `sanitizeForTerminal must remove ${JSON.stringify(removed)}`);
}
assert.equal(clean, "redmidnulc1done");
assert.equal(sanitizeForTerminal("a\nb\tc"), "a\nb\tc");
assert.equal(sanitizeForTerminal(42), "42");

// paint wraps and resets only when enabled.
const painted = paint("x", SGR.text, true);
assert.ok(painted.startsWith(SGR.text));
assert.ok(painted.endsWith(SGR.reset));
assert.equal(paint("x", SGR.text, false), "x");

// Fence-aware styler classifies fenced content and marker lines, and is
// byte-preserving with all SGR stripped — fed in streaming chunks so the
// held-prefix boundary is exercised.
const sample = "before\n```js\nconst x = 1;\n```\nafter\n";
const chunks = ["before\n``", "`js\nconst x = ", "1;\n``", "`\nafter\n"];
const stripSgr = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

const styler = createStyler(true);
let styled = "";
for (const chunk of chunks) styled += styler.push(chunk);
styled += styler.flush();
assert.ok(styled.includes(SGR.code), "fenced content must be painted SGR.code");
assert.ok(styled.includes(SGR.text), "prose must be painted SGR.text");
assert.ok(styled.includes(SGR.dim), "fence marker lines must be painted SGR.dim");
assert.equal(stripSgr(styled), sample, "createStyler(true) must preserve characters byte-for-byte");

const plainStyler = createStyler(false);
let plain = "";
for (const chunk of chunks) plain += plainStyler.push(chunk);
plain += plainStyler.flush();
assert.equal(plain, sample, "createStyler(false) must preserve characters byte-for-byte");

// The runner's brand constant must stay the exact 24-bit SGR.
assert.equal(SGR.brand, "\x1b[38;2;77;106;254m");

console.log("deepseek-format-check: all assertions passed");
