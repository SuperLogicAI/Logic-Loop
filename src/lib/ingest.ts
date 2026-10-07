import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AgentState,
  AttentionSourceContext,
  ClaudeStatuslinePayload,
  ClaudeStatuslineStatus,
  HookPayload,
  Tab,
} from "../types";

export function hooksSetup(): Promise<void> {
  return invoke("hooks_setup");
}

export function hooksRemove(): Promise<void> {
  return invoke("hooks_remove");
}

type HooksState = "off" | "partial" | "on";

export function hooksStatus(): Promise<boolean> {
  return invoke<HooksState>("hooks_status").then((s) => s !== "off");
}

/** Ours installed but missing an event added since (Plan 053): Update re-runs setup. */
export function hooksOutdated(): Promise<boolean> {
  return invoke<HooksState>("hooks_status").then((s) => s === "partial");
}

export function claudeDetect(): Promise<boolean> {
  return invoke<boolean>("claude_detect");
}

export function claudeStatuslineStatus(): Promise<ClaudeStatuslineStatus> {
  return invoke<ClaudeStatuslineStatus>("claude_statusline_status");
}

export function claudeStatuslineSetup(): Promise<void> {
  return invoke("claude_statusline_setup");
}

export function claudeStatuslineRemove(): Promise<void> {
  return invoke("claude_statusline_remove");
}

export function opencodeDetect(): Promise<boolean> {
  return invoke<boolean>("opencode_detect");
}

export function opencodeHooksSetup(): Promise<void> {
  return invoke("opencode_hooks_setup");
}

export function opencodeHooksRemove(): Promise<void> {
  return invoke("opencode_hooks_remove");
}

export function opencodeHooksStatus(): Promise<boolean> {
  return invoke<boolean>("opencode_hooks_status");
}

export function codexDetect(): Promise<boolean> {
  return invoke<boolean>("codex_detect");
}

export function codexHooksSetup(): Promise<void> {
  return invoke("codex_hooks_setup");
}

export function codexHooksRemove(): Promise<void> {
  return invoke("codex_hooks_remove");
}

export function codexHooksStatus(): Promise<boolean> {
  return invoke<boolean>("codex_hooks_status");
}

export function antigravityDetect(): Promise<boolean> {
  return invoke<boolean>("antigravity_detect");
}

export function antigravityHooksSetup(): Promise<void> {
  return invoke("antigravity_hooks_setup");
}

export function antigravityHooksRemove(): Promise<void> {
  return invoke("antigravity_hooks_remove");
}

export function antigravityHooksStatus(): Promise<boolean> {
  return invoke<boolean>("antigravity_hooks_status");
}

export function piDetect(): Promise<boolean> {
  return invoke<boolean>("pi_detect");
}

export function piHooksSetup(): Promise<void> {
  return invoke("pi_hooks_setup");
}

export function piHooksRemove(): Promise<void> {
  return invoke("pi_hooks_remove");
}

export function piHooksStatus(): Promise<boolean> {
  return invoke<boolean>("pi_hooks_status");
}

export function deepseekDetect(): Promise<boolean> {
  return invoke<boolean>("deepseek_detect");
}

export function deepseekHooksSetup(): Promise<void> {
  return invoke("deepseek_hooks_setup");
}

export function deepseekHooksRemove(): Promise<void> {
  return invoke("deepseek_hooks_remove");
}

export function deepseekHooksStatus(): Promise<boolean> {
  return invoke<boolean>("deepseek_hooks_status");
}

export function onHookEvent(cb: (p: HookPayload) => void): Promise<UnlistenFn> {
  return listen<HookPayload>("ingest://hook", (e) => {
    if (typeof e.payload?.hook_event_name === "string" && typeof e.payload?.session_id === "string") {
      cb(e.payload);
    }
  });
}

export function onTranscriptLine(
  cb: (p: { session_id: string; line: string }) => void
): Promise<UnlistenFn> {
  return listen<{ session_id: string; line: string }>("ingest://transcript", (e) => cb(e.payload));
}

