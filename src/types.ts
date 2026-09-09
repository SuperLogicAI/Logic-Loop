export interface Bookmark {
  id: number;
  name: string;
  cwd: string;
  color: string;
  position: number;
}

export type AgentState = "working" | "waiting" | "idle" | "error";

export type PanelMode = "expanded" | "compact" | "hidden";

export type AttentionKind = "decision" | "waiting" | "stalled" | "result" | "blocker";

/** Source identity captured at ingestion time. It is deliberately distinct
 * from an inbox route: historical/project-level rows can lack some fields. */
export interface AttentionSourceContext {
  sessionId?: string;
  tabId?: string;
  agent?: string;
  actorId?: string;
}

/** Common durable read shape for the cross-project Attention inbox. The
 * query/UI arrive in later phases; defining it now keeps source writes typed. */
export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  projectKey: string;
  sessionId: string | null;
  tabId: string | null;
  adapterId: string | null;
  actorId: string | null;
  createdAt: number;
  lastActivityAt: number | null;
  text: string;
  evidenceId: number | null;
  actionability: "act" | "review" | "investigate" | "unknown";
  confidence: "explicit" | "inferred" | "unknown";
  route: "exact" | "session" | "project" | "unavailable";
}

/** Raw cross-project evidence returned by the repo query. Live eligibility,
 * routing, actionability, and display ordering are derived in attention.ts. */
export interface AttentionEvidence {
  id: string;
  kind: AttentionKind;
  projectKey: string;
  sessionId: string | null;
  tabId: string | null;
  adapterId: string | null;
  actorId: string | null;
  createdAt: number;
  lastActivityAt: number | null;
  text: string;
  evidenceId: number | null;
  runId: string | null;
  observedState: AgentState | null;
}

export interface Tab {
  id: string;
  ptyId: number;
  title: string;
  cwd: string;
  color: string;
  status: "live" | "dead";
  sessionId?: string;
  agentState?: AgentState;
  /** ms epoch of the last state-bearing hook (Phase 14b's clock). Not
   * persisted — a relaunch has no agentState either, both come back on the
   * first hook. */
  lastEventTs?: number;
  /** True if the tab's most recent `UserPromptSubmit` had no fresh human
   * keystrokes behind it (Phase 15 turn provenance). Not persisted — same
   * rule as `lastEventTs`. */
  lastTurnAuto?: boolean;
  /** Adapter identity (e.g. "codex"), carried from the hook payload's
   * `agent` field so a resumed/restarted tab can pick the right resume
   * command. Undefined for Claude and any adapter with no marker yet. */
  agent?: string;
}

export interface Blocker {
  id: number;
  cwd: string;
  session_id: string | null;
  tab_id: string | null;
  agent: string | null;
  actor_id: string | null;
  text: string;
  source: string; // 'manual' | detector label
  resolved: number;
  ts: number;
}

export interface ToolEvent {
  id: number;
  ts: number;
  session_id: string;
  tool: string;
  detail: string;
  plain: string; // human-readable headline derived in the repo layer
  filePath: string; // path this event *changed*; "" for tools that changed nothing, so only diffable rows offer a diff
}

export interface Commit {
  hash: string;
  ts: number;
  subject: string;
}

export interface Decision {
  id: number;
  session_id: string;
  cwd: string;
  tab_id: string | null;
  agent: string | null;
  actor_id: string | null;
  question: string;
  status: "open" | "answered" | "delegated" | "dismissed";
  user_answer: string | null;
  assumption: string | null;
  context_json: string;
  ts: number;
}

export interface Note {
  id: number;
  cwd: string;
  kind: "landing" | "residue";
  body: string;
  status: "open" | "done" | "skipped";
  session_id: string | null;
  ts: number;
}

export interface ExtractorSettings {
  backend: "claude" | "codex" | "lmstudio";
  lmstudioUrl: string;
  lmstudioModel: string;
  codexModel: string;
}

/** A tab-tether-keyed re-entry candidate: the latest session bound to a tab
 * that was still active when the app last quit (see `repo.reentryCandidates`). */
export interface ReentryCandidate {
  session_id: string;
  tab_tether: string;
  project_key: string;
  cwd: string;
  transcript_path: string;
  /** Adapter identity persisted with the binding; undefined for legacy rows
   * and any adapter without a marker yet — treated as Claude for resume. */
  agent?: string;
}

/** A fan-out group (Phase 7): one parent tab, N child tabs it spawned. */
export interface SpawnGroup {
  id: string;
  parent_tab_id: string;
  label: string | null;
  created_at: number;
}

/** One child of a spawn group. `cmd` is the launch command it was spawned
 * with (display only — the child's own PTY already carries it). */
export interface SpawnGroupMember {
  group_id: string;
  child_tab_id: string;
  cmd: string | null;
  created_at: number;
}

/** Rollup view of a spawn group for the currently active tab — computed in
 * App.tsx from `SpawnGroup`/`SpawnGroupMember` (DB) plus live `tabs` and
 * `unseenStops` (in-memory), and handed to SidePanel purely for display. */
export interface FanOutRollup {
  groupId: string;
  label: string | null;
  isParent: boolean; // true when the active tab owns this group
  parentTabId: string;
  parentTitle: string;
  members: {
    childTabId: string;
    title: string;
    cmd: string | null;
    status: "running" | "flag" | "done" | "dead" | "gone";
  }[];
}

/** A tab spawned into a git worktree (Phase 9 "Isolate loop"). `repo_cwd` is
 * the main checkout it branches from; `branch` is kept on close, only the
 * worktree directory is ever removed. */
export interface WorktreeTab {
  tab_id: string;
  repo_cwd: string;
  worktree_path: string;
  branch: string;
  created_at: number;
}

export interface HookPayload {
  hook_event_name: string;
  session_id: string;
  cwd?: string;
  transcript_path?: string;
  /** Repo root for `cwd`, derived server-side. The key every panel queries by. */
  project_key?: string;
  /** Tab tether. Absent for sessions started outside the app. */
  tab_id?: string;
  /** Payload shape version; 0 = pre-versioning. Recorded, not branched on yet. */
  hook_version?: number;
  /** Ingestion-origin adapter marker (e.g. "codex"), stamped server-side from
   * the `X-Logic-Loop-Agent` header. Absent for Claude and any adapter that
   * hasn't wired up its own marker yet — never guessed from payload shape.
   * Distinct from a payload's own `agent_id` field, which identifies a
   * *subagent* within a session and is unrelated to adapter identity. */
  agent?: "codex" | string;
  [key: string]: unknown;
}

export const PALETTE = [
  "#e06c75",
  "#e5a06c",
  "#e5c07b",
  "#98c379",
  "#56b6c2",
  "#61afef",
  "#c678dd",
  "#abb2bf",
] as const;
