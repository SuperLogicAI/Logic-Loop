import { useEffect, useRef, useState } from "react";
import { draftLandingNote } from "../lib/landing";
import { HUES, RainbowText, cycle } from "./RainbowText";

interface Props {
  projectName: string;
  sessionId: string | null;
  onSave: (body: string) => void;
  onSkip: () => void;
}

const SECONDS = 60;
const R = 20;
const C = 2 * Math.PI * R;

// Continuous sweep, 0 = red → 270 = violet. Drives the countdown ring.
// 62% lightness keeps yellow and green legible on the dark card.
const roygbv = (t: number) => `hsl(${t * 270} 85% 62%)`;

const RAINBOW_GRADIENT = `linear-gradient(135deg, ${HUES.map((_, i) => cycle(i, 0.6)).join(", ")})`;

/** Leaving a tab with recent agent activity → capture the next physical action.
 *  Never hostage: Esc skips, and the countdown auto-skips at zero. */
export function LandingNoteModal({ projectName, sessionId, onSave, onSkip }: Props) {
  const [body, setBody] = useState("");
  const [remaining, setRemaining] = useState(SECONDS);
  const [drafting, setDrafting] = useState(!!sessionId);
  const touched = useRef(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  // stable callbacks for the timer/keydown effects
  const skipRef = useRef(onSkip);
  skipRef.current = onSkip;

  useEffect(() => {
    areaRef.current?.focus();
  }, []);

  // Esc skips no matter where focus sits — clicking the overlay must not
  // strand the user (never hostage).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        skipRef.current();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Pre-draft: fill the textarea unless the user already typed. Late arrivals
  // (modal still open) fill; if it unmounted first, the setState is a no-op.
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    void draftLandingNote(sessionId).then((draft) => {
      if (cancelled) return;
      setDrafting(false);
      if (draft && !touched.current) {
        setBody(draft);
        areaRef.current?.setSelectionRange(draft.length, draft.length);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Countdown → auto-skip at zero.
  useEffect(() => {
    const iv = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(iv);
          skipRef.current();
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  const save = () => {
    const text = body.trim();
    if (text) onSave(text);
    else onSkip();
  };

  return (
    // top-7 keeps the titlebar drag region reachable under the overlay
    <div className="fixed inset-x-0 top-7 bottom-0 z-40 flex items-center justify-center bg-black/60">
      <div className="w-[32rem] max-w-[90vw] rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-xl">
        <div className="mb-2 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold">
              <RainbowText text={`Landing note — ${projectName}`} />
            </h3>
            <p className="text-xs text-white/85">
              What's the next physical action here when you come back?
            </p>
          </div>
          <svg width="48" height="48" viewBox="0 0 48 48" className="shrink-0 -rotate-90">
            <circle cx="24" cy="24" r={R} fill="none" stroke="#3f3f46" strokeWidth="3" />
            <circle
              cx="24"
              cy="24"
              r={R}
              fill="none"
              // Runs the sweep backwards: violet with a full minute left,
              // red in the last seconds.
              stroke={roygbv(remaining / SECONDS)}
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - remaining / SECONDS)}
              style={{ transition: "stroke-dashoffset 1s linear, stroke 1s linear" }}
            />
            <text
              x="24"
              y="24"
              textAnchor="middle"
              dominantBaseline="central"
              fill="rgb(255 255 255 / 0.4)"
              fontSize="13"
              // The <svg> is -rotate-90 so the ring starts at 12 o'clock; undo
              // it here or the digits read sideways.
              transform="rotate(90 24 24)"
            >
              {remaining}
            </text>
          </svg>
        </div>
        <textarea
          ref={areaRef}
          className="h-24 w-full resize-none rounded bg-zinc-800 p-2 text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
          placeholder={drafting ? "Drafting a suggestion…" : "e.g. reply to the agent's auth-scope question, then rerun tests"}
          value={body}
          onChange={(e) => {
            touched.current = true;
            setBody(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              save();
            }
          }}
        />
        <div className="mt-3 flex justify-end gap-2 text-sm">
          <button className="rounded px-3 py-1 text-zinc-400 hover:text-zinc-200" onClick={onSkip}>
            Skip
          </button>
          <button
            className="rounded border-2 border-transparent px-3 py-1 font-medium text-white hover:brightness-125"
            // Gradient border: charcoal fill clipped to the padding box, rainbow
            // clipped to the border box. hover uses brightness because the
            // background is inline and can't be swapped by a hover: class.
            style={{
              background: `linear-gradient(#18181b, #18181b) padding-box, ${RAINBOW_GRADIENT} border-box`,
            }}
            onClick={save}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
