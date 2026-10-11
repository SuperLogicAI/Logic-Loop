// Plan 062 self-check: line endings survive the textarea round-trip.
// Run: npm run markdown-editor:check
import { strict as assert } from "node:assert";
import { highlightMarkdown, isDirty, toDisk, toTextarea } from "../src/lib/markdownEditor";

const crlf = "# Title\r\n\r\n- a\r\n";
const lf = "# Title\n\n- a\n";

// CRLF file: textarea sees LF, saving restores CRLF byte-for-byte
assert.equal(toTextarea(crlf), lf);
assert.equal(toDisk(toTextarea(crlf), crlf), crlf);
// an edit typed in the textarea (LF) is written back as CRLF
assert.equal(toDisk(lf + "- b\n", crlf), crlf + "- b\r\n");
// LF file stays LF
assert.equal(toDisk(lf, lf), lf);
// normalization alone is not an edit
assert.equal(isDirty(toTextarea(crlf), crlf), false);
assert.equal(isDirty(lf + "x", lf), true);
// trailing-newline change is an edit
assert.equal(isDirty("# Title\n\n- a", lf), true);

// Colour layer: tokens join back to the source exactly (alignment invariant)
const sample = [
  "# H1", "## H2", "### H3", "#nohash", "---", "> quote",
  "- **bold** and `code` see [x](docs/a.md)", "  2. [ ] task", "@AGENTS.md", "mail a@b.com",
  "```bash", "# not a heading", "```", "",
].join("\n");
const lines = highlightMarkdown(sample);
assert.equal(lines.map((l) => l.map((t) => t.text).join("")).join("\n"), sample);
const kinds = lines.map((l) => l.map((t) => t.kind).join(","));
assert.deepEqual(kinds.slice(0, 6), ["h1", "h2", "h3", "text", "rule", "quote"]);
assert.equal(kinds[6], "marker,strong,text,code,text,link");
assert.equal(kinds[7], "text,marker,text");
assert.equal(kinds[8], "import");
assert.equal(kinds[9], "text"); // email isn't an @import
assert.deepEqual(kinds.slice(10, 13), ["fence", "code", "fence"]); // # inside a fence isn't a heading
assert.deepEqual(lines[13], []); // trailing newline → empty last line

console.log("markdown-editor-check: all assertions passed");
