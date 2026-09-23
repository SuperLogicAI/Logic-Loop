/**
 * Pure, display-only terminal presentation helpers for the first-party dsh
 * runner (Plan 042 Part B).
 *
 * Nothing here reads or parses semantic data: it only turns an
 * already-extracted string into bytes safe to print, and wraps it in
 * 24-bit SGR color. The byte-preservation contract on `createStyler` keeps
 * the rendered characters identical to the input apart from added SGR.
 *
 * Logic Loop's terminal background is `#1e2127` (src/components/Terminal.tsx).
 * No dependency: plain SGR constants, like the runner already used.
 */

/** 24-bit SGR color constants and the reset that closes every span. */
export const SGR = {
  brand: "\x1b[38;2;77;106;254m", // #4d6afe — user prompt, assistant gutter
  text: "\x1b[38;2;219;226;236m", // #dbe2ec — assistant prose
  code: "\x1b[38;2;156;220;254m", // #9cdcfe — fenced code content
  dim: "\x1b[38;2;123;134;149m", // #7b8695 — separators, hints, fences
  error: "\x1b[38;2;248;113;113m", // #f87171 — turn errors
  reset: "\x1b[0m",
};

/**
 * Pure color gate. SGR is emitted only on a TTY, with NO_COLOR unset/empty,
 * and FORCE_COLOR not exactly `"0"` (the spec's truth table). `process.env`
 * values are strings, so `"0"` is the disable sentinel.
 * @param {{ isTTY?: unknown, noColor?: unknown, forceColor?: unknown }} [env]
 * @returns {boolean}
 */
export function shouldUseColor(env = {}) {
  const { isTTY, noColor, forceColor } = env;
  if (forceColor === "0") return false;
  if (noColor) return false;
  return Boolean(isTTY);
}

/**
 * Strip terminal control sequences from untrusted text before printing.
 *
 * Removes OSC (`ESC ] ... BEL` or `ESC \`), CSI (`ESC [ ... final`), and any
 * other two-byte ESC sequence, then every C0/C1 control except `\n` and
 * `\t` (so CR, NUL, and C1 like `\x9b` are dropped). `String(...)` first so
 * a non-string never throws. This is a display-integrity fix: model text
 * must not move the cursor, recolor, or overwrite earlier output.
 * @param {unknown} text
 * @returns {string}
 */
export function sanitizeForTerminal(text) {
  return String(text)
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "") // OSC
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "") // CSI
    .replace(/\x1b[\x20-\x7e]/g, "") // any remaining two-byte ESC sequence
    .replace(/[\x00-\x08\x0b\x0c\x0d-\x1f\x7f\x80-\x9f]/g, ""); // controls
}

/**
 * Wrap `text` in `sgr` and close it with a reset, unless color is disabled.
 * Never appends a second reset to text that already ends with one.
 * @param {unknown} text
 * @param {string} sgr
 * @param {boolean} enabled
 * @returns {string}
 */
export function paint(text, sgr, enabled) {
  const s = String(text);
  if (!enabled) return s;
  return s.endsWith(SGR.reset) ? sgr + s : sgr + s + SGR.reset;
}

/** A line whose first non-space characters are three backticks. */
const FENCE_LINE = /^[ \t]*`{3,}/;
/** The longest prefix we hold while deciding whether a line is a fence. */
const FENCE_CANDIDATE = /^[ \t]*`{0,2}$/;

/**
 * Fence-aware streaming styler. `push(delta)` returns SGR-wrapped output for
 * that delta; `flush()` emits any held partial line and resets. With every
 * SGR sequence stripped, the concatenation of all `push`/`flush` returns
 * equals the concatenation of all inputs exactly — no character is added,
 * dropped, or reordered. Fenced content is painted `SGR.code`, fence marker
 * lines `SGR.dim`, everything else `SGR.text`.
 *
 * A trailing partial line is held only while it is still a fence-candidate
 * prefix (leading spaces plus up to two backticks); anything else is emitted
 * immediately, so a normal reply streams without waiting for its newline.
 * @param {boolean} enabled
 * @returns {{ push: (text: unknown) => string, flush: () => string }}
 */
export function createStyler(enabled) {
  let inFence = false;
  let deciding = ""; // held line-start prefix: spaces/tabs + up to 2 backticks
  let lineOpen = false; // an open line has a style and buffered run
  let lineSgr = SGR.text;
  let fenceLine = false; // current open line is a fence marker: toggle on \n
  let run = ""; // open-line characters not yet wrapped

  function flushRun(out) {
    if (run.length === 0) return out;
    const painted = paint(run, lineSgr, enabled);
    run = "";
    return out + painted;
  }

  function openBody() {
    lineSgr = inFence ? SGR.code : SGR.text;
    fenceLine = false;
    lineOpen = true;
    run += deciding;
    deciding = "";
  }

  function openFence() {
    lineSgr = SGR.dim;
    fenceLine = true;
    lineOpen = true;
    run += deciding;
    deciding = "";
  }

  function push(text) {
    let out = "";
    for (const ch of String(text)) {
      if (!lineOpen) {
        if (ch === "\n") {
          const sgr = inFence ? SGR.code : SGR.text;
          if (deciding.length > 0) {
            out += paint(deciding, sgr, enabled);
            deciding = "";
          }
          out += paint("\n", sgr, enabled);
          continue;
        }
        if (ch === " " || ch === "\t" || ch === "`") {
          deciding += ch;
          if (FENCE_LINE.test(deciding)) openFence();
          continue;
        }
        openBody();
        run += ch;
        continue;
      }
      if (ch === "\n") {
        run += "\n";
        out = flushRun(out);
        if (fenceLine) inFence = !inFence;
        lineOpen = false;
        fenceLine = false;
        continue;
      }
      run += ch;
    }
    out = flushRun(out);
    // Keep holding only a still-ambiguous fence prefix; never more.
    if (!lineOpen && !FENCE_CANDIDATE.test(deciding)) {
      out += paint(deciding, inFence ? SGR.code : SGR.text, enabled);
      deciding = "";
    }
    return out;
  }

  function flush() {
    let out = "";
    if (!lineOpen && deciding.length > 0) {
      out += paint(deciding, inFence ? SGR.code : SGR.text, enabled);
    }
    out = flushRun(out);
    inFence = false;
    deciding = "";
    lineOpen = false;
    fenceLine = false;
    lineSgr = SGR.text;
    return out;
  }

  return { push, flush };
}
