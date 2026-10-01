import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";

// Bump to re-show the tour after a real redesign — separate from
// ONBOARDING_VERSION (src/lib/onboarding.ts), see repo.ts's TOUR_VERSION_KEY
// comment for why the two are independent. Bumped to 2 for Plan 048's new
// opening Home step — a profile that already saw v1 gets it once more.
export const TOUR_VERSION = 2;

interface Step {
  target: string;
  title: string;
  body: string;
}

// Order matches the panel's on-screen top-to-bottom layout. A step whose
// `data-tour-target` isn't mounted (e.g. Since You Left / Next only render
// once there's something to show) is dropped at tour-open time, never
// shown as a broken/empty card — fail open, same as every other panel.
const STEPS: Step[] = [
  {
    target: "home",
    title: "Home",
    body: "Every project you've opened, what changed, and what needs a choice — one screen. Click a project to see its Overview, then Continue into its workspace, which is where the panels below actually live.",
  },
  {
    target: "decisions",
    title: "Decisions",
    body: "When an agent hits a fork — two ways to do something, two questions in one message — it surfaces here instead of quietly deciding for you. Nothing here yet just means nothing's waited on you so far.",
  },
  {
    target: "since-left",
    title: "Since You Left",
    body: "A digest of what happened while this tab was out of view: files touched, commands run, decisions opened. Shows up once you've stepped away and come back.",
  },
  {
    target: "accomplished",
    title: "Accomplished",
    body: "Results the agent finished that you haven't acknowledged yet, plus a running log of file edits and tool activity.",
  },
  {
    target: "blockers",
    title: "Blockers",
    body: "Anything stopping real progress — detected automatically or added by hand — so you don't switch into a project only to find it's stuck.",
  },
  {
    target: "next",
    title: "Next",
    body: "The single lowest-friction next action for this project: an open decision, a blocker, or a starred idea — whichever's most worth doing right now.",
  },
  {
    target: "idea-board",
    title: "Idea Board",
    body: "A per-project kanban dock for ideas. Star up to three as “Now” and Next pulls from them first.",
  },
  {
    target: "attention",
    title: "Attention Inbox",
    body: "⌘K (Ctrl+K on Windows/Linux) opens a rollup of every open decision, unclaimed result, and blocker across all your projects — ranked by what needs you most.",
  },
  {
    target: "header-controls",
    title: "Header controls",
    body: "Lock-in silences notifications without stopping any panel or hook underneath. Split opens a second terminal side by side. Setup and Tour reopen from here any time.",
  },
];

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface Props {
  onClose: () => void;
}

const CARD_WIDTH = 320;
const GAP = 12;

const CARD_MIN_SPACE = 190;

function mountedTargets(): string[] {
  return STEPS.filter((s) => {
    const target = document.querySelector(`[data-tour-target="${s.target}"]`);
    // Workspace content stays mounted beneath Home, but display:none targets
    // cannot provide a spotlight. Include only targets that have layout.
    return target !== null && target.getClientRects().length > 0;
  }).map((s) => s.target);
}

// Clip to the viewport so a section taller than the window (or scrolled
// partly off) still gets an on-screen spotlight and card.
function visibleRect(rect: Rect): Rect {
  const top = Math.max(0, rect.top);
  const bottom = Math.min(window.innerHeight, rect.top + rect.height);
  return { ...rect, top, height: Math.max(0, bottom - top) };
}

function cardStyle(rect: Rect | null): CSSProperties {
  if (!rect) {
    return { top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: CARD_WIDTH };
  }
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const spaceBelow = viewportH - (rect.top + rect.height);
  const left = Math.min(Math.max(GAP, rect.left), Math.max(GAP, viewportW - CARD_WIDTH - GAP));
  if (spaceBelow >= CARD_MIN_SPACE) {
    return { top: rect.top + rect.height + GAP, left, width: CARD_WIDTH };
  }
  if (rect.top >= CARD_MIN_SPACE) {
    return { bottom: viewportH - rect.top + GAP, left, width: CARD_WIDTH };
  }
  // Target fills the viewport — dock the card over its bottom edge.
  return { bottom: GAP, left, width: CARD_WIDTH };
}

/** Guided, skippable spotlight tour over the real side-panel sections — no
 * fake data seeded into any panel (Phase 47). Fails open: a target that
 * isn't mounted is dropped from the step list rather than shown broken, and
 * an empty step list closes the tour instead of rendering nothing useful. */
