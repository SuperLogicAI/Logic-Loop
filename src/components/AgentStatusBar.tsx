import { useEffect, useState } from "react";
import {
  antigravityDetect,
  antigravityHooksRemove,
  antigravityHooksSetup,
  antigravityHooksStatus,
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
import type { PanelMode } from "../types";
import { PanelIcon } from "./PanelIcon";

/** Persistent header above the terminal pane. Panel fold/expand stays at its
 * left edge in every presentation mode; alphabetized adapter controls stay
 * aligned on the right. Sidebar LM moved into SidePanel's utility row. */
export function AgentStatusBar({ panelMode, onTogglePanel }: { panelMode: PanelMode; onTogglePanel: () => void }) {
  const [hooksOn, setHooksOn] = useState<boolean | null>(null);
  const [opencodeAvailable, setOpencodeAvailable] = useState(false);
  const [opencodeOn, setOpencodeOn] = useState<boolean | null>(null);
  const [codexAvailable, setCodexAvailable] = useState(false);
  const [codexOn, setCodexOn] = useState<boolean | null>(null);
  const [antigravityAvailable, setAntigravityAvailable] = useState(false);
  const [antigravityOn, setAntigravityOn] = useState<boolean | null>(null);

  useEffect(() => {
    void hooksStatus().then(setHooksOn).catch(() => setHooksOn(null));
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
    void antigravityDetect()
      .then((available) => {
        setAntigravityAvailable(available);
        if (available)
          void antigravityHooksStatus().then(setAntigravityOn).catch(() => setAntigravityOn(null));
      })
      .catch(() => setAntigravityAvailable(false));
  }, []);

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

  const toggleAntigravityHooks = async () => {
    try {
      if (antigravityOn) {
        await antigravityHooksRemove();
        setAntigravityOn(false);
      } else {
        await antigravityHooksSetup();
        setAntigravityOn(true);
      }
    } catch (e) {
      console.error("antigravity hooks toggle failed:", e);
    }
  };

  const hookClass = (enabled: boolean | null, primary = false) =>
    `flex h-6 shrink-0 items-center rounded-full px-3 text-xs ${
      enabled
        ? "bg-emerald-900 text-emerald-300 hover:bg-emerald-800"
        : primary
          ? "animate-pulse bg-amber-900/60 font-semibold text-amber-300 hover:bg-amber-800/60"
          : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
    }`;

  return (
    <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-zinc-800 px-1.5">
      <button
        type="button"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-sky-400"
        aria-label={panelMode === "expanded" ? "Fold project panel" : "Expand project panel"}
        title={panelMode === "expanded" ? "Fold project panel" : "Expand project panel"}
        onClick={onTogglePanel}
      >
        <PanelIcon name={panelMode === "expanded" ? "fold" : "expand"} className="h-5 w-5" />
      </button>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 overflow-x-auto">
        {antigravityAvailable && (
          <button
            className={hookClass(antigravityOn)}
            onClick={() => void toggleAntigravityHooks()}
            title="Toggle the Antigravity (agy) adapter hooks in ~/.gemini/config/hooks.json — shallower than Claude/Codex: no session-start (so no re-entry after a relaunch) or waiting signal for a question the agent asks"
          >
            {antigravityOn === null ? "antigravity ?" : antigravityOn ? "antigravity on" : "antigravity off"}
          </button>
        )}
        <button
          className={hookClass(hooksOn, true)}
          onClick={() => void toggleHooks()}
          title="Toggle Claude Code hook ingestion in ~/.claude/settings.json"
        >
          {hooksOn === null ? "claude ?" : hooksOn ? "claude on" : "⚠ claude off — panels & dots inactive"}
        </button>
        {codexAvailable && (
          <button
            className={hookClass(codexOn)}
            onClick={() => void toggleCodexHooks()}
            title="Toggle the Codex adapter hooks in ~/.codex/hooks.json — Codex will ask you to trust the hook once in its own TUI on first use"
          >
            {codexOn === null ? "codex ?" : codexOn ? "codex on" : "codex off"}
          </button>
        )}
        {opencodeAvailable && (
          <button
            className={hookClass(opencodeOn)}
            onClick={() => void toggleOpencodeHooks()}
            title="Toggle the OpenCode adapter plugin in ~/.config/opencode/opencode.json"
          >
            {opencodeOn === null ? "opencode ?" : opencodeOn ? "opencode on" : "opencode off"}
          </button>
        )}
      </div>
    </div>
  );
}
