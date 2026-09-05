// Self-check for panel row shaping: session scoping + the Accomplished
// panel's filename. Run: npm run scope:check
import { strict as assert } from "node:assert";
import { basename, scopeBySession } from "../src/lib/repo";

const row = (id: number, sessionId: string) => ({ id, session_id: sessionId });

const rows = [row(1, "s-parent"), row(2, "s-child-a"), row(3, "s-child-b"), row(2, "s-child-a")];

// Fan-out siblings sharing a cwd: each tab's session only sees its own rows.
assert.deepEqual(
  scopeBySession(rows, "s-child-a").map((r) => r.id),
  [2, 2],
  "sibling session's rows leaked into another session's scope"
);
assert.deepEqual(
  scopeBySession(rows, "s-parent").map((r) => r.id),
  [1],
  "parent's own session row was dropped"
);

// A session with no rows in this cwd scopes to nothing, not a fallback list.
assert.deepEqual(scopeBySession(rows, "s-unrelated"), [], "unrelated session matched rows it never produced");

// No bound session yet (plain shell, no agent has reported) — cwd-wide
// fallback, same behavior as before this fix existed.
assert.equal(scopeBySession(rows, null).length, 4, "null session id should fall back to the unfiltered list");

// --- Accomplished panel filename, either separator. ---
// The backslash case is the bug: splitting on `/` alone left the path whole and
// the panel rendered "Edited C:\Users\x\dev\proj\main.rs".
assert.equal(basename("C:\\Users\\x\\dev\\proj\\main.rs"), "main.rs", "backslash path not shortened");
assert.equal(basename("/Users/x/dev/proj/main.rs"), "main.rs", "posix path not shortened");
assert.equal(basename("C:/Users/x/dev/proj/main.rs"), "main.rs", "mixed-separator path not shortened");
// Trailing separator: filter(Boolean) drops the empty tail, so a directory-ish
// path still names its last real segment rather than returning "".
assert.equal(basename("/Users/x/dev/proj/"), "proj");
// Already bare, and the degenerate inputs — never return "" to the panel.
assert.equal(basename("main.rs"), "main.rs");
assert.equal(basename("/"), "/");
assert.equal(basename(""), "");

console.log("scope-check: all assertions passed");
