/** Plan 051: a decision is stale when it is open, older than 14 days, and its
 * session has been dormant (no events) for 14 days. Derived on every read; no
 * rows are rewritten and nothing is stored (invariant #3). There is no reliable
 * "session ended" signal for Claude Code, so dormancy stands in for it. */
export const STALE_DECISION_DAYS = 14;

const DAY_MS = 86_400_000;

/** SQL predicate over the `decisions` table (qualify by table name, not alias).
 * The cutoff is an integer computed here and inlined, never user input. */
export function staleDecisionSql(now: number = Date.now()): string {
  const cutoff = Math.floor(now - STALE_DECISION_DAYS * DAY_MS);
  return `(decisions.status = 'open' AND decisions.ts < ${cutoff}
    AND NOT EXISTS (SELECT 1 FROM events se WHERE se.session_id = decisions.session_id AND se.ts >= ${cutoff}))`;
}
