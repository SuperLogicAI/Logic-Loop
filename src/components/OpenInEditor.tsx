import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { getEditorApp, setEditorApp, DEFAULT_EDITOR_APP } from "../lib/repo";

interface Props {
  cwd: string; // project dir: the containment root for `open_in_editor`
  path?: string; // agent-reported file; omitted = open the project folder
  buttonClass: string;
}

/** Plan 061: hand a file or the project to the user's real editor instead of
 * editing in-app (docs/IDEAS.md "Editor-native users"). Containment and the
 * never-the-default-handler rule live in Rust (`pty::open_in_editor`). */
export function OpenInEditor({ cwd, path, buttonClass }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const showEditorInput = async () => {
    setDraft(await getEditorApp().catch(() => DEFAULT_EDITOR_APP));
    setEditing(true);
  };

  const open = async () => {
    setError(null);
    try {
      await invoke("open_in_editor", { cwd, path: path ?? null, editor: await getEditorApp() });
    } catch (e) {
      setError(String(e));
      void showEditorInput();
    }
  };

  const reveal = async () => {
    setError(null);
    // Reveal executes nothing, so no containment — just make it absolute.
    const target = !path ? cwd : path.startsWith("/") ? path : `${cwd.replace(/\/$/, "")}/${path}`;
    await revealItemInDir(target).catch((e) => setError(String(e)));
  };

  const save = async () => {
    if (!draft.trim()) return;
    await setEditorApp(draft).catch(() => undefined);
    setEditing(false);
    setError(null);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={buttonClass} onClick={() => void reveal()}>
          Show in Finder
        </button>
        {/* Open in editor last so "change editor" sits beside the action it configures */}
        <button type="button" className={buttonClass} onClick={() => void open()}>
          Open in editor
        </button>
        {!editing && (
          <button type="button" className="text-[10px] text-zinc-500 hover:text-zinc-300" onClick={() => void showEditorInput()}>
            change editor
          </button>
        )}
      </div>
      {error && <p role="alert" className="text-xs text-attn-400">{error}</p>}
      {editing && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="text-zinc-500" htmlFor="editor-app">Editor app:</label>
          <input id="editor-app" value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); void save(); }
              if (e.key === "Escape") { e.stopPropagation(); setEditing(false); }
            }}
            placeholder={DEFAULT_EDITOR_APP}
            className="w-48 rounded border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-zinc-100 focus:border-info-500" />
          <button type="button" className="text-info-400" onClick={() => void save()}>Save</button>
          <button type="button" className="text-zinc-400" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}
