import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import * as repo from "../lib/repo";
import { observedAgentTime, projectDisplayName } from "../lib/dashboard";
import { summarizeDelta, lastAssistantText, type EventRow } from "../lib/delta";
import { computeMomentum } from "../lib/momentum";
import { parseBoard, peekBoard, EXAMPLE_BOARD, type BoardStatus } from "../lib/board";
import { resolveAttentionRoute, type AttentionTabSnapshot } from "../lib/attention";
import { type CopyUpdateData } from "./CopyUpdateModal";
import type { AttentionEvidence, Blocker, Commit, Decision, Note, ReentryCandidate, Tab } from "../types";

type Range = "today" | "7d" | "30d";

const RANGE_LABEL: Record<Range, string> = { today: "Today", "7d": "7 days", "30d": "30 days" };
// ponytail: "Today" as a rolling 24h window, not local-midnight-to-now —
// avoids timezone/DST edge cases for a work-log filter; close enough for
// "what happened recently", revisit if a user reports it reading odd near
// midnight.
const RANGE_MS: Record<Range, number> = {
  today: 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

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

interface WorkLogEntry {
  sessionId: string;
  agent: string | null;
  lastTs: number;
  excerpt: string;
  filesEdited: number;
  turns: number;
}

interface OverviewData {
  catalog: repo.ProjectCatalogEntry | null;
  openDecisions: Decision[];
  openBlockers: Blocker[];
  landing: Note | null;
  workLog: WorkLogEntry[];
  commits: Commit[];
  board: { state: "ready" | "missing" | "error"; cards: ReturnType<typeof parseBoard>; isExample: boolean };
  agentTime: ReturnType<typeof observedAgentTime>;
}

interface Props {
  projectKey: string;
  tabs: Tab[];
  expand: (cwd: string) => string;
  now: number;
  onBack: () => void;
  onContinueTab: (tabId: string) => void;
  onStartSession: (projectKey: string) => void;
  onOpenCopyUpdate: (data: CopyUpdateData) => void;
}

export function ProjectOverview({ projectKey, tabs, expand, now, onBack, onContinueTab, onStartSession, onOpenCopyUpdate }: Props) {
  const [range, setRange] = useState<Range>("7d");
  const [data, setData] = useState<OverviewData | null>(null);
  const [purposeDraft, setPurposeDraft] = useState("");
  const [editingPurpose, setEditingPurpose] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const since = now - RANGE_MS[range];
    void (async () => {
      const [catalogRows, openDecisions, allBlockers, sessions, landing, boardPeek, agentObs] = await Promise.all([
        repo.listProjectCatalog().catch(() => []),
        repo.openDecisionsForProject(projectKey).catch(() => []),
        repo.listBlockers(projectKey).catch(() => []),
        repo.projectSessions(projectKey).catch(() => []),
        repo.latestLandingNote(projectKey).catch(() => null),
        peekBoard(projectKey).catch(() => ({ state: "error", message: "" }) as const),
        repo.projectAgentTimeObservations(projectKey).catch(() => []),
      ]);
      const eventsPerSession = await Promise.all(
        sessions.map((s) =>
          repo.eventsSince(s.tab_tether, s.session_id, since).catch(() => [] as EventRow[])
        )
      );
      const commits = await invoke<Commit[]>("git_log", { cwd: projectKey, limit: 50 })
        .then((rows) => rows.filter((c) => c.ts >= since))
        .catch(() => []);
      if (cancelled) return;

      const workLog: WorkLogEntry[] = sessions
        .map((s, i) => {
          const events = eventsPerSession[i];
          if (events.length === 0) return null;
          const delta = summarizeDelta(events, []);
          return {
            sessionId: s.session_id,
            agent: s.agent,
            lastTs: events[events.length - 1].ts,
            excerpt: lastAssistantText(events),
            filesEdited: delta.files.length,
            turns: delta.turns,
          };
        })
        .filter((e): e is WorkLogEntry => e !== null)
        .sort((a, b) => b.lastTs - a.lastTs);

      const cards = boardPeek.state === "ready" ? parseBoard(boardPeek.content) : [];
      const isExample = boardPeek.state === "ready" && boardPeek.content === EXAMPLE_BOARD;

      setData({
        catalog: catalogRows.find((c) => c.projectKey === projectKey) ?? null,
        openDecisions,
        openBlockers: allBlockers.filter((b) => b.resolved === 0),
        landing,
        workLog,
        commits,
        board: { state: boardPeek.state, cards, isExample },
        agentTime: observedAgentTime(
          agentObs.map((o) => ({ sessionId: o.session_id, runId: o.run_id, state: o.state, observedAt: o.observed_at }))
        ),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [projectKey, range, now]);

  const liveTabs = tabs.filter((t) => t.status === "live" && expand(t.cwd) === projectKey);
  const [reentry, setReentry] = useState<ReentryCandidate[]>([]);
  useEffect(() => {
    let cancelled = false;
    void repo
      .reentryCandidates()
      .then((rows) => {
        if (cancelled) return;
        const openTetherIds = new Set(tabs.map((t) => t.id));
        setReentry(rows.filter((r) => r.project_key === projectKey && !openTetherIds.has(r.tab_tether)));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // tabs intentionally omitted: this only needs to re-run when the project
    // changes, not on every live tab mutation — openTetherIds is read fresh
    // each time it does run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectKey]);

  const displayName = useMemo(() => projectDisplayName(projectKey, [projectKey]), [projectKey]);

  const tabSnapshots: AttentionTabSnapshot[] = tabs.map((t) => ({
    id: t.id,
    cwd: expand(t.cwd),
    sessionId: t.sessionId,
    agent: t.agent,
    status: t.status,
  }));

  const needsAChoice = data
    ? [
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
      ]
    : [];

  const momentum = data
    ? computeMomentum({
        landing: data.landing,
        decisions: data.openDecisions,
        blockers: data.openBlockers,
        plannedCard: data.board.cards.find((c) => c.now) ?? data.board.cards.find((c) => c.status === "planned") ?? null,
        // Read-only: Overview never calls any of these. computeMomentum needs
        // the shape; nothing wires a "done" control to them here.
        onLandingDone: async () => undefined,
        onDecisionDone: async () => undefined,
        onBlockerDone: async () => undefined,
        onPlannedCardDone: async () => undefined,
      })
    : null;

  const statusCounts: Record<BoardStatus, number> = { idea: 0, planned: 0, building: 0, later: 0, done: 0 };
  if (data) for (const c of data.board.cards) statusCounts[c.status]++;
  const nowCard = data?.board.cards.find((c) => c.now) ?? null;

  const savePurpose = async () => {
    await repo.setProjectPurpose(projectKey, purposeDraft).catch(() => undefined);
    setData((d) => (d && d.catalog ? { ...d, catalog: { ...d.catalog, purpose: purposeDraft } } : d));
    setEditingPurpose(false);
  };

  const togglePinned = async () => {
    if (!data?.catalog) return;
    const next = !data.catalog.pinned;
    await repo.setProjectPinned(projectKey, next).catch(() => undefined);
    setData((d) => (d && d.catalog ? { ...d, catalog: { ...d.catalog, pinned: next } } : d));
  };

  const toggleArchived = async () => {
    if (!data?.catalog) return;
    const next = !data.catalog.archived;
    await repo.setProjectArchived(projectKey, next).catch(() => undefined);
    setData((d) => (d && d.catalog ? { ...d, catalog: { ...d.catalog, archived: next } } : d));
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
          <div className="ml-auto flex items-center gap-2">
            {liveTabs.length > 0 ? (
              <button
                type="button"
                className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500"
                onClick={() => onContinueTab(liveTabs[0].id)}
              >
                Continue
              </button>
            ) : (
              <button
                type="button"
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
                onClick={() => onStartSession(projectKey)}
              >
                Start session
              </button>
            )}
            <button
              type="button"
              disabled={!data}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
              onClick={() =>
                data &&
                onOpenCopyUpdate({
                  projectName: displayName,
                  rangeLabel: RANGE_LABEL[range],
                  workLogExcerpts: data.workLog.map((e) => e.excerpt).filter((t) => t.length > 0),
                  commits: data.commits,
                  openDecisions: data.openDecisions,
                  openBlockers: data.openBlockers,
                  nextStep: momentum?.text ?? null,
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
              className="w-full max-w-md rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 outline-none focus:border-sky-500"
            />
            <button type="button" className="text-xs text-sky-400" onClick={() => void savePurpose()}>
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
        <p className="mt-1 text-[11px] text-zinc-600">
          {data?.catalog?.lastActivityAt ? `Last activity ${age(data.catalog.lastActivityAt, now)}` : "No activity recorded yet"}
          {data?.catalog?.firstSeenAt ? ` · first seen ${age(data.catalog.firstSeenAt, now)}` : ""}
        </p>

        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section>
            <h3 className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">Needs a choice</h3>
            {needsAChoice.length === 0 ? (
              <p className="mt-2 text-xs text-zinc-600">Nothing open.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {needsAChoice.map((item, i) => (
                  <li key={i} className="rounded-md border border-zinc-800 bg-zinc-800/30 p-2.5">
                    <p className="text-xs text-zinc-200">{item.text}</p>
                    {item.assumption && <p className="mt-0.5 text-[11px] text-zinc-500">Agent assumption: {item.assumption}</p>}
                    <button
                      type="button"
                      disabled={!item.route.tabId}
                      className="mt-1.5 text-[11px] text-sky-400 hover:text-sky-300 disabled:text-zinc-600"
                      onClick={() => item.route.tabId && onContinueTab(item.route.tabId)}
                    >
                      {item.route.tabId ? "Go to workspace" : "Destination unavailable"}
                    </button>
                  </li>
                ))}
              </ul>
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
              <p className="mt-2 text-xs text-zinc-600">Nothing queued up.</p>
            )}
          </section>

          <section>
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">Work log</h3>
              <div className="flex gap-1" role="tablist" aria-label="Work log range">
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
            {!data ? (
              <p className="mt-2 text-xs text-zinc-600">Loading…</p>
            ) : data.workLog.length === 0 && data.commits.length === 0 ? (
              <p className="mt-2 text-xs text-zinc-600">none recorded</p>
            ) : (
              <>
                <ul className="mt-2 space-y-2">
                  {data.workLog.map((entry) => (
                    <li key={entry.sessionId} className="text-xs text-zinc-300">
                      <span className="text-zinc-500">{age(entry.lastTs, now)}</span>
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
            {!data || data.board.state === "missing" ? (
              <p className="mt-2 text-xs text-zinc-600">No board yet.</p>
            ) : data.board.state === "error" ? (
              <p className="mt-2 text-xs text-red-400">Couldn't read the board.</p>
            ) : data.board.isExample ? (
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
            <h3 className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">Agent time (observed)</h3>
            {data && data.agentTime.sinceDate ? (
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

          <section>
            <h3 className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">Workspaces</h3>
            <p className="mt-2 text-xs text-zinc-300">
              {liveTabs.length === 0 && reentry.length === 0 ? (
                "none"
              ) : (
                <>
                  {liveTabs.map((t) => `${t.title} · ${t.agent ?? "claude"} · ${t.agentState ?? "live"}`).join("  |  ")}
                  {reentry.length > 0 ? `${liveTabs.length > 0 ? "  |  " : ""}${reentry.length} closed` : ""}
                </>
              )}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
