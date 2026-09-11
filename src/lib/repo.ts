import Database from "@tauri-apps/plugin-sql";
import type {
  Blocker,
  AgentState,
  AttentionEvidence,
  AttentionSourceContext,
  Bookmark,
  Decision,
  ExtractorSettings,
  LandingNoteMode,
  Note,
  PanelMode,
  ReentryCandidate,
  SpawnGroup,
  SpawnGroupMember,
  ToolEvent,
  WorktreeTab,
} from "../types";
import { parseOnboardingVersion } from "./onboarding";
import type { ExtractedDecision } from "./extractor";
import { clampPanelWidth, parsePanelMode, type VisiblePanelMode } from "./panelLayout";
import { parseLandingNoteMode } from "./landingMode";

let db: Database | null = null;
// Lifecycle hooks can arrive concurrently. Keep each raw-hook/derivative pair
// ordered so a later accepted observation cannot overtake its source event.
const hookWriteChains = new Map<string, Promise<void>>();

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

export interface EventWriteResult {
  id: number | null;
  inserted: boolean;
}

async function writeEvent(
  d: Database,
  sessionId: string,
  type: string,
  payloadJson: string,
  ts: number,
  dedupe: string
): Promise<EventWriteResult> {
  const result = await d.execute(
    "INSERT OR IGNORE INTO events (session_id, type, payload_json, ts, dedupe_key) VALUES ($1, $2, $3, $4, $5)",
    [sessionId, type, payloadJson, ts, dedupe]
  );
  const rows = await d.select<{ id: number }[]>("SELECT id FROM events WHERE dedupe_key = $1", [dedupe]);
  return { id: rows[0]?.id ?? result.lastInsertId ?? null, inserted: result.rowsAffected === 1 };
}

/** All event writes use this path so their dedupe key is never skipped. */
export async function addEvent(sessionId: string, type: string, payloadJson: string): Promise<EventWriteResult> {
  const d = await getDb();
  const ts = Date.now();
  return writeEvent(d, sessionId, type, payloadJson, ts, dedupeKey(sessionId, type, payloadJson, ts));
}

export interface AttentionObservation {
  state: AgentState;
  sourceHook: string;
  observedAt: number;
  runId: string;
  projectKey?: string;
  context: AttentionSourceContext;
}

/** Stable across retries of one accepted raw hook, unlike the time-bucketed
 * raw-event dedupe key. This lets a retry repair a failed derivative write
 * without inventing another lifecycle occurrence. */
export function attentionObservationDedupeKey(sessionId: string, sourceEventId: number): string {
  return `attention_state_observed|${sessionId}|source:${sourceEventId}`;
}

export function attentionObservationPayload(
  sessionId: string,
  sourceEventId: number,
  o: AttentionObservation
): string {
  return JSON.stringify({
    v: 1,
    source_event_id: sourceEventId,
    session_id: sessionId,
    state: o.state,
    source_hook: o.sourceHook,
    observed_at: o.observedAt,
    run_id: o.runId,
    project_key: o.projectKey,
    tab_id: o.context.tabId,
    adapter_id: o.context.agent,
    actor_id: o.context.actorId,
  });
}

/** Persist a raw hook and, only when the existing state machine accepted a
 * live parent state, its durable attention observation. Keeping this ordered
 * in the repo layer means duplicate hooks share one source occurrence. */
export async function addHookEvent(
  sessionId: string,
  type: string,
  payloadJson: string,
  observation?: AttentionObservation
): Promise<EventWriteResult> {
  const previous = hookWriteChains.get(sessionId) ?? Promise.resolve();
  const task = previous.catch(() => undefined).then(() => addHookEventNow(sessionId, type, payloadJson, observation));
  const tail = task.then(
    () => undefined,
    () => undefined
  );
  hookWriteChains.set(sessionId, tail);
  try {
    return await task;
  } finally {
    if (hookWriteChains.get(sessionId) === tail) hookWriteChains.delete(sessionId);
  }
}

async function addHookEventNow(
  sessionId: string,
  type: string,
  payloadJson: string,
  observation?: AttentionObservation
): Promise<EventWriteResult> {
  const d = await getDb();
  const ts = Date.now();
  const raw = await writeEvent(d, sessionId, type, payloadJson, ts, dedupeKey(sessionId, type, payloadJson, ts));
  if (!observation || raw.id == null) return raw;
  const payload = attentionObservationPayload(sessionId, raw.id, observation);
  await writeEvent(
    d,
    sessionId,
    "attention_state_observed",
    payload,
    observation.observedAt,
    attentionObservationDedupeKey(sessionId, raw.id)
  );
  return raw;
}

