// Self-check for the Accomplished diff pop-out's file-section slicing.
// Run: npm run diff:check
import { strict as assert } from "node:assert";
import { dirOf, extractFileDiff } from "../src/lib/diff";

const section = (path: string) =>
  [
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1,2 +1,2 @@",
    "-old",
    "+new",
    "",
  ].join("\n");

const staged = section("src/a/foo.ts") + section("src/b/foo.ts") + section("src-tauri/src/pty.rs");

// --- dirOf ---
assert.equal(dirOf("/repo/src/foo.ts"), "/repo/src", "posix path should yield its parent dir");
assert.equal(dirOf("C:\\repo\\src\\foo.ts"), "C:\\repo\\src", "windows path should keep its native separators");
assert.equal(dirOf("README.md"), null, "a bare filename has no directory to point git at");
assert.equal(dirOf("/README.md"), null, "a repo-root-relative path has no usable parent");

// --- extractFileDiff ---
const one = extractFileDiff(staged, "/Users/x/repo/src/b/foo.ts");
assert.ok(one.startsWith("diff --git a/src/b/foo.ts"), "absolute path should match its repo-relative section");
assert.ok(!one.includes("src/a/foo.ts"), "must not bleed into the neighbouring section");
assert.equal(one.split("diff --git").length - 1, 1, "exactly one section should come back");

// Same basename in a sibling directory must not match — suffix matching is
// anchored at a separator, which is the whole point of the `/` in the check.
assert.equal(
  extractFileDiff(staged, "/Users/x/repo/src/c/foo.ts"),
  "",
  "a same-named file in an unstaged directory must not borrow another's diff"
);

// A file the agent touched but nobody staged: no section, empty state.
assert.equal(extractFileDiff(staged, "/Users/x/repo/src/unstaged.ts"), "", "unstaged file yields no diff");
assert.equal(extractFileDiff("", "/Users/x/repo/src/a/foo.ts"), "", "empty diff (not a repo / git failed) yields no diff");
assert.equal(extractFileDiff(staged, ""), "", "a row with no file path yields no diff");

// Windows-shaped file_path against git's always-forward-slash diff paths.
assert.ok(
  extractFileDiff(staged, "C:\\repo\\src-tauri\\src\\pty.rs").startsWith("diff --git a/src-tauri/src/pty.rs"),
  "backslashed agent path must still match git's forward-slash diff header"
);

// Added file: the `--- /dev/null` half must never be treated as a path.
const added = [
  "diff --git a/src/new.ts b/src/new.ts",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/src/new.ts",
  "@@ -0,0 +1 @@",
  "+hello",
  "",
].join("\n");
assert.ok(extractFileDiff(added, "/repo/src/new.ts").includes("+hello"), "a new file's section must be found");
assert.equal(extractFileDiff(added, "/dev/null"), "", "/dev/null must never match a section");

// Rename with no hunks (pure rename): header-line fallback, either side matches.
const renamed = [
  "diff --git a/src/old.ts b/src/new-name.ts",
  "similarity index 100%",
  "rename from src/old.ts",
  "rename to src/new-name.ts",
  "",
].join("\n");
assert.ok(extractFileDiff(renamed, "/repo/src/new-name.ts").startsWith("diff --git"), "rename destination should match");
assert.ok(extractFileDiff(renamed, "/repo/src/old.ts").startsWith("diff --git"), "rename source should match");

// Hunk content that itself looks like a diff header must not split a section.
const nested = [
  "diff --git a/docs/x.md b/docs/x.md",
  "--- a/docs/x.md",
  "+++ b/docs/x.md",
  "@@ -1 +1,2 @@",
  " prose",
  "+diff --git a/fake b/fake",
  "",
].join("\n");
assert.equal(extractFileDiff(nested, "/repo/fake"), "", "a header inside hunk content must not become its own section");
assert.ok(extractFileDiff(nested, "/repo/docs/x.md").includes("+diff --git"), "hunk content stays with its own section");

console.log("diff-check: all assertions passed");
