import type { ExtractorSettings } from "../types";

/** Plan 050 Part B: fired after Sidebar LM settings change so the sidebar header re-evaluates. */
export const SIDEBAR_CONTROLS_REFRESH = "sidebar-controls-refresh";

/** Traffic kind from the Safe Router log read; null = not read yet. */
export type TrafficKind = "missing" | "v1" | "ready" | "error" | null;

/** Unknown ≠ Absent: an unreadable log (error) keeps Traffic visible. Only a
 * definite "missing" hides it, and never for a user who has seen a real log. */
export function showTraffic(kind: TrafficKind, seen: boolean): boolean {
  return seen || (kind !== null && kind !== "missing");
}

/** Sidebar LM: an explicit user choice (`pinned`, from the Setup toggle) wins.
 * With no choice (null) it shows once a local/non-default extractor is
 * configured; an unreadable settings read ("error") keeps it visible; null
 * settings = not read yet. */
export function showSidebarLm(settings: ExtractorSettings | "error" | null, pinned: boolean | null = null): boolean {
  if (pinned !== null) return pinned;
  if (settings === null) return false;
  if (settings === "error") return true;
  return settings.backend !== "claude" || settings.claudeModel !== "";
}
