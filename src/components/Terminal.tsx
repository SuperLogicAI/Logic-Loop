import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { onPtyExit, onPtyOutput, ptyResize, ptyWrite } from "../lib/pty";
import type { Tab } from "../types";

interface Props {
  tab: Tab;
  visible: boolean;
  onExit: (tabId: string) => void;
  onRestart: (tabId: string, resumeSessionId?: string) => void;
}

export function Terminal({ tab, visible, onExit, onRestart }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  // Create xterm once per tab, keep it for the tab's lifetime.
  useEffect(() => {
    const term = new XTerm({
      scrollback: 10000,
      fontSize: 13,
      fontFamily: "SF Mono, Menlo, monospace",
      cursorBlink: true,
      allowProposedApi: true,
      theme: { background: "#1e2127" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    // A URL in agent output is inert text otherwise: xterm has no OS to hand a
    // click to. Route through the opener plugin (system browser) rather than
    // window.open, which would navigate the webview off the app itself.
    term.loadAddon(new WebLinksAddon((_e, uri) => void openUrl(uri)));
    // ⌘V via the webview's native paste path can skip xterm's paste handler,
    // losing bracketed-paste wrapping (multi-line pastes then submit
    // line-by-line in TUIs like claude). Route it through term.paste(), which
    // always applies bracketed wrapping when the app enabled mode 2004.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === "keydown" && e.metaKey && !e.altKey && !e.ctrlKey && e.key.toLowerCase() === "v") {
        // pbpaste via Rust, not navigator.clipboard \u2014 the webview's clipboard
        // read pops the macOS "Paste" permission pill on every \u2318V.
        void invoke<string>("clipboard_text")
          .then(async (t) => {
            // Notes/TextEdit put U+2028/U+2029 (and sometimes bare \r) on the
            // clipboard; xterm only converts \n, so normalize first or the
            // breaks vanish inside TUIs.
            if (t) {
              term.paste(t.replace(/\r\n|\r|\u2028|\u2029/g, "\n"));
              return;
            }
            // No text \u2014 an image? Save it to a file and paste the path, so
            // screenshots land in agents like claude.
            const path = await invoke<string | null>("clipboard_image_path");
            if (path) term.paste(path + " ");
          })
          .catch(() => undefined); // fall through to default paste path
        return false;
      }
      return true;
    });
    termRef.current = term;
    fitRef.current = fit;
    if (containerRef.current) term.open(containerRef.current);
    return () => {
      term.dispose();
      termRef.current = null;
    };
  }, [tab.id]);

  // Wire I/O to the current ptyId (re-wires after restart).
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const ptyId = tab.ptyId;
    const dataSub = term.onData((d) => void ptyWrite(ptyId, d));
    let cancelled = false;
    const unlisteners: Array<() => void> = [];
    const track = (u: () => void) => {
      if (cancelled) u();
      else unlisteners.push(u);
    };
    void onPtyOutput(ptyId, (bytes) => term.write(bytes)).then(track);
    void onPtyExit(ptyId, () => onExit(tab.id)).then(track);
    return () => {
      cancelled = true;
      dataSub.dispose();
      unlisteners.forEach((u) => u());
    };
  }, [tab.id, tab.ptyId, onExit]);

  // ponytail: DOM renderer only. WebGL addon (even capped to the visible tab)
  // crashed the WKWebView content process under rapid tab-switch/resize —
  // page reloads, all state gone. Revisit with @xterm/addon-canvas if DOM
  // rendering ever measurably lags.

  // Fit on visibility + container resize (fitting while hidden yields bogus dims).
  useEffect(() => {
    if (!visible || !containerRef.current) return;
    let raf = 0;
    const doFit = () => {
      const fit = fitRef.current;
      const term = termRef.current;
      const el = containerRef.current;
      if (!fit || !term || !el || el.clientWidth === 0 || el.clientHeight === 0) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      if (tab.status === "live") void ptyResize(tab.ptyId, term.cols, term.rows);
    };
    doFit();
    termRef.current?.focus();
    // coalesce resize storms to one fit per frame
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(doFit);
    });
    ro.observe(containerRef.current);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [visible, tab.ptyId, tab.status]);

  return (
    <div className="relative h-full w-full" style={{ display: visible ? "block" : "none" }}>
      <div ref={containerRef} className="h-full w-full bg-[#1e2127] p-1" />
      {tab.status === "dead" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <div className="flex flex-col items-center gap-3 rounded-lg bg-zinc-800 px-8 py-6 text-zinc-200 shadow-xl">
            <span>Process exited</span>
            <button
              className="rounded bg-zinc-600 px-4 py-1.5 text-sm hover:bg-zinc-500"
              onClick={() => {
                termRef.current?.reset();
                onRestart(tab.id, tab.sessionId);
              }}
            >
              {tab.sessionId ? "Re-enter" : "Restart"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
