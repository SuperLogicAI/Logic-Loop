// Self-check for blocker repository/UI wiring: Phase 24 bulk-clear and the
// Plan 052 two-tier split (project blockers vs detector rows), with the real
// SQL statements from repo.ts executed against SQLite (node:sqlite).
// Run: npm run blockers:check
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PROJECT_BLOCKER_SQL, isProjectBlocker, promotedParts } from "../src/lib/repo";

const repoSource = readFileSync(join(import.meta.dirname, "../src/lib/repo.ts"), "utf-8");
const panelSource = readFileSync(join(import.meta.dirname, "../src/components/SidePanel.tsx"), "utf-8");

/** The first template-literal SQL after `marker` in repo.ts, with the shared
 * fragment substituted — so the fixture runs the statement the app runs. */
function sqlAfter(marker: string): string {
  const m = new RegExp(`${marker}[\\s\\S]*?\`([^\`]+)\``).exec(repoSource);
  assert.ok(m, `no SQL template found after ${marker}`);
  // `$1` is tauri-plugin-sql's positional style; node:sqlite binds `?`.
  return m[1].replaceAll("${PROJECT_BLOCKER_SQL}", PROJECT_BLOCKER_SQL).replaceAll("$1", "?");
}

// --- Source wiring ---

assert.match(
  repoSource,
  /export async function resolveAllBlockers\(cwd: string\)[\s\S]*UPDATE blockers SET resolved = 1 WHERE cwd = \$1 AND resolved = 0 AND \$\{PROJECT_BLOCKER_SQL\}`, \[cwd\]/,
  "bulk resolve must update only open project blockers for the supplied cwd"
);
assert.match(
  repoSource,
  /FROM blockers\s+WHERE resolved = 0 AND \$\{PROJECT_BLOCKER_SQL\}\s+UNION ALL/,
  "Inbox union must exclude detector rows"
);
assert.match(
  repoSource,
  /export async function promoteBlocker\(b: Blocker\)[\s\S]*?addBlocker\(b\.cwd, `\$\{b\.source\}: \$\{b\.text\}`, `\$\{PROMOTED_PREFIX\}\$\{b\.source\}`[\s\S]*?setBlockerResolved\(b\.id, true\)/,
  "promote must add a promoted:<label> project blocker from the detected row, then resolve that row"
);
assert.ok(
  panelSource.includes("await repo.resolveAllBlockers(cwd)"),
  "Blockers clear-all handler must use the project-scoped repository operation"
);
assert.match(
  panelSource,
  /open\.length > 1[\s\S]*title="Resolve all open blockers"[\s\S]*e\.stopPropagation\(\)[\s\S]*void clearAllBlockers\(\)/,
  "clear all must require multiple open blockers and remain separate from the collapse target"
);
assert.match(
  panelSource,
  /const open = blockers\.filter\(\(b\) => b\.resolved === 0 && repo\.isProjectBlocker\(b\)\)/,
  "cards and counts must come from project blockers only"
);
assert.match(
  panelSource,
  /const detected = blockers\.filter\(\(b\) => b\.resolved === 0 && !repo\.isProjectBlocker\(b\)\)/,
  "the Detected tier must hold only open detector rows"
);
assert.ok(panelSource.includes("await repo.resolveDetectedBlockers(cwd)"), "clear detected must use its own operation");
assert.ok(panelSource.includes("await repo.promoteBlocker(b)"), "↑ must call promoteBlocker");
assert.ok(
  panelSource.includes("useState(false); // Plan 052: newest ROW_CAP, ＋N expands"),
  "Detected tier starts collapsed to the newest ROW_CAP rows (maintainer decision, live review)"
);
assert.ok(panelSource.includes("const promoted = repo.promotedParts(b);"), "project cards must render promoted rows as label + detail");

// promotedParts: label from source, detail with the stored `<label>: ` prefix stripped.
assert.deepEqual(promotedParts({ source: "promoted:Tests failing", text: "Tests failing: 3 failed" }), {
  label: "Tests failing",
  detail: "3 failed",
});
assert.deepEqual(promotedParts({ source: "promoted:Lock held", text: "no prefix" }), { label: "Lock held", detail: "no prefix" });
assert.equal(promotedParts({ source: "manual", text: "Tests failing: typed by hand" }), null, "a typed blocker is never split");
assert.equal(promotedParts({ source: "Tests failing", text: "3 failed" }), null, "a detector row is not promoted");

// --- Real SQL against SQLite ---

const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE blockers (id INTEGER PRIMARY KEY, cwd TEXT, text TEXT, source TEXT, resolved INTEGER, ts INTEGER)");
const seed = () => {
  db.exec("DELETE FROM blockers");
  const add = db.prepare("INSERT INTO blockers VALUES (?, ?, ?, ?, ?, 0)");
  add.run(1, "/p", "waiting on API key", "manual", 0);
  add.run(2, "/p", "old manual", "manual", 1);
  add.run(3, "/p", "165-/** rate-limit window", "Rate limited", 0);
  add.run(4, "/p", "ls: x: No such file or directory", "Missing file/module", 0);
  add.run(5, "/p", "1 failed", "Tests failing", 1);
  add.run(6, "/q", "need design sign-off", "manual", 0);
  add.run(7, "/q", "EADDRINUSE", "Port in use", 0);
  add.run(8, "/p", "Tests failing: 3 failed", "promoted:Tests failing", 0);
};
const openIn = (cwd: string) =>
  (db.prepare("SELECT id FROM blockers WHERE cwd = ? AND resolved = 0 ORDER BY id").all(cwd) as { id: number }[]).map(
    (r) => r.id
  );

// TS and SQL forms of the tier rule agree on every row.
seed();
const all = db.prepare("SELECT id, source FROM blockers ORDER BY id").all() as { id: number; source: string }[];
const sqlProject = (db.prepare(`SELECT id FROM blockers WHERE ${PROJECT_BLOCKER_SQL} ORDER BY id`).all() as { id: number }[]).map(
  (r) => r.id
);
assert.deepEqual(
  all.filter(isProjectBlocker).map((r) => r.id),
  sqlProject,
  "isProjectBlocker and PROJECT_BLOCKER_SQL must select the same rows"
);
assert.deepEqual(sqlProject, [1, 2, 6, 8], "project tier = typed + promoted rows, never detector rows");

// Tab badge counts: project blockers only.
const counts = db.prepare(sqlAfter("export async function blockerCounts")).all() as { cwd: string; n: number }[];
assert.deepEqual(
  Object.fromEntries(counts.map((r) => [r.cwd, r.n])),
  { "/p": 2, "/q": 1 },
  "detector rows must not count toward tab badges; promoted rows do"
);

// Project clear-all leaves detected rows open, and other projects alone.
db.prepare(sqlAfter("export async function resolveAllBlockers")).run("/p");
assert.deepEqual(openIn("/p"), [3, 4], "clear all must leave detected rows open");
assert.deepEqual(openIn("/q"), [6, 7], "clear all must not touch another project");

// Clear detected leaves project blockers open, and other projects alone.
seed();
db.prepare(sqlAfter("export async function resolveDetectedBlockers")).run("/p");
assert.deepEqual(openIn("/p"), [1, 8], "clear detected must leave project blockers (typed and promoted) open");
assert.deepEqual(openIn("/q"), [6, 7], "clear detected must not touch another project");

console.log("blockers-check: all assertions passed");
