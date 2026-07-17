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
      return stoppedSessions.has(p.session_id) ? null : "waiting";
    case "Stop":
      stoppedSessions.add(p.session_id);
      return "idle";
    default:
      return null;
  }
}
