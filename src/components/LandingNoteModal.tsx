import { useEffect, useRef, useState } from "react";
import { draftLandingNote } from "../lib/landing";

interface Props {
  projectName: string;
  sessionId: string | null;
  onSave: (body: string) => void;
  onSkip: () => void;
}

const SECONDS = 60;
const R = 20;
const C = 2 * Math.PI * R;

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
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onSkip();
        }
      }}
    >
      <div className="w-[32rem] max-w-[90vw] rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-xl">
        <div className="mb-2 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-teal-300">Landing note — {projectName}</h3>
            <p className="text-xs text-zinc-500">
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
              stroke="#2dd4bf"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - remaining / SECONDS)}
              style={{ transition: "stroke-dashoffset 1s linear" }}
            />
            <text x="24" y="28" textAnchor="middle" className="rotate-90" fill="#a1a1aa" fontSize="12" transform="rotate(90 24 24)">
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
          <button className="rounded bg-teal-700 px-3 py-1 text-zinc-100 hover:bg-teal-600" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