/** A session's transcript could not be opened: it sends hooks but no transcript
 *  lines, so decisions and any transcript-fed panel stay empty for it. Re-fires
 *  on every hook while the file is missing; the UI keys on session_id. */
export function onTailerFailed(
  cb: (p: { session_id: string; path: string }) => void
): Promise<UnlistenFn> {
  return listen<{ session_id: string; path: string }>("ingest://tailer-failed", (e) => cb(e.payload));
}

/** Adapter setup warning (e.g. foreign PostToolUse hook collision in agy < 1.1.27). */
export function onAdapterWarning(
  cb: (p: { agent: string; reason: string }) => void
): Promise<UnlistenFn> {
  return listen<{ agent: string; reason: string }>("ingest://adapter-warning", (e) => cb(e.payload));
}

/** Plan 023: live statusLine mirror from the Claude wrapper. Never persisted
 * (see `ClaudeStatuslinePayload`) — the caller keeps only the latest snapshot
 * per tab/session. */
export function onStatusline(cb: (p: ClaudeStatuslinePayload) => void): Promise<UnlistenFn> {
  return listen<ClaudeStatuslinePayload>("ingest://statusline", (e) => {
    if (typeof e.payload?.session_id === "string") cb(e.payload);
  });
}

/** The subset of a tab this module needs to bind a session to it. */
export interface BindCandidate {
  id: string;
  cwd: string; // already the expanded project key
  status: string;
  sessionId?: string;
  agentState?: AgentState;
  launchId?: string;
}

export type LaunchDecision = "replace" | "reject" | "default";

// Step 0 (Plan 045): `/new` and a child `codex exec` both start with
// `startup`, so only these in-TUI sources may replace within one launch.
const REPLACING_SOURCES = new Set(["clear", "resume", "fork"]);

/**
 * Plan 045: the launch rule for a tethered Codex event against its tab.
 * `bindSession`, `sessionBindingLocation`, and `mergeTabIdentity` all defer to
 * it, so binding is still decided in one place.
 * - The tab's own session, non-Codex, or untethered: `default` (today's rules).
 * - Unknown/retired launch: `reject` — never binds or replaces.
 * - Plain tether (`none`): `default`, first-session-wins (Decision A).
 * - Registered launch, `SessionStart`: this launch's first one `replace`s
 *   whatever the tab held; a later one replaces only for clear/resume/fork.
 *   Subagents never replace.
 */
export function codexLaunchDecision(
  p: HookPayload,
  tab: { sessionId?: string; launchId?: string }
): LaunchDecision {
  if (p.agent !== "codex" || !p.tab_id || tab.sessionId === p.session_id) return "default";
  if (p.launch === "unknown" || p.launch === "retired") return "reject";
  if (p.launch !== "current" || p.hook_event_name !== "SessionStart" || isSubagentHook(p)) return "default";
  if (tab.launchId !== p.launch_id) return "replace";
  return typeof p["source"] === "string" && REPLACING_SOURCES.has(p["source"]) ? "replace" : "reject";
}

/** Location to persist for a tethered SessionStart. Every adapter needs an
 * exact, live tab that is unclaimed or already owns this session. Agy can omit
 * workspacePaths, so its tab may supply the missing project. */
export function sessionBindingLocation(
  p: HookPayload,
  projectKey: string | undefined,
  tab?: { id: string; cwd: string; status: string; sessionId?: string; launchId?: string }
): { cwd: string; projectKey: string } | null {
  if (!p.tab_id) return null;
  if (tab?.id !== p.tab_id || tab.status !== "live") return null;
  const decision = codexLaunchDecision(p, tab);
  if (decision === "reject") return null;
  if (decision !== "replace" && tab.sessionId && tab.sessionId !== p.session_id) return null;
  if (p.cwd && projectKey) return { cwd: p.cwd, projectKey };
  if (p.agent === "antigravity" && tab?.cwd) {
    return { cwd: tab.cwd, projectKey: tab.cwd };
  }
  return null;
}