/** Last path segment, for either separator. Agent payloads carry native paths,
 * so a Windows `file_path` arrives backslashed — splitting on `/` alone returned
 * the whole path and the Accomplished panel printed it verbatim. */
export function basename(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

/** Accomplished panel: recent tool uses for a project, straight off the events table. */
export async function listToolEvents(cwd: string, limit = 50): Promise<ToolEvent[]> {
  const d = await getDb();
  const rows = await d.select<{ id: number; ts: number; session_id: string; payload_json: string }[]>(
    `SELECT id, ts, session_id, payload_json FROM events
     WHERE type = 'hook:PostToolUse' AND json_extract(payload_json, '$.cwd') = $1
     ORDER BY ts DESC LIMIT $2`,
    [cwd, limit]
  );
  // Tools that write the file they name. A Read/Grep row also carries a
  // `file_path`, but there is no change to show for one — keeping the diffable
  // set here means the panel never has to decide which rows are clickable.
  const WRITES = new Set(["Edit", "Write", "NotebookEdit", "MultiEdit"]);
  const VERB: Record<string, string> = {
    Edit: "Edited",
    Write: "Wrote",
    Read: "Read",
    NotebookEdit: "Edited",
    Grep: "Searched",
    Glob: "Searched",
    // Antigravity's own tool names (Phase 16) — tool_input's file_path/
    // command/description are normalized in antigravity.rs's translate().
    run_command: "Ran",
    write_to_file: "Wrote",
    replace_file_content: "Edited",
    view_file: "Read",
    grep_search: "Searched",
    find_by_name: "Searched",
  };
  return rows.map((r) => {
    let tool = "?";
    let detail = "";
    let plain = "";
    let written = "";
    try {
      const p = JSON.parse(r.payload_json) as Record<string, unknown>;
      tool = typeof p.tool_name === "string" ? p.tool_name : "?";
      const input = (p.tool_input ?? {}) as Record<string, unknown>;
      const filePath = typeof input.file_path === "string" ? input.file_path : "";
      const command = typeof input.command === "string" ? input.command : "";
      const description = typeof input.description === "string" ? input.description : "";
      detail = filePath || command || description || "";
      written = WRITES.has(tool) ? filePath : "";
      // Plain-English headline: hook descriptions first (Bash sends one),
      // else verb + filename, else the tool name.
      plain =
        description ||
        (filePath ? `${VERB[tool] ?? tool} ${basename(filePath)}` : "") ||
        (command ? `Ran ${command.slice(0, 60)}` : tool);
    } catch {
      // keep defaults
    }
    return { id: r.id, ts: r.ts, session_id: r.session_id, tool, detail, plain, filePath: written };
  });
}

/** Scope cwd-wide rows down to one tab's own session. Fan-out siblings (and
 * any two tabs open on the same project) share a cwd, so the project-wide
 * queries above return every session's rows — this is the filter that keeps
 * a tab's panel from showing a sibling's decisions/tool activity.
 * `sessionId` null (no hook has bound a session to this tab yet — a plain
 * shell with no agent, or a tab that hasn't reported in) falls back to the
 * unfiltered cwd-wide list, matching the existing untethered-session
 * fallback used elsewhere in the app. */
export function scopeBySession<T extends { session_id: string }>(
  rows: T[],
  sessionId: string | null
): T[] {
  if (!sessionId) return rows;
  return rows.filter((r) => r.session_id === sessionId);
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

interface AttentionEvidenceRow {
  id: string;
  kind: AttentionEvidence["kind"];
  project_key: string;
  session_id: string | null;
  tab_id: string | null;
  adapter_id: string | null;
  actor_id: string | null;
  created_at: number;
  last_activity_at: number | null;
  text: string;
  evidence_id: number | null;
  run_id: string | null;
  observed_state: AgentState | null;
  archived: number;
}

const ATTENTION_INTERACTION_SESSION = "__logic_loop_attention__";

export function attentionInteractionPayload(targetIds: string[], operationId: string): string {
  const unique = [...new Set(targetIds.filter((id) => id.length > 0))];
  if (unique.length === 0) throw new Error("Attention interaction requires at least one target");
  return JSON.stringify({ v: 1, operation_id: operationId, target_ids: unique });
}

/** Archive state is separate from source obligation state and is occurrence-scoped. */
export async function setAttentionArchived(targetIds: string[], archived: boolean): Promise<void> {
  const payload = attentionInteractionPayload(targetIds, crypto.randomUUID());
  await addEvent(ATTENTION_INTERACTION_SESSION, archived ? "attention_archived" : "attention_unarchived", payload);
}

/** One global read over durable obligations plus the latest lifecycle evidence
 * for this App run. Live-tab eligibility and safe routing remain pure UI-side
 * derivations because the database cannot prove a PTY is still alive. */
export async function listAttentionEvidence(runId: string): Promise<AttentionEvidence[]> {
  const d = await getDb();
  const rows = await d.select<AttentionEvidenceRow[]>(
    `WITH valid_events AS (
       SELECT id, session_id, type, payload_json, ts
       FROM events
       WHERE json_valid(payload_json)
     ),
     outstanding_results AS (
       SELECT l.*,
              ROW_NUMBER() OVER (PARTITION BY l.session_id ORDER BY l.ts DESC, l.id DESC) AS rn
       FROM valid_events l
       WHERE l.type = 'result_landed'
         AND COALESCE(json_extract(l.payload_json, '$.project_key'), json_extract(l.payload_json, '$.cwd')) IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM events c
           WHERE c.type = 'result_claimed' AND c.session_id = l.session_id AND c.ts > l.ts
         )
     ),
     run_observations AS (
       SELECT e.*,
              ROW_NUMBER() OVER (
                PARTITION BY e.session_id
                ORDER BY CAST(json_extract(e.payload_json, '$.observed_at') AS INTEGER) DESC, e.id DESC
              ) AS rn
       FROM valid_events e
       WHERE e.type = 'attention_state_observed'
         AND json_extract(e.payload_json, '$.run_id') = $1
     ),
     source_evidence AS (
       SELECT 'decision:' || id AS id,
            'decision' AS kind,
            cwd AS project_key,
            session_id,
            tab_id,
            agent AS adapter_id,
            actor_id,
            ts AS created_at,
            NULL AS last_activity_at,
            question AS text,
            id AS evidence_id,
            NULL AS run_id,
            NULL AS observed_state
     FROM decisions
     WHERE status = 'open'
     UNION ALL
     SELECT 'blocker:' || id,
            'blocker',
            cwd,
            session_id,
            tab_id,
            agent,
            actor_id,
            ts,
            NULL,
            text,
            id,
            NULL,
            NULL
     FROM blockers
     WHERE resolved = 0
     UNION ALL
     SELECT 'result:' || id,
            'result',
            COALESCE(json_extract(payload_json, '$.project_key'), json_extract(payload_json, '$.cwd')),
            session_id,
            json_extract(payload_json, '$.tab_id'),
            json_extract(payload_json, '$.adapter_id'),
            json_extract(payload_json, '$.actor_id'),
            ts,
            ts,
            'Result ready to review',
            id,
            NULL,
            NULL
     FROM outstanding_results
     WHERE rn = 1
     UNION ALL
     SELECT CASE json_extract(payload_json, '$.state')
              WHEN 'waiting' THEN 'waiting:'
              ELSE 'stalled:'
            END || CAST(json_extract(payload_json, '$.source_event_id') AS TEXT),
            CASE json_extract(payload_json, '$.state')
              WHEN 'waiting' THEN 'waiting'
              ELSE 'stalled'
            END,
            json_extract(payload_json, '$.project_key'),
            session_id,
            json_extract(payload_json, '$.tab_id'),
            json_extract(payload_json, '$.adapter_id'),
            json_extract(payload_json, '$.actor_id'),
            CAST(json_extract(payload_json, '$.observed_at') AS INTEGER),
            CAST(json_extract(payload_json, '$.observed_at') AS INTEGER),
            CASE json_extract(payload_json, '$.state')
              WHEN 'waiting' THEN 'Agent is waiting for input'
              ELSE 'No observed activity for 3m'
            END,
            CAST(json_extract(payload_json, '$.source_event_id') AS INTEGER),
            json_extract(payload_json, '$.run_id'),
            json_extract(payload_json, '$.state')
       FROM run_observations
       WHERE rn = 1
         AND json_extract(payload_json, '$.project_key') IS NOT NULL
         AND json_extract(payload_json, '$.source_event_id') IS NOT NULL
         AND json_extract(payload_json, '$.state') IN ('waiting', 'working')
     ),
     interaction_targets AS (
       SELECT e.id AS interaction_id,
              e.ts,
              target.value AS target_id,
              CASE e.type WHEN 'attention_archived' THEN 1 ELSE 0 END AS archived
       FROM valid_events e, json_each(e.payload_json, '$.target_ids') AS target
       WHERE e.type IN ('attention_archived', 'attention_unarchived')
         AND json_type(e.payload_json, '$.target_ids') = 'array'
         AND typeof(target.value) = 'text'
         AND target.value <> ''
     ),
     latest_interactions AS (
       SELECT *,
              ROW_NUMBER() OVER (PARTITION BY target_id ORDER BY ts DESC, interaction_id DESC) AS rn
       FROM interaction_targets
     )
     SELECT source_evidence.*,
            CASE WHEN latest_interactions.archived = 1 THEN 1 ELSE 0 END AS archived
     FROM source_evidence
     LEFT JOIN latest_interactions
       ON latest_interactions.target_id = source_evidence.id
      AND latest_interactions.rn = 1`,
    [runId]
  );
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    projectKey: row.project_key,
    sessionId: row.session_id,
    tabId: row.tab_id,
    adapterId: row.adapter_id,
    actorId: row.actor_id,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
    text: row.text,
    evidenceId: row.evidence_id,
    runId: row.run_id,
    observedState: row.observed_state,
    archived: row.archived === 1,
  }));
}

