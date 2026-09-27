import type { Tab } from "../types";

/** A resumed tab knows its session before Codex's lazy first SessionStart.
 * The in-memory binding cache is still empty then, so allow only the active
 * live tab with that exact persisted session as a fallback. */
export function decisionReplyTab(
  tabs: readonly Tab[],
  sessionId: string,
  boundTabId: string | undefined,
  activeTabId: string | null
): Tab | null {
  const eligible = (tab: Tab) => tab.status === "live" && tab.sessionId === sessionId;
  const bound = tabs.find((tab) => tab.id === boundTabId && eligible(tab));
  if (bound) return bound;
  return tabs.find((tab) => tab.id === activeTabId && eligible(tab)) ?? null;
}
