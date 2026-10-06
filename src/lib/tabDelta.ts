import * as repo from "./repo";
import { hasDelta, summarizeDelta, type Delta } from "./delta";

/** Since-you-left digest for one live tab (Plan 050 Part C). Mirrors the
 * sidebar's read path. Tabs with no bound session are skipped: an unbound
 * tab could be a fan-out child, and the sidebar isolates those. null = nothing
 * to show (never left, no session, nothing new, or a read failed). */
export async function loadTabDelta(tab: { id: string; cwd: string; sessionId?: string }): Promise<Delta | null> {
  if (!tab.sessionId) return null;
  try {
    const since = await repo.lastLeft(tab.id);
    if (since == null) return null;
    const [rows, decisionsSince] = await Promise.all([
      repo.eventsSince(tab.id, tab.sessionId, since),
      repo.decisionsOpenedSince(tab.cwd, since),
    ]);
    const delta = summarizeDelta(rows, repo.scopeBySession(decisionsSince, tab.sessionId));
    return hasDelta(delta) ? delta : null;
  } catch {
    return null;
  }
}
