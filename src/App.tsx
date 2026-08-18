import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { homeDir } from "@tauri-apps/api/path";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  bindSession,
  onHookEvent,
  onTailerFailed,
  onTranscriptLine,
  seedUnclaimedTabs,
  shouldFlagUnclaimed,
  shouldNotify,
  stateForHook,
} from "./lib/ingest";
import { detectBlockers } from "./lib/detectors";
import * as decisions from "./lib/decisions";
import { initNotifications, notify } from "./lib/notify";
import { SidePanel } from "./components/SidePanel";
import { LandingNoteModal } from "./components/LandingNoteModal";
import { FanOutModal } from "./components/FanOutModal";
import type { AgentState, Decision } from "./types";
import { ptyWrite } from "./lib/pty";
import { TabBar } from "./components/TabBar";
import { AgentStatusBar } from "./components/AgentStatusBar";
import { BookmarksBar } from "./components/BookmarksBar";
import { Terminal } from "./components/Terminal";
import { canonicalizeCwd, projectKeyOf, ptyKill, ptyKillAll, ptySpawn } from "./lib/pty";
import * as repo from "./lib/repo";
import type { Bookmark, FanOutRollup, SpawnGroup, SpawnGroupMember, Tab } from "./types";
import { PALETTE } from "./types";

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
  const unseenStopsRef = useRef(unseenStops);
  unseenStopsRef.current = unseenStops;
  // Sessions whose transcript file could not be opened — they emit hooks but no
  // transcript, so decisions never extract for them. Silent until surfaced.
  const [blindSessions, setBlindSessions] = useState<Record<string, string>>({});

  // Nudges (Phase 6): muted project keys, cached so the hot ingestion path
  // never blocks on a DB read before deciding whether to notify.
  const mutedProjectsRef = useRef(new Set<string>());
  const refreshMutedProjects = useCallback(() => {
    void repo
      .mutedProjects()
      .then((s) => (mutedProjectsRef.current = s))
      .catch(() => undefined);
  }, []);

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
  // Fan-out spawns N children through the ordinary openTab path, which sets
  // activeId each time — the tab-switch effect below reads that as N rapid
  // human switches and offers a landing prompt for whatever was active before
  // the fan-out started (usually the parent, which had real activity). Not a
  // real "leaving this tab" moment; suppressed only for the duration of the
  // spawn loop, not for a genuine switch away from a fan-out child afterward.
  const suppressLandingRef = useRef(false);
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
    void initNotifications();
    refreshMutedProjects();
  }, [refreshBlockerCounts, refreshDecisionCounts, refreshMutedProjects]);

  const openTab = useCallback(async (opts?: { name?: string; cwd?: string; color?: string; cmd?: string }) => {
    const spawnCwd = await canonicalizeCwd(opts?.cwd ?? "~").catch(() => opts?.cwd ?? "~");
    // tab.cwd is the project key every panel queries by, so it is the repo
    // root, not the spawn dir — otherwise a tab opened in src-tauri files
    // against a different project than one opened at the repo root.
    const cwd = await projectKeyOf(spawnCwd).catch(() => spawnCwd);
    // The tether must exist before the PTY does: hooks inherit it from the env.
    // Must be globally unique for the app's lifetime, not just this process —
    // session_bindings.tab_tether persists across relaunches, and a
    // per-process counter reset to 0 on every launch collided with itself:
    // "tab-6" alone had 12 different sessions bound to it over two days,
    // silently burying all but the most-recently-updated one in re-entry.
    const id = crypto.randomUUID();
    const ptyId = await ptySpawn(spawnCwd, 80, 24, id, undefined, opts?.cmd);
    const tab: Tab = {
      id,
      ptyId,
      title: opts?.name ?? "Terminal",
      cwd,
      color: opts?.color ?? PALETTE[7],
      status: "live",
    };
    setTabs((t) => [...t, tab]);
    setActiveId(tab.id);
    return tab.id;
  }, []);

  /** Fan out (Phase 7): spawn N child tabs under a new group, each via the
   * ordinary `openTab` path (invariant #4 — no second spawn code path, no
   * carve-out tether class). One bad item (unspawnable cwd/cmd) must not
   * block its siblings or leave the group half-formed silently — caught and
   * skipped per invariant #2. */
  const fanOut = useCallback(
    async (
      parentTabId: string,
      items: { name?: string; cwd: string; cmd?: string }[],
      label?: string
    ) => {
      const groupId = crypto.randomUUID();
      await repo.createSpawnGroup(groupId, parentTabId, label ?? null);
      suppressLandingRef.current = true;
      try {
        for (const item of items) {
          try {
            const childId = await openTab({
              // No name field in the Fan-out modal's row form/paste JSON — every
              // child defaulted to the generic "Terminal" title, making rollup
              // rows indistinguishable. Same fallback ghost-tab titles already
              // use: last path segment of the cwd.
              name: item.name ?? item.cwd.split("/").filter(Boolean).pop() ?? item.cwd,
              cwd: item.cwd,
              color: PALETTE[7],
              cmd: item.cmd,
            });
            await repo.addSpawnMember(groupId, childId, item.cmd ?? null);
          } catch {
            // fail open — this child never got a tab; siblings still spawn.
          }
        }
      } finally {
        suppressLandingRef.current = false;
      }
    },
    [openTab]
  );
  const [fanOutModalOpen, setFanOutModalOpen] = useState(false);
  const [fanOutRefresh, setFanOutRefresh] = useState(0);
  const dismissSpawnMember = useCallback(async (groupId: string, childTabId: string) => {
    await repo.removeSpawnMember(groupId, childTabId).catch(() => undefined);
    setFanOutRefresh((n) => n + 1);
  }, []);

  // Fan-out rollup (Phase 7): DB-backed group/membership for the active tab,
  // refreshed on tab switch — same pattern as SidePanel's own cwd-keyed
  // reload, not a continuous live subscription. "landed" is the only piece
  // that needs a DB round-trip (invariant #3: dumb SQL view); PTY liveness
  // and the unclaimed flag are read straight from live state below, so they
  // never go stale between switches.
  const [fanOutGroups, setFanOutGroups] = useState<
    { group: SpawnGroup; members: (SpawnGroupMember & { landed: boolean })[] }[]
  >([]);

  useEffect(() => {
    if (!activeId) {
      setFanOutGroups([]);
      return;
    }
    let cancelled = false;
    void repo
      .groupsForTab(activeId)
      .then(async (groups) => {
        const withMembers = await Promise.all(
          groups.map(async (group) => {
            const members = await repo.groupMembers(group.id);
            const withLanded = await Promise.all(
              members.map(async (m) => {
                const tab = tabsRef.current.find((t) => t.id === m.child_tab_id);
                const landed = tab?.sessionId
                  ? await repo.hasLandedResult(tab.sessionId).catch(() => false)
                  : false;
                return { ...m, landed };
              })
            );
            return { group, members: withLanded };
          })
        );
        if (!cancelled) setFanOutGroups(withMembers);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeId, fanOutRefresh]);

  const fanOutRollups: FanOutRollup[] = useMemo(() => {
    return fanOutGroups.map(({ group, members }) => {
    const parentTab = tabs.find((t) => t.id === group.parent_tab_id);
    return {
      groupId: group.id,
      label: group.label,
      isParent: group.parent_tab_id === activeId,
      parentTabId: group.parent_tab_id,
      parentTitle: parentTab?.title ?? group.parent_tab_id,
      members: members.map((m) => {
        const tab = tabs.find((t) => t.id === m.child_tab_id);
        // "done" needs its own signal, not `m.landed` alone: `result_landed`
        // only gets written when the Stop fires on a tab you're NOT watching
        // (Phase 6's unclaimed-result flag) — a child finished while its tab
        // was active never gets one. Live agentState covers that case (it's
        // set on every state-bearing hook regardless of focus); `m.landed`
        // stays as a fallback for a just-re-entered tab whose first hook
        // since resume hasn't landed yet.
        const done = !!tab && (tab.agentState === "idle" || m.landed);
        const status: FanOutRollup["members"][number]["status"] = !tab
          ? "gone"
          : tab.status === "dead"
            ? "dead"
            : unseenStops.has(tab.id)
              ? "flag"
              : done
                ? "done"
                : "running";
        return { childTabId: m.child_tab_id, title: tab?.title ?? m.child_tab_id, cmd: m.cmd, status };
      }),
    };
    });
  }, [fanOutGroups, tabs, unseenStops, activeId]);

  // Unclaimed results (Phase 6): a tab is claimed by becoming both the active
  // tab and the window having focus. Persisted so the Accomplished panel can
  // headline it and it survives a restart (unlike `unseenStops`, the in-memory
  // read model for the dock badge / TabBar glow).
  const claimTab = useCallback((tabId: string) => {
    if (!unseenStopsRef.current.has(tabId)) return; // nothing to claim — no event to persist
    const tab = tabsRef.current.find((t) => t.id === tabId);
    if (tab?.sessionId) {
      void repo.addEvent(tab.sessionId, "result_claimed", "{}").catch(() => undefined);
    }
    setUnseenStops((s) => {
      if (!s.has(tabId)) return s;
      const next = new Set(s);
      next.delete(tabId);
      return next;
    });
  }, []);

  const closeTab = useCallback((tabId: string) => {
    // Side effects outside the updater — StrictMode double-invokes updaters.
    const tab = tabsRef.current.find((t) => t.id === tabId);
    if (tab && tab.status === "live") void ptyKill(tab.ptyId);
    // An explicitly closed tab must not ghost back next launch — a tab that
    // died with the app (quit, crash) should.
    void repo.deactivateSessionBinding(tabId).catch(() => undefined);
    // PTY dies now; the landing modal collects the note after the fact,
    // reading the (already-persisted) transcript for its draft.
    if (tab) maybePromptLanding(tab);
    // Closing counts as claiming — otherwise an unclaimed result on a tab
    // that's never switched to just stays flagged in the DB forever, since
    // nothing else ever calls claimTab for a tab that no longer exists.
    claimTab(tabId);
    tabActivityRef.current.delete(tabId);
    tabPromptRef.current.delete(tabId);
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      setActiveId((a) => {
        if (a !== tabId) return a;
        const idx = prev.findIndex((t) => t.id === tabId);
        return next[Math.min(idx, next.length - 1)]?.id ?? null;
      });
      return next;
    });
  }, [maybePromptLanding, claimTab]);

  const markDead = useCallback((tabId: string) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, status: "dead" as const } : t)));
  }, []);

  const restartTab = useCallback(async (tabId: string, resumeSessionId?: string) => {
    const tab = tabsRef.current.find((t) => t.id === tabId);
    if (!tab) return;
    // Same tether openTab already passes — without it a restarted tab respawns
    // untethered and its next session binds by cwd fallback instead of tether.
    const ptyId = await ptySpawn(tab.cwd === "~" ? null : tab.cwd, 80, 24, tab.id, resumeSessionId);
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
    void ptyKillAll().then(async () => {
      // Ghost tabs: sessions still active when the app last quit. Never
      // spawned (ptyId: -1) — the dead-tab overlay offers "Re-enter", which
      // is what actually opens the PTY, via the same resume path a mid-run
      // process death uses.
      const candidates = await repo.reentryCandidates().catch(() => []);
      if (candidates.length === 0) {
        void openTab();
        return;
      }
      const ghosts: Tab[] = candidates.map((c) => ({
        id: c.tab_tether,
        ptyId: -1,
        title: c.project_key.split("/").filter(Boolean).pop() ?? c.project_key,
        cwd: c.project_key,
        color: PALETTE[7],
        status: "dead",
        sessionId: c.session_id,
      }));
      // Seed the unclaimed flags before activating a tab: claimTab reads the
      // in-memory set, so a result that outlived the last quit is unclaimable
      // unless it is flagged before the activeId effect runs its claim. All
      // three setState calls batch into one commit, so the effect sees them.
      const unclaimed = await repo.unclaimedSessions().catch(() => new Set<string>());
      setUnseenStops(seedUnclaimedTabs(ghosts, unclaimed));
      setTabs(ghosts);
      setActiveId(ghosts[0].id);
    });
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

      // project_key (repo root, derived server-side) is the panel key; p.cwd is
      // the agent's literal dir and may be a subdir of it.
      const projectKey = p.project_key ?? p.cwd?.replace(/\/$/, "");
      if (projectKey) {
        sessionCwd.set(p.session_id, projectKey);
      }
      // Re-entry write path: only tethered sessions (started by this app) are
      // ours to resume — an outside terminal's SessionStart carries no tab_id.
      if (p.hook_event_name === "SessionStart" && p.tab_id && projectKey && p.cwd && p.transcript_path) {
        void repo
          .upsertSessionBinding(p.session_id, p.tab_id, projectKey, p.cwd, p.transcript_path)
          .catch(() => undefined); // fail open, same as addEvent above
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
      if (!tabId) {
        const match = bindSession(
          p,
          tabsRef.current.map((t) => ({ ...t, cwd: expand(t.cwd) })),
          {
            boundTabIds: new Set(bindings.values()),
            activeTabId: activeIdRef.current,
            projectKey,
          }
        );
        if (match) {
          tabId = match;
          bindings.set(p.session_id, tabId);
        }
      }
      if (!tabId) return; // session from an outside terminal
      tabActivityRef.current.set(tabId, Date.now()); // for the landing-note ritual

      const prevAgentState = tabsRef.current.find((t) => t.id === tabId)?.agentState;
      const state = stateForHook(p);
      const cwd = sessionCwd.get(p.session_id);
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== tabId) return t;
          // keep tab.cwd synced to the agent's project key so panels/badges
          // query the right project even after an in-shell `cd`. A `cd` within
          // the same repo is now a no-op here — that's the fix.
          const next = cwd && expand(t.cwd) !== cwd ? { ...t, cwd } : t;
          return state ? { ...next, sessionId: p.session_id, agentState: state } : next;
        })
      );
      // Fan-out rollup's "done"/"running" depends on live agentState, so it
      // needs a nudge on every state-bearing hook — not just tab switches —
      // or a card sitting on the parent tab never notices a child finish.
      if (state) setFanOutRefresh((n) => n + 1);

      const muted = cwd ? mutedProjectsRef.current.has(cwd) : false;
      const nudgeLabel = cwd ? (cwd.split("/").filter(Boolean).pop() ?? cwd) : "Logic Loop";
      const canNotify = () => shouldNotify(tabId, activeIdRef.current, document.hasFocus(), muted);

      // Waiting-edge only — a hook can re-fire (e.g. an idle reminder) while
      // already waiting, and that must not re-notify every time.
      if (state === "waiting" && prevAgentState !== "waiting" && canNotify()) {
        notify("Waiting for input", nudgeLabel);
      }

      // agent finished on a tab the human isn't looking at right now — either
      // a background tab (app focused, different tab active) or the whole app
      // backgrounded. Flagged until claimTab (tab switch / window focus).
      if (isStop && shouldFlagUnclaimed(tabId, activeIdRef.current, document.hasFocus())) {
        const id = tabId;
        setUnseenStops((s) => new Set(s).add(id));
        // Without a cwd the row can never match unclaimedResults' cwd filter —
        // skip the write rather than persist an event nothing can read.
        if (cwd) {
          void repo
            .addEvent(p.session_id, "result_landed", JSON.stringify({ cwd }))
            .catch(() => undefined);
        }
        if (canNotify()) notify("Finished", nudgeLabel);
      }
    }).then(track);

    void onTranscriptLine((p) => {
      void repo.addEvent(p.session_id, "transcript", p.line).catch(() => undefined);
      runDetectors(p.session_id, p.line);
      decisions.onTranscript(p.session_id, sessionCwd.get(p.session_id), p.line, refreshDecisionCounts);
      // transcripts flowing again → clear any warning for this session
      setBlindSessions((s) => {
        if (!(p.session_id in s)) return s;
        const next = { ...s };
        delete next[p.session_id];
        return next;
      });
    }).then(track);

    void onTailerFailed((p) => {
      setBlindSessions((s) => (s[p.session_id] === p.path ? s : { ...s, [p.session_id]: p.path }));
    }).then(track);

    return () => {
      cancelled = true;
      unlisteners.forEach((u) => u());
    };
  }, [expand, refreshBlockerCounts, refreshDecisionCounts]);

  // File drag-drop: the webview intercepts native drops (no DOM drop events),
  // so paste dropped paths into the active terminal — the human dragged them,
  // the app is not typing on its own.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void getCurrentWebview().onDragDropEvent((ev) => {
      if (ev.payload.type !== "drop" || ev.payload.paths.length === 0) return;
      const tab = tabsRef.current.find((t) => t.id === activeIdRef.current && t.status === "live");
      if (!tab) return;
      const quoted = ev.payload.paths.map((p) => `'${p.replace(/'/g, `'\\''`)}'`).join(" ");
      void ptyWrite(tab.ptyId, quoted + " ");
    }).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const reorderTabs = useCallback((srcId: string, dstId: string) => {
    if (srcId === dstId) return;
    setTabs((prev) => {
      const from = prev.findIndex((t) => t.id === srcId);
      const to = prev.findIndex((t) => t.id === dstId);
      if (from < 0 || to < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  const reorderBookmarks = useCallback(
    (srcId: number, dstId: number) => {
      if (srcId === dstId) return;
      const ids = bookmarks.map((b) => b.id);
      const from = ids.indexOf(srcId);
      const to = ids.indexOf(dstId);
      if (from < 0 || to < 0) return;
      ids.splice(to, 0, ...ids.splice(from, 1));
      // optimistic: live hover-reorder fires per crossing, so don't make the
      // next move compute off a pre-refresh (stale) order
      setBookmarks(ids.map((id) => bookmarks.find((b) => b.id === id)!));
      void repo.reorderBookmarks(ids).then(refreshBookmarks);
    },
    [bookmarks, refreshBookmarks]
  );

  // Dock badge = agents waiting on the user + agents that finished unseen.
  // Refocusing the window claims only the active tab, not every flagged one —
  // a background tab's result stays flagged until the human switches to it.
  useEffect(() => {
    const claim = () => {
      const id = activeIdRef.current;
      if (id) claimTab(id);
    };
    window.addEventListener("focus", claim);
    return () => window.removeEventListener("focus", claim);
  }, [claimTab]);
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
          // pbpaste via Rust — navigator.clipboard triggers the macOS
          // "Paste" permission pill in WKWebView.
          void invoke<string>("clipboard_text")
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

  // On tab switch: snapshot the tab we left (residue panel), offer its
  // landing prompt, and claim the tab switched to. A closed tab is gone here
  // — closeTab already handled it.
  useEffect(() => {
    const prevId = prevActiveRef.current;
    prevActiveRef.current = activeId;
    if (prevId && prevId !== activeId) {
      const prevTab = tabsRef.current.find((t) => t.id === prevId);
      if (prevTab) {
        setPrevSnap({ cwd: expand(prevTab.cwd), state: prevTab.agentState });
        if (!suppressLandingRef.current) maybePromptLanding(prevTab);
      }
    }
    // Switching to a flagged tab while the window isn't focused (e.g. via a
    // background automation) must not silently claim it — same rule the
    // focus-listener follows.
    if (activeId && document.hasFocus()) claimTab(activeId);
  }, [activeId, expand, maybePromptLanding, claimTab]);

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
      {/* Custom titlebar (native one hidden via titleBarStyle: Overlay).
          Left padding clears the macOS traffic lights; drag region keeps
          move + double-click-to-zoom working. */}
      <div
        data-tauri-drag-region
        className="flex h-7 shrink-0 items-center gap-1.5 bg-zinc-900 pl-[78px]"
      >
        <img src="/loop.png" alt="" className="pointer-events-none h-4 w-4" />
        <span className="pointer-events-none text-xs font-semibold text-zinc-400">Logic Loop</span>
      </div>
      <TabBar
        tabs={tabs}
        activeId={activeId}
        onSelect={setActiveId}
        onClose={closeTab}
        onNew={() => void openTab()}
        onFanOut={() => activeTab && setFanOutModalOpen(true)}
        onReorder={reorderTabs}
        blockerCount={(t) => blockerCountsByCwd[expand(t.cwd)] ?? 0}
        decisionCount={(t) => decisionCountsByCwd[expand(t.cwd)] ?? 0}
        unclaimed={(t) => unseenStops.has(t.id)}
      />
      <BookmarksBar
        bookmarks={bookmarks}
        onOpen={(b) => void openTab({ name: b.name, cwd: b.cwd, color: b.color })}
        onAdd={(name, cwd, color) =>
          void canonicalizeCwd(cwd)
            .catch(() => cwd)
            .then((c) => repo.addBookmark(name, c, color))
            .then(refreshBookmarks)
        }
        onUpdate={(b) => void repo.updateBookmark(b).then(refreshBookmarks)}
        onDelete={(id) => void repo.deleteBookmark(id).then(refreshBookmarks)}
        onReorder={reorderBookmarks}
      />
      <div className="flex min-h-0 flex-1">
        {railOpen && activeTab && (
          <SidePanel
            cwd={expand(activeTab.cwd)}
            sessionId={activeTab.sessionId ?? null}
            accent={activeTab.color === PALETTE[7] ? null : activeTab.color}
            refreshKey={panelRefresh}
            prevCwd={prevSnap?.cwd ?? null}
            prevState={prevSnap?.state}
            blindPaths={Object.values(blindSessions)}
            fanOut={fanOutRollups}
            onSelectTab={setActiveId}
            onDismissMember={dismissSpawnMember}
            onBlockersChanged={refreshBlockerCounts}
            onDecisionsChanged={refreshDecisionCounts}
            onAnswerNow={answerNow}
            onMuteChanged={refreshMutedProjects}
          />
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <AgentStatusBar />
          <div className="min-h-0 flex-1">
            {tabs.map((tab) => (
              <Terminal
                key={tab.id}
                tab={tab}
                visible={tab.id === activeId}
                onExit={markDead}
                onRestart={(id, sid) => void restartTab(id, sid)}
              />
            ))}
          </div>
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
      {fanOutModalOpen && activeTab && (
        <FanOutModal
          parentCwd={expand(activeTab.cwd)}
          onLaunch={(items, label) => {
            setFanOutModalOpen(false);
            void fanOut(activeTab.id, items, label);
          }}
          onCancel={() => setFanOutModalOpen(false)}
        />
      )}
    </div>
  );
}
