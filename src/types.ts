export interface Bookmark {
  id: number;
  name: string;
  cwd: string;
  color: string;
  position: number;
}

export type AgentState = "working" | "waiting" | "idle" | "error";

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
}

export interface Blocker {
  id: number;
  cwd: string;
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
  backend: "claude" | "lmstudio";
  lmstudioUrl: string;
  lmstudioModel: string;
}

/** A tab-tether-keyed re-entry candidate: the latest session bound to a tab
 * that was still active when the app last quit (see `repo.reentryCandidates`). */
export interface ReentryCandidate {
  session_id: string;
  tab_tether: string;
  project_key: string;
  cwd: string;
  transcript_path: string;
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
