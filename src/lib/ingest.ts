import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AgentState, HookPayload } from "../types";

export function hooksSetup(): Promise<void> {
  return invoke("hooks_setup");
}

export function hooksRemove(): Promise<void> {
  return invoke("hooks_remove");
}

export function hooksStatus(): Promise<boolean> {
  return invoke<boolean>("hooks_status");
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

/** The subset of a tab this module needs to bind a session to it. */
export interface BindCandidate {
  id: string;
  cwd: string; // already the expanded project key
  status: string;
  agentState?: AgentState;
}

/**
 * Session→tab binding. This is the ONE place binding is decided.
 *
 * Tether first: the PTY carries `LOGIC_LOOP_TAB_ID`, hooks echo it back, so the
 * answer is exact — including two tabs open on the same repo, which cwd
 * matching always got wrong. cwd matching survives as a fallback because
 * sessions started in an outside terminal carry no tether.
 */
export function bindSession(
  p: HookPayload,
  tabs: BindCandidate[],
  opts: { boundTabIds: Set<string>; activeTabId: string | null; projectKey?: string }
): string | null {
  if (typeof p.tab_id === "string") {
    const tethered = tabs.find((t) => t.id === p.tab_id);
    if (tethered) return tethered.id;
    // Tethered to a tab that's since closed: do not fall through to cwd, or the
    // dead tab's events land on whatever unbound tab happens to match.
    return null;
  }
  const { boundTabIds, activeTabId, projectKey } = opts;
  if (!projectKey) return null;
  // `/` is never a real project: it means the session was started somewhere with
  // no meaningful cwd. Binding it would overwrite the tab's cwd with a key that
  // matches nothing, blanking the panel. Untethered + rootless = not ours.
  if (projectKey === "/") return null;
  return (
    tabs.find((t) => t.cwd === projectKey && !boundTabIds.has(t.id))?.id ??
    tabs.find((t) => t.cwd === projectKey)?.id ??
    // else the active tab — the user `cd`ed away from the tab's spawn cwd
    // before running claude, and they're typing in it now.
    tabs.find((t) => t.id === activeTabId && t.status === "live" && !boundTabIds.has(t.id))?.id ??
    null
  );
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
 * `shouldFlagUnclaimed`, plus the project's mute setting. */
export function shouldNotify(
  tabId: string,
  activeTabId: string | null,
  windowFocused: boolean,
  muted: boolean
): boolean {
  return !muted && shouldFlagUnclaimed(tabId, activeTabId, windowFocused);
}

// ponytail: constant; settings-table knob if real use disagrees
export const STALL_MS = 3 * 60 * 1000;

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

/** Map a hook event to the tab's agent state; null = no state change. */
export function stateForHook(p: HookPayload): AgentState | null {
  // Subagent events carry agent_id; they never drive tab state.
  if (typeof p["agent_id"] === "string" && p["agent_id"] !== "") return null;
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
      stoppedSessions.add(p.session_id);
      return "idle";
    default:
      return null;
  }
}
