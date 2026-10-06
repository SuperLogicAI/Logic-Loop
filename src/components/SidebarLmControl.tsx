import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { getExtractorSettings, setExtractorSettings } from "../lib/repo";
import type { ExtractorSettings } from "../types";

export function SidebarLmControl({ compact = false }: { compact?: boolean }) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [extractor, setExtractor] = useState<ExtractorSettings | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    void getExtractorSettings().then(setExtractor).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!showSettings) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); setShowSettings(false); buttonRef.current?.focus(); }
    };
    const reposition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (rect) setPosition({ top: rect.bottom + 4, left: Math.max(8, Math.min(rect.left, window.innerWidth - 264)) });
    };
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("keydown", close, true);
    return () => { window.removeEventListener("resize", reposition); window.removeEventListener("keydown", close, true); };
  }, [showSettings]);

  useEffect(() => {
    if (!showSettings || !extractor) return;
    popoverRef.current?.querySelector<HTMLInputElement>("input:checked")?.focus();
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !popoverRef.current?.contains(event.target) && !buttonRef.current?.contains(event.target)) setShowSettings(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [showSettings, extractor !== null]);

  const saveExtractor = (settings: ExtractorSettings) => {
    setExtractor(settings);
    void setExtractorSettings(settings).catch(() => undefined);
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        aria-label="Sidebar LM settings"
        aria-expanded={showSettings}
        type="button"
        className={`flex shrink-0 items-center justify-center gap-1 rounded-full text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-400 ${compact ? "h-10 w-10" : "h-7 px-1.5"}`}
        onClick={() => setShowSettings((shown) => !shown)}
        title="Choose the model that extracts decisions for the sidebar"
      >
        <span className={`${compact ? "text-2xl" : "text-base"} leading-none`} aria-hidden="true">⚙</span>
        {!compact && <span data-control-label className="whitespace-nowrap">Sidebar LM</span>}
      </button>
      {showSettings && extractor && createPortal(
        <div ref={popoverRef} role="dialog" aria-label="Sidebar LM settings" style={position} className="fixed z-50 flex max-h-[calc(100vh-5rem)] overflow-y-auto w-64 flex-col gap-2 rounded-md border border-zinc-700 bg-zinc-800 p-3 text-xs shadow-xl">
          <span className="font-semibold text-zinc-300">Decision extractor</span>
          <label className="flex items-center gap-2 text-zinc-300">
            <input
              type="radio"
              checked={extractor.backend === "claude"}
              onChange={() => saveExtractor({ ...extractor, backend: "claude" })}
            />
            Claude CLI (default)
          </label>
          {extractor.backend === "claude" && (
            <>
              <input
                className="rounded bg-zinc-900 px-2 py-1 text-zinc-200 outline-none"
                placeholder="Claude model override (optional, default sonnet)"
                value={extractor.claudeModel}
                onChange={(event) => saveExtractor({ ...extractor, claudeModel: event.target.value })}
              />
              {extractor.claudeModel && extractor.claudeModel !== "sonnet" && (
                <span className="text-attn-400">
                  Only sonnet is golden-set verified. Haiku missed ~1-in-7 decisions in testing.
                </span>
              )}
            </>
          )}
          <label className="flex items-center gap-2 text-zinc-300">
            <input
              type="radio"
              checked={extractor.backend === "codex"}
              onChange={() => saveExtractor({ ...extractor, backend: "codex" })}
            />
            Codex CLI
          </label>
          <label className="flex items-center gap-2 text-zinc-300">
            <input
              type="radio"
              checked={extractor.backend === "lmstudio"}
              onChange={() => saveExtractor({ ...extractor, backend: "lmstudio" })}
            />
            LM Studio (local)
          </label>
          <label className="flex items-center gap-2 text-zinc-300">
            <input
              type="radio"
              checked={extractor.backend === "ollama"}
              onChange={() => saveExtractor({ ...extractor, backend: "ollama" })}
            />
            Ollama (local)
          </label>
          {extractor.backend === "codex" && (
            <input
              className="rounded bg-zinc-900 px-2 py-1 text-zinc-200 outline-none"
              placeholder="Codex model override (optional)"
              value={extractor.codexModel}
              onChange={(event) => saveExtractor({ ...extractor, codexModel: event.target.value })}
            />
          )}
          {extractor.backend === "lmstudio" && (
            <>
              <input
                className="rounded bg-zinc-900 px-2 py-1 text-zinc-200 outline-none"
                placeholder="http://127.0.0.1:1234"
                value={extractor.lmstudioUrl}
                onChange={(event) => saveExtractor({ ...extractor, lmstudioUrl: event.target.value })}
              />
              <input
                className="rounded bg-zinc-900 px-2 py-1 text-zinc-200 outline-none"
                placeholder="model (blank = loaded model)"
                value={extractor.lmstudioModel}
                onChange={(event) => saveExtractor({ ...extractor, lmstudioModel: event.target.value })}
              />
            </>
          )}
          {extractor.backend === "ollama" && (
            <>
              <input
                className="rounded bg-zinc-900 px-2 py-1 text-zinc-200 outline-none"
                placeholder="http://127.0.0.1:11434"
                value={extractor.ollamaUrl}
                onChange={(event) => saveExtractor({ ...extractor, ollamaUrl: event.target.value })}
              />
              <input
                className="rounded bg-zinc-900 px-2 py-1 text-zinc-200 outline-none"
                placeholder="model (e.g. llama3.2)"
                value={extractor.ollamaModel}
                onChange={(event) => saveExtractor({ ...extractor, ollamaModel: event.target.value })}
              />
            </>
          )}
          <button className="self-end text-zinc-400 hover:text-zinc-200" onClick={() => { setShowSettings(false); buttonRef.current?.focus(); }}>
            Close
          </button>
        </div>, document.body
      )}
    </div>
  );
}
