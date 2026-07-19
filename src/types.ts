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
