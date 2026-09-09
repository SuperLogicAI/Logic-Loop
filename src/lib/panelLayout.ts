import type { PanelMode } from "../types";

export const PANEL_DEFAULT_WIDTH = 288;
export const PANEL_MIN_WIDTH = 192;
export const PANEL_MAX_WIDTH = 512;
export const PANEL_COMPACT_WIDTH = 48;

export type VisiblePanelMode = Exclude<PanelMode, "hidden">;

export function parsePanelMode(value: string | null): PanelMode {
  return value === "compact" || value === "hidden" || value === "expanded" ? value : "expanded";
}

export function clampPanelWidth(value: number): number {
  if (!Number.isFinite(value)) return PANEL_DEFAULT_WIDTH;
  return Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, value));
}

export function togglePanelMode(
  current: PanelMode,
  lastVisible: VisiblePanelMode
): { mode: PanelMode; lastVisible: VisiblePanelMode } {
  if (current === "hidden") return { mode: lastVisible, lastVisible };
  const mode = current === "expanded" ? "compact" : "expanded";
  return { mode, lastVisible: mode };
}

export function togglePanelHidden(
  current: PanelMode,
  lastVisible: VisiblePanelMode
): { mode: PanelMode; lastVisible: VisiblePanelMode } {
  if (current === "hidden") return { mode: lastVisible, lastVisible };
  return { mode: "hidden", lastVisible: current };
}
