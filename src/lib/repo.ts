import Database from "@tauri-apps/plugin-sql";
import type { Blocker, Bookmark, Decision, ExtractorSettings, Note, ReentryCandidate, ToolEvent } from "../types";
import type { ExtractedDecision } from "./extractor";

let db: Database | null = null;

async function getDb(): Promise<Database> {
  if (!db) db = await Database.load("sqlite:context-terminal.db");
  return db;
}

export async function listBookmarks(): Promise<Bookmark[]> {
  const d = await getDb();
  return d.select<Bookmark[]>("SELECT * FROM bookmarks ORDER BY position");
}

export async function addBookmark(name: string, cwd: string, color: string): Promise<void> {
  const d = await getDb();
  await d.execute(
    "INSERT INTO bookmarks (name, cwd, color, position) VALUES ($1, $2, $3, (SELECT COALESCE(MAX(position), 0) + 1 FROM bookmarks))",
    [name, cwd, color]
  );
}

export async function updateBookmark(b: Bookmark): Promise<void> {
  const d = await getDb();
  await d.execute("UPDATE bookmarks SET name = $1, cwd = $2, color = $3 WHERE id = $4", [
    b.name,
    b.cwd,
    b.color,
    b.id,
  ]);
}

export async function deleteBookmark(id: number): Promise<void> {
  const d = await getDb();
  await d.execute("DELETE FROM bookmarks WHERE id = $1", [id]);
}

/** Persist a drag-reorder: positions follow the given id order. */
export async function reorderBookmarks(ids: number[]): Promise<void> {
  const d = await getDb();
  for (let i = 0; i < ids.length; i++) {
    await d.execute("UPDATE bookmarks SET position = $1 WHERE id = $2", [i + 1, ids[i]]);
  }
}

/** Duplicate deliveries collapse to one row within this window; two real
 * events of the same type/session (e.g. two Stops) are always well over a
 * second apart, so this never eats a legitimate one. See docs/ROADMAP.md
 * "Events dedupe key". */
const DEDUPE_BUCKET_MS = 500;

/** Dedupe key for the events table. `tool_use_id` (PostToolUse) is a natural
 * id straight from the Anthropic API — unique per real tool call, immune to
 * concurrent subagents sharing one session_id, so it's used alone with no
 * time bucket. Types without one (Stop, Notification, UserPromptSubmit,
 * transcript lines) fall back to session + agent_id (disambiguates
 * concurrent subagents, which share the parent session_id) + full payload +
 * a coarse time bucket — content alone would collapse every same-session
 * Stop into one row, since a Stop payload carries no per-turn field today. */
export function dedupeKey(sessionId: string, type: string, payloadJson: string, ts: number): string {
  let toolUseId: string | undefined;
  let agentId: string | undefined;
  try {
    const p = JSON.parse(payloadJson) as Record<string, unknown>;
    if (typeof p.tool_use_id === "string") toolUseId = p.tool_use_id;
    if (typeof p.agent_id === "string") agentId = p.agent_id;
  } catch {
    // opaque payload (e.g. a malformed transcript line) — no natural id
  }
  if (toolUseId) return `${type}|${sessionId}|tool:${toolUseId}`;
  const bucket = Math.floor(ts / DEDUPE_BUCKET_MS);
  return `${type}|${sessionId}|agent:${agentId ?? ""}|${bucket}|${payloadJson}`;
}

export async function addEvent(sessionId: string, type: string, payloadJson: string): Promise<void> {
  const d = await getDb();
  const ts = Date.now();
  await d.execute(
    "INSERT OR IGNORE INTO events (session_id, type, payload_json, ts, dedupe_key) VALUES ($1, $2, $3, $4, $5)",
    [sessionId, type, payloadJson, ts, dedupeKey(sessionId, type, payloadJson, ts)]
  );
}

