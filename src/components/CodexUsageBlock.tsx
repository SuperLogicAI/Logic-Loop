export interface CodexWindow {
  usedPercent: number;
  windowDurationMins: number;
  resetsAt: number;
}
export interface CodexBucket {
  id: string;
  name: string;
  primary: CodexWindow | null;
  secondary: CodexWindow | null;
}
export interface CodexMeterData {
  state: "available" | "unavailable";
  model: string | null;
  buckets: CodexBucket[];
}
export interface CodexMeterSnapshot {
  sessionId: string;
  state: "loading" | "available" | "unavailable" | "error";
  data: CodexMeterData | null;
  receivedAt: number | null;
  error?: string;
}

export function codexWindowLabel(minutes: number): string {
  if (minutes === 10080) return "weekly";
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

export function codexMeterStale(snapshot: CodexMeterSnapshot, now: number): boolean {
  return snapshot.receivedAt !== null && now - snapshot.receivedAt > 120_000;
}

function WindowBar({ window }: { window: CodexWindow }) {
  const used = Math.max(0, Math.min(100, window.usedPercent));
  const reset = new Date(window.resetsAt * 1000).toLocaleString(undefined, {
    weekday: "short", hour: "numeric", minute: "2-digit",
  });
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline justify-between text-[9px] text-zinc-500">
        <span>{codexWindowLabel(window.windowDurationMins)}</span>
        <span>{Math.round(used)}% used · {Math.round(100 - used)}% left · resets {reset}</span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-800">
        <div className={`h-full rounded-full ${used >= 90 ? "bg-red-500" : used >= 70 ? "bg-amber-400" : "bg-sky-500"}`} style={{ width: `${used}%` }} />
      </div>
    </div>
  );
}

export function CodexUsageBlock({ agent, sessionId, snapshot, now }: {
  agent?: string;
  sessionId: string | null;
  snapshot: CodexMeterSnapshot | null;
  now: number;
}) {
  if (agent !== "codex" || !sessionId) return null;
  const current = snapshot?.sessionId === sessionId ? snapshot : null;
  const stale = current ? codexMeterStale(current, now) : false;
  const data = current?.data;
  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-b border-zinc-800 px-3 py-1.5 text-[10px] text-zinc-400" title="Shared across this Codex account, including activity outside this project.">
      <span className="text-zinc-500">Codex usage · {data?.model || "Model unknown"}</span>
      {!current || current.state === "loading" ? <span className="text-zinc-600">Loading account limits…</span> : null}
      {current?.state === "unavailable" && <span className="text-zinc-600">Account limits unavailable for this authentication.</span>}
      {current?.state === "error" && !data && <span className="text-amber-400">Could not read account limits.</span>}
      {(stale || current?.state === "error") && data && <span className="text-amber-400">Last update may be stale.</span>}
      {data?.state === "available" && (data.buckets.length === 0 ? <span className="text-zinc-600">No account windows returned.</span> : data.buckets.map((bucket) => (
        <div key={bucket.id} className="flex flex-col gap-1">
          <span className="text-zinc-500">{bucket.name || bucket.id} account</span>
          {bucket.primary && <WindowBar window={bucket.primary} />}
          {bucket.secondary && <WindowBar window={bucket.secondary} />}
          {!bucket.primary && !bucket.secondary && <span className="text-zinc-600">No windows returned.</span>}
        </div>
      )))}
    </div>
  );
}