export async function listBlockers(cwd: string): Promise<Blocker[]> {
  const d = await getDb();
  return d.select<Blocker[]>(
    "SELECT * FROM blockers WHERE cwd = $1 ORDER BY resolved, ts DESC LIMIT 100",
    [cwd]
  );
}

/** Dedupe while unresolved: manual entries by text, detector entries by
 * project + session + detector label so sibling agents remain distinct. */
export async function addBlocker(
  cwd: string,
  text: string,
  source: string,
  context: AttentionSourceContext = {}
): Promise<void> {
  const d = await getDb();
  await d.execute(
    `INSERT INTO blockers (cwd, text, source, resolved, ts, session_id, tab_id, agent, actor_id)
     SELECT $1, $2, $3, 0, $4, $5, $6, $7, $8
     WHERE NOT EXISTS (
       SELECT 1 FROM blockers
       WHERE cwd = $1 AND resolved = 0
         AND (
           (source = 'manual' AND text = $2)
           OR (source != 'manual' AND source = $3 AND session_id IS $5)
         )
     )`,
    [
      cwd,
      text,
      source,
      Date.now(),
      context.sessionId ?? null,
      context.tabId ?? null,
      context.agent ?? null,
      context.actorId ?? null,
    ]
  );
}

export async function setBlockerResolved(id: number, resolved: boolean): Promise<void> {
  const d = await getDb();
  await d.execute("UPDATE blockers SET resolved = $1 WHERE id = $2", [resolved ? 1 : 0, id]);
}