/**
 * Session→tab binding. This is the ONE place binding is decided.
 *
 * Tether first: the PTY carries `LOGIC_LOOP_TAB_ID`, hooks echo it back, so the
 * answer is exact — including two tabs open on the same repo, which cwd
 * matching always got wrong. cwd matching survives for other adapters, but
 * Codex requires a tether: its shared daemon can send another client's ID.
 */
export function bindSession(
  p: HookPayload,
  tabs: BindCandidate[],
  opts: { boundTabIds: Set<string>; activeTabId: string | null; projectKey?: string }
): string | null {
  if (typeof p.tab_id === "string") {
    const tethered = tabs.find((t) => t.id === p.tab_id);
    // Tethered to a tab that's since closed: do not fall through to cwd, or the
    // dead tab's events land on whatever unbound tab happens to match.
    if (tethered?.status !== "live") return null;
    const decision = codexLaunchDecision(p, tethered);
    if (decision === "replace") return tethered.id;
    if (decision === "reject") return null;
    return !tethered.sessionId || tethered.sessionId === p.session_id ? tethered.id : null;
  }
  // Codex's shared daemon can emit hooks with another client's inherited
  // tether. An untethered Codex event has no exact client identity either.
  if (p.agent === "codex") return null;
  const { boundTabIds, activeTabId, projectKey } = opts;
  const liveTabs = tabs.filter((t) => t.status === "live");
  // The tab that already owns this session is the answer, even when the
  // in-memory binding map is empty (ghost tabs after relaunch never seed it)
  // or the session has since cd'ed elsewhere.
  const owner = liveTabs.find((t) => t.sessionId === p.session_id);
  if (owner) return owner.id;
  if (!projectKey) return null;
  // A filesystem root is never a real project: it means the session was started
  // somewhere with no meaningful cwd. Binding it would overwrite the tab's cwd
  // with a key that matches nothing, blanking the panel. Untethered + rootless =
  // not ours. A Windows drive root (`C:\`, `C:/`, bare `C:`) is the same hazard.
  // Deliberately anchored and exact — a prefix test would reject `/Users/x` and
  // `C:\dev\proj` too, which fails far more quietly than the bug it fixes.
  if (/^(?:[/\\]|[A-Za-z]:[/\\]?)$/.test(projectKey)) return null;
  // A tab already holding a different session (bound in memory, or carrying a
  // persisted sessionId — a re-entered ghost) is never a fallback target: an
  // outside session would stamp its tab_id onto that tab's derived rows.
  // No eligible tab → unbound; the hook is still persisted by the caller.
  const eligible = liveTabs.filter((t) => !boundTabIds.has(t.id) && !t.sessionId);
  return (
    eligible.find((t) => t.cwd === projectKey)?.id ??
    // else the active tab — the user `cd`ed away from the tab's spawn cwd
    // before running claude, and they're typing in it now.
    eligible.find((t) => t.id === activeTabId)?.id ??
    null
  );
}

/** Applies one hook event to the tab it's tethered to. Gated on session
 * ownership, not just tether match: a tab's own bound session drives its
 * identity/state/cwd as before, but a *different* session sharing the same
 * `LOGIC_LOOP_TAB_ID` (e.g. a one-off CLI run as a subprocess inside an
 * existing tab's shell) must not hijack it — no icon flip, no `sessionId`
 * overwrite. `!t.sessionId` is the one exception: a tab's first-ever
 * structured event establishes its identity. The raw event still gets
 * written to `hook_events` regardless (that happens unconditionally,
 * upstream of this call) — only the tab's displayed state is guarded here. */
