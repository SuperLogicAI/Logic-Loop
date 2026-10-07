import type { Decision, Note } from "../types";
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
  /** The caller's board pick: a Now-starred card if any, else the top planned card. */
  plannedCard: Card | null;
  onLandingDone: (note: Note) => Promise<void>;
  onDecisionDone: (decision: Decision) => Promise<void>;
  onPlannedCardDone: (card: Card) => Promise<void>;
}

/** Cascade (Plan 052): latest open landing note → Now-starred card → oldest
 *  open decision → unstarred planned card. Human-chosen work outranks
 *  extracted questions; blockers are never "next" (not startable work).
 *  Nothing open → null. Do not reorder without updating
 *  scripts/momentum-check.ts's fixtures. */
export function computeMomentum(input: MomentumInput): MomentumItem | null {
  const { landing, decisions, plannedCard, onLandingDone, onDecisionDone, onPlannedCardDone } = input;

  const oldestOpenDecision = decisions
    .filter((d) => d.status === "open")
    .reduce<Decision | null>((a, d) => (!a || d.ts < a.ts ? d : a), null);
  const planned = (card: Card): MomentumItem => ({
    label: "planned",
    text: card.next ?? card.title,
    done: () => onPlannedCardDone(card),
  });

  if (landing) return { label: "landing note", text: landing.body, done: () => onLandingDone(landing) };
  if (plannedCard?.now) return planned(plannedCard);
  if (oldestOpenDecision)
    return {
      label: "decision",
      // Wrapped like answerNow's prefill (App.tsx) — this is the agent's
      // question, seeding it verbatim would read as the user asking it back.
      text: `Re: "${oldestOpenDecision.question}" — `,
      done: () => onDecisionDone(oldestOpenDecision),
    };
  if (plannedCard) return planned(plannedCard);
  return null;
}
