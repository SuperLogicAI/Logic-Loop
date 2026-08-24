import { useEffect, useState } from "react";
import { gitBranches } from "../lib/pty";
import { sanitizeSlug } from "../lib/worktree";

interface Props {
  parentCwd: string;
  onLaunch: (opts: { branch: string; isNew: boolean }) => Promise<void>;
  onCancel: () => void;
}

/** "Isolate loop": spawn a tab bound to a fresh git worktree instead of the
 * current checkout, so a parallel work stream doesn't collide with tabs
 * already open on the same repo. Errors from the launch (git error, slug
 * collision) render inline and keep the modal open — never a silent failure
 * (invariant #2's foreground carve-out, same as Fan-out). */
export function IsolateLoopModal({ parentCwd, onLaunch, onCancel }: Props) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [newSlug, setNewSlug] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void gitBranches(parentCwd).then(setBranches).catch(() => setBranches([]));
  }, [parentCwd]);

  const slugPreview = sanitizeSlug(newSlug);
  const filtered = branches.filter((b) => b.toLowerCase().includes(filter.toLowerCase()));

  const launch = async () => {
    const opts =
      mode === "new" ? { branch: newSlug.trim(), isNew: true } : { branch: selected ?? "", isNew: false };
    if (!opts.branch) return;
    setError(null);
    setBusy(true);
    try {
      await onLaunch(opts);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-x-0 top-7 bottom-0 z-40 flex items-center justify-center bg-black/60"
      onClick={onCancel}
    >
      <div
        className="max-h-[85vh] w-[28rem] max-w-[90vw] overflow-y-auto rounded-lg border border-cyan-500/30 bg-zinc-900 p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold text-cyan-300">Isolate loop</h3>
        <p className="mb-3 text-xs text-zinc-500">
          Spawn a tab on a fresh git worktree, on a new or existing branch. Use it to run a
          separate work stream on this repo without touching tabs already checked out.
        </p>
        <div className="mb-3 flex gap-1 text-xs">
          <button
            className={`rounded px-2.5 py-1 ${mode === "new" ? "bg-cyan-500 text-black" : "text-zinc-400 hover:bg-zinc-800"}`}
            onClick={() => setMode("new")}
          >
            New branch
          </button>
          <button
            className={`rounded px-2.5 py-1 ${mode === "existing" ? "bg-cyan-500 text-black" : "text-zinc-400 hover:bg-zinc-800"}`}
            onClick={() => setMode("existing")}
          >
            Existing branch
          </button>
        </div>
        {mode === "new" ? (
          <div className="mb-4">
            <input
              className="w-full rounded bg-zinc-800 px-2 py-1 text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
              placeholder="try-x"
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
              autoFocus
            />
            {newSlug.trim() && (
              <p className="mt-1.5 font-mono text-[10px] text-zinc-500">
                branch: loop/{slugPreview} · dir: {slugPreview}
              </p>
            )}
          </div>
        ) : (
          <div className="mb-4">
            <input
              className="mb-2 w-full rounded bg-zinc-800 px-2 py-1 text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
              placeholder="Filter branches…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <ul className="max-h-48 overflow-y-auto rounded border border-zinc-800">
              {filtered.length === 0 && <li className="px-2 py-1.5 text-zinc-600">No branches</li>}
              {filtered.map((b) => (
                <li
                  key={b}
                  className={`cursor-pointer px-2 py-1.5 font-mono text-xs ${
                    selected === b ? "bg-cyan-500/20 text-cyan-200" : "text-zinc-300 hover:bg-zinc-800"
                  }`}
                  onClick={() => setSelected(b)}
                >
                  {b}
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && <p className="mb-3 text-xs text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 text-sm">
          <button className="rounded px-3 py-1 text-zinc-400 hover:text-zinc-200" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="rounded bg-cyan-500 px-3 py-1 font-medium text-black hover:bg-cyan-400 disabled:opacity-50"
            onClick={() => void launch()}
            disabled={busy || (mode === "new" ? !newSlug.trim() : !selected)}
          >
            {busy ? "Launching…" : "Launch"}
          </button>
        </div>
      </div>
    </div>
  );
}