export function mergeTabIdentity(
  t: Tab,
  p: HookPayload,
  cwd: string | undefined,
  state: AgentState | null,
  isPromptSubmit: boolean,
  provenance: "human" | "auto" | undefined,
  expandCwd: (cwd: string) => string
): Tab {
  const decision = codexLaunchDecision(p, t);
  if (decision === "reject") return t;
  if (decision === "replace") {
    // Plan 045: a new session takes the tab even though `SessionStart` maps
    // to no state; otherwise its first prompt would fail ownership below.
    t = {
      ...t,
      sessionId: p.session_id,
      launchId: p.launch_id,
      agentState: undefined,
      lastEventTs: undefined,
      lastTurnAuto: undefined,
    };
  }
  const owns = !t.sessionId || t.sessionId === p.session_id;
  if (!owns) return t;
  const next = cwd && expandCwd(t.cwd) !== cwd ? { ...t, cwd } : t;
  const withAgent = p.agent && next.agent !== p.agent ? { ...next, agent: p.agent } : next;
  if (!state) return withAgent;
  return {
    ...withAgent,
    sessionId: p.session_id,
    agentState: state,
    lastEventTs: Date.now(),
    lastTurnAuto: isPromptSubmit ? provenance === "auto" : withAgent.lastTurnAuto,
  };
}

// Epoch guard: sessions whose last turn ended with Stop. Late-arriving events
// from that turn (out-of-order curl delivery, background subagents, the idle
// reminder Notification) must not revive the tab out of idle — only a new
// human-initiated turn (UserPromptSubmit) reopens the epoch. Sessions we
// attach to mid-turn are treated as open by default.
const stoppedSessions = new Set<string>();

/** Test-only: clear epoch-guard state between scenarios. */
export function resetEpochGuard(): void {
  stoppedSessions.clear();
}

/** Whether a finished session should flag its tab as an unclaimed result:
 * either a different tab is active (background tab, app focused), or the
 * whole app is backgrounded. Claiming (App.tsx's `claimTab`) is the inverse —
 * a tab is claimed by becoming both the active tab and the window focused. */
export function shouldFlagUnclaimed(
  tabId: string,
  activeTabId: string | null,
  windowFocused: boolean
): boolean {
  return tabId !== activeTabId || !windowFocused;
}

/** Startup seed for the in-memory unclaimed flags: which restored tabs carry a
 * result that landed before the last quit and was never claimed. Must be
 * applied before a tab is activated — the claim path reads the flag set. */
export function seedUnclaimedTabs(
  tabs: { id: string; sessionId?: string }[],
  unclaimedSessions: Set<string>
): Set<string> {
  return new Set(
    tabs.filter((t) => t.sessionId && unclaimedSessions.has(t.sessionId)).map((t) => t.id)
  );
}

/** Whether a nudge (OS notification) should fire: same rule as
 * `shouldFlagUnclaimed`, plus project mute and app-wide Lock-in. */
export function shouldNotify(
  tabId: string,
  activeTabId: string | null,
  windowFocused: boolean,
  muted: boolean,
  lockIn = false
): boolean {
  return !lockIn && !muted && shouldFlagUnclaimed(tabId, activeTabId, windowFocused);
}

// ponytail: constant; settings-table knob if real use disagrees
export const STALL_MS = 3 * 60 * 1000;

// ponytail: constant; tune from dogfood if human turns get misclassified auto
export const PROVENANCE_WINDOW_MS = 5000;

/** Was a `UserPromptSubmit` typed by the human, or fired by a loop/resubmit
 * with no fresh keystrokes behind it? `tabId` is the tether (same uuid as
 * `LOGIC_LOOP_TAB_ID` and `Tab.id`); `lastInputTs` comes from `pty.ts`'s
 * per-tab keystroke clock. No tether (outside-terminal session) or no
 * recorded input yet (fresh tab, spawn-time launch command) both default to
 * `human` — `auto` is only assigned when we positively know the PTY input
 * path went quiet. */
