import Database from "@tauri-apps/plugin-sql";
import type { Blocker, Bookmark, Decision, ExtractorSettings, Note, ToolEvent } from "../types";
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

export async function addEvent(sessionId: string, type: string, payloadJson: string): Promise<void> {
  const d = await getDb();
  await d.execute(
    "INSERT INTO events (session_id, type, payload_json, ts) VALUES ($1, $2, $3, $4)",
    [sessionId, type, payloadJson, Date.now()]
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
  return rows.map((r) => {
    let tool = "?";
    let detail = "";
    try {
      const p = JSON.parse(r.payload_json) as Record<string, unknown>;
      tool = typeof p.tool_name === "string" ? p.tool_name : "?";
      const input = (p.tool_input ?? {}) as Record<string, unknown>;
      detail =
        (typeof input.file_path === "string" && input.file_path) ||
        (typeof input.command === "string" && input.command) ||
        (typeof input.description === "string" && input.description) ||
        "";
    } catch {
      // keep defaults
    }
    return { id: r.id, ts: r.ts, tool, detail };
  });
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

/** Tab badges: open-blocker count per project cwd. */
export async function blockerCounts(): Promise<Record<string, number>> {
  const d = await getDb();
  const rows = await d.select<{ cwd: string; n: number }[]>(
    "SELECT cwd, count(*) AS n FROM blockers WHERE resolved = 0 GROUP BY cwd"
  );
  return Object.fromEntries(rows.map((r) => [r.cwd, r.n]));
}
