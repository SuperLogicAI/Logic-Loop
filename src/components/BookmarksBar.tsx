import { useState } from "react";
import type { Bookmark } from "../types";
import { PALETTE } from "../types";

interface Props {
  bookmarks: Bookmark[];
  onOpen: (b: Bookmark) => void;
  onAdd: (name: string, cwd: string, color: string) => void;
  onUpdate: (b: Bookmark) => void;
  onDelete: (id: number) => void;
  onReorder: (srcId: number, dstId: number) => void;
}

interface FormState {
  id: number | null; // null = adding
  name: string;
  cwd: string;
  color: string;
}

export function BookmarksBar({ bookmarks, onOpen, onAdd, onUpdate, onDelete, onReorder }: Props) {
  const [form, setForm] = useState<FormState | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ id: number; x: number; y: number } | null>(null);

  const submit = () => {
    if (!form || !form.name.trim()) return;
    const cwd = form.cwd.trim() || "~"; // empty/nonexistent cwd falls back to home in pty_spawn
    if (form.id === null) {
      onAdd(form.name.trim(), cwd, form.color);
    } else {
      const orig = bookmarks.find((b) => b.id === form.id);
      if (orig) onUpdate({ ...orig, name: form.name.trim(), cwd, color: form.color });
    }
    setForm(null);
  };

  return (
    // data-tauri-drag-region: empty bar space moves the window
    <div
      data-tauri-drag-region
      onPointerUp={() => setDragId(null)}
      onPointerLeave={() => setDragId(null)}
      className="relative flex select-none items-center gap-1.5 border-b border-zinc-800 bg-zinc-900 px-2 py-1"
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
            className={`flex shrink-0 items-center gap-1.5 rounded-full bg-zinc-800 px-3 py-0.5 text-xs text-zinc-300 transition-[background-color,opacity] hover:bg-zinc-700 ${
              dragId === b.id ? "opacity-60 ring-1 ring-zinc-500" : ""
            }`}
            title={b.cwd}
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: b.color }} />
            {b.name}
          </button>
        ))}
        <button
          className="shrink-0 rounded-full px-2 py-0.5 text-xs text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
          onClick={() => setForm({ id: null, name: "", cwd: "", color: PALETTE[0] })}
        >
          ＋ bookmark
        </button>

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
                if (b) setForm({ id: b.id, name: b.name, cwd: b.cwd, color: b.color });
                setMenu(null);
              }}
            >
              Edit
            </button>
            <button
              className="px-4 py-1 text-left text-red-400 hover:bg-zinc-700"
              onClick={() => {
                onDelete(menu.id);
                setMenu(null);
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
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <input
            className="w-64 rounded bg-zinc-900 px-2 py-1 text-zinc-200 outline-none"
            placeholder="Working directory (e.g. ~/Desktop/proj)"
            value={form.cwd}
            onChange={(e) => setForm({ ...form, cwd: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && submit()}
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
          <div className="flex justify-end gap-2">
            <button className="text-zinc-400 hover:text-zinc-200" onClick={() => setForm(null)}>
              Cancel
            </button>
            <button className="rounded bg-zinc-600 px-3 py-1 text-zinc-100 hover:bg-zinc-500" onClick={submit}>
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