/** Accomplished panel: recent tool uses for a project, straight off the events table. */
export async function listToolEvents(cwd: string, limit = 50): Promise<ToolEvent[]> {
  const d = await getDb();
  const rows = await d.select<{ id: number; ts: number; payload_json: string }[]>(
    `SELECT id, ts, payload_json FROM events
     WHERE type = 'hook:PostToolUse' AND json_extract(payload_json, '$.cwd') = $1
     ORDER BY ts DESC LIMIT $2`,
    [cwd, limit]
  );
  const VERB: Record<string, string> = {
    Edit: "Edited",
    Write: "Wrote",
    Read: "Read",
    NotebookEdit: "Edited",
    Grep: "Searched",
    Glob: "Searched",
  };
  const base = (p: string) => p.split("/").filter(Boolean).pop() ?? p;
  return rows.map((r) => {
    let tool = "?";
    let detail = "";
    let plain = "";
    try {
      const p = JSON.parse(r.payload_json) as Record<string, unknown>;
      tool = typeof p.tool_name === "string" ? p.tool_name : "?";
      const input = (p.tool_input ?? {}) as Record<string, unknown>;
      const filePath = typeof input.file_path === "string" ? input.file_path : "";
      const command = typeof input.command === "string" ? input.command : "";
      const description = typeof input.description === "string" ? input.description : "";
      detail = filePath || command || description || "";
      // Plain-English headline: hook descriptions first (Bash sends one),
      // else verb + filename, else the tool name.
      plain =
        description ||
        (filePath ? `${VERB[tool] ?? tool} ${base(filePath)}` : "") ||
        (command ? `Ran ${command.slice(0, 60)}` : tool);
    } catch {
      // keep defaults
    }
    return { id: r.id, ts: r.ts, tool, detail, plain };
  });
}

/** Accomplished panel headline: results that finished on this project but
 * haven't been claimed (switched to / focused) since. */
export async function unclaimedResults(cwd: string): Promise<{ session_id: string; ts: number }[]> {
  const d = await getDb();
  return d.select<{ session_id: string; ts: number }[]>(
    `SELECT l.session_id, MAX(l.ts) AS ts
     FROM events l
     WHERE l.type = 'result_landed'
       AND json_extract(l.payload_json, '$.cwd') = $1
       AND NOT EXISTS (
         SELECT 1 FROM events c
         WHERE c.type = 'result_claimed' AND c.session_id = l.session_id AND c.ts > l.ts
       )
     GROUP BY l.session_id
     ORDER BY ts DESC`,
    [cwd]
  );
}

/** Every session holding an unclaimed result, across all projects. Startup
 * seeds the in-memory unclaimed flags from this: `claimTab` reads that set and
 * not the DB, so a result that outlived a quit is otherwise unclaimable. */
export async function unclaimedSessions(): Promise<Set<string>> {
  const d = await getDb();
  const rows = await d.select<{ session_id: string }[]>(
    `SELECT DISTINCT l.session_id
     FROM events l
     WHERE l.type = 'result_landed'
       AND NOT EXISTS (
         SELECT 1 FROM events c
         WHERE c.type = 'result_claimed' AND c.session_id = l.session_id AND c.ts > l.ts
       )`
  );
  return new Set(rows.map((r) => r.session_id));
}

export async function listBlockers(cwd: string): Promise<Blocker[]> {
  const d = await getDb();
  return d.select<Blocker[]>(
    "SELECT * FROM blockers WHERE cwd = $1 ORDER BY resolved, ts DESC LIMIT 100",
    [cwd]
  );
}

/** Dedupe while unresolved: manual entries by text, detector entries by detector label. */
export async function addBlocker(cwd: string, text: string, source: string): Promise<void> {
  const d = await getDb();
  await d.execute(
    `INSERT INTO blockers (cwd, text, source, resolved, ts)
     SELECT $1, $2, $3, 0, $4
     WHERE NOT EXISTS (
       SELECT 1 FROM blockers
       WHERE cwd = $1 AND resolved = 0
         AND ((source = 'manual' AND text = $2) OR (source != 'manual' AND source = $3))
     )`,
    [cwd, text, source, Date.now()]
  );
}

export async function setBlockerResolved(id: number, resolved: boolean): Promise<void> {
  const d = await getDb();
  await d.execute("UPDATE blockers SET resolved = $1 WHERE id = $2", [resolved ? 1 : 0, id]);
}

