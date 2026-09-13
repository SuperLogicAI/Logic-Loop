// Open-decision reconciliation: submitted user reply -> existing decision IDs.
// Pure prompt and validation contract only; I/O remains in the ingestion layer.

export interface ReconciliationCandidate {
  id: number;
  question: string;
  assumption: string | null;
  ts: number;
}

const MAX_REPLY_CHARS = 8_000;

/** The exact observed reply, capped before it enters a database row. */
export function boundedSubmittedReply(submittedReply: string): string {
  return submittedReply.slice(0, MAX_REPLY_CHARS);
}

/** Answer-now (`App.tsx`'s `answerNow`) always writes the reply as
 * `Re: "<question>" — <answer...>`. When the submitted reply carries that
 * exact prefix for one of the session's open candidates, it deterministically
 * names its own target — no model call needed. Returns the matched candidate
 * id, or null when the reply isn't an Answer-now reply (or names no open
 * candidate verbatim, e.g. the card was dismissed after the prompt was
 * prefilled) — the only way an open decision closes, besides manual
 * dismiss. */
export function matchAnswerNowReply(
  candidates: ReconciliationCandidate[],
  submittedReply: string
): number | null {
  if (!submittedReply.startsWith('Re: "')) return null;
  const match = candidates.find((c) => submittedReply.startsWith(`Re: "${c.question}" — `));
  return match ? match.id : null;
}
