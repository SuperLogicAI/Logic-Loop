import type { AttentionEvidence, AttentionItem, Tab } from "../types";
import { STALL_MS } from "./ingest";

export interface AttentionTabSnapshot {
  id: string;
  cwd: string;
  sessionId?: string;
  agent?: string;
  status: Tab["status"];
}

export interface AttentionViews {
  active: AttentionItem[];
  backlog: AttentionItem[];
  archived: AttentionItem[];
}

const ACTIONABILITY_ORDER: Record<AttentionItem["actionability"], number> = {
  act: 0,
  review: 1,
  investigate: 2,
  unknown: 3,
};

const KIND_ORDER: Record<AttentionItem["kind"], number> = {
  waiting: 0,
  decision: 1,
  result: 2,
  blocker: 3,
  stalled: 4,
};

function sameKnown(value: string | null, candidate: string | undefined): boolean {
  return value == null || candidate == null || value === candidate;
}

export function resolveAttentionRoute(
  evidence: AttentionEvidence,
  tabs: AttentionTabSnapshot[]
): { route: AttentionItem["route"]; tabId: string | null } {
  const live = tabs.filter((tab) => tab.status === "live");
  if (evidence.tabId) {
    const exact = live.find((tab) => tab.id === evidence.tabId);
    if (
      exact &&
      exact.cwd === evidence.projectKey &&
      sameKnown(evidence.sessionId, exact.sessionId) &&
      sameKnown(evidence.adapterId, exact.agent)
    ) {
      return { route: "exact", tabId: exact.id };
    }
  }

  if (evidence.sessionId) {
    const sessions = live.filter(
      (tab) =>
        tab.sessionId === evidence.sessionId &&
        tab.cwd === evidence.projectKey &&
        sameKnown(evidence.adapterId, tab.agent)
    );
    if (sessions.length === 1) return { route: "session", tabId: sessions[0].id };
    return { route: "unavailable", tabId: null };
  }

  const projects = live.filter(
    (tab) => tab.cwd === evidence.projectKey && sameKnown(evidence.adapterId, tab.agent)
  );
  if (projects.length === 1) return { route: "project", tabId: projects[0].id };
  return { route: "unavailable", tabId: null };
}

function actionability(kind: AttentionItem["kind"], route: AttentionItem["route"]): AttentionItem["actionability"] {
  if (route === "unavailable") return "unknown";
  if (kind === "waiting" || kind === "decision") return "act";
  if (kind === "result") return "review";
  return "investigate";
}

export function compareAttention(a: AttentionItem, b: AttentionItem): number {
  return (
    ACTIONABILITY_ORDER[a.actionability] - ACTIONABILITY_ORDER[b.actionability] ||
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
    a.createdAt - b.createdAt ||
    a.id.localeCompare(b.id)
  );
}

export function buildAttentionItems(
  evidence: AttentionEvidence[],
  tabs: AttentionTabSnapshot[],
  currentRunId: string,
  now: number
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const row of evidence) {
    const resolved = resolveAttentionRoute(row, tabs);
    const lifecycle = row.kind === "waiting" || row.kind === "stalled";
    if (lifecycle) {
      if (row.runId !== currentRunId || resolved.route === "unavailable") continue;
      if (row.kind === "waiting" && row.observedState !== "waiting") continue;
      if (
        row.kind === "stalled" &&
        (row.observedState !== "working" || row.lastActivityAt == null || now - row.lastActivityAt <= STALL_MS)
      ) {
        continue;
      }
    }
    items.push({
      id: row.id,
      kind: row.kind,
      projectKey: row.projectKey,
      sessionId: row.sessionId,
      tabId: resolved.tabId,
      adapterId: row.adapterId,
      actorId: row.actorId,
      createdAt: row.createdAt,
      lastActivityAt: row.lastActivityAt,
      text: row.text,
      evidenceId: row.evidenceId,
      actionability: actionability(row.kind, resolved.route),
      confidence: row.kind === "waiting" || row.kind === "stalled" ? "inferred" : "explicit",
      route: resolved.route,
      archived: row.archived,
    });
  }
  return items.sort(compareAttention);
}

function compareOldest(a: AttentionItem, b: AttentionItem): number {
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

/** Split the one global snapshot into mutually exclusive UI surfaces. */
export function partitionAttentionItems(items: AttentionItem[]): AttentionViews {
  const active: AttentionItem[] = [];
  const backlog: AttentionItem[] = [];
  const archived: AttentionItem[] = [];
  for (const item of items) {
    if (item.archived) archived.push(item);
    else if (item.route === "unavailable") backlog.push(item);
    else active.push(item);
  }
  return {
    active,
    backlog: backlog.sort(compareOldest),
    archived: archived.sort(compareOldest),
  };
}

export function attentionProjectLabel(projectKey: string): string {
  return projectKey.split(/[\\/]/).filter(Boolean).pop() ?? projectKey;
}

export function filterAttentionItems(items: AttentionItem[], query: string): AttentionItem[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return items;
  return items.filter((item) =>
    [attentionProjectLabel(item.projectKey), item.projectKey, item.kind, item.adapterId ?? "", item.text]
      .join("\n")
      .toLocaleLowerCase()
      .includes(needle)
  );
}
