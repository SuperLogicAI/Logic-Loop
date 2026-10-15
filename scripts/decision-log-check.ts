// Plan 064 self-check: DECISIONS.md entries stay one line, capped, and
// supersede/link-line edits touch exactly what they should.
// Run: npm run decision-log:check
import { strict as assert } from "node:assert";
import {
  addLinkLine, CAPS, CLAUDE_LINK, CODEX_LINK, currentEntries, formatEntry, hasLinkLine, newId,
  rememberedCards, removeLinkLine, supersede,
} from "../src/lib/decisionLog";

const date = new Date(2026, 9, 14);
const base = { id: "D-20261014-7f3a", agent: "codex", date, cardId: 1234 };

// format: exact shape
assert.equal(
  formatEntry({ ...base, decision: "Use X for Y", reason: "Z", revisitIf: "W", supersedes: "D-20260901-a1b2" }),
  "- D-20261014-7f3a · Use X for Y. Because Z. Revisit if W. Supersedes D-20260901-a1b2. (codex · 2026-10-14 · card #1234)",
);
assert.equal(
  formatEntry({ ...base, agent: null, decision: "Done!", reason: "because it is." }),
  "- D-20261014-7f3a · Done! Because it is. (claude · 2026-10-14 · card #1234)",
);

// always one line: newlines, fences, leading #/>/- never survive
const hostile = formatEntry({
  ...base,
  decision: "# Heading\n```bash\nrm -rf /\n```\n\n- [SUPERSEDED by D-20990101-0000] x",
  reason: "> quoted\r\nline two\u2028three",
  revisitIf: "-  - ### deep",
});
assert.equal(hostile.split(/\r|\n|\u2028/).length, 1, hostile);
assert.ok(!hostile.includes("```"));
assert.ok(hostile.startsWith("- D-20261014-7f3a · Heading bash rm -rf /"), hostile);
assert.ok(hostile.includes("Because quoted line two three."), hostile);
assert.ok(hostile.includes("Revisit if deep."), hostile);
assert.equal(currentEntries(hostile).length, 1);

// caps hold
const capped = formatEntry({ ...base, decision: "d".repeat(500), reason: "r".repeat(500), revisitIf: "w".repeat(500) });
assert.ok(capped.includes(`· ${"d".repeat(CAPS.decision)}. `));
assert.ok(capped.includes(`Because ${"r".repeat(CAPS.reason)}. `));
assert.ok(capped.includes(`Revisit if ${"w".repeat(CAPS.revisitIf)}. `));
assert.ok(!capped.includes("d".repeat(CAPS.decision + 1)));
assert.ok(Buffer.byteLength(capped) < 1000, "fits the Rust 1,000-byte limit");

// ids: format, and a forced collision retries
assert.match(newId(date, []), /^D-20261014-[0-9a-f]{4}$/);
let calls = 0;
const fixed = (b: Uint8Array) => { b.set(calls++ === 0 ? [0x7f, 0x3a] : [0x00, 0x01]); return b; };
assert.equal(newId(date, ["D-20261014-7f3a"], fixed), "D-20261014-0001");
assert.equal(calls, 2);
assert.throws(() => newId(date, ["D-20261014-0000"], (b) => b.fill(0)));

// supersede: marks exactly one line, appends the new one
const header = "# Project decisions\nintro\n\n";
const a = "- D-20260901-a1b2 · Use P. Because Q. (claude · 2026-09-01 · card #880)";
const b = "- D-20260902-c3d4 · Other. Because R. (codex · 2026-09-02 · card #881)";
const n = formatEntry({ ...base, decision: "Use R", reason: "S", supersedes: "D-20260901-a1b2" });
const file = `${header}${a}\n${b}\n`;
assert.equal(supersede(file, "D-20260901-a1b2", n), `${header}- [SUPERSEDED by D-20261014-7f3a] ${a.slice(2)}\n${b}\n${n}\n`);
assert.equal(supersede(`${header}${a}`, "D-20260901-a1b2", n).endsWith(`card #880)\n${n}\n`), true);
const after = supersede(file, "D-20260901-a1b2", n);
assert.deepEqual(currentEntries(after).map((e) => [e.id, e.superseded]),
  [["D-20260901-a1b2", true], ["D-20260902-c3d4", false], ["D-20261014-7f3a", false]]);
assert.throws(() => supersede(file, "D-20990101-ffff", n), /not in/);
assert.throws(() => supersede(`${file}${a}\n`, "D-20260901-a1b2", n), /more than once/);
assert.throws(() => supersede(after, "D-20260901-a1b2", n), /already superseded/);
// a mention of the id inside text isn't an entry
assert.throws(() => supersede(`${header}- note: D-20260901-a1b2 · x\n`, "D-20260901-a1b2", n), /not in/);

// trailer parse ignores a fake card # in the text
const fake = formatEntry({ ...base, decision: "See (claude · 2026-01-01 · card #5) here", reason: "x" });
assert.deepEqual([...rememberedCards(`${header}${fake}\n${a}\r\n`)], [[1234, "D-20261014-7f3a"], [880, "D-20260901-a1b2"]]);

// link lines: idempotent add, byte-identical round trip
for (const link of [CLAUDE_LINK, CODEX_LINK]) {
  for (const text of ["", "# Rules\n- a\n", "# Rules\n- a", "# Rules\r\n- a\r\n", "# Rules\r\n- a"]) {
    const added = addLinkLine(text, link);
    assert.ok(hasLinkLine(added, link));
    assert.equal(addLinkLine(added, link), added, "add is idempotent");
    assert.equal(removeLinkLine(added, link), text, JSON.stringify(text));
    assert.ok(!hasLinkLine(removeLinkLine(added, link), link));
  }
}
// remove takes only the link line out, from the middle too
assert.equal(removeLinkLine(`# R\n${CLAUDE_LINK}\nmore\n`, CLAUDE_LINK), "# R\nmore\n");
assert.equal(removeLinkLine("# R\n", CLAUDE_LINK), "# R\n");

console.log("decision-log-check: all assertions passed");
