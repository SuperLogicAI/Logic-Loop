// Plan 048 (Home dashboard): pure shaping only — no DB/Tauri calls here, same
// discipline as momentum.ts/delta.ts/attention.ts. Callers (repo.ts reads,
// eventually the Home/Overview components) gather rows; this module turns
// them into numbers and strings a panel can render, deterministically.
import type { AgentState, Commit, Tab } from "../types";
import type { ProjectCatalogEntry, ProjectWorkLogRow } from "./repo";
import { lastAssistantText, summarizeDelta } from "./delta";

export type DashboardRange = "today" | "7d" | "30d";

export function resolveHomeStartSurface(saved: string | null, hasHistory: boolean): "home" | "workspace" {
  if (saved === "home" || saved === "workspace") return saved;
  return hasHistory ? "workspace" : "home";
}

export function projectWorkspaceChoices(tabs: readonly Tab[], projectKey: string, expand: (cwd: string) => string): Tab[] {
  return tabs.filter((tab) => expand(tab.cwd) === projectKey);
}

export function dashboardRangeStart(range: DashboardRange, now: number): number {
  if (range === "today") {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }
  return now - (range === "7d" ? 7 : 30) * 86_400_000;
}

export function commitsInRange(commits: readonly Commit[], since: number, until: number): Commit[] {
  return commits.filter((c) => c.ts * 1000 > since && c.ts * 1000 <= until);
}

export interface WorkLogEntry {
  key: string;
  sessionId: string;
  day: string;
  agent: string | null;
  lastTs: number;
  excerpt: string;
  filesEdited: number;
  turns: number;
}

/** One entry per authoritative session and local calendar day. Deduplicate
 * event IDs as a backstop; session re-entry must not multiply old activity. */
export function buildProjectWorkLog(rows: readonly ProjectWorkLogRow[]): WorkLogEntry[] {
  const groups = new Map<string, ProjectWorkLogRow[]>();
  const seen = new Set<number>();
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const date = new Date(row.ts);
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const key = JSON.stringify([row.session_id, day]);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, events]) => {
    events.sort((a, b) => a.ts - b.ts || a.id - b.id);
    const delta = summarizeDelta(events, []);
    const last = events[events.length - 1]!;
    const [, day] = JSON.parse(key) as [string, string];
    return { key, sessionId: last.session_id, day, agent: last.agent, lastTs: last.ts,
      excerpt: lastAssistantText(events), filesEdited: delta.files.length, turns: delta.turns };
  }).sort((a, b) => b.lastTs - a.lastTs || a.key.localeCompare(b.key));
}

// --- Home project cards (Plan 048 §3) ---

/** Narrow, pure-friendly view of a live/ghost tab — App.tsx maps its full
 * `Tab[]` down to this before calling `buildProjectCards`, same shape as
 * `attention.ts`'s `AttentionTabSnapshot`. */
export interface HomeTabSummary {
  projectKey: string;
  status: "live" | "dead";
  agentState?: AgentState;
}

export interface ProjectCardViewModel {
  projectKey: string;
  pinned: boolean;
  archived: boolean;
  bookmarked: boolean;
  purpose: string | null;
  nickname?: string | null;
  bookmarkName?: string | null;
  bookmarkColor?: string | null;
  lastActivityAt: number | null;
  workingCount: number;
  waitingCount: number;
  /** A live or restorable (ghost) tab exists for this project — whether Open
   * routes to an existing session or has to start a new one. */
  hasAnyTab: boolean;
  /** Eligible for Home's "Show older projects" fold: 30+ days since the last
   * recorded activity, not pinned or bookmarked. Always false when there's no
   * activity on record at all — that's "no activity recorded yet", a
   * different empty state, not "old" (Plan 048 §3). */
  olderProject: boolean;
}

const OLDER_PROJECT_CUTOFF_MS = 30 * 24 * 60 * 60 * 1000;

