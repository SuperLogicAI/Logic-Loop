import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import * as repo from "../lib/repo";
import { observedAgentTime, humanTime, humanTimeLines, formatDuration, HUMAN_IDLE_CAP_MS, projectDisplayName, projectFolderLabel, buildProjectWorkLog, commitsInRange, dashboardRangeStart, projectWorkspaceChoices, type DashboardRange, type WorkLogEntry } from "../lib/dashboard";
import { dashboardReads, observeDashboardRead, type ReadState, type ReadDiagnostic } from "../lib/dashboardLoader";
import { computeMomentum } from "../lib/momentum";
import { parseBoard, peekBoard, EXAMPLE_BOARD, type BoardStatus } from "../lib/board";
import { resolveAttentionRoute, type AttentionTabSnapshot } from "../lib/attention";
import { type CopyUpdateData } from "./CopyUpdateModal";
import type { AttentionEvidence, Blocker, Commit, Decision, Note, ReentryCandidate, Tab } from "../types";

type Range = DashboardRange;
const RANGE_LABEL: Record<Range, string> = { today: "Today", "7d": "7 days", "30d": "30 days" };

function age(ts: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - ts) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function decisionAsEvidence(d: Decision): AttentionEvidence {
  return {
    id: `decision:${d.id}`,
    kind: "decision",
    projectKey: d.cwd,
    sessionId: d.session_id,
    tabId: d.tab_id,
    adapterId: d.agent,
    actorId: d.actor_id,
    createdAt: d.ts,
    lastActivityAt: null,
    text: d.question,
    evidenceId: d.id,
    runId: null,
    observedState: null,
    archived: false,
  };
}

function blockerAsEvidence(b: Blocker): AttentionEvidence {
  return {
    id: `blocker:${b.id}`,
    kind: "blocker",
    projectKey: b.cwd,
    sessionId: b.session_id,
    tabId: b.tab_id,
    adapterId: b.agent,
    actorId: b.actor_id,
    createdAt: b.ts,
    lastActivityAt: null,
    text: b.text,
    evidenceId: b.id,
    runId: null,
    observedState: null,
    archived: false,
  };
}

interface OverviewValues {
  catalog: repo.ProjectCatalogEntry;
  openDecisions: Decision[];
  openBlockers: Blocker[];
  landing: Note | null;
  workLog: WorkLogEntry[];
  commits: Commit[];
  board: { state: "ready" | "missing"; cards: ReturnType<typeof parseBoard>; isExample: boolean };
  agentTime: ReturnType<typeof observedAgentTime>;
  humanTime: ReturnType<typeof humanTime>;
  reentry: ReentryCandidate[];
}

type OverviewReads = { [K in keyof OverviewValues]: ReadState<OverviewValues[K]> };
const loadingReads = (): OverviewReads => ({
  catalog: { state: "loading" }, openDecisions: { state: "loading" }, openBlockers: { state: "loading" },
  landing: { state: "loading" }, workLog: { state: "loading" }, commits: { state: "loading" },
  board: { state: "loading" }, agentTime: { state: "loading" }, humanTime: { state: "loading" }, reentry: { state: "loading" },
});

/** Plan 051: stale decisions (open, >14 days, dormant session) are left out of
 * Overview's open list; surface the count here with a one-click dismiss.
 * Fail open: a failed read renders nothing. */
