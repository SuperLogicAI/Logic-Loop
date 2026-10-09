// Plan 059: token spend meter. Pure helpers only — no DB, no Tauri.

export interface SubagentEventRow {
  id: number;
  ts: number;
  session_id: string;
  type: string; // 'hook:SubagentStart' | 'hook:SubagentStop' | 'hook:SessionStart' | 'hook:SessionEnd'
  agent_id: string | null;
}

export interface SubagentState {
  active: number;
  unknown: number;
  /** When the next unknown ages out — re-read then. Null if none pending. */
  recheckAt?: number | null;
}

/** An unknown ("?") flags that something may have been left running; it
 * stops being useful after a few minutes, so it ages out. */
export const UNKNOWN_TTL_MS = 10 * 60_000;

/** Observed worker subagents for one tab's rows. An ID is open from its
 * Start until its Stop — a set, never starts minus stops, since Start
 * re-fires on child resume. Open IDs are unknown, not active, once the tab
 * is dead or the parent session ended (a crash can drop the Stop). A parent
 * SessionStart turns open IDs unknown when it follows an end (resume) or
 * belongs to a different session (/clear, in-tab /resume — Claude sends no
 * SessionEnd); a same-session SessionStart (/compact) leaves them. */
export function subagentState(rows: SubagentEventRow[], tabLive: boolean, now: number): SubagentState {
  const open = new Map<string, string>(); // agent id → session id
  const stale = new Map<string, number>(); // agent id → when it became unknown
  let endedAt: number | null = null;
  let lastTs = 0;
  for (const r of [...rows].sort((a, b) => a.ts - b.ts || a.id - b.id)) {
    lastTs = r.ts;
    const parent = !r.agent_id;
    if (r.type === "hook:SessionEnd" && parent) endedAt = r.ts;
    else if (r.type === "hook:SessionStart" && parent) {
      for (const [id, session] of open) {
        if (endedAt !== null || session !== r.session_id) {
          stale.set(id, endedAt ?? r.ts);
          open.delete(id);
        }
      }
      endedAt = null;
    } else if (r.type === "hook:SubagentStart" && !parent) {
      stale.delete(r.agent_id!);
      open.set(r.agent_id!, r.session_id);
    } else if (r.type === "hook:SubagentStop" && !parent) {
      open.delete(r.agent_id!);
      stale.delete(r.agent_id!);
    }
  }
  // Still-open IDs become unknown when the session ended, or when the tab is
  // dead — ponytail: no death time is recorded, so the tab's last row stands
  // in for it; record a death ts if expiry on dead tabs ever looks early.
  if (endedAt !== null || !tabLive) {
    for (const id of open.keys()) stale.set(id, endedAt ?? lastTs);
    open.clear();
  }
  const expiries = [...stale.values()].map((t) => t + UNKNOWN_TTL_MS).filter((t) => t > now);
  return {
    active: open.size,
    unknown: expiries.length,
    recheckAt: expiries.length ? Math.min(...expiries) : null,
  };
}

export function addSubagentStates(a: SubagentState | undefined, b: SubagentState): SubagentState {
  const recheck = [a?.recheckAt, b.recheckAt].filter((t): t is number => typeof t === "number");
  return {
    active: (a?.active ?? 0) + b.active,
    unknown: (a?.unknown ?? 0) + b.unknown,
    recheckAt: recheck.length ? Math.min(...recheck) : null,
  };
}

/** "2 subagents", "2 subagents · 1 ?", "1 subagent ?"; null when none. */
export function subagentLabel(s: SubagentState | undefined): string | null {
  if (!s || (s.active === 0 && s.unknown === 0)) return null;
  const noun = (n: number) => `subagent${n === 1 ? "" : "s"}`;
  if (s.active === 0) return `${s.unknown} ${noun(s.unknown)} ?`;
  return `${s.active} ${noun(s.active)}${s.unknown > 0 ? ` · ${s.unknown} ?` : ""}`;
}

// ---- Token spend (Plan 059 Checkpoint 2) ----

/** Latest usage snapshot per (agent, thread_id, response_id), as `repo.usageRows` returns it.
 * `input` is normalized: total input including cache reads and writes. */
export interface UsageRow {
  agent: string;
  root_session_id: string;
  thread_id: string;
  source_ts: number;
  input: number;
  cache_read: number;
  cache_write: number;
  output: number;
}

/** Per-thread coverage from the usage reader (`usage://thread`). */
export interface UsageThread {
  agent: string;
  root_session_id: string;
  thread_id: string;
  kind: string; // main | worker | guardian | …
  tab_id: string | null;
  project_key: string | null;
  status: "pending" | "recorded" | "unsupported" | "unreadable";
}

