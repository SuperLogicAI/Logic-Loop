import { useEffect, useSyncExternalStore } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import * as repo from "../lib/repo";
import { compactEvents, formatBytes, NUDGE_SNOOZE_MS, shouldNudge } from "../lib/compaction";

const RECLAIM_PROMPT =
  "This permanently deletes stored tool output and metadata lines from past sessions. " +
  "Messages, decisions, notes and work history stay. This can't be undone.";

type Run =
  | { status: "idle" }
  | { status: "running"; removed: number }
  | { status: "done"; reclaimedBytes: number }
  | { status: "snoozed" }
  | { status: "failed"; message: string };

interface StorageState {
  bytes: number | null;
  compactedAt: number | null;
  snoozedUntil: number | null;
  agentsWorking: boolean;
  run: Run;
}

// One store: the popover and the side-panel row share a run and its progress.
let state: StorageState = { bytes: null, compactedAt: null, snoozedUntil: null, agentsWorking: false, run: { status: "idle" } };
let loaded = false;
const listeners = new Set<() => void>();

function update(patch: Partial<StorageState>): void {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function useStorage(): StorageState {
  const snapshot = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    if (loaded) return;
    loaded = true;
    void Promise.all([repo.databaseBytes(), repo.compactionState()])
      .then(([bytes, saved]) => update({ bytes, ...saved }))
      .catch(() => undefined); // fail open: no size, no nudge
  }, []);
  return snapshot;
}

export function setAgentsWorking(agentsWorking: boolean): void {
  if (agentsWorking !== state.agentsWorking) update({ agentsWorking });
}

async function reclaimSpace(): Promise<void> {
  if (state.run.status === "running") return;
  const confirmed = await ask(RECLAIM_PROMPT, {
    title: "Reclaim disk space?",
    kind: "warning",
    okLabel: "Delete and reclaim",
    cancelLabel: "Cancel",
  });
  if (!confirmed) return;
  update({ run: { status: "running", removed: 0 } });
  try {
    const { reclaimedBytes } = await compactEvents(repo, (removed) => update({ run: { status: "running", removed } }));
    update({ run: { status: "done", reclaimedBytes }, compactedAt: Date.now(), bytes: await repo.databaseBytes() });
  } catch (e) {
    update({ run: { status: "failed", message: String(e) } });
  }
}

function snooze(): void {
  update({ run: { status: "snoozed" }, snoozedUntil: Date.now() + NUDGE_SNOOZE_MS });
  void repo.snoozeCompactionNudge(state.snoozedUntil!).catch(() => undefined);
}

function runMessage(run: Run): string | null {
  if (run.status === "running") return `Reclaiming space, ${run.removed.toLocaleString()} lines removed so far…`;
  if (run.status === "done") return `Reclaimed ${formatBytes(run.reclaimedBytes)}.`;
  if (run.status === "snoozed") return "Reclaim space stays available in Sidebar LM.";
  if (run.status === "failed") return `Couldn't reclaim space: ${run.message}`;
  return null;
}

/** Storage section of the Sidebar LM popover. */
export function StorageRow() {
  const { bytes, agentsWorking, run } = useStorage();
  const running = run.status === "running";
  return (
    <div className="flex flex-col gap-1 border-t border-zinc-800 pt-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-zinc-300">Storage</span>
        <span className="text-zinc-400">{bytes === null ? "—" : formatBytes(bytes)}</span>
      </div>
      <button
        type="button"
        disabled={running || agentsWorking}
        title={agentsWorking ? "Available once no agent is working" : "Delete stored lines nothing reads"}
        className="self-start text-zinc-400 hover:text-zinc-200 disabled:cursor-not-allowed disabled:text-zinc-600"
        onClick={() => void reclaimSpace()}
      >
        Reclaim space
      </button>
      {run.status !== "idle" && run.status !== "snoozed" && <span className="text-zinc-400">{runMessage(run)}</span>}
    </div>
  );
}

/** Quiet one-time side-panel row. Also reports a run, since the popover closes. */
export function StorageNudge() {
  const { bytes, compactedAt, snoozedUntil, agentsWorking, run } = useStorage();
  const row = "flex shrink-0 items-center gap-2 border-b border-zinc-800 px-3 py-1.5 text-xs text-zinc-400";
  const message = runMessage(run);
  if (message) {
    return (
      <p className={row} role="status">
        <span className="min-w-0 flex-1 leading-4">{message}</span>
        {run.status !== "running" && (
          <button
            type="button"
            aria-label="Dismiss"
            className="shrink-0 px-1 hover:text-zinc-200"
            onClick={() => update({ run: { status: "idle" } })}
          >
            ×
          </button>
        )}
      </p>
    );
  }
  if (!shouldNudge({ bytes, compactedAt, snoozedUntil, agentsWorking, now: Date.now() })) return null;
  return (
    <p className={row}>
      <span className="min-w-0 flex-1 leading-4">
        Logic Loop is using {formatBytes(bytes!)}. Most of it is old tool output nothing reads.
      </span>
      <button type="button" className="shrink-0 text-zinc-200 hover:underline" onClick={() => void reclaimSpace()}>
        Review
      </button>
      <button type="button" className="shrink-0 hover:text-zinc-200" onClick={snooze}>
        Not now
      </button>
    </p>
  );
}
