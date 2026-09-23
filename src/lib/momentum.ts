import type { Blocker, Decision, Note } from "../types";
import type { Card } from "./board";

/** One "what's next" pick and how to resolve it. Pure display data plus a
 *  caller-supplied resolver — this module decides *which* source wins, the
 *  caller still owns the actual write. */
export interface MomentumItem {
  label: string;
  text: string;
  done: () => Promise<void>;
}

export interface MomentumInput {
  landing: Note | null;
  decisions: Decision[];
  blockers: Blocker[];
  plannedCard: Card | null;
  onLandingDone: (note: Note) => Promise<void>;
  onDecisionDone: (decision: Decision) => Promise<void>;
  onBlockerDone: (blocker: Blocker) => Promise<void>;
  onPlannedCardDone: (card: Card) => Promise<void>;
}

/** Cascade: latest open landing note → oldest open decision → oldest open
 *  blocker → planned board card. Nothing open → null. Extracted verbatim
 *  from SidePanel's prior inline logic (Plan 043) — do not reorder without
 *  updating scripts/momentum-check.ts's characterization fixtures. */
export function computeMomentum(input: MomentumInput): MomentumItem | null {
  const { landing, decisions, blockers, plannedCard, onLandingDone, onDecisionDone, onBlockerDone, onPlannedCardDone } =
    input;

  const oldestOpenDecision = decisions
    .filter((d) => d.status === "open")
    .reduce<Decision | null>((a, d) => (!a || d.ts < a.ts ? d : a), null);
  const oldestOpenBlocker = blockers
    .filter((b) => b.resolved === 0)
    .reduce<Blocker | null>((a, b) => (!a || b.ts < a.ts ? b : a), null);

  if (landing) return { label: "landing note", text: landing.body, done: () => onLandingDone(landing) };
  if (oldestOpenDecision)
    return {
      label: "decision",
      // Wrapped like answerNow's prefill (App.tsx) — this is the agent's
      // question, seeding it verbatim would read as the user asking it back.
      text: `Re: "${oldestOpenDecision.question}" — `,
      done: () => onDecisionDone(oldestOpenDecision),
    };
  if (oldestOpenBlocker)
    return { label: "blocker", text: oldestOpenBlocker.text, done: () => onBlockerDone(oldestOpenBlocker) };
  if (plannedCard)
    return {
      label: "planned",
      text: plannedCard.next ?? plannedCard.title,
      done: () => onPlannedCardDone(plannedCard),
    };
  return null;
}
