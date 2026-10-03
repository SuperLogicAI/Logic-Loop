import { useEffect, useMemo, useState } from "react";
import * as repo from "../lib/repo";
import {
  buildProjectCards,
  projectDisplayName,
  projectFolderLabel,
  sortProjectCards,
  type HomeTabSummary,
  type ProjectCardViewModel,
} from "../lib/dashboard";
import type { Tab } from "../types";

type Filter = "all" | "working" | "decisions" | "archived";

const FILTER_LABEL: Record<Filter, string> = {
  all: "All",
  working: "Working",
  decisions: "Needs a choice",
  archived: "Archived",
};

function age(ts: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - ts) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

interface Props {
  tabs: Tab[];
  expand: (cwd: string) => string;
  /** Current workspace pane, if any — Home never changes it, only reads it
   * for the "Continue" callout (Plan 048 §3: "most recently used live or
   * resumable workspace ... User click only"). */
  activeTab: Tab | null;
  openDecisionOwners: repo.DecisionOwner[];
  /** Clicking a project opens its Project Overview (Plan 048 §1) — the
   * workspace itself is reached from there, not directly from the card. */
  onOpenOverview: (projectKey: string) => void;
  /** Return to the exact pane `activeTab` points at, with no respawn. */
  onContinue: (tabId: string) => void;
  attentionCount: number;
  onOpenAttention: () => void;
  inboxBadgeEnabled: boolean;
  onToggleInboxBadge: () => void;
  startSurface: "home" | "workspace" | null;
  onChangeStartSurface: (next: "home" | "workspace") => Promise<void>;
  onOpenSetup: () => void;
  onOpenTour: () => void;
}

