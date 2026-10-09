// Plan 059 Checkpoint 2: token spend meter — dock chip, Home card line, Overview section.
// Units are effort units, never dollars. Panels are views over usage_records.
import { useEffect, useState } from "react";
import * as repo from "../lib/repo";
import { formatTokens } from "../lib/contextMeter";
import { SPARK_FULL_SCALE, SPEND_AMBER, SPEND_RED, sparkHeights, spendCoverage, spendLevel, spendSummary, WEIGHTS, type SpendSummary, type UsageRow, type UsageThread } from "../lib/spend";

const UNIT_NOTE = `Effort units: fresh input ×${WEIGHTS.fresh}, cache read ×${WEIGHTS.cacheRead}, cache write ×${WEIGHTS.cacheWrite}, output ×${WEIGHTS.output}. Not dollars. Bars: last 15 min, full height = ${formatTokens(SPARK_FULL_SCALE)} units/min; amber ≥ ${formatTokens(SPEND_AMBER)}, red ≥ ${formatTokens(SPEND_RED)}.`;

function ago(ts: number | null, now: number): string {
  if (ts === null) return "no samples yet";
  const s = Math.max(0, Math.round((now - ts) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
}

export function spendTitle(s: SpendSummary, threads: UsageThread[], now: number): string {
  const cov = spendCoverage(threads, s.rootSessionId);
  const coverage = cov.seen === 0 ? "" : ` · ${cov.recorded}/${cov.seen} threads recorded${cov.recorded < cov.seen ? " (incomplete)" : ""}`;
  const window = s.windowMin >= 5 ? "5-min avg" : `avg over ${Math.max(1, Math.round(s.windowMin))} min (session is young)`;
  return `${formatTokens(Math.round(s.ratePerMin))} units/min (${window}) · last 1 min: ${formatTokens(Math.round(s.burstPerMin))} · session total ${formatTokens(Math.round(s.total))} · last sample ${ago(s.lastSampleAt, now)}${coverage}\n${UNIT_NOTE}`;
}

const BAR_COLOR = { zero: "bg-zinc-700", normal: "bg-info-500", high: "bg-attn-400", peak: "bg-danger-500" } as const;

/** 15 one-minute bars, oldest first, on a fixed scale (not the line's own
 * peak), colored by each minute's own level — same palette as the context meter. */
function Sparkline({ values }: { values: number[] }) {
  const heights = sparkHeights(values);
  return (
    <span className="inline-flex h-3 items-end gap-px align-middle" aria-hidden="true">
      {values.map((v, i) => (
        <span
          key={i}
          className={`w-0.5 ${BAR_COLOR[spendLevel(v)]}`}
          style={{ height: heights[i] > 0 ? `${Math.max(heights[i] * 100, 15)}%` : "1px" }}
        />
      ))}
    </span>
  );
}

/** Sparkline + "41k u/min · 1.2M total". */
export function SpendLine({ s }: { s: SpendSummary }) {
  return (
    <span className="inline-flex items-center gap-1.5 tabular-nums">
      <Sparkline values={s.sparkline} />
      {formatTokens(Math.round(s.ratePerMin))} u/min · {formatTokens(Math.round(s.total))} total
    </span>
  );
}

/** Re-render on an interval so the 5-min rate decays without new samples. */
export function useNow(ms = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function useTabUsage(tabId: string, sessionId: string | undefined, refresh: number): UsageRow[] {
  const [rows, setRows] = useState<UsageRow[]>([]);
  useEffect(() => {
    let cancelled = false;
    void repo
      .usageRows(tabId, sessionId ?? null)
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch(() => undefined); // fail open: no meter
    return () => {
      cancelled = true;
    };
  }, [tabId, sessionId, refresh]);
  return rows;
}

export function SpendChip({ tabId, sessionId, refresh, threads }: { tabId: string; sessionId?: string; refresh: number; threads: UsageThread[] }) {
  const rows = useTabUsage(tabId, sessionId, refresh);
  const now = useNow();
  const s = spendSummary(rows, now);
  if (!s) return null;
  return (
    <span className="shrink-0 cursor-default text-xs text-zinc-500 tabular-nums" title={spendTitle(s, threads, now)}>
      <SpendLine s={s} />
    </span>
  );
}

/** Overview: per-thread breakdown of each project tab's current session. */
export function AgentSpendSection({ tabs, refresh, threads }: { tabs: { id: string; title: string; sessionId?: string }[]; refresh: number; threads: UsageThread[] }) {
  const now = useNow();
  const [byTab, setByTab] = useState<Map<string, UsageRow[]>>(new Map());
  const key = tabs.map((t) => `${t.id}:${t.sessionId ?? ""}`).join("|");
  useEffect(() => {
    let cancelled = false;
    void Promise.all(tabs.map(async (t) => [t.id, await repo.usageRows(t.id, t.sessionId ?? null)] as const))
      .then((pairs) => {
        if (!cancelled) setByTab(new Map(pairs));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refresh]);
  const rows = tabs
    .map((t) => ({ tab: t, s: spendSummary(byTab.get(t.id) ?? [], now) }))
    .filter((x): x is { tab: (typeof tabs)[number]; s: SpendSummary } => x.s !== null);
  if (rows.length === 0) return null;
  const kindOf = (threadId: string) => threads.find((t) => t.thread_id === threadId)?.kind ?? "thread";
  return (
    <section className="mt-5">
      <div className="flex h-6 items-center">
        <h3 className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase" title={UNIT_NOTE}>Agent spend (effort units)</h3>
      </div>
      <div className="mt-2 flex flex-col gap-3">
        {rows.map(({ tab, s }) => {
          const cov = spendCoverage(threads, s.rootSessionId);
          return (
            <div key={tab.id} className="text-xs text-zinc-300">
              <p className="text-zinc-200" title={spendTitle(s, threads, now)}>
                {tab.title} · <SpendLine s={s} />
              </p>
              <table className="mt-1 w-full max-w-md text-[11px] text-zinc-400 tabular-nums">
                <thead>
                  <tr className="text-left text-zinc-600">
                    <th className="font-normal">Thread</th>
                    <th className="text-right font-normal">rate/min</th>
                    <th className="text-right font-normal">total</th>
                  </tr>
                </thead>
                <tbody>
                  {s.threads.map((t) => (
                    <tr key={t.threadId}>
                      <td>
                        {kindOf(t.threadId)} <span className="text-zinc-600">{t.threadId.slice(-6)}</span>
                      </td>
                      <td className="text-right">{formatTokens(Math.round(t.ratePerMin))}</td>
                      <td className="text-right">{formatTokens(Math.round(t.total))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-[11px] text-zinc-600">
                Last sample {ago(s.lastSampleAt, now)}
                {cov.seen > 0 && ` · ${cov.recorded} of ${cov.seen} threads recorded${cov.recorded < cov.seen ? " — total is incomplete" : ""}`}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
