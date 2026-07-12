import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { homeDir } from "@tauri-apps/api/path";
import { ask } from "@tauri-apps/plugin-dialog";
import { onHookEvent, onTranscriptLine, stateForHook } from "./lib/ingest";
import { detectBlockers } from "./lib/detectors";
import * as decisions from "./lib/decisions";
import { SidePanel } from "./components/SidePanel";
import { LandingNoteModal } from "./components/LandingNoteModal";
import type { AgentState, Decision } from "./types";
import { ptyWrite } from "./lib/pty";
import { TabBar } from "./components/TabBar";
import { BookmarksBar } from "./components/BookmarksBar";
import { Terminal } from "./components/Terminal";
import { ptyKill, ptyKillAll, ptySpawn } from "./lib/pty";
import * as repo from "./lib/repo";
import type { Bookmark, Tab } from "./types";
import { PALETTE } from "./types";

let tabCounter = 0;

export default function App() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const didInit = useRef(false);
  const [home, setHome] = useState("");
  const [railOpen, setRailOpen] = useState(true);
  const [panelRefresh, setPanelRefresh] = useState(0);
  const [blockerCountsByCwd, setBlockerCountsByCwd] = useState<Record<string, number>>({});
  const [unseenStops, setUnseenStops] = useState<Set<string>>(new Set());

  // Landing-note ritual: agent activity per tab, and when we last prompted it.
  const tabActivityRef = useRef(new Map<string, number>()); // tab id -> last agent-activity ts
  const tabPromptRef = useRef(new Map<string, number>()); // tab id -> last landing-prompt ts
  const [landingPrompt, setLandingPrompt] = useState<{
    cwd: string;
    projectName: string;
    sessionId: string | null;
  } | null>(null);
  const landingPromptRef = useRef(landingPrompt);
  landingPromptRef.current = landingPrompt;
  // Attention residue: snapshot of the tab we most recently switched away from.
  const [prevSnap, setPrevSnap] = useState<{ cwd: string; state?: AgentState } | null>(null);
  const prevActiveRef = useRef<string | null>(null);

  const expand = useCallback(
    (p: string) =>
      (p === "~" ? home : p.startsWith("~/") ? home + p.slice(1) : p).replace(/\/$/, ""),
    [home]
  );

  // Prompt a landing note when leaving a tab that had agent activity since the
  // last prompt. Debounced to one prompt per tab per 10 min (tab-flipping while
  // testing must not spam the ritual). Never stacks over an open modal.
  const maybePromptLanding = useCallback(
    (tab: Tab) => {
      if (landingPromptRef.current) return;
      const activity = tabActivityRef.current.get(tab.id);
      const lastPrompt = tabPromptRef.current.get(tab.id) ?? 0;
      if (!activity || activity <= lastPrompt) return;
      if (Date.now() - lastPrompt < 10 * 60 * 1000) return;
      tabPromptRef.current.set(tab.id, Date.now());
      tabActivityRef.current.delete(tab.id);
      setLandingPrompt({
        cwd: expand(tab.cwd),
        projectName: expand(tab.cwd).split("/").filter(Boolean).pop() ?? tab.cwd,
        sessionId: tab.sessionId ?? null,
      });
    },
    [expand]
  );

  const [decisionCountsByCwd, setDecisionCountsByCwd] = useState<Record<string, number>>({});

  const refreshBlockerCounts = useCallback(() => {
    void repo.blockerCounts().then(setBlockerCountsByCwd).catch(() => undefined);
  }, []);

  const refreshDecisionCounts = useCallback(() => {
    void repo.decisionCounts().then(setDecisionCountsByCwd).catch(() => undefined);
    setPanelRefresh((n) => n + 1);
  }, []);

  useEffect(() => {
    void homeDir().then((h) => setHome(h.replace(/\/$/, "")));
    refreshBlockerCounts();
    refreshDecisionCounts();
  }, [refreshBlockerCounts, refreshDecisionCounts]);

  const openTab = useCallback(async (opts?: { name?: string; cwd?: string; color?: string }) => {
    const ptyId = await ptySpawn(opts?.cwd ?? null, 80, 24);
    const tab: Tab = {
      id: `tab-${++tabCounter}`,
      ptyId,
      title: opts?.name ?? "Terminal",
      cwd: opts?.cwd ?? "~",
      color: opts?.color ?? PALETTE[7],
      status: "live",
    };
    setTabs((t) => [...t, tab]);
    setActiveId(tab.id);
  }, []);

  const closeTab = useCallback((tabId: string) => {
    setTabs((prev) => {
      const tab = prev.find((t) => t.id === tabId);
      if (tab && tab.status === "live") void ptyKill(tab.ptyId);
      // PTY dies now; the landing modal collects the note after the fact,
      // reading the (already-persisted) transcript for its draft.
      if (tab) maybePromptLanding(tab);
      const next = prev.filter((t) => t.id !== tabId);
      setActiveId((a) => {
        if (a !== tabId) return a;
        const idx = prev.findIndex((t) => t.id === tabId);
        return next[Math.min(idx, next.length - 1)]?.id ?? null;
      });
      return next;
    });
  }, [maybePromptLanding]);

  const markDead = useCallback((tabId: string) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, status: "dead" as const } : t)));
  }, []);

  const restartTab = useCallback(async (tabId: string) => {
    const tab = tabsRef.current.find((t) => t.id === tabId);
    if (!tab) return;
    const ptyId = await ptySpawn(tab.cwd === "~" ? null : tab.cwd, 80, 24);
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, ptyId, status: "live" as const } : t))
    );
  }, []);

  const refreshBookmarks = useCallback(async () => {
    setBookmarks(await repo.listBookmarks());
  }, []);

  useEffect(() => {
    if (didInit.current) return; // StrictMode double-mount guard
    didInit.current = true;
    void refreshBookmarks();
    // reap PTYs orphaned by a webview crash/reload, then start fresh
    void ptyKillAll().then(() => openTab());
  }, [openTab, refreshBookmarks]);

  // Ingestion: bind hook events to tabs by cwd, persist to events table,
  // drive the per-tab agent state machine.
  const bindingsRef = useRef(new Map<string, string>()); // session_id -> tab id
  const sessionCwdRef = useRef(new Map<string, string>()); // session_id -> project cwd

  useEffect(() => {
    const bindings = bindingsRef.current;
    const sessionCwd = sessionCwdRef.current;

    // Detection lives here — the ingestion layer. Panels only read SQL.
    const runDetectors = (sessionId: string, text: string) => {
      const cwd = sessionCwd.get(sessionId);
      if (!cwd) return;
      for (const d of detectBlockers(text)) {
        const line = text.split("\n").find((l) => d.re.test(l))?.trim().slice(0, 120) ?? d.label;
        void repo
          .addBlocker(cwd, line, d.label)
          .then(() => {
            refreshBlockerCounts();
            setPanelRefresh((n) => n + 1);
          })
          .catch(() => undefined);
      }
    };

    let cancelled = false;
    const unlisteners: Array<() => void> = [];
    const track = (u: () => void) => {
      if (cancelled) u();
      else unlisteners.push(u);
    };
    void onHookEvent((p) => {
      void repo
        .addEvent(p.session_id, `hook:${p.hook_event_name}`, JSON.stringify(p))
        .catch(() => undefined); // fail open: panel data loss must not break terminals

      if (typeof p.cwd === "string") {
        sessionCwd.set(p.session_id, p.cwd.replace(/\/$/, ""));
      }
      if (p.hook_event_name === "Stop") {
        decisions.onStop(p.session_id, sessionCwd.get(p.session_id), refreshDecisionCounts);
      }
      const isStop = p.hook_event_name === "Stop";
      if (p.hook_event_name === "PostToolUse") {
        const resp = p["tool_response"];
        const text =
          typeof resp === "string"
            ? resp
            : resp && typeof resp === "object"
              ? Object.values(resp).filter((v): v is string => typeof v === "string").join("\n")
              : "";
        runDetectors(p.session_id, text);
        setPanelRefresh((n) => n + 1); // accomplished panel has a new row
      }

      let tabId = bindings.get(p.session_id);
      if (!tabId && typeof p.cwd === "string") {
        const cwd = p.cwd.replace(/\/$/, "");
        const bound = new Set(bindings.values());
        // cwd match first; else the active tab — the user `cd`ed away from the
        // tab's spawn cwd before running claude, and they're typing in it now.
        const active = tabsRef.current.find(
          (t) => t.id === activeIdRef.current && t.status === "live" && !bound.has(t.id)
        );
        const match =
          tabsRef.current.find((t) => expand(t.cwd) === cwd && !bound.has(t.id)) ??
          tabsRef.current.find((t) => expand(t.cwd) === cwd) ??
          active;
        if (match) {
          tabId = match.id;
          bindings.set(p.session_id, tabId);
        }
      }
      if (!tabId) return; // session from an outside terminal
      tabActivityRef.current.set(tabId, Date.now()); // for the landing-note ritual

      const state = stateForHook(p);
      const cwd = sessionCwd.get(p.session_id);
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== tabId) return t;
          // keep tab.cwd synced to the agent's real cwd so panels/badges
          // query the right project even after an in-shell `cd`
          const next = cwd && expand(t.cwd) !== cwd ? { ...t, cwd } : t;
          return state ? { ...next, sessionId: p.session_id, agentState: state } : next;
        })
      );
      // agent finished while the app is in the background → badge until refocus
      if (isStop && !document.hasFocus()) {
        const id = tabId;
        setUnseenStops((s) => new Set(s).add(id));
      }
    }).then(track);

    void onTranscriptLine((p) => {
      void repo.addEvent(p.session_id, "transcript", p.line).catch(() => undefined);
      runDetectors(p.session_id, p.line);
      decisions.onTranscript(p.session_id, sessionCwd.get(p.session_id), p.line, refreshDecisionCounts);
    }).then(track);

    return () => {
      cancelled = true;
      unlisteners.forEach((u) => u());
    };
  }, [expand, refreshBlockerCounts, refreshDecisionCounts]);

  // Dock badge = agents waiting on the user + agents that finished while the
  // app was in the background (cleared on refocus).
  useEffect(() => {
    const clear = () => setUnseenStops((s) => (s.size ? new Set<string>() : s));
    window.addEventListener("focus", clear);
    return () => window.removeEventListener("focus", clear);
  }, []);
  const waitingCount = tabs.filter(
    (t) => t.status === "live" && (t.agentState === "waiting" || unseenStops.has(t.id))
  ).length;
  useEffect(() => {
    void getCurrentWindow().setBadgeCount(waitingCount > 0 ? waitingCount : undefined);
  }, [waitingCount]);

  // Quit guard: confirm when live PTYs would be terminated.
  useEffect(() => {
    const win = getCurrentWindow();
    const unlisten = win.onCloseRequested(async (event) => {
      const live = tabsRef.current.filter((t) => t.status === "live").length;
      if (live === 0) return;
      event.preventDefault();
      const ok = await ask(
        `${live} active session${live === 1 ? "" : "s"} will be terminated.`,
        { title: "Quit Logic Loop?", kind: "warning", okLabel: "Quit", cancelLabel: "Cancel" }
      );
      if (ok) void win.destroy();
    });
    return () => {
      void unlisten.then((u) => u());
    };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "b") {
        e.preventDefault();
        setRailOpen((o) => !o);
      } else if (mod && e.key === "t") {
        e.preventDefault();
        void openTab();
      } else if (mod && e.key === "w") {
        e.preventDefault();
        setActiveId((a) => {
          if (a) closeTab(a);
          return a;
        });
      } else if (mod && e.key === "v") {
        // The menu's Paste role was removed (it double-pasted into terminals),
        // so form inputs need a manual ⌘V. Terminals handle their own ⌘V via
        // xterm's custom key handler — skip its hidden helper textarea here.
        const el = document.activeElement;
        const isField =
          el instanceof HTMLInputElement ||
          (el instanceof HTMLTextAreaElement && !el.classList.contains("xterm-helper-textarea"));
        if (isField) {
          e.preventDefault();
          void navigator.clipboard
            .readText()
            .then((t) => {
              if (!t) return;
              const field = el as HTMLInputElement | HTMLTextAreaElement;
              const start = field.selectionStart ?? field.value.length;
              const end = field.selectionEnd ?? start;
              const value = field.value.slice(0, start) + t + field.value.slice(end);
              // go through the native setter so React's controlled inputs see it
              const proto =
                field instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
              Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(field, value);
              field.setSelectionRange(start + t.length, start + t.length);
              field.dispatchEvent(new Event("input", { bubbles: true }));
            })
            .catch(() => undefined);
        }
      } else if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        setActiveId((a) => {
          const ts = tabsRef.current;
          if (ts.length === 0) return a;
          const idx = ts.findIndex((t) => t.id === a);
          const dir = e.shiftKey ? -1 : 1;
          return ts[(idx + dir + ts.length) % ts.length]?.id ?? a;
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [openTab, closeTab]);

  // On tab switch: snapshot the tab we left (residue panel) and offer its
  // landing prompt. A closed tab is gone here — closeTab already handled it.
  useEffect(() => {
    const prevId = prevActiveRef.current;
    prevActiveRef.current = activeId;
    if (!prevId || prevId === activeId) return;
    const prevTab = tabsRef.current.find((t) => t.id === prevId);
    if (!prevTab) return;
    setPrevSnap({ cwd: expand(prevTab.cwd), state: prevTab.agentState });
    maybePromptLanding(prevTab);
  }, [activeId, expand, maybePromptLanding]);

  const activeTab = tabs.find((t) => t.id === activeId) ?? null;

  // Answer-now prefill: writes a draft into the bound tab's terminal and marks
  // the decision answered. User edits and presses Enter — never sent by us.
  const answerNow = useCallback(
    (d: Decision) => {
      const tabId = bindingsRef.current.get(d.session_id);
      const tab = tabsRef.current.find((t) => t.id === tabId && t.status === "live");
      if (!tab) return;
      setActiveId(tab.id);
      void ptyWrite(tab.ptyId, `Re: "${d.question}" — `);
      void repo.setDecisionStatus(d.id, "answered").then(refreshDecisionCounts);
    },
    [refreshDecisionCounts]
  );

  return (
    <div className="flex h-screen flex-col bg-zinc-900">
      <TabBar
        tabs={tabs}
        activeId={activeId}
        onSelect={setActiveId}
        onClose={closeTab}
        onNew={() => void openTab()}
        blockerCount={(t) => blockerCountsByCwd[expand(t.cwd)] ?? 0}
        decisionCount={(t) => decisionCountsByCwd[expand(t.cwd)] ?? 0}
      />
      <BookmarksBar
        bookmarks={bookmarks}
        onOpen={(b) => void openTab({ name: b.name, cwd: b.cwd, color: b.color })}
        onAdd={(name, cwd, color) => void repo.addBookmark(name, cwd, color).then(refreshBookmarks)}
        onUpdate={(b) => void repo.updateBookmark(b).then(refreshBookmarks)}
        onDelete={(id) => void repo.deleteBookmark(id).then(refreshBookmarks)}
      />
      <div className="flex min-h-0 flex-1">
        {railOpen && activeTab && (
          <SidePanel
            cwd={expand(activeTab.cwd)}
            refreshKey={panelRefresh}
            prevCwd={prevSnap?.cwd ?? null}
            prevState={prevSnap?.state}
            onBlockersChanged={refreshBlockerCounts}
            onDecisionsChanged={refreshDecisionCounts}
            onAnswerNow={answerNow}
          />
        )}
        <div className="min-h-0 min-w-0 flex-1">
          {tabs.map((tab) => (
            <Terminal
              key={tab.id}
              tab={tab}
              visible={tab.id === activeId}
              onExit={markDead}
              onRestart={(id) => void restartTab(id)}
            />
          ))}
        </div>
      </div>
      {landingPrompt && (
        <LandingNoteModal
          projectName={landingPrompt.projectName}
          sessionId={landingPrompt.sessionId}
          onSave={(text) => {
            void repo
              .addNote(landingPrompt.cwd, "landing", text, landingPrompt.sessionId)
              .then(() => setPanelRefresh((n) => n + 1))
              .catch(() => undefined);
            setLandingPrompt(null);
          }}
          onSkip={() => {
            // skip is a first-class outcome — logged as a status='skipped' row
            void repo
              .addNote(landingPrompt.cwd, "landing", "", landingPrompt.sessionId, "skipped")
              .catch(() => undefined);
            setLandingPrompt(null);
          }}
        />
      )}
    </div>
  );
}