export function HomeDashboard({
  tabs,
  expand,
  activeTab,
  openDecisionOwners,
  onOpenOverview,
  onContinue,
  attentionCount,
  onOpenAttention,
  inboxBadgeEnabled,
  onToggleInboxBadge,
  startSurface,
  onChangeStartSurface,
  onOpenSetup,
  onOpenTour,
}: Props) {
  const [catalog, setCatalog] = useState<repo.ProjectCatalogEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [showOlder, setShowOlder] = useState(false);
  const [preferenceError, setPreferenceError] = useState(false);
  const [savingPreference, setSavingPreference] = useState(false);
  const now = useMemo(() => Date.now(), []); // one snapshot per Home visit, not a ticking clock

  useEffect(() => {
    let cancelled = false;
    void repo
      .listProjectCatalog()
      .then((rows) => {
        if (!cancelled) setCatalog(rows);
      })
      .catch(() => {
        if (!cancelled) setCatalog([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const homeTabs: HomeTabSummary[] = useMemo(
    () => tabs.map((t) => ({ projectKey: expand(t.cwd), status: t.status, agentState: t.agentState })),
    [tabs, expand]
  );

  const decisionCountByProject = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of openDecisionOwners) {
      counts.set(row.cwd, (counts.get(row.cwd) ?? 0) + 1);
    }
    return counts;
  }, [openDecisionOwners]);

  const allKeys = useMemo(() => (catalog ?? []).map((c) => c.projectKey), [catalog]);

  const cards = useMemo(() => {
    if (!catalog) return [];
    return sortProjectCards(buildProjectCards(catalog, homeTabs, now));
  }, [catalog, homeTabs, now]);

  const projectCount = cards.length;
  const workingProjectCount = cards.filter((c) => c.workingCount > 0).length;
  const decisionProjectCount = cards.filter((c) => (decisionCountByProject.get(c.projectKey) ?? 0) > 0).length;

  const filtered = cards.filter((c) => {
    if (filter === "working" && c.workingCount === 0 && c.waitingCount === 0) return false;
    if (filter === "decisions" && (decisionCountByProject.get(c.projectKey) ?? 0) === 0) return false;
    if (filter === "archived" && !c.archived) return false;
    if (filter !== "archived" && c.archived) return false;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      const name = projectDisplayName(c.projectKey, allKeys, c).toLowerCase();
      if (!name.includes(q) && !c.projectKey.toLowerCase().includes(q) && !(c.purpose ?? "").toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  });

  const searching = query.trim().length > 0;
  const visible = searching || showOlder ? filtered : filtered.filter((c) => !c.olderProject);
  const hiddenOlderCount = searching ? 0 : filtered.length - visible.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-zinc-900 px-6 py-5">
      <div className="mx-auto w-full max-w-5xl">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-zinc-400">
          <span className="text-base font-semibold text-zinc-100">Home</span>
          {catalog === null ? (
            <span>Loading projects…</span>
          ) : (
            <span>
              {projectCount} project{projectCount === 1 ? "" : "s"}
              {workingProjectCount > 0 ? ` · ${workingProjectCount} with agents working` : ""}
              {decisionProjectCount > 0 ? ` · ${decisionProjectCount} with open decisions` : ""}
            </span>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <label className="text-xs text-zinc-400">Start in: {" "}
              <select aria-label="Start in" value={startSurface ?? "workspace"} disabled={startSurface === null || savingPreference}
                className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-300"
                onChange={(e) => {
                  const next = e.target.value === "home" ? "home" : "workspace";
                  setPreferenceError(false);
                  setSavingPreference(true);
                  void onChangeStartSurface(next).catch(() => setPreferenceError(true)).finally(() => setSavingPreference(false));
                }}>
                <option value="home">Home</option><option value="workspace">Last workspace</option>
              </select>
            </label>
            <button type="button" className="rounded-md border border-sky-800/70 px-2.5 py-1.5 text-xs text-zinc-300 hover:border-sky-500 focus-visible:border-sky-400 focus-visible:outline-2 focus-visible:outline-sky-400" onClick={onOpenSetup}>Setup</button>
            <button type="button" className="rounded-md border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300" onClick={onOpenTour}>Tour</button>
            <button
              type="button"
              className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              onClick={onToggleInboxBadge}
              title="Plan 048 inbox_badge setting — hides the unread count on the Attention button, not the button itself"
            >
              {inboxBadgeEnabled ? "Hide unread count" : "Show unread count"}
            </button>
            <button
              type="button"
              className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
              onClick={onOpenAttention}
            >
              Inbox{inboxBadgeEnabled && attentionCount > 0 ? ` (${attentionCount})` : ""}
            </button>
          </div>
        </div>

        {preferenceError && <p role="alert" className="mt-2 text-xs text-amber-400">Couldn't save startup preference. Choose it again to retry.</p>}
        {activeTab && (
          <div className="mt-4 flex items-center gap-3 rounded-lg border border-zinc-700 bg-zinc-800/60 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">Continue</p>
              <p className="truncate text-sm text-zinc-200">{projectDisplayName(expand(activeTab.cwd), allKeys, catalog?.find((entry) => entry.projectKey === expand(activeTab.cwd)))}</p>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500"
              onClick={() => onContinue(activeTab.id)}
            >
              Continue
            </button>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects…"
            aria-label="Search projects"
            className="min-w-48 flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-sky-500"
          />
          <div className="flex items-center gap-1" role="tablist" aria-label="Project filters">
            {(Object.keys(FILTER_LABEL) as Filter[]).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={filter === key}
                className={`rounded px-2.5 py-1.5 text-xs ${filter === key ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"}`}
                onClick={() => setFilter(key)}
              >
                {FILTER_LABEL[key]}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {catalog !== null && visible.length === 0 && (
            <p className="col-span-full py-8 text-center text-sm text-zinc-500">
              {catalog.length === 0 ? <>No projects yet. <button type="button" className="text-sky-400 hover:text-sky-300" onClick={onOpenSetup}>Choose a folder and start a session</button></> : "No projects match this search."}
            </p>
          )}
          {visible.map((card) => (
            <ProjectCard
              key={card.projectKey}
              card={card}
              displayName={projectDisplayName(card.projectKey, allKeys, card)}
              decisionCount={decisionCountByProject.get(card.projectKey) ?? 0}
              now={now}
              onOpen={() => onOpenOverview(card.projectKey)}
            />
          ))}
        </div>

        {hiddenOlderCount > 0 && (
          <button
            type="button"
            className="mt-4 text-xs text-zinc-500 hover:text-zinc-300"
            onClick={() => setShowOlder(true)}
          >
            Show {hiddenOlderCount} older project{hiddenOlderCount === 1 ? "" : "s"}
          </button>
        )}
      </div>
    </div>
  );
}

function ProjectCard({
  card,
  displayName,
  decisionCount,
  now,
  onOpen,
}: {
  card: ProjectCardViewModel;
  displayName: string;
  decisionCount: number;
  now: number;
  onOpen: () => void;
}) {
  const statusParts: string[] = [];
  if (card.workingCount > 0) statusParts.push(`${card.workingCount} working`);
  if (card.waitingCount > 0) statusParts.push(`${card.waitingCount} waiting`);

  return (
    <div className="flex flex-col rounded-lg border border-zinc-700 bg-zinc-800/40 p-4" style={{ borderColor: card.bookmarkColor || undefined }}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 truncate text-sm font-medium text-zinc-100" title={card.projectKey}>
          {displayName}
        </h3>
        <div className="flex shrink-0 items-center gap-1">
          {card.pinned && <span className="text-[10px] text-amber-400">pinned</span>}
          {card.archived && <span className="text-[10px] text-zinc-500">Archived</span>}
        </div>
      </div>
      <p className="mt-1 break-all text-[11px] text-zinc-400" title={card.projectKey}>{projectFolderLabel(card.projectKey)}</p>
      {card.purpose && <p className="mt-1 line-clamp-1 text-xs text-zinc-500">{card.purpose}</p>}
      <p className="mt-2 text-[11px] text-zinc-500">
        {card.lastActivityAt ? age(card.lastActivityAt, now) : "No activity recorded yet"}
      </p>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-400">
        {statusParts.length > 0 && <span>{statusParts.join(" · ")}</span>}
        {decisionCount > 0 && <span className="text-orange-400">{decisionCount} open decision{decisionCount === 1 ? "" : "s"}</span>}
      </div>
      <button
        type="button"
        aria-label={`Open ${displayName} overview`}
        className="mt-3 rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700"
        onClick={onOpen}
      >
        Open
      </button>
    </div>
  );
}
