import { useEffect, useState } from "react";
import {
  codexDetect,
  codexHooksRemove,
  codexHooksSetup,
  codexHooksStatus,
  hooksRemove,
  hooksSetup,
  hooksStatus,
  opencodeDetect,
  opencodeHooksRemove,
  opencodeHooksSetup,
  opencodeHooksStatus,
} from "../lib/ingest";
import { getExtractorSettings, setExtractorSettings } from "../lib/repo";
import type { ExtractorSettings } from "../types";

/** Header row above the terminal pane, lined up with SidePanel's own
 * "project:/notify" header on the left. Was previously crammed into
 * BookmarksBar alongside bookmarks — grows with every adapter (Phase 8
 * added "opencode", more coming per ROADMAP.md v2 Adapters), and bookmarks
 * grow without bound too, so the two don't belong on the same row. */
export function AgentStatusBar() {
  const [hooksOn, setHooksOn] = useState<boolean | null>(null);
  const [opencodeAvailable, setOpencodeAvailable] = useState(false);
  const [opencodeOn, setOpencodeOn] = useState<boolean | null>(null);
  const [codexAvailable, setCodexAvailable] = useState(false);
  const [codexOn, setCodexOn] = useState<boolean | null>(null);
  const [extractor, setExtractor] = useState<ExtractorSettings | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    void hooksStatus().then(setHooksOn).catch(() => setHooksOn(null));
    void getExtractorSettings().then(setExtractor).catch(() => undefined);
    void opencodeDetect()
      .then((available) => {
        setOpencodeAvailable(available);
        if (available) void opencodeHooksStatus().then(setOpencodeOn).catch(() => setOpencodeOn(null));
      })
      .catch(() => setOpencodeAvailable(false));
    void codexDetect()
      .then((available) => {
        setCodexAvailable(available);
        if (available) void codexHooksStatus().then(setCodexOn).catch(() => setCodexOn(null));
      })
      .catch(() => setCodexAvailable(false));
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

  const toggleOpencodeHooks = async () => {
    try {
      if (opencodeOn) {
        await opencodeHooksRemove();
        setOpencodeOn(false);
      } else {
        await opencodeHooksSetup();
        setOpencodeOn(true);
      }
    } catch (e) {
      console.error("opencode hooks toggle failed:", e);
    }
  };

  const toggleCodexHooks = async () => {
    try {
      if (codexOn) {
        await codexHooksRemove();
        setCodexOn(false);
      } else {
        await codexHooksSetup();
        setCodexOn(true);
      }
    } catch (e) {
      console.error("codex hooks toggle failed:", e);
    }
  };

  return (
    <div className="relative flex h-10 shrink-0 items-center justify-end gap-1.5 border-b border-zinc-800 px-3">
      <button
        className={`rounded-full px-3 py-0.5 text-xs ${
          hooksOn
            ? "bg-emerald-900 text-emerald-300 hover:bg-emerald-800"
            : "animate-pulse bg-amber-900/60 font-semibold text-amber-300 hover:bg-amber-800/60"
        }`}
        onClick={() => void toggleHooks()}
        title="Toggle Claude Code hook ingestion in ~/.claude/settings.json"
      >
        {hooksOn === null ? "claude ?" : hooksOn ? "claude on" : "⚠ claude off — panels & dots inactive"}
      </button>
      {opencodeAvailable && (
        <button
          className={`rounded-full px-3 py-0.5 text-xs ${
            opencodeOn
              ? "bg-emerald-900 text-emerald-300 hover:bg-emerald-800"
              : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
          }`}
          onClick={() => void toggleOpencodeHooks()}
          title="Toggle the OpenCode adapter plugin in ~/.config/opencode/opencode.json"
        >
          {opencodeOn === null ? "opencode ?" : opencodeOn ? "opencode on" : "opencode off"}
        </button>
      )}
      {codexAvailable && (
        <button
          className={`rounded-full px-3 py-0.5 text-xs ${
            codexOn
              ? "bg-emerald-900 text-emerald-300 hover:bg-emerald-800"
              : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
          }`}
          onClick={() => void toggleCodexHooks()}
          title="Toggle the Codex adapter hooks in ~/.codex/hooks.json — Codex will ask you to trust the hook once in its own TUI on first use"
        >
          {codexOn === null ? "codex ?" : codexOn ? "codex on" : "codex off"}
        </button>
      )}
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
    </div>
  );
}