export function FeatureTour({ onClose }: Props) {
  // Targets can mount after the tour opens (compact → expanded panel), so
  // re-check periodically instead of freezing the list at open time.
  const [present, setPresent] = useState<string[]>(mountedTargets);
  useEffect(() => {
    const id = setInterval(() => {
      const now = mountedTargets();
      setPresent((prev) => (prev.join() === now.join() ? prev : now));
    }, 300);
    return () => clearInterval(id);
  }, []);
  const activeSteps = useMemo(() => STEPS.filter((s) => present.includes(s.target)), [present]);
  const [stepId, setStepId] = useState<string | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const total = activeSteps.length;
  const step = activeSteps.find((s) => s.target === stepId) ?? activeSteps[0];
  const index = step ? activeSteps.indexOf(step) : 0;

  useEffect(() => {
    if (total > 0) return;
    const t = setTimeout(onClose, 1000);
    return () => clearTimeout(t);
  }, [total, onClose]);

  const next = () => {
    if (index + 1 >= total) onClose();
    else setStepId(activeSteps[index + 1].target);
  };
  const back = () => {
    if (index > 0) setStepId(activeSteps[index - 1].target);
  };

  useLayoutEffect(() => {
    if (!step) return;
    const el = document.querySelector<HTMLElement>(`[data-tour-target="${step.target}"]`);
    if (!el) {
      setRect(null);
      return;
    }
    const update = () => setRect(visibleRect(el.getBoundingClientRect()));
    update();
    // A section taller than the viewport can't be centered — show its top.
    const tall = el.getBoundingClientRect().height > window.innerHeight * 0.6;
    el.scrollIntoView({ block: tall ? "start" : "center", behavior: "smooth" });
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [step]);

  useEffect(() => {
    nextRef.current?.focus();
  }, [step]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "Tab") {
        // Keep focus inside the card — the overlay is modal.
        const focusables = Array.from(
          cardRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? []
        );
        if (focusables.length === 0) return event.preventDefault();
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (!cardRef.current?.contains(active)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        } else if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      } else if (event.key === "ArrowRight" || (event.key === "Enter" && !(event.target instanceof HTMLButtonElement))) {
        event.preventDefault();
        next();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        back();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [next, back, onClose]);

  if (!step) return null;

  const spotlightStyle: CSSProperties = rect
    ? {
        top: rect.top - 6,
        left: rect.left - 6,
        width: rect.width + 12,
        height: rect.height + 12,
        boxShadow:
          "0 0 0 9999px rgba(0,0,0,0.72), 0 0 0 3px rgba(56,189,248,0.9), 0 0 26px 6px rgba(56,189,248,0.5)",
      }
    : { top: 0, left: 0, width: 0, height: 0, boxShadow: "0 0 0 9999px rgba(0,0,0,0.72)" };

  return (
    <>
      <div className="fixed inset-0 z-40" role="presentation" />
      <div
        className="pointer-events-none fixed z-40 rounded-lg transition-all duration-200"
        style={spotlightStyle}
      />
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-step-title"
        className="fixed z-50 rounded-lg border border-sky-500/40 bg-zinc-950 p-3.5 text-xs text-zinc-300 shadow-2xl transition-all duration-200"
        style={cardStyle(rect)}
      >
        <div className="mb-2 flex items-center justify-between text-[10px] text-zinc-500">
          <span>
            {index + 1} of {total}
          </span>
          <button type="button" onClick={onClose} className="hover:text-zinc-200">
            Skip tour
          </button>
        </div>
        <h3 id="tour-step-title" className="mb-1 font-semibold text-zinc-100">
          {step.title}
        </h3>
        <p className="mb-3 leading-5 text-zinc-400">{step.body}</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={back}
            disabled={index === 0}
            aria-label="Previous"
            className="rounded px-2 py-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close tour"
            className="rounded px-2 py-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          >
            ×
          </button>
          <button
            ref={nextRef}
            type="button"
            onClick={next}
            className="ml-auto rounded bg-sky-600 px-3 py-1 font-medium text-white hover:bg-sky-500 focus-visible:outline-2 focus-visible:outline-sky-300"
          >
            {index + 1 === total ? "Done" : "›"}
          </button>
        </div>
      </div>
    </>
  );
}
