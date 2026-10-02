import type { AppSurface } from "../types";

export type SplitPaneIds = [string, string];
export type SplitOrientation = "horizontal" | "vertical";

export function splitContains(pair: SplitPaneIds | null, tabId: string): boolean {
  return pair?.[0] === tabId || pair?.[1] === tabId;
}

/** Keep pane position stable: selecting a third tab replaces the focused pane. */
export function selectIntoSplit(
  pair: SplitPaneIds | null,
  focusedId: string | null,
  selectedId: string
): SplitPaneIds | null {
  if (!pair || splitContains(pair, selectedId)) return pair;
  return pair[1] === focusedId ? [pair[0], selectedId] : [selectedId, pair[1]];
}

export function visibleTerminalIds(
  activeId: string | null,
  pair: SplitPaneIds | null
): string[] {
  if (pair) return pair;
  return activeId ? [activeId] : [];
}

/** Plan 048: same as `visibleTerminalIds`, but empty outside the "workspace"
 * surface — Home and Project Overview show no live pane, even though
 * `activeId`/`pair` still point at one for when the user comes back. */
export function effectiveVisibleTerminalIds(
  surface: AppSurface,
  activeId: string | null,
  pair: SplitPaneIds | null
): string[] {
  if (surface.kind !== "workspace") return [];
  return visibleTerminalIds(activeId, pair);
}

/** Since-you-left anchors: the tabs that just stopped being visible, i.e. in
 * the previous effective visible set but not the next. A tab hidden behind
 * Home already left when Home opened — it must not be anchored again (that
 * later anchor would swallow a result it finished while unseen). */
export function departedTabIds(prev: readonly string[], next: readonly string[]): string[] {
  return prev.filter((id) => !next.includes(id));
}
