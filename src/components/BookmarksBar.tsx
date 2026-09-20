import { useState } from "react";
import type { Bookmark } from "../types";
import { PALETTE } from "../types";

interface Props {
  bookmarks: Bookmark[];
  onOpen: (b: Bookmark) => void;
  onAdd: (name: string, cwd: string, color: string) => Promise<void>;
  onUpdate: (b: Bookmark) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onReorder: (srcId: number, dstId: number) => void;
}

interface FormState {
  id: number | null; // null = adding
  name: string;
  cwd: string;
  color: string;
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function BookmarksBar({ bookmarks, onOpen, onAdd, onUpdate, onDelete, onReorder }: Props) {
  const [form, setForm] = useState<FormState | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ id: number; x: number; y: number } | null>(null);
  const [pending, setPending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Only clears the form on confirmed persistence — a rejected write keeps
  // the user's fields and shows a retryable error instead of silently
  // discarding the edit (plan033).
  const submit = async () => {
    if (!form || !form.name.trim() || pending) return;
    const cwd = form.cwd.trim() || "~"; // empty/nonexistent cwd falls back to home in pty_spawn
    setPending(true);
    setSaveError(null);
    try {
      if (form.id === null) {
        await onAdd(form.name.trim(), cwd, form.color);
      } else {
        const orig = bookmarks.find((b) => b.id === form.id);
        if (orig) await onUpdate({ ...orig, name: form.name.trim(), cwd, color: form.color });
      }
      setForm(null);
    } catch (error) {
      setSaveError(errorMessage(error));
    } finally {
      setPending(false);
    }
  };

  return (
    // Tauri drag region: empty bar space moves the window
    <div
      data-tauri-drag-region="deep"
      onPointerUp={() => setDragId(null)}
      onPointerLeave={() => setDragId(null)}
      className="relative flex select-none items-center gap-1.5 border-t border-b border-zinc-700 bg-zinc-800 px-2 py-1"
    >
      {bookmarks.map((b) => (
          <button
            key={b.id}
            onClick={() => onOpen(b)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ id: b.id, x: e.clientX, y: e.clientY });
            }}
            // ponytail: pointer events, not HTML5 drag — see TabBar.tsx; the
            // webview's native drag-drop handler eats DOM drop events.
            onPointerDown={() => setDragId(b.id)}
            onPointerEnter={() => {
              if (dragId !== null && dragId !== b.id) onReorder(dragId, b.id);
            }}
            onPointerUp={() => setDragId(null)}
            className={`flex shrink-0 items-center gap-1.5 rounded-full border border-zinc-600 bg-zinc-900 py-0.5 pr-3 pl-2 text-xs text-zinc-300 transition-[background-color,border-color,opacity] hover:border-zinc-400 hover:bg-zinc-800 ${
              dragId === b.id ? "opacity-60 ring-1 ring-zinc-500" : ""
            }`}
            title={b.cwd}
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: b.color }} />
            {b.name}
          </button>
        ))}
        <button
          className="shrink-0 rounded-full px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100"
          onClick={() => {
            setSaveError(null);
            setForm({ id: null, name: "", cwd: "", color: PALETTE[0] });
          }}
        >
          ＋ bookmark
        </button>

      {deleteError && (
        <span className="shrink-0 rounded-full bg-red-950/60 px-2 py-0.5 text-xs text-red-300">
          Delete failed: {deleteError}
        </span>
      )}

      {menu && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenu(null)} />
          <div
            className="fixed z-20 flex flex-col rounded-md border border-zinc-700 bg-zinc-800 py-1 text-xs text-zinc-200 shadow-xl"
            style={{ left: menu.x, top: menu.y }}
          >
            <button
              className="px-4 py-1 text-left hover:bg-zinc-700"
              onClick={() => {
                const b = bookmarks.find((x) => x.id === menu.id);
                if (b) {
                  setSaveError(null);
                  setForm({ id: b.id, name: b.name, cwd: b.cwd, color: b.color });
                }
                setMenu(null);
              }}
            >
              Edit
            </button>
            <button
              className="px-4 py-1 text-left text-red-400 hover:bg-zinc-700"
              onClick={() => {
                const id = menu.id;
                setMenu(null);
                setDeleteError(null);
                void onDelete(id).catch((error: unknown) => setDeleteError(errorMessage(error)));
              }}
            >
              Delete
            </button>
          </div>
        </>
      )}

      {form && (
        <div className="absolute top-full left-2 z-20 mt-1 flex flex-col gap-2 rounded-md border border-zinc-700 bg-zinc-800 p-3 text-xs shadow-xl">
          <input
            autoFocus
            className="rounded bg-zinc-900 px-2 py-1 text-zinc-200 outline-none"
            placeholder="Name"
            value={form.name}
            disabled={pending}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />
          <input
            className="w-64 rounded bg-zinc-900 px-2 py-1 text-zinc-200 outline-none"
            placeholder="Working directory (e.g. ~/Desktop/proj)"
            value={form.cwd}
            disabled={pending}
            onChange={(e) => setForm({ ...form, cwd: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />
          <div className="flex gap-1.5">
            {PALETTE.map((c) => (
              <button
                key={c}
                className={`h-5 w-5 rounded-full ${form.color === c ? "ring-2 ring-white" : ""}`}
                style={{ backgroundColor: c }}
                onClick={() => setForm({ ...form, color: c })}
              />
            ))}
          </div>
          {saveError && <p className="max-w-64 break-words text-red-400">{saveError}</p>}
          <div className="flex justify-end gap-2">
            <button
              className="text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
              disabled={pending}
              onClick={() => {
                setForm(null);
                setSaveError(null);
              }}
            >
              Cancel
            </button>
            <button
              className="rounded bg-zinc-600 px-3 py-1 text-zinc-100 hover:bg-zinc-500 disabled:opacity-50"
              disabled={pending}
              onClick={() => void submit()}
            >
              {pending ? "Saving…" : saveError ? "Retry" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