export function computeProvenance(
  tabId: string | undefined,
  lastInputTs: number | undefined,
  now: number
): "human" | "auto" {
  if (!tabId || lastInputTs === undefined) return "human";
  return now - lastInputTs < PROVENANCE_WINDOW_MS ? "human" : "auto";
}

/** Derived, not stored — keeps every adapter, stateForHook, fan-out rollup
 * and check script untouched. Only "working" stalls: "waiting" already has
 * its own pulse meaning ("needs you now"); a long-idle waiting tab just
 * gets an age badge, not a stall label. */
export function deriveClock(
  tab: { agentState?: AgentState; lastEventTs?: number },
  now: number
): { quietMs: number; stalled: boolean } {
  const quietMs = tab.lastEventTs ? now - tab.lastEventTs : 0;
  return { quietMs, stalled: tab.agentState === "working" && quietMs > STALL_MS };
}

/** `Xs`/`Xm`/`Xh`/`Xd` for a duration in ms — same buckets as SidePanel's
 * `ago()`, but for an elapsed span rather than a distance from an absolute ts. */
export function formatAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** Panel status words for a tab with no live hook state yet. A tab carrying a
 * persisted session (a re-entered ghost: Codex `resume` sends no hook until
 * the next turn) is a restored session, not "no session". */
export function sessionStatusLabel(
  agentState: AgentState | undefined,
  sessionId: string | null | undefined
): { state: string; noEvents: string } {
  return sessionId && !agentState
    ? { state: "session restored", noEvents: "no new activity" }
    : { state: agentState ?? "no session", noEvents: "no events yet" };
}

/** Map a hook event to the tab's agent state; null = no state change. */
export function stateForHook(p: HookPayload): AgentState | null {
  // Subagent events carry agent_id; they never drive tab state.
  if (isSubagentHook(p)) return null;
  switch (p.hook_event_name) {
    case "UserPromptSubmit":
      stoppedSessions.delete(p.session_id);
      return "working";
    case "PostToolUse": {
      if (stoppedSessions.has(p.session_id)) return null;
      const resp = p["tool_response"];
      const isError =
        typeof resp === "object" && resp !== null && (resp as Record<string, unknown>)["is_error"] === true;
      return isError ? "error" : "working";
    }
    case "Notification":
    case "PermissionRequest":
      return stoppedSessions.has(p.session_id) ? null : "waiting";
    case "Stop":
    // Codex-only terminal events (Plan: Codex interruption/session-end
    // lifecycle). Both are turn/session-terminal, same as Stop: close the
    // epoch so a late out-of-order event from the closed turn can't revive
    // the tab. Neither is a failure — an interrupted turn is not an error.
    case "Interrupt":
    case "SessionEnd":
      stoppedSessions.add(p.session_id);
      return "idle";
    default:
      return null;
  }
}

/** Codex subagents share the parent's session/tether, so event name and
 * session alone cannot prove the parent turn completed. */
export function isSubagentHook(p: HookPayload): boolean {
  return typeof p["agent_id"] === "string" && p["agent_id"] !== "";
}

/** A landed result belongs only to a parent Stop/Interrupt. SessionEnd closes
 * the epoch without producing a result, and a subagent completion must never
 * flag its parent's tab as finished. */
export function isTerminalResult(p: HookPayload): boolean {
  return !isSubagentHook(p) && (p.hook_event_name === "Stop" || p.hook_event_name === "Interrupt");
}

/** Freeze the tab identity attached to a hook before work is queued. App.tsx
 * passes only a verified live match; raw tethers remain available for other
 * callers that have not resolved a tab yet. */
export function sourceContextForHook(
  p: HookPayload,
  matchedTabId?: string,
  verifiedMatchOnly = false
): AttentionSourceContext {
  return {
    sessionId: p.session_id,
    tabId: verifiedMatchOnly ? matchedTabId : p.tab_id ?? matchedTabId,
    agent: p.agent,
    actorId: typeof p["agent_id"] === "string" && p["agent_id"] ? p["agent_id"] : undefined,
  };
}