export async function deleteBlocker(id: number): Promise<void> {
  const d = await getDb();
  await d.execute("DELETE FROM blockers WHERE id = $1", [id]);
}

export async function insertDecision(
  sessionId: string,
  cwd: string,
  d: ExtractedDecision,
  contextJson: string
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO decisions (session_id, cwd, question, status, user_answer, assumption, context_json, ts)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      sessionId,
      cwd,
      d.question,
      d.answered ? "answered" : "open",
      d.user_answer,
      d.agent_assumption,
      contextJson,
      Date.now(),
    ]
  );
}

export async function listDecisions(cwd: string): Promise<Decision[]> {
  const d = await getDb();
  return d.select<Decision[]>(
    `SELECT * FROM decisions WHERE cwd = $1
     ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, ts DESC LIMIT 100`,
    [cwd]
  );
}

export async function setDecisionStatus(id: number, status: Decision["status"]): Promise<void> {
  const d = await getDb();
  await d.execute("UPDATE decisions SET status = $1 WHERE id = $2", [status, id]);
}

/** Tab badges: open-decision count per project cwd. */
export async function decisionCounts(): Promise<Record<string, number>> {
  const d = await getDb();
  const rows = await d.select<{ cwd: string; n: number }[]>(
    "SELECT cwd, count(*) AS n FROM decisions WHERE status = 'open' GROUP BY cwd"
  );
  return Object.fromEntries(rows.map((r) => [r.cwd, r.n]));
}

export async function getExtractorSettings(): Promise<ExtractorSettings> {
  const d = await getDb();
  const rows = await d.select<{ key: string; value: string }[]>(
    "SELECT key, value FROM settings WHERE key IN ('extractor_backend','lmstudio_url','lmstudio_model')"
  );
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    backend: m["extractor_backend"] === "lmstudio" ? "lmstudio" : "claude",
    lmstudioUrl: m["lmstudio_url"] ?? "http://127.0.0.1:1234",
    lmstudioModel: m["lmstudio_model"] ?? "",
  };
}

export async function setExtractorSettings(s: ExtractorSettings): Promise<void> {
  const d = await getDb();
  const pairs: [string, string][] = [
    ["extractor_backend", s.backend],
    ["lmstudio_url", s.lmstudioUrl],
    ["lmstudio_model", s.lmstudioModel],
  ];
  for (const [k, v] of pairs) {
    await d.execute(
      "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2",
      [k, v]
    );
  }
}

// --- Per-project notification mute (Phase 6): reuses the settings
// key/value table, same pattern as getExtractorSettings/setExtractorSettings. ---

const MUTE_KEY_PREFIX = "mute_notifications:";

export async function isProjectMuted(cwd: string): Promise<boolean> {
  const d = await getDb();
  const rows = await d.select<{ value: string }[]>("SELECT value FROM settings WHERE key = $1", [
    MUTE_KEY_PREFIX + cwd,
  ]);
  return rows[0]?.value === "1";
}

export async function setProjectMuted(cwd: string, muted: boolean): Promise<void> {
  const d = await getDb();
  await d.execute(
    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2",
    [MUTE_KEY_PREFIX + cwd, muted ? "1" : "0"]
  );
}

/** All muted project keys, loaded once and cached by the caller — the hot
 * ingestion path can't block on a DB read before deciding whether to notify. */
export async function mutedProjects(): Promise<Set<string>> {
  const d = await getDb();
  const rows = await d.select<{ key: string }[]>(
    "SELECT key FROM settings WHERE key LIKE $1 AND value = '1'",
    [MUTE_KEY_PREFIX + "%"]
  );
  return new Set(rows.map((r) => r.key.slice(MUTE_KEY_PREFIX.length)));
}

// --- Notes: landing prompts + attention residue (Phase 4) ---

export async function addNote(
  cwd: string,
  kind: Note["kind"],
  body: string,
  sessionId: string | null,
  status: Note["status"] = "open"
): Promise<void> {
  const d = await getDb();
  await d.execute(
    "INSERT INTO notes (cwd, kind, body, status, session_id, ts) VALUES ($1, $2, $3, $4, $5, $6)",
    [cwd, kind, body, status, sessionId, Date.now()]
  );
}

