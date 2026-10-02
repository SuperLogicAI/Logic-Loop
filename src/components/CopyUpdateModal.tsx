import { useEffect, useMemo, useRef, useState } from "react";
import { buildUpdateMarkdown, copyDraft } from "../lib/dashboard";
import type { Blocker, Commit, Decision } from "../types";

export interface CopyUpdateData {
  projectName: string;
  rangeLabel: string;
  workLogExcerpts: string[];
  commits: Commit[];
  openDecisions: Decision[];
  openBlockers: Blocker[];
  nextStep: string | null;
}

interface Props {
  data: CopyUpdateData;
  onClose: () => void;
}

/** Plan 048 "Copy update": an editable draft, no model call, nothing sent or
 * written anywhere — the only side effect is the OS clipboard, and only when
 * the user clicks Copy. */
export function CopyUpdateModal({ data, onClose }: Props) {
  const draftSeed = useMemo(
    () =>
      buildUpdateMarkdown({
        projectName: data.projectName,
        rangeLabel: data.rangeLabel,
        progressLines: data.workLogExcerpts,
        commitSubjects: data.commits.map((c) => c.subject),
        decisionsNeeded: data.openDecisions.map((d) => ({ question: d.question, assumption: d.assumption })),
        blockerLines: data.openBlockers.map((b) => b.text),
        nextStep: data.nextStep,
      }),
    [data]
  );
  const [text, setText] = useState(draftSeed);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const dialogRef = useRef<HTMLDivElement>(null);
  const priorFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    priorFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    return () => priorFocusRef.current?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>('textarea, button:not([disabled])') ?? []
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // Clipboard denial is not a crash — the text stays on screen for a manual
  // select-all/copy, and the failure is announced with a retry.
  const copy = async () => {
    setCopyState(await copyDraft((t) => navigator.clipboard.writeText(t), text));
  };

  return (
    <div className="fixed inset-x-0 bottom-0 top-7 z-50 flex items-start justify-center bg-black/55 px-4 pt-[10vh]" role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Copy update"
        onKeyDown={onKeyDown}
        className="flex max-h-[75vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-100">Copy update — {data.projectName}</h2>
          <button type="button" aria-label="Close" title="Close (Esc)" className="text-xs text-zinc-500 hover:text-zinc-200" onClick={onClose}>
            Esc
          </button>
        </div>
        <p className="mt-1 text-[11px] text-zinc-500">
          Read it over and edit anything before copying — nothing here is sent anywhere automatically.
        </p>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setCopyState("idle");
          }}
          rows={14}
          className="mt-3 flex-1 resize-none rounded-md border border-zinc-700 bg-zinc-950 p-3 font-mono text-xs text-zinc-200 outline-none focus:border-sky-500"
        />
        {copyState === "failed" && (
          <p role="alert" className="mt-2 text-[11px] text-red-400">
            Couldn't copy to the clipboard. Select the text and press ⌘C, or try again.
          </p>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
            onClick={onClose}
          >
            Close
          </button>
          <button
            type="button"
            className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500"
            onClick={() => void copy()}
          >
            {copyState === "copied" ? "Copied!" : copyState === "failed" ? "Try again" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}
