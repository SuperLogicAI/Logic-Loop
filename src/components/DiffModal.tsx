import { useEffect, useMemo, useState } from "react";
import { diffLineRoles, loadFileDiff, type DiffLineRole, type DiffSource, type FileDiff } from "../lib/diff";
import { basename } from "../lib/repo";
import { OpenInEditor } from "./OpenInEditor";

// Semantic roles (Plan 050) so Lock-in greys these with everything else.
const LINE_CLASS: Record<DiffLineRole, string> = {
  meta: "text-zinc-500",
  hunk: "text-info-300",
  add: "text-ok-300",
  del: "text-danger-300",
  ctx: "",
};

const SOURCE_LABEL: Record<DiffSource, string> = {
  head: "Uncommitted changes (vs last commit)",
  staged: "Staged changes (no commits yet)",
  new: "New file, not tracked by git yet",
};

// A new 1 MB file is ~20k lines of spans, enough to stall the modal.
const LINE_CAP = 3000;

interface Props {
  filePath: string; // agent-reported path off the Accomplished row
  cwd: string; // active tab's project dir, the fallback repo to ask
  onClose: () => void;
}

/** Read-only diff pop-out for an Accomplished row. Unified diff with +/-
 * line colours only — no syntax highlighting and no editing — see docs/IDEAS.md for why the editable
 * version is not wanted. A lookup that finds nothing renders the empty
 * state rather than throwing into the panel tree. */
export function DiffModal({ filePath, cwd, onClose }: Props) {
  const [diff, setDiff] = useState<FileDiff | null | undefined>(undefined); // undefined = loading
  const lines = useMemo(() => (diff ? diff.text.split("\n") : []), [diff]);
  const roles = useMemo(() => diffLineRoles(lines), [lines]);
  const hidden = Math.max(0, lines.length - LINE_CAP);

  useEffect(() => {
    let cancelled = false;
    void loadFileDiff(filePath, cwd)
      .catch(() => null)
      .then((found) => {
        if (!cancelled) setDiff(found);
      });
    return () => {
      cancelled = true;
    };
  }, [filePath, cwd]);

  // Esc closes wherever focus sits — the overlay click alone strands a user
  // who scrolled inside the diff.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    // top-7 keeps the titlebar drag region reachable under the overlay
    <div
      className="fixed inset-x-0 top-7 bottom-0 z-40 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-[48rem] max-w-[90vw] flex-col rounded-lg border border-ok-800/60 bg-zinc-900 p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold text-ok-300">{basename(filePath)}</h3>
        <p className="mb-2 truncate font-mono text-[10px] text-zinc-600" title={filePath}>
          {filePath}
        </p>
        <div className="mb-2">
          <OpenInEditor cwd={cwd} path={filePath}
            buttonClass="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-800" />
        </div>
        {diff === undefined ? (
          <p className="text-xs text-zinc-500">Loading diff…</p>
        ) : diff === null ? (
          <p className="text-xs text-zinc-500">
            No uncommitted changes in this file. It may already be committed, ignored by git, or
            outside this project&apos;s repo. Open in editor to see the whole file.
          </p>
        ) : (
          <>
            <p className="text-xs text-zinc-300">{SOURCE_LABEL[diff.source]}</p>
            {diff.source === "head" && (
              <p className="text-[11px] text-zinc-500">
                Everything uncommitted in this file, not only this turn&apos;s edit.
              </p>
            )}
            <pre className="mt-2 overflow-auto rounded bg-black/30 p-2 font-mono text-[11px] whitespace-pre text-zinc-300">
              {lines.slice(0, LINE_CAP).map((line, i) => (
                <span key={i} className={LINE_CLASS[roles[i]]}>
                  {line}
                  {"\n"}
                </span>
              ))}
              {hidden > 0 && (
                <span className="text-zinc-500">
                  … {hidden.toLocaleString()} more lines. Open in editor to see the rest.
                </span>
              )}
            </pre>
          </>
        )}
        <div className="mt-3 flex justify-end text-sm">
          <button className="rounded px-3 py-1 text-zinc-400 hover:text-zinc-200" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