export async function listNotes(cwd: string, kind: Note["kind"]): Promise<Note[]> {
  const d = await getDb();
  return d.select<Note[]>(
    "SELECT * FROM notes WHERE cwd = $1 AND kind = $2 ORDER BY ts DESC LIMIT 100",
    [cwd, kind]
  );
}

export async function setNoteStatus(id: number, status: Note["status"]): Promise<void> {
  const d = await getDb();
  await d.execute("UPDATE notes SET status = $1 WHERE id = $2", [status, id]);
}

/** Momentum + residue: the most recent open landing note for a project, if any. */
export async function latestLandingNote(cwd: string): Promise<Note | null> {
  const d = await getDb();
  const rows = await d.select<Note[]>(
    "SELECT * FROM notes WHERE cwd = $1 AND kind = 'landing' AND status = 'open' AND body != '' ORDER BY ts DESC LIMIT 1",
    [cwd]
  );
  return rows[0] ?? null;
}

/** Landing draft: the session's last few transcript-line payloads, oldest first. */
export async function recentTranscript(sessionId: string, limit = 20): Promise<string[]> {
  const d = await getDb();
  const rows = await d.select<{ payload_json: string }[]>(
    "SELECT payload_json FROM events WHERE session_id = $1 AND type = 'transcript' ORDER BY ts DESC LIMIT $2",
    [sessionId, limit]
  );
  return rows.map((r) => r.payload_json).reverse();
}

// --- Re-entry (Phase 6): one row per Claude session, keyed by the tab's own
// tether uuid so a resumed session (new session_id) is still found under the
// same tab. ---

/** Written on every `SessionStart` for a tethered session. */
export async function upsertSessionBinding(
  sessionId: string,
  tabTether: string,
  projectKey: string,
  cwd: string,
  transcriptPath: string
): Promise<void> {
  const d = await getDb();
  await d.execute(
    `INSERT INTO session_bindings (session_id, tab_tether, project_key, cwd, transcript_path, active, updated_at)
     VALUES ($1, $2, $3, $4, $5, 1, $6)
     ON CONFLICT(session_id) DO UPDATE SET
       tab_tether = $2, project_key = $3, cwd = $4, transcript_path = $5, active = 1, updated_at = $6`,
    [sessionId, tabTether, projectKey, cwd, transcriptPath, Date.now()]
  );
}

/** A tab the user explicitly closed should not ghost back next launch. */
export async function deactivateSessionBinding(tabTether: string): Promise<void> {
  const d = await getDb();
  await d.execute("UPDATE session_bindings SET active = 0 WHERE tab_tether = $1", [tabTether]);
}

interface SessionBindingRow extends ReentryCandidate {
  updated_at: number;
}

/** One row per tether: the most recently updated of its (possibly several,
 * for a tether resumed more than once) active session rows. */
export function latestPerTether(rows: SessionBindingRow[]): ReentryCandidate[] {
  const byTether = new Map<string, SessionBindingRow>();
  for (const r of rows) {
    const cur = byTether.get(r.tab_tether);
    if (!cur || r.updated_at > cur.updated_at) byTether.set(r.tab_tether, r);
  }
  return [...byTether.values()].map(
    ({ session_id, tab_tether, project_key, cwd, transcript_path }) => ({
      session_id,
      tab_tether,
      project_key,
      cwd,
      transcript_path,
    })
  );
}

/** Startup ghost tabs: the most recent active session per tether. */
export async function reentryCandidates(): Promise<ReentryCandidate[]> {
  const d = await getDb();
  const rows = await d.select<SessionBindingRow[]>(
    "SELECT session_id, tab_tether, project_key, cwd, transcript_path, updated_at FROM session_bindings WHERE active = 1"
  );
  return latestPerTether(rows);
}

/** Tab badges: open-blocker count per project cwd. */
export async function blockerCounts(): Promise<Record<string, number>> {
  const d = await getDb();
  const rows = await d.select<{ cwd: string; n: number }[]>(
    "SELECT cwd, count(*) AS n FROM blockers WHERE resolved = 0 GROUP BY cwd"
  );
  return Object.fromEntries(rows.map((r) => [r.cwd, r.n]));
}
