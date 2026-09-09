import { useEffect, useState } from "react";
import { loadFileDiff } from "../lib/diff";
import { basename } from "../lib/repo";

interface Props {
  filePath: string; // agent-reported path off the Accomplished row
  cwd: string; // active tab's project dir, the fallback repo to ask
  onClose: () => void;
}

/** Read-only diff pop-out for an Accomplished row. Raw unified diff, no
 * highlighting and no editing — see docs/IDEAS.md for why the editable
 * version is not wanted. A lookup that finds nothing renders the empty
 * state rather than throwing into the panel tree. */
export function DiffModal({ filePath, cwd, onClose }: Props) {
  const [diff, setDiff] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadFileDiff(filePath, cwd)
      .catch(() => "")
      .then((text) => {
        if (!cancelled) setDiff(text);
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
        className="flex max-h-[80vh] w-[48rem] max-w-[90vw] flex-col rounded-lg border border-emerald-800/60 bg-zinc-900 p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold text-emerald-300">{basename(filePath)}</h3>
        <p className="mb-2 truncate font-mono text-[10px] text-zinc-600" title={filePath}>
          {filePath}
        </p>
        {diff === null ? (
          <p className="text-xs text-zinc-500">Loading diff…</p>
        ) : diff === "" ? (
          <p className="text-xs text-zinc-500">
            No staged diff for this file. The app can only read staged changes
            (<span className="font-mono">git diff --cached</span>), so an edit the agent hasn't
            staged — or a file outside this project's repo — shows nothing here.
          </p>
        ) : (
          <pre className="overflow-auto rounded bg-black/30 p-2 font-mono text-[11px] whitespace-pre text-zinc-300">
            {diff}
          </pre>
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