function StaleDecisionsNote({ projectKey }: { projectKey: string }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void repo.staleDecisionsForProject(projectKey).then((rows) => { if (!cancelled) setCount(rows.length); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [projectKey]);
  if (count === 0) return null;
  return (
    <div className="flex items-center gap-2 text-xs text-zinc-500">
      <span>{count} stale decision{count === 1 ? "" : "s"} (older than 14 days, session idle)</span>
      <button
        type="button"
        className="rounded border border-zinc-700 px-2 py-0.5 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-focus-400"
        onClick={() => void repo.dismissStaleDecisions(projectKey).then(() => setCount(0)).catch(() => undefined)}
      >
        Dismiss all stale
      </button>
    </div>
  );
}

function ReadStatus({ read, label }: { read: ReadState<unknown>; label: string }) {
  if (read.state === "ready") return null;
  return <p role="status" className={`mt-2 text-xs ${read.state === "error" ? "text-attn-400" : "text-zinc-500"}`}>
    {read.state === "loading" ? `Loading ${label}…` : read.reason === "timeout"
      ? `${label} took too long. Retry to check again.` : `Couldn't load ${label}. Retry to check again.`}
  </p>;
}

interface Props {
  projectKey: string;
  tabs: Tab[];
  expand: (cwd: string) => string;
  now: number;
  onBack: () => void;
  onContinueTab: (tabId: string) => void;
  onStartSession: (projectKey: string) => Promise<void>;
  onOpenCopyUpdate: (data: CopyUpdateData) => void;
}

export function ProjectOverview({ projectKey, tabs, expand, now, onBack, onContinueTab, onStartSession, onOpenCopyUpdate }: Props) {
  const [startingSession, setStartingSession] = useState(false);
  const startingSessionRef = useRef(false);
  const [sessionError, setSessionError] = useState(false);
  const [range, setRange] = useState<Range>("7d");
  const [refresh, setRefresh] = useState(0);
  const identity = JSON.stringify([projectKey, range, refresh]);
  const [snapshot, setSnapshot] = useState<{ identity: string; reads: OverviewReads }>({ identity: "", reads: loadingReads() });
  const reads = snapshot.identity === identity ? snapshot.reads : loadingReads();
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [editingNickname, setEditingNickname] = useState(false);
  const [savingNickname, setSavingNickname] = useState(false);
  const [nicknameError, setNicknameError] = useState(false);
  const [purposeDraft, setPurposeDraft] = useState("");
  const [editingPurpose, setEditingPurpose] = useState(false);
  const [diagnostics, setDiagnostics] = useState<{ identity: string; events: ReadDiagnostic[] }>({ identity: "", events: [] });

  useEffect(() => {
    let cancelled = false;
    const until = Date.now();
    const since = dashboardRangeStart(range, until);
    setSnapshot({ identity, reads: loadingReads() });
    setDiagnostics({ identity, events: [] });
    const report = (event: ReadDiagnostic) => {
      if (!cancelled) setDiagnostics((d) => d.identity === identity ? { ...d, events: [...d.events, event] } : d);
    };
    const watch = <K extends keyof OverviewValues>(key: K, load: () => Promise<OverviewValues[K]>, cacheKey = key as string, ttl = 0) =>
      observeDashboardRead(key, dashboardReads.read(JSON.stringify([projectKey, cacheKey]), load, ttl), (read) => {
        if (!cancelled) setSnapshot((d) => d.identity === identity ? { ...d, reads: { ...d.reads, [key]: read } } : d);
      }, report);
    const dispose = [
      watch("catalog", () => repo.projectOverviewMetadata(projectKey)),
      watch("openDecisions", () => repo.openDecisionsForProject(projectKey)),
      watch("openBlockers", async () => (await repo.listBlockers(projectKey)).filter((b) => b.resolved === 0)),
      watch("landing", () => repo.latestLandingNote(projectKey)),
      watch("workLog", async () => buildProjectWorkLog(await repo.projectWorkLogEvents(projectKey, since, until)), `workLog:${range}`),
      watch("commits", async () => commitsInRange(await dashboardReads.read(JSON.stringify([projectKey, "git"]),
        () => invoke<Commit[]>("dashboard_git_log", { cwd: projectKey, sinceMs: dashboardRangeStart("30d", until), untilMs: until }), 30_000), since, until), `commits:${range}`),
      watch("board", async () => {
        const peek = await peekBoard(projectKey);
        if (peek.state === "error") throw new Error("board unavailable");
        return { state: peek.state, cards: peek.state === "ready" ? parseBoard(peek.content) : [],
          isExample: peek.state === "ready" && peek.content === EXAMPLE_BOARD };
      }, "board", 30_000),
      watch("agentTime", async () => observedAgentTime((await repo.projectAgentTimeObservations(projectKey))
        .map((o) => ({ sessionId: o.session_id, runId: o.run_id, state: o.state, observedAt: o.observed_at })))),
      // Read one cap early so an interval opened just before the range is clipped, not lost.
      watch("humanTime", async () => humanTime((await repo.projectHumanTimeEvents(projectKey, since - HUMAN_IDLE_CAP_MS))
        .map((e) => ({ tabId: e.tab_id, type: e.type, ts: e.ts })), until, since), `humanTime:${range}`),
      watch("reentry", () => repo.reentryCandidates().then((rows) => rows.filter((r) => r.project_key === projectKey))),
    ];
    return () => {
      cancelled = true;
      dispose.forEach((stop) => stop());
    };
    // now is for display ages only; the shared 15s stall clock must never
    // cancel work or launch new filesystem/SQL reads.
  }, [projectKey, range, refresh, identity]);

  const value = <K extends keyof OverviewValues>(key: K): OverviewValues[K] | undefined => {
    const read = reads[key];
    return read.state === "ready" ? read.value : undefined;
  };
  // Plan 052: the read returns every open row; only project blockers feed
  // Needs a choice and Copy update, detector rows are just a count line.
  const allOpenBlockers = value("openBlockers") ?? [];
  const detectedCount = allOpenBlockers.filter((b) => !repo.isProjectBlocker(b)).length;
  const data = {
    catalog: value("catalog"), openDecisions: value("openDecisions") ?? [],
    openBlockers: allOpenBlockers.filter(repo.isProjectBlocker), landing: value("landing") ?? null,
    workLog: value("workLog") ?? [], commits: value("commits") ?? [],
    board: value("board"), agentTime: value("agentTime"), humanTime: value("humanTime"),
  };
  const choiceReady = reads.openDecisions.state === "ready" && reads.openBlockers.state === "ready";
  const momentumReady = choiceReady && reads.landing.state === "ready" && reads.board.state === "ready";
  const copyReady = choiceReady && reads.workLog.state === "ready" && reads.commits.state === "ready" && reads.landing.state === "ready" && reads.humanTime.state === "ready";
  const workspaceChoices = projectWorkspaceChoices(tabs, projectKey, expand);
  const liveTabs = workspaceChoices.filter((t) => t.status === "live");
  const openTethers = new Set(tabs.map((t) => t.id));
  const reentry = (value("reentry") ?? []).filter((r) => !openTethers.has(r.tab_tether));

  const displayName = projectDisplayName(projectKey, [projectKey], data.catalog);

  const startSession = async () => {
    if (startingSessionRef.current) return;
    startingSessionRef.current = true;
    setStartingSession(true);
    setSessionError(false);
    try {
      await onStartSession(projectKey);
    } catch {
      setSessionError(true);
    } finally {
      startingSessionRef.current = false;
      setStartingSession(false);
    }
  };

  const saveNickname = async () => {
    if (savingNickname) return;
    setSavingNickname(true);
    setNicknameError(false);
    try {
      await repo.setProjectNickname(projectKey, nicknameDraft);
      setEditingNickname(false);
      setRefresh((n) => n + 1);
    } catch {
      setNicknameError(true);
    } finally {
      setSavingNickname(false);
    }
  };

  const tabSnapshots: AttentionTabSnapshot[] = tabs.map((t) => ({
    id: t.id,
    cwd: expand(t.cwd),
    sessionId: t.sessionId,
    agent: t.agent,
    status: t.status,
  }));

  const needsAChoice = [
        ...data.openDecisions.map((d) => ({
          kind: "decision" as const,
          text: d.question,
          assumption: d.assumption,
          route: resolveAttentionRoute(decisionAsEvidence(d), tabSnapshots),
        })),
        ...data.openBlockers.map((b) => ({
          kind: "blocker" as const,
          text: b.text,
          assumption: null,
          route: resolveAttentionRoute(blockerAsEvidence(b), tabSnapshots),
        })),
      ];

  const momentum = momentumReady
    ? computeMomentum({
        landing: data.landing,
        decisions: data.openDecisions,
        plannedCard: (data.board?.cards ?? []).find((c) => c.now) ?? (data.board?.cards ?? []).find((c) => c.status === "planned") ?? null,
        // Read-only: Overview never calls any of these. computeMomentum needs
        // the shape; nothing wires a "done" control to them here.
        onLandingDone: async () => undefined,
        onDecisionDone: async () => undefined,
        onPlannedCardDone: async () => undefined,
      })
    : null;

  const statusCounts: Record<BoardStatus, number> = { idea: 0, planned: 0, building: 0, later: 0, done: 0 };
  for (const c of (data.board?.cards ?? [])) statusCounts[c.status]++;
  const nowCard = data.board?.cards.find((c) => c.now) ?? null;

  const savePurpose = async () => {
    await repo.setProjectPurpose(projectKey, purposeDraft).catch(() => undefined);
    setRefresh((n) => n + 1);
    setEditingPurpose(false);
  };

  const togglePinned = async () => {
    if (!data?.catalog) return;
    const next = !data.catalog.pinned;
    await repo.setProjectPinned(projectKey, next).catch(() => undefined);
    setRefresh((n) => n + 1);
  };

  const toggleArchived = async () => {
    if (!data?.catalog) return;
    const next = !data.catalog.archived;
    await repo.setProjectArchived(projectKey, next).catch(() => undefined);
    setRefresh((n) => n + 1);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-zinc-900 px-6 py-5">
      <div className="mx-auto w-full max-w-5xl">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="text-sm text-zinc-500 hover:text-zinc-300" onClick={onBack}>
            Home
          </button>
          <span className="text-sm text-zinc-600">/</span>
          <h2 className="text-sm font-semibold text-zinc-100">{displayName}</h2>
          <div className="ml-auto flex flex-wrap items-start gap-2">
            <div className="flex flex-col items-start gap-2">
              {workspaceChoices.length > 1 ? (
                <select aria-label="Continue in workspace" value=""
                  className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-300"
                  onChange={(e) => {
                    if (workspaceChoices.some((t) => t.id === e.target.value)) onContinueTab(e.target.value);
                  }}>
                  <option value="" disabled>Continue in…</option>
                  {workspaceChoices.map((tab) => <option key={tab.id} value={tab.id}>
                    {tab.title} · {tab.agent ?? "shell"} · {tab.status === "dead" ? "closed — Re-enter in workspace" : tab.agentState ?? "live"} · {tab.id.slice(0, 8)}
                  </option>)}
                </select>
              ) : workspaceChoices.length === 1 ? (
                <button
                  type="button"
                  className="rounded-md bg-info-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-info-500"
                  onClick={() => onContinueTab(workspaceChoices[0].id)}
                >
                  Continue
                </button>
              ) : (
                <button
                  type="button"
                  className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
                  disabled={startingSession}
                  onClick={() => void startSession()}
                >
                  {startingSession ? "Starting…" : "Start session"}
                </button>
              )}
              {workspaceChoices.length > 0 && (
                <button type="button" disabled={startingSession}
                  className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                  onClick={() => void startSession()}>
                  {startingSession ? "Starting…" : "New session tab"}
                </button>
              )}
              {sessionError && <p role="alert" className="text-xs text-attn-400">Could not start a session. Try again.</p>}
            </div>
            <button
              type="button"
              disabled={!copyReady}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
              onClick={() =>
                copyReady &&
                onOpenCopyUpdate({
                  projectName: displayName,
                  rangeLabel: RANGE_LABEL[range],
                  workLogExcerpts: data.workLog.map((e) => e.excerpt).filter((t) => t.length > 0),
                  commits: data.commits,
                  openDecisions: data.openDecisions,
                  openBlockers: data.openBlockers,
                  timeLines: data.humanTime ? humanTimeLines(data.humanTime) : [],
                  nextStep: computeMomentum({ landing: data.landing, decisions: data.openDecisions, plannedCard: null,
                    onLandingDone: async () => undefined, onDecisionDone: async () => undefined,
                    onPlannedCardDone: async () => undefined })?.text ?? null,
                })
              }
            >
              Copy update
            </button>
            <button
              type="button"
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
              onClick={() => void togglePinned()}
            >
              {data?.catalog?.pinned ? "Unpin" : "Pin"}
            </button>
            <button
              type="button"
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
              onClick={() => void toggleArchived()}
            >
              {data?.catalog?.archived ? "Unarchive" : "Archive"}
            </button>
          </div>
        </div>

        <p className="mt-1 break-all text-xs text-zinc-400" title={projectKey}>{projectFolderLabel(projectKey)}</p>
        {editingNickname ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input autoFocus aria-label="Project nickname" maxLength={120}
              disabled={savingNickname} value={nicknameDraft}
              placeholder="Blank uses bookmark or folder name"
              onChange={(e) => setNicknameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); void saveNickname(); }
                if (e.key === "Escape" && !savingNickname) { e.stopPropagation(); setEditingNickname(false); }
              }}
              className="w-full max-w-md rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 focus:border-info-500" />
            <button type="button" disabled={savingNickname} className="text-xs text-info-400" onClick={() => void saveNickname()}>Save name</button>
            <button type="button" disabled={savingNickname} className="text-xs text-zinc-400" onClick={() => setEditingNickname(false)}>Cancel</button>
            {nicknameError && <p role="alert" className="text-xs text-attn-400">Could not save the name. Try again.</p>}
          </div>
        ) : (
          <button type="button" disabled={reads.catalog.state !== "ready"} className="mt-1 text-xs text-info-400"
            onClick={() => { setNicknameDraft(data.catalog?.nickname ?? ""); setNicknameError(false); setEditingNickname(true); }}>
            {data.catalog?.nickname ? "Edit project name" : "Add project nickname"}
          </button>
        )}
        {editingPurpose ? (
          <div className="mt-1 flex items-center gap-2">
            <input
              autoFocus
              value={purposeDraft}
              onChange={(e) => setPurposeDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void savePurpose();
                if (e.key === "Escape") setEditingPurpose(false);
              }}
              className="w-full max-w-md rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 outline-none focus:border-info-500"
            />
            <button type="button" className="text-xs text-info-400" onClick={() => void savePurpose()}>
              Save
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="mt-1 block text-left text-xs text-zinc-500 hover:text-zinc-300"
            onClick={() => {
              setPurposeDraft(data?.catalog?.purpose ?? "");
              setEditingPurpose(true);
            }}
          >
            {data?.catalog?.purpose || "Add a one-line purpose…"}
          </button>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button type="button" className="text-xs text-info-400 hover:text-info-300" onClick={() => setRefresh((n) => n + 1)}>Refresh / Retry</button>
          {!copyReady && <p role="status" className="text-xs text-zinc-500">Copy update is waiting for decisions, blockers, session activity, commits and your landing note. Retry unavailable sources.</p>}
        </div>
        <ReadStatus read={reads.catalog} label="project details" />
        {reads.catalog.state === "ready" && <p className="mt-1 text-[11px] text-zinc-600">
          {data?.catalog?.lastActivityAt ? `Last activity ${age(data.catalog.lastActivityAt, now)}` : "No activity recorded yet"}
          {data?.catalog?.firstSeenAt ? ` · first seen ${age(data.catalog.firstSeenAt, now)}` : ""}
        </p>}

        {/* Plan 057: time first, with the page-wide range — the work log below can run very long. */}
        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section>
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">Your time</h3>
              <div className="flex gap-1" role="tablist" aria-label="Range">
                {(Object.keys(RANGE_LABEL) as Range[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={range === key}
                    className={`rounded px-1.5 py-0.5 text-[10px] ${range === key ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
                    onClick={() => setRange(key)}
                  >
                    {RANGE_LABEL[key]}
                  </button>
                ))}
              </div>
            </div>
            {reads.humanTime.state !== "ready" ? <ReadStatus read={reads.humanTime} label="your time" /> : data.humanTime?.sinceDate ? (
              <p className="mt-2 text-xs text-zinc-300">
                {formatDuration(data.humanTime.totalMs)} {range === "today" ? "today" : `in the last ${RANGE_LABEL[range]}`}
                {data.humanTime.sinceDate > dashboardRangeStart(range, Date.now()) && (
                  <> (tracking since {new Date(data.humanTime.sinceDate).toLocaleDateString()})</>
                )}
                <span className="block text-[11px] text-zinc-600">
                  Counted while a tab in this project is visible and you're active; gaps over 15 min count as 15.
                </span>
              </p>
            ) : (
              <p className="mt-2 text-xs text-zinc-600">Hidden — no time tracked in this range yet.</p>
            )}
          </section>
          <section>
            <h3 className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">Agent time (observed)</h3>
            {reads.agentTime.state !== "ready" ? <ReadStatus read={reads.agentTime} label="agent time" /> : data.agentTime?.sinceDate ? (
              <p className="mt-2 text-xs text-zinc-300">
                {Math.floor(data.agentTime.totalMs / 3_600_000)}h {Math.floor((data.agentTime.totalMs % 3_600_000) / 60_000)}m
                across {data.agentTime.sessionCount} session{data.agentTime.sessionCount === 1 ? "" : "s"} since{" "}
                {new Date(data.agentTime.sinceDate).toLocaleDateString()}
                <span className="block text-[11px] text-zinc-600">Parallel sessions can exceed wall clock.</span>
              </p>
            ) : (
              <p className="mt-2 text-xs text-zinc-600">Hidden — no lifecycle observations yet.</p>
            )}
          </section>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section>
            <h3 className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">Needs a choice</h3>
            {reads.openDecisions.state !== "ready" && <ReadStatus read={reads.openDecisions} label="decisions" />}
            {reads.openBlockers.state !== "ready" && <ReadStatus read={reads.openBlockers} label="blockers" />}
            {choiceReady && needsAChoice.length === 0 ? (
              <p className="mt-2 text-xs text-zinc-600">Nothing open.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {needsAChoice.map((item, i) => (
                  <li key={i} className="rounded-md border border-zinc-800 bg-zinc-800/30 p-2.5">
                    <p id={`needs-choice-${i}`} className="text-xs text-zinc-200">{item.text}</p>
                    {item.assumption && <p className="mt-0.5 text-[11px] text-zinc-500">Agent assumption: {item.assumption}</p>}
                    <button
                      type="button"
                      disabled={!item.route.tabId}
                      aria-describedby={`needs-choice-${i}`}
                      className="mt-1.5 text-[11px] text-info-400 hover:text-info-300 disabled:text-zinc-600"
                      onClick={() => item.route.tabId && onContinueTab(item.route.tabId)}
                    >
                      {item.route.tabId ? "Go to workspace" : "Destination unavailable"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {detectedCount > 0 && (
              <p className="mt-2 text-[11px] text-zinc-600">
                {detectedCount} detected tool {detectedCount === 1 ? "error" : "errors"} (in the workspace Blockers panel)
              </p>
            )}
          </section>

          <section>
            <h3 className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">Pick up here</h3>
            {momentum ? (
              <div className="mt-2 rounded-md border border-zinc-800 bg-zinc-800/30 p-2.5">
                <p className="text-[10px] text-zinc-500">From your {momentum.label}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-zinc-200">{momentum.text}</p>
              </div>
            ) : (
              momentumReady ? <p className="mt-2 text-xs text-zinc-600">Nothing queued up.</p> : <>
                <ReadStatus read={reads.landing} label="landing note" />
                <ReadStatus read={reads.openDecisions} label="decisions" />
                <ReadStatus read={reads.openBlockers} label="blockers" />
                <ReadStatus read={reads.board} label="board" />
              </>
            )}
          </section>

          <StaleDecisionsNote projectKey={projectKey} />

          <section>
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">Work log · {RANGE_LABEL[range]}</h3>
            </div>
            <ReadStatus read={reads.workLog} label="session activity" />
            <ReadStatus read={reads.commits} label="local commits" />
            {reads.workLog.state === "ready" && reads.commits.state === "ready" && data.workLog.length === 0 && data.commits.length === 0 ? (
              <p className="mt-2 text-xs text-zinc-600">none recorded</p>
            ) : (
              <>
                <ul className="mt-2 space-y-2">
                  {data.workLog.map((entry) => (
                    <li key={entry.key} className="text-xs text-zinc-300">
                      <span className="text-zinc-500">{entry.day} · {age(entry.lastTs, now)}</span>
                      {entry.agent ? ` · ${entry.agent}` : ""}
                      {entry.excerpt && <p className="mt-0.5 line-clamp-1 text-zinc-400">Agent reported: {entry.excerpt}</p>}
                      <p className="text-[11px] text-zinc-600">
                        {entry.filesEdited} file{entry.filesEdited === 1 ? "" : "s"} edited · {entry.turns} turn{entry.turns === 1 ? "" : "s"}
                      </p>
                    </li>
                  ))}
                </ul>
                {data.commits.length > 0 && (
                  <p className="mt-2 text-[11px] text-zinc-500">
                    Committed locally: {data.commits.slice(0, 5).map((c) => c.subject).join("; ")}
                  </p>
                )}
              </>
            )}
          </section>

          <section>
            <h3 className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">Plan</h3>
            {reads.board.state !== "ready" ? (
              <ReadStatus read={reads.board} label="board" />
            ) : data.board?.state === "missing" ? (
              <p className="mt-2 text-xs text-zinc-600">No board yet.</p>
            ) : data.board?.isExample ? (
              <p className="mt-2 text-xs text-zinc-600">Example board — not edited yet.</p>
            ) : (
              <div className="mt-2 text-xs text-zinc-300">
                {nowCard && <p>Now: {nowCard.title}</p>}
                <p className="mt-0.5 text-zinc-500">
                  Idea {statusCounts.idea} · Planned {statusCounts.planned} · Building {statusCounts.building} · Done{" "}
                  {statusCounts.done}
                </p>
              </div>
            )}
          </section>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section>
            <h3 className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">Workspaces</h3>
            <ReadStatus read={reads.reentry} label="closed workspaces" />
            <p className="mt-2 text-xs text-zinc-300">
              {liveTabs.length === 0 && reentry.length === 0 ? (
                reads.reentry.state === "ready" ? "none" : "No live workspaces"
              ) : (
                <>
                  {liveTabs.map((t) => `${t.title} · ${t.agent ?? "claude"} · ${t.agentState ?? "live"}`).join("  |  ")}
                  {reentry.length > 0 ? `${liveTabs.length > 0 ? "  |  " : ""}${reentry.length} closed` : ""}
                </>
              )}
            </p>
          </section>
        </div>
        <details className="mt-5 text-[11px] text-zinc-500">
          <summary>Read diagnostics</summary>
          <ul>{(diagnostics.identity === identity ? diagnostics.events : []).map((event, i) =>
            <li key={i}>{event.source}: {event.outcome} · {event.durationMs}ms{event.count === undefined ? "" : ` · ${event.count} rows`}</li>)}</ul>
        </details>
      </div>
    </div>
  );
}
