export type SplitPaneIds = [string, string];

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