/** Approved weights (Plan 059 Decision 1), model-independent. Reasoning is inside output. */
export const WEIGHTS = { fresh: 1, cacheRead: 0.1, cacheWrite: 1.25, output: 5 } as const;
export const RATE_WINDOW_MS = 5 * 60_000;
export const SPARK_MINUTES = 15;

export function effortUnits(r: Pick<UsageRow, "input" | "cache_read" | "cache_write" | "output">): number {
  const fresh = Math.max(r.input - r.cache_read - r.cache_write, 0);
  return fresh * WEIGHTS.fresh + r.cache_read * WEIGHTS.cacheRead + r.cache_write * WEIGHTS.cacheWrite + r.output * WEIGHTS.output;
}

export interface ThreadSpend {
  threadId: string;
  ratePerMin: number;
  total: number;
}

export interface SpendSummary {
  /** Units/min over the trailing 5 minutes, by source time — backfilled history never counts as current. */
  ratePerMin: number;
  /** Units per minute for the last 15 minutes, oldest first. */
  sparkline: number[];
  /** Odometer: the current session's total (the root with the newest sample). */
  total: number;
  rootSessionId: string | null;
  lastSampleAt: number | null;
  threads: ThreadSpend[];
}

export function spendSummary(rows: UsageRow[], now: number): SpendSummary | null {
  if (rows.length === 0) return null;
  let newest = rows[0];
  for (const r of rows) if (r.source_ts > newest.source_ts) newest = r;
  const root = newest.root_session_id;
  const sparkline = new Array<number>(SPARK_MINUTES).fill(0);
  const threads = new Map<string, ThreadSpend>();
  let windowUnits = 0;
  let total = 0;
  for (const r of rows) {
    const u = effortUnits(r);
    const age = now - r.source_ts;
    const inWindow = age >= 0 && age < RATE_WINDOW_MS;
    if (inWindow) windowUnits += u;
    const bucket = SPARK_MINUTES - 1 - Math.floor(age / 60_000);
    if (age >= 0 && bucket >= 0) sparkline[bucket] += u;
    if (r.root_session_id !== root) continue;
    total += u;
    const t = threads.get(r.thread_id) ?? { threadId: r.thread_id, ratePerMin: 0, total: 0 };
    t.total += u;
    if (inWindow) t.ratePerMin += u / (RATE_WINDOW_MS / 60_000);
    threads.set(r.thread_id, t);
  }
  return {
    ratePerMin: windowUnits / (RATE_WINDOW_MS / 60_000),
    sparkline,
    total,
    rootSessionId: root,
    lastSampleAt: newest.source_ts,
    threads: [...threads.values()].sort((a, b) => b.total - a.total),
  };
}

/** Several tabs' summaries (one project). Totals of a shared root count once. */
export function addSpend(summaries: SpendSummary[]): SpendSummary | null {
  if (summaries.length === 0) return null;
  const seen = new Set<string>();
  const out: SpendSummary = { ratePerMin: 0, sparkline: new Array<number>(SPARK_MINUTES).fill(0), total: 0, rootSessionId: null, lastSampleAt: null, threads: [] };
  for (const s of summaries) {
    const dup = s.rootSessionId !== null && seen.has(s.rootSessionId);
    if (s.rootSessionId) seen.add(s.rootSessionId);
    if (dup) continue;
    out.ratePerMin += s.ratePerMin;
    s.sparkline.forEach((v, i) => (out.sparkline[i] += v));
    out.total += s.total;
    out.lastSampleAt = Math.max(out.lastSampleAt ?? 0, s.lastSampleAt ?? 0) || null;
    out.threads.push(...s.threads);
  }
  return out;
}

/** Sparkline full scale, in units/min. Fixed, not relative to the line's own
 * peak — a relative scale makes any rising spend look maxed. ~ the
 * maintainer's p99 per-minute spend from the Checkpoint 0 sampler (214k). */
export const SPARK_FULL_SCALE = 200_000;

/** Bar heights 0..1 against the fixed full scale; above it clips at 1. */
export function sparkHeights(values: number[]): number[] {
  return values.map((v) => Math.min(Math.max(v, 0) / SPARK_FULL_SCALE, 1));
}

/** Coverage for one root: threads whose usage is recorded vs all discovered. */
export function spendCoverage(threads: UsageThread[], rootSessionId: string | null): { recorded: number; seen: number } {
  const mine = threads.filter((t) => t.root_session_id === rootSessionId);
  return { recorded: mine.filter((t) => t.status === "recorded").length, seen: mine.length };
}
