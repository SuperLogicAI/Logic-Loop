import { useEffect, useState } from "react";
import { getExtractorSettings, setExtractorSettings } from "../lib/repo";
import type { ExtractorSettings } from "../types";

export function SidebarLmControl() {
  const [extractor, setExtractor] = useState<ExtractorSettings | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    void getExtractorSettings().then(setExtractor).catch(() => undefined);
  }, []);

  const saveExtractor = (settings: ExtractorSettings) => {
    setExtractor(settings);
    void setExtractorSettings(settings).catch(() => undefined);
  };

  return (
    <div className="relative">
      <button
        type="button"
        className="flex h-7 items-center gap-1 rounded-full px-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        onClick={() => setShowSettings((shown) => !shown)}
        title="Choose the model that extracts decisions for the sidebar"
      >
        <span className="text-base leading-none" aria-hidden="true">⚙</span>
        <span>Sidebar LM</span>
      </button>
      {showSettings && extractor && (
        <div className="absolute top-full left-0 z-20 mt-1 flex w-64 flex-col gap-2 rounded-md border border-zinc-700 bg-zinc-800 p-3 text-xs shadow-xl">
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
                <span className="text-amber-400">
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
          <button className="self-end text-zinc-400 hover:text-zinc-200" onClick={() => setShowSettings(false)}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}