/** Archived and "has work in flight" are independent facts on the resulting
 * card — archiving a project never hides that it still has a live tab (Plan
 * 048 §3: "archived project with a live session — still shown as Working,
 * labeled Archived"). Neither flag here suppresses the other. */
export function buildProjectCards(
  catalog: readonly ProjectCatalogEntry[],
  tabs: readonly HomeTabSummary[],
  now: number
): ProjectCardViewModel[] {
  const tabsByProject = new Map<string, HomeTabSummary[]>();
  for (const tab of tabs) {
    const list = tabsByProject.get(tab.projectKey);
    if (list) list.push(tab);
    else tabsByProject.set(tab.projectKey, [tab]);
  }

  return catalog.map((entry) => {
    const projectTabs = tabsByProject.get(entry.projectKey) ?? [];
    const liveTabs = projectTabs.filter((t) => t.status === "live");
    return {
      projectKey: entry.projectKey,
      pinned: entry.pinned,
      archived: entry.archived,
      bookmarked: entry.bookmarked,
      purpose: entry.purpose,
      nickname: entry.nickname,
      bookmarkName: entry.bookmarkName,
      bookmarkColor: entry.bookmarkColor,
      lastActivityAt: entry.lastActivityAt,
      workingCount: liveTabs.filter((t) => t.agentState === "working").length,
      waitingCount: liveTabs.filter((t) => t.agentState === "waiting").length,
      hasAnyTab: projectTabs.length > 0 || entry.hasActiveSessionBinding,
      olderProject:
        !entry.pinned &&
        !entry.bookmarked &&
        entry.lastActivityAt !== null &&
        now - entry.lastActivityAt > OLDER_PROJECT_CUTOFF_MS,
    };
  });
}

/** Home's card order: pinned first, then most recently active, then project
 * key — deterministic so a live data refresh never reorders the card under
 * the pointer/focus (Plan 048 §3). The only place cards get ordered; a
 * caller re-sorting elsewhere would defeat that stability. */
export function sortProjectCards(cards: readonly ProjectCardViewModel[]): ProjectCardViewModel[] {
  return [...cards].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const aTs = a.lastActivityAt ?? -Infinity;
    const bTs = b.lastActivityAt ?? -Infinity;
    if (aTs !== bTs) return bTs - aTs;
    return a.projectKey.localeCompare(b.projectKey);
  });
}

function basenameOf(projectKey: string): string {
  const segments = projectKey.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? projectKey;
}

/** Card display name: basename, with the immediate parent directory appended
 * only when another project in the same set shares that basename (Plan 048
 * §3: "name (basename; parent dir appended on collision)"). */
export function projectDisplayName(projectKey: string, allProjectKeys: readonly string[], identity?: { nickname?: string | null; bookmarkName?: string | null }): string {
  const preferred = identity?.nickname?.trim() || identity?.bookmarkName?.trim();
  if (preferred) return preferred;
  const base = basenameOf(projectKey);
  const collides = allProjectKeys.some((other) => other !== projectKey && basenameOf(other) === base);
  if (!collides) return base;
  const segments = projectKey.split("/").filter(Boolean);
  const parent = segments[segments.length - 2];
  return parent ? `${parent}/${base}` : base;
}

// --- Agent time (Plan 048 §4) ---

export interface AgentTimeObservation {
  sessionId: string;
  runId: string;
  state: AgentState;
  observedAt: number;
}

export interface ObservedAgentTime {
  totalMs: number;
  /** Earliest observation across every session, closed interval or not —
   * null only when there are no observations at all. */
  sinceDate: number | null;
  /** Sessions that contributed at least one closed interval. A session whose
   * only observation never closed (or closed with zero elapsed time) doesn't
   * count — this is "sessions the hours came from", matching the "14h 20m
   * across 6 sessions" header, not "sessions ever observed". */
  sessionCount: number;
}

