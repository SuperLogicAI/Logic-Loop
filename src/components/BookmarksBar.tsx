import { useEffect, useState } from "react";
import type { Bookmark } from "../types";
import { PALETTE } from "../types";
import { hooksRemove, hooksSetup, hooksStatus } from "../lib/ingest";
import { getExtractorSettings, setExtractorSettings } from "../lib/repo";
import type { ExtractorSettings } from "../types";

interface Props {
  bookmarks: Bookmark[];
  onOpen: (b: Bookmark) => void;
  onAdd: (name: string, cwd: string, color: string) => void;
  onUpdate: (b: Bookmark) => void;
  onDelete: (id: number) => void;
}

interface FormState {
  id: number | null; // null = adding
  name: string;
  cwd: string;
  color: string;
}

export function BookmarksBar({ bookmarks, onOpen, onAdd, onUpdate, onDelete }: Props) {
  const [form, setForm] = useState<FormState | null>(null);
  const [menu, setMenu] = useState<{ id: number; x: number; y: number } | null>(null);
  const [hooksOn, setHooksOn] = useState<boolean | null>(null);
  const [extractor, setExtractor] = useState<ExtractorSettings | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    void hooksStatus().then(setHooksOn).catch(() => setHooksOn(null));
    void getExtractorSettings().then(setExtractor).catch(() => undefined);
  }, []);

  const saveExtractor = (s: ExtractorSettings) => {
    setExtractor(s);
    void setExtractorSettings(s).catch(() => undefined);
  };

  const toggleHooks = async () => {
    try {
      if (hooksOn) {
        await hooksRemove();
        setHooksOn(false);
      } else {
        await hooksSetup();
        setHooksOn(true);
      }
    } catch (e) {
      console.error("hooks toggle failed:", e);
    }
  };

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
    <div className="relative flex items-center gap-1.5 border-b border-zinc-800 bg-zinc-900 px-2 py-1">
      {bookmarks.map((b) => (
        <button
          key={b.id}
          onClick={() => onOpen(b)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ id: b.id, x: e.clientX, y: e.clientY });
          }}
          className="flex items-center gap-1.5 rounded-full bg-zinc-800 px-3 py-0.5 text-xs text-zinc-300 hover:bg-zinc-700"
          title={b.cwd}
        >
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: b.color }} />
          {b.name}
        </button>
      ))}
      <button
        className="rounded-full px-2 py-0.5 text-xs text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
        onClick={() => setForm({ id: null, name: "", cwd: "", color: PALETTE[0] })}
      >
        ＋ bookmark
      </button>
      <button
        className={`ml-auto rounded-full px-3 py-0.5 text-xs ${
          hooksOn
            ? "bg-emerald-900 text-emerald-300 hover:bg-emerald-800"
            : "animate-pulse bg-amber-900/60 font-semibold text-amber-300 hover:bg-amber-800/60"
        }`}
        onClick={() => void toggleHooks()}
        title="Toggle Claude Code hook ingestion in ~/.claude/settings.json"
      >
        {hooksOn === null ? "hooks ?" : hooksOn ? "hooks on" : "⚠ hooks off — panels & dots inactive"}
      </button>
      <button
        className="flex items-center gap-1 rounded-full px-2 py-0.5 text-sm text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
        onClick={() => setShowSettings((s) => !s)}
        title="Choose the model that extracts decisions for the sidebar"
      >
        <span className="text-xl leading-none">⚙</span>
        <span>Sidebar LM</span>
      </button>
      {showSettings && extractor && (
        <div className="absolute top-full right-2 z-20 mt-1 flex w-64 flex-col gap-2 rounded-md border border-zinc-700 bg-zinc-800 p-3 text-xs shadow-xl">
          <span className="font-semibold text-zinc-300">Decision extractor</span>
          <label className="flex items-center gap-2 text-zinc-300">
            <input
              type="radio"
              checked={extractor.backend === "claude"}
              onChange={() => saveExtractor({ ...extractor, backend: "claude" })}
            />
            claude CLI (default)
          </label>
          <label className="flex items-center gap-2 text-zinc-300">
            <input
              type="radio"
              checked={extractor.backend === "lmstudio"}
              onChange={() => saveExtractor({ ...extractor, backend: "lmstudio" })}
            />
            LM Studio (local)
          </label>
          {extractor.backend === "lmstudio" && (
            <>
              <input
                className="rounded bg-zinc-900 px-2 py-1 text-zinc-200 outline-none"
                placeholder="http://127.0.0.1:1234"
                value={extractor.lmstudioUrl}
                onChange={(e) => saveExtractor({ ...extractor, lmstudioUrl: e.target.value })}
              />
              <input
                className="rounded bg-zinc-900 px-2 py-1 text-zinc-200 outline-none"
                placeholder="model (blank = loaded model)"
                value={extractor.lmstudioModel}
                onChange={(e) => saveExtractor({ ...extractor, lmstudioModel: e.target.value })}
              />
            </>
          )}
          <button className="self-end text-zinc-400 hover:text-zinc-200" onClick={() => setShowSettings(false)}>
            Close
          </button>
        </div>
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