/** Resolve every open blocker for one project while preserving blocker history. */
export async function resolveAllBlockers(cwd: string): Promise<void> {
  const d = await getDb();
  await d.execute("UPDATE blockers SET resolved = 1 WHERE cwd = $1 AND resolved = 0", [cwd]);
}

export async function deleteBlocker(id: number): Promise<void> {
  const d = await getDb();
  await d.execute("DELETE FROM blockers WHERE id = $1", [id]);
}

export async function insertDecision(
  sessionId: string,
  cwd: string,
  d: ExtractedDecision,
  contextJson: string,
  context: AttentionSourceContext = {}
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO decisions (session_id, cwd, question, status, user_answer, assumption, context_json, ts, tab_id, agent, actor_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      sessionId,
      cwd,
      d.question,
      d.answered ? "answered" : "open",
      d.user_answer,
      d.agent_assumption,
      contextJson,
      Date.now(),
      context.tabId ?? null,
      context.agent ?? null,
      context.actorId ?? null,
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

export interface DecisionSessionGroup {
  session_id: string;
  n: number;
  min_ts: number;
  max_ts: number;
}

/** Per-session open-decision clusters for one project, newest first. */
export async function decisionsBySession(cwd: string): Promise<DecisionSessionGroup[]> {
  const d = await getDb();
  return d.select<DecisionSessionGroup[]>(
    `SELECT session_id, count(*) AS n, min(ts) AS min_ts, max(ts) AS max_ts
     FROM decisions WHERE cwd = $1 AND status = 'open'
     GROUP BY session_id ORDER BY max_ts DESC`,
    [cwd]
  );
}

/** Bulk-dismiss every open decision in one session — same "not a real
 * decision" semantic as the per-row ✕ (`setDecisionStatus(id, "dismissed")`),
 * just applied to a whole cluster at once. */
export async function dismissSession(sessionId: string): Promise<void> {
  const d = await getDb();
  await d.execute("UPDATE decisions SET status = 'dismissed' WHERE session_id = $1 AND status = 'open'", [
    sessionId,
  ]);
}

/** Pure grouping step for the open-decisions list, newest cluster first.
 * Exported for `decisions-check.ts` — no DB round trip needed since
 * `listDecisions` already has everything. */
export function groupDecisionsBySession(open: Decision[]): DecisionSessionGroup[] {
  const bySession = new Map<string, Decision[]>();
  for (const d of open) {
    const list = bySession.get(d.session_id);
    if (list) list.push(d);
    else bySession.set(d.session_id, [d]);
  }
  return [...bySession.entries()]
    .map(([session_id, ds]) => ({
      session_id,
      n: ds.length,
      min_ts: Math.min(...ds.map((d) => d.ts)),
      max_ts: Math.max(...ds.map((d) => d.ts)),
    }))
    .sort((a, b) => b.max_ts - a.max_ts);
}

export async function getExtractorSettings(): Promise<ExtractorSettings> {
  const d = await getDb();
  const rows = await d.select<{ key: string; value: string }[]>(
    "SELECT key, value FROM settings WHERE key IN ('extractor_backend','lmstudio_url','lmstudio_model','codex_model')"
  );
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    backend:
      m["extractor_backend"] === "lmstudio"
        ? "lmstudio"
        : m["extractor_backend"] === "codex"
          ? "codex"
          : "claude",
    lmstudioUrl: m["lmstudio_url"] ?? "http://127.0.0.1:1234",
    lmstudioModel: m["lmstudio_model"] ?? "",
    codexModel: m["codex_model"] ?? "",
  };
}

export async function setExtractorSettings(s: ExtractorSettings): Promise<void> {
  const d = await getDb();
  const pairs: [string, string][] = [
    ["extractor_backend", s.backend],
    ["lmstudio_url", s.lmstudioUrl],
    ["lmstudio_model", s.lmstudioModel],
    ["codex_model", s.codexModel],
  ];
  for (const [k, v] of pairs) {
    await d.execute(
      "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2",
      [k, v]
    );
  }
}

// --- Global side-panel presentation (Phase 25): stored in the existing
// settings table. Layout is global because it describes the app shell, not a
// project's semantic state. ---

const PANEL_MODE_KEY = "panel_mode";
const PANEL_LAST_VISIBLE_MODE_KEY = "panel_last_visible_mode";
const PANEL_WIDTH_KEY = "panel_width";

async function getSetting(key: string): Promise<string | null> {
  const d = await getDb();
  const rows = await d.select<{ value: string }[]>("SELECT value FROM settings WHERE key = $1", [key]);
  return rows[0]?.value ?? null;
}

async function setSetting(key: string, value: string): Promise<void> {
  const d = await getDb();
  await d.execute(
    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2",
    [key, value]
  );
}

const ONBOARDING_VERSION_KEY = "onboarding_version";

export async function getOnboardingVersion(): Promise<number> {
  return parseOnboardingVersion(await getSetting(ONBOARDING_VERSION_KEY));
}

export async function setOnboardingVersion(version: number): Promise<void> {
  const safeVersion = Number.isSafeInteger(version) && version >= 0 ? version : 0;
  await setSetting(ONBOARDING_VERSION_KEY, String(safeVersion));
}

export async function getPanelMode(): Promise<PanelMode> {
  return parsePanelMode(await getSetting(PANEL_MODE_KEY));
}

export async function setPanelMode(mode: PanelMode): Promise<void> {
  await setSetting(PANEL_MODE_KEY, mode);
}

export async function getPanelLastVisibleMode(): Promise<VisiblePanelMode> {
  const mode = parsePanelMode(await getSetting(PANEL_LAST_VISIBLE_MODE_KEY));
  return mode === "compact" ? "compact" : "expanded";
}

export async function setPanelLastVisibleMode(mode: VisiblePanelMode): Promise<void> {
  await setSetting(PANEL_LAST_VISIBLE_MODE_KEY, mode);
}

export async function getPanelWidth(): Promise<number> {
  const value = await getSetting(PANEL_WIDTH_KEY);
  return clampPanelWidth(Number(value ?? Number.NaN));
}

export async function setPanelWidth(width: number): Promise<void> {
  await setSetting(PANEL_WIDTH_KEY, String(Math.round(clampPanelWidth(width))));
}

// Landing-note capture is a global shell preference, like panel layout. Notes
// themselves remain project-scoped in the notes table below.
const LANDING_NOTE_MODE_KEY = "landing_note_mode";

export async function getLandingNoteMode(): Promise<LandingNoteMode> {
  return parseLandingNoteMode(await getSetting(LANDING_NOTE_MODE_KEY));
}

export async function setLandingNoteMode(mode: LandingNoteMode): Promise<void> {
  await setSetting(LANDING_NOTE_MODE_KEY, mode);
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

// --- Idea Board (Phase 18): per-project collapsed/height, same settings-
// table pattern as project mute above. ---

const BOARD_COLLAPSED_PREFIX = "board_collapsed:";
const BOARD_HEIGHT_PREFIX = "board_height:";

export async function getBoardCollapsed(cwd: string): Promise<boolean> {
  const d = await getDb();
  const rows = await d.select<{ value: string }[]>("SELECT value FROM settings WHERE key = $1", [
    BOARD_COLLAPSED_PREFIX + cwd,
  ]);
  return rows[0]?.value !== "0"; // collapsed by default until the user opens it once
}

export async function setBoardCollapsed(cwd: string, collapsed: boolean): Promise<void> {
  const d = await getDb();
  await d.execute(
    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2",
    [BOARD_COLLAPSED_PREFIX + cwd, collapsed ? "1" : "0"]
  );
}

export async function getBoardHeight(cwd: string): Promise<number | null> {
  const d = await getDb();
  const rows = await d.select<{ value: string }[]>("SELECT value FROM settings WHERE key = $1", [
    BOARD_HEIGHT_PREFIX + cwd,
  ]);
  const n = rows[0] ? Number(rows[0].value) : NaN;
  return Number.isFinite(n) ? n : null;
}

export async function setBoardHeight(cwd: string, height: number): Promise<void> {
  const d = await getDb();
  await d.execute(
    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2",
    [BOARD_HEIGHT_PREFIX + cwd, String(Math.round(height))]
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

// --- Since-you-left delta (Phase 14a): a `tab_left` event marks the anchor;
// everything after it is the digest. Keyed by tab tether (survives
// `--resume` whether or not session_id changes), with a session_id fallback
// for rows that never carry a tab_id (outside-terminal sessions bound by cwd
// fallback, and every `transcript` row, whose JSON has no tab_id key). ---

/** Most recent moment the human left this tab, or null if never (first visit
 * — the landing note's job, not this one). */
export async function lastLeft(tether: string): Promise<number | null> {
  const d = await getDb();
  const rows = await d.select<{ ts: number | null }[]>(
    `SELECT MAX(ts) AS ts FROM events WHERE type = 'tab_left' AND json_extract(payload_json, '$.tab_id') = $1`,
    [tether]
  );
  return rows[0]?.ts ?? null;
}

/** Every event on this tab's own session since `since`, oldest first —
 * the raw material `summarizeDelta` reduces. */
export async function eventsSince(
  tether: string,
  sessionId: string | null,
  since: number
): Promise<{ id: number; ts: number; type: string; payload_json: string }[]> {
  const d = await getDb();
  return d.select<{ id: number; ts: number; type: string; payload_json: string }[]>(
    `SELECT id, ts, type, payload_json FROM events
     WHERE ts > $1
       AND (
         json_extract(payload_json, '$.tab_id') = $2
         OR (json_extract(payload_json, '$.tab_id') IS NULL AND session_id = $3)
       )
     ORDER BY ts ASC`,
    [since, tether, sessionId ?? ""]
  );
}

/** Decisions opened on this project since `since` — scope to the tab's own
 * session with `scopeBySession` at the call site, same as every other
 * cwd-wide read. */
export async function decisionsOpenedSince(cwd: string, since: number): Promise<Decision[]> {
  const d = await getDb();
  return d.select<Decision[]>(
    `SELECT * FROM decisions WHERE cwd = $1 AND status = 'open' AND ts > $2 ORDER BY ts DESC`,
    [cwd, since]
  );
}

// --- Re-entry (Phase 6): one row per Claude session, keyed by the tab's own
// tether uuid so a resumed session (new session_id) is still found under the
// same tab. ---

/** Written on every `SessionStart` for a tethered session. `agent` is the
 * adapter marker from the hook payload (see `types.ts`'s `HookPayload.agent`)
 * — undefined for Claude and any adapter without one yet; stored as NULL,
 * same as a legacy pre-adapter row. */
export async function upsertSessionBinding(
  sessionId: string,
  tabTether: string,
  projectKey: string,
  cwd: string,
  transcriptPath: string,
  agent?: string,
  tabTitle?: string,
  tabColor?: string
): Promise<void> {
  const d = await getDb();
  await d.execute(
    `INSERT INTO session_bindings
       (session_id, tab_tether, project_key, cwd, transcript_path, agent, tab_title, tab_color, active, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9)
     ON CONFLICT(session_id) DO UPDATE SET
       tab_tether = $2, project_key = $3, cwd = $4, transcript_path = $5, agent = $6,
       tab_title = $7, tab_color = $8, active = 1, updated_at = $9`,
    [
      sessionId,
      tabTether,
      projectKey,
      cwd,
      transcriptPath,
      agent ?? null,
      tabTitle ?? null,
      tabColor ?? null,
      Date.now(),
    ]
  );
}

/** A tab the user explicitly closed should not ghost back next launch. */
export async function deactivateSessionBinding(tabTether: string): Promise<void> {
  const d = await getDb();
  await d.execute("UPDATE session_bindings SET active = 0 WHERE tab_tether = $1", [tabTether]);
}

interface SessionBindingRow extends Omit<ReentryCandidate, "agent" | "tab_title" | "tab_color"> {
  updated_at: number;
  agent?: string | null;
  tab_title?: string | null;
  tab_color?: string | null;
}

function nonBlank(value: string | null | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  return value;
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
    ({ session_id, tab_tether, project_key, cwd, transcript_path, agent, tab_title, tab_color }) => ({
      session_id,
      tab_tether,
      project_key,
      cwd,
      transcript_path,
      tab_title: nonBlank(tab_title),
      tab_color: nonBlank(tab_color),
      agent: agent ?? undefined,
    })
  );
}

/** Startup ghost tabs: the most recent active session per tether. */
export async function reentryCandidates(): Promise<ReentryCandidate[]> {
  const d = await getDb();
  const rows = await d.select<SessionBindingRow[]>(
    `SELECT session_id, tab_tether, project_key, cwd, transcript_path, agent,
            tab_title, tab_color, updated_at
     FROM session_bindings WHERE active = 1`
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

// --- Fan-out spawn groups (Phase 7): rollup is a dumb SQL view over these two
// tables plus the existing events table — no new intelligence, no new event
// types (invariant #3). ---

export async function createSpawnGroup(
  id: string,
  parentTabId: string,
  label: string | null
): Promise<void> {
  const d = await getDb();
  await d.execute(
    "INSERT INTO spawn_groups (id, parent_tab_id, label, created_at) VALUES ($1, $2, $3, $4)",
    [id, parentTabId, label, Date.now()]
  );
}

export async function addSpawnMember(
  groupId: string,
  childTabId: string,
  cmd: string | null
): Promise<void> {
  const d = await getDb();
  await d.execute(
    "INSERT INTO spawn_group_members (group_id, child_tab_id, cmd, created_at) VALUES ($1, $2, $3, $4)",
    [groupId, childTabId, cmd, Date.now()]
  );
}

/** Pure lookup, split out from `groupsForTab` the same way `latestPerTether`
 * is split from `reentryCandidates` — so the round-trip logic is testable
 * without a live DB. A tab matches as parent (owns the group — possibly more
 * than one, if you fan out again from the same tab before clearing the last
 * one) or as a member (child_tab_id in spawn_group_members, at most one group
 * — a child tab is only ever created by a single launch). Parent groups sort
 * oldest-first: the original fan-out stays the one you land on, newer ones
 * push down rather than silently replacing it (the bug this fixes — a second
 * fan-out from the same tab used to be invisible until the first was fully
 * dismissed, since the old lookup returned only a single first-match). */
export function findGroupsForTab(
  tabId: string,
  groups: SpawnGroup[],
  members: SpawnGroupMember[]
): SpawnGroup[] {
  const asParent = groups
    .filter((g) => g.parent_tab_id === tabId)
    .sort((a, b) => a.created_at - b.created_at);
  if (asParent.length > 0) return asParent;
  const membership = members.find((m) => m.child_tab_id === tabId);
  if (!membership) return [];
  const group = groups.find((g) => g.id === membership.group_id);
  return group ? [group] : [];
}

/** Every group a tab belongs to, as parent or child — empty if it's in neither role. */
export async function groupsForTab(tabId: string): Promise<SpawnGroup[]> {
  const d = await getDb();
  const groups = await d.select<SpawnGroup[]>("SELECT * FROM spawn_groups");
  const members = await d.select<SpawnGroupMember[]>("SELECT * FROM spawn_group_members");
  return findGroupsForTab(tabId, groups, members);
}

/** Drop one child from its group (dismiss a lingering row from the rollup).
 * If that was the last member, the group itself is deleted too — an empty
 * group has nothing left to roll up and would otherwise sit orphaned in
 * `spawn_groups` forever with no card to show it on. */
export async function removeSpawnMember(groupId: string, childTabId: string): Promise<void> {
  const d = await getDb();
  await d.execute("DELETE FROM spawn_group_members WHERE group_id = $1 AND child_tab_id = $2", [
    groupId,
    childTabId,
  ]);
  const remaining = await d.select<{ n: number }[]>(
    "SELECT count(*) AS n FROM spawn_group_members WHERE group_id = $1",
    [groupId]
  );
  if ((remaining[0]?.n ?? 0) === 0) {
    await d.execute("DELETE FROM spawn_groups WHERE id = $1", [groupId]);
  }
}

/** Every tab that is a fan-out child in any group, regardless of which tab is
 * active — the tab-strip glow needs all of them at once, not just the
 * active tab's own rollup. */
export async function allFanOutChildTabIds(): Promise<string[]> {
  const d = await getDb();
  const rows = await d.select<{ child_tab_id: string }[]>(
    "SELECT DISTINCT child_tab_id FROM spawn_group_members"
  );
  return rows.map((r) => r.child_tab_id);
}

/** Every tab that is a fan-out parent (origin) in any group — ties the glow
 * back the other direction so the launching tab stays visually linked to its
 * children after they spawn. */
export async function allFanOutParentTabIds(): Promise<string[]> {
  const d = await getDb();
  const rows = await d.select<{ parent_tab_id: string }[]>(
    "SELECT DISTINCT parent_tab_id FROM spawn_groups"
  );
  return rows.map((r) => r.parent_tab_id);
}

export async function groupMembers(groupId: string): Promise<SpawnGroupMember[]> {
  const d = await getDb();
  return d.select<SpawnGroupMember[]>(
    "SELECT * FROM spawn_group_members WHERE group_id = $1 ORDER BY created_at",
    [groupId]
  );
}

/** Whether this session has ever landed a result, claimed or not — the
 * rollup's "done" status needs this (not just `unclaimedResults`) to tell
 * "finished and claimed" apart from "still running", and it must survive a
 * restart, so it reads the persisted events table rather than in-memory
 * `unseenStops`. */
export async function hasLandedResult(sessionId: string): Promise<boolean> {
  const d = await getDb();
  const rows = await d.select<{ n: number }[]>(
    "SELECT count(*) AS n FROM events WHERE type = 'result_landed' AND session_id = $1",
    [sessionId]
  );
  return (rows[0]?.n ?? 0) > 0;
}

// --- Worktree-bound tabs (Phase 9 "Isolate loop"): a lookup table, not a
// state machine (invariant #3) — close-time cleanup and re-entry both need
// to know a tab is worktree-bound even after a relaunch. ---

export async function createWorktreeTab(
  tabId: string,
  repoCwd: string,
  worktreePath: string,
  branch: string
): Promise<void> {
  const d = await getDb();
  await d.execute(
    "INSERT INTO worktree_tabs (tab_id, repo_cwd, worktree_path, branch, created_at) VALUES ($1, $2, $3, $4, $5)",
    [tabId, repoCwd, worktreePath, branch, Date.now()]
  );
}

export async function worktreeForTab(tabId: string): Promise<WorktreeTab | null> {
  const d = await getDb();
  const rows = await d.select<WorktreeTab[]>("SELECT * FROM worktree_tabs WHERE tab_id = $1", [tabId]);
  return rows[0] ?? null;
}

export async function deleteWorktreeTab(tabId: string): Promise<void> {
  const d = await getDb();
  await d.execute("DELETE FROM worktree_tabs WHERE tab_id = $1", [tabId]);
}

/** Every worktree-bound tab id — same "all of them, not just active" need
 * as `allFanOutChildTabIds`, for the tab-strip glow. */
export async function allWorktreeTabIds(): Promise<string[]> {
  const d = await getDb();
  const rows = await d.select<{ tab_id: string }[]>("SELECT tab_id FROM worktree_tabs");
  return rows.map((r) => r.tab_id);
}