/** Per session+run, each `"working"` observation opens an interval closed by
 * the next observation in that same run — regardless of its state, since any
 * later observation proves the session moved on from working. An interval
 * still open when its run's observations run out is dropped, not extended to
 * "now" or to the next run: a crash must not silently bill hours the process
 * was never actually proven to be working through. A new run for the same
 * session (relaunch, resumed) never closes a previous run's trailing open
 * interval either — see Plan 048 §4. */
export function observedAgentTime(observations: readonly AgentTimeObservation[]): ObservedAgentTime {
  if (observations.length === 0) return { totalMs: 0, sinceDate: null, sessionCount: 0 };

  const groups = new Map<string, AgentTimeObservation[]>();
  for (const o of observations) {
    const key = `${o.sessionId}\u0000${o.runId}`;
    const list = groups.get(key);
    if (list) list.push(o);
    else groups.set(key, [o]);
  }

  let totalMs = 0;
  let sinceDate = Infinity;
  const sessionsWithClosedInterval = new Set<string>();

  for (const group of groups.values()) {
    group.sort((a, b) => a.observedAt - b.observedAt);
    sinceDate = Math.min(sinceDate, group[0].observedAt);
    for (let i = 0; i < group.length - 1; i++) {
      const cur = group[i];
      if (cur.state !== "working") continue;
      const next = group[i + 1];
      const elapsed = next.observedAt - cur.observedAt;
      if (elapsed <= 0) continue; // out-of-order/duplicate timestamps contribute nothing
      totalMs += elapsed;
      sessionsWithClosedInterval.add(cur.sessionId);
    }
    // group[group.length - 1]: if "working", it's the open-at-run-end
    // interval this function deliberately drops.
  }

  return {
    totalMs,
    sinceDate: Number.isFinite(sinceDate) ? sinceDate : null,
    sessionCount: sessionsWithClosedInterval.size,
  };
}

// --- Copy update (Plan 048 §3 "Copy update") ---

export interface UpdateMarkdownDecision {
  question: string;
  assumption: string | null;
}

export interface UpdateMarkdownInput {
  projectName: string;
  /** Already formatted, e.g. "Sep 22–29" — this module does no date math. */
  rangeLabel: string;
  /** Already-curated, human-readable progress notes — never raw tool_input
   * (file paths, shell commands) or a transcript body. Each entry is
   * truncated to its first line as a defense-in-depth backstop, not as the
   * primary guarantee: the caller owns picking prose-safe sources (an
   * agent-reported note, not a tool event) in the first place. */
  progressLines: readonly string[];
  commitSubjects: readonly string[];
  decisionsNeeded: readonly UpdateMarkdownDecision[];
  blockerLines: readonly string[];
  nextStep: string | null;
}

export const OMITTED_LINE = "Technical details omitted; review in the workspace.";

