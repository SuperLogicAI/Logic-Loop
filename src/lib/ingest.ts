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

/** Map a hook event to the tab's agent state; null = no state change. */
export function stateForHook(p: HookPayload): AgentState | null {
  switch (p.hook_event_name) {
    case "UserPromptSubmit":
      return "working";
    case "PostToolUse": {
      const resp = p["tool_response"];
      const isError =
        typeof resp === "object" && resp !== null && (resp as Record<string, unknown>)["is_error"] === true;
      return isError ? "error" : "working";
    }
    case "Notification":
      return "waiting";
    case "Stop":
      return "idle";
    default:
      return null;
  }
}