// Slash words that are prose, not paths. Closed list on purpose: a general
// letters-only exemption would also pass `src/components` or `config/secrets`.
const SLASH_PROSE = new Set(["and/or", "either/or", "w/", "w/o", "i/o", "n/a", "tcp/ip"]);
const CODE_FILE = /\.(?:sh|bash|zsh|py|ts|tsx|js|jsx|mjs|cjs|json|toml|ya?ml|md|rs|sql|env|lock)$/i;
// Lowercase only: commands are typed lowercase, sentence prose is not ("Git
// history", "Make sure"). Tool names count anywhere with an argument.
const TOOL_COMMAND = /(?:^|[\s(])(?:npm|npx|pnpm|yarn|cargo|git|sudo|curl|wget|brew|pip3?|rg|sed|awk|tsx|deno|python3)\s+\S/;
// English-ambiguous commands: only as the line's first word (with an argument
// or a `cmd:` error prefix), or anywhere when followed by a flag.
const AMBIGUOUS = "ls|cd|rm|mkdir|cp|mv|cat|find|make|node|python|bash|sh|zsh|touch|kill|chmod";
const AMBIGUOUS_LEADING = new RegExp(`^(?:${AMBIGUOUS})(?::|\\s+\\S)`);
const AMBIGUOUS_FLAGGED = new RegExp(`(?:^|\\s)(?:${AMBIGUOUS})\\s+--?[A-Za-z]`);

function isPathLikeToken(raw: string): boolean {
  const token = raw.replace(/^[("'\[<{]+/, "").replace(/[)"'\]>},;:.!?]+$/, "");
  if (!token) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(token)) return true; // URL
  if (token.startsWith("~") || token.includes("\\") || /^[A-Za-z]:(?:[\\/]|$)/.test(token)) return true;
  if (token.includes("/") && !SLASH_PROSE.has(token.toLowerCase()) && !/^\d+(?:\/\d+)+$/.test(token)) return true;
  return CODE_FILE.test(token) && !/^[A-Z][A-Za-z]*\.js$/.test(token); // `Node.js` is a name
}

/** One exportable line for the Copy update draft: first line only, Markdown
 * links reduced to their text, and the whole line replaced when it carries a
 * file path or shell command. Output minimization over untrusted agent prose —
 * never semantic ingestion, never PTY parsing. */
export function exportSafeLine(text: string): string {
  const line = text
    .split("\n")[0]!
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim();
  if (
    /`|(?:^|\s)\$\s/.test(line) ||
    TOOL_COMMAND.test(line) ||
    AMBIGUOUS_LEADING.test(line) ||
    AMBIGUOUS_FLAGGED.test(line) ||
    line.split(/\s+/).some(isPathLikeToken)
  ) {
    return OMITTED_LINE;
  }
  return line;
}

/** A colliding display name is `parent/base`; the heading falls back to the
 * base name rather than to the omission notice. */
function exportSafeTitle(name: string): string {
  const safe = exportSafeLine(name);
  if (safe !== OMITTED_LINE) return safe;
  const base = exportSafeLine(name.split("\n")[0]!.split(/[\\/]/).filter(Boolean).pop() ?? "");
  return base && base !== OMITTED_LINE ? base : "Project";
}

function bulletsOrNoneRecorded(lines: readonly string[]): string[] {
  return lines.length > 0 ? lines.map((l) => `- ${exportSafeLine(l)}`) : ["- none recorded"];
}

/** Deterministic Markdown for the Copy update modal — no model call, ever.
 * Empty sections say "none recorded" rather than being omitted, so the
 * reader never mistakes "nothing tracked" for "everything's fine" (Plan 048
 * §3: "never imply health"). The draft is meant to be read and edited before
 * Copy, not sent anywhere by this function. */
export function buildUpdateMarkdown(input: UpdateMarkdownInput): string {
  const progress = [...input.progressLines];
  if (input.commitSubjects.length > 0) {
    const n = input.commitSubjects.length;
    progress.push(`${n} local commit${n === 1 ? "" : "s"}: ${input.commitSubjects.map(exportSafeLine).join("; ")}`);
  }

  const lines: string[] = [];
  lines.push(`## ${exportSafeTitle(input.projectName)} — update (${exportSafeLine(input.rangeLabel)})`);
  lines.push("**Progress**");
  lines.push(...bulletsOrNoneRecorded(progress));
  lines.push("**Decisions needed**");
  lines.push(
    ...bulletsOrNoneRecorded(
      input.decisionsNeeded.map((d) =>
        d.assumption ? `${d.question} (current assumption: ${d.assumption})` : d.question
      )
    )
  );
  lines.push("**Blockers**");
  lines.push(...bulletsOrNoneRecorded(input.blockerLines));
  lines.push("**Next**");
  lines.push(...bulletsOrNoneRecorded(input.nextStep ? [input.nextStep] : []));
  return lines.join("\n");
}

/** Copy update's one side effect. A rejected clipboard write is a visible,
 * retryable state, never a silent reset (the text stays on screen). */
export async function copyDraft(
  write: (text: string) => Promise<void>,
  text: string
): Promise<"copied" | "failed"> {
  try {
    await write(text);
    return "copied";
  } catch {
    return "failed";
  }
}
