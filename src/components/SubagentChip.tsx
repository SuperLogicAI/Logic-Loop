// Plan 059: observed worker subagents for the active tab, beside the context meter.
import { useEffect, useState } from "react";
import * as repo from "../lib/repo";
import { subagentLabel, subagentState, type SubagentState } from "../lib/spend";

export function SubagentChip({ tabId, sessionId, live, refresh }: { tabId: string; sessionId?: string; live: boolean; refresh: number }) {
  const [state, setState] = useState<SubagentState | undefined>();
  const [tick, setTick] = useState(0); // re-read when a "?" ages out
  useEffect(() => {
    let cancelled = false;
    void repo
      .subagentEvents(tabId, sessionId ?? null)
      .then((rows) => {
        if (!cancelled) setState(subagentState(rows, live, Date.now()));
      })
      .catch(() => undefined); // fail open: no chip
    return () => {
      cancelled = true;
    };
  }, [tabId, sessionId, live, refresh, tick]);
  useEffect(() => {
    if (!state?.recheckAt) return;
    const timer = setTimeout(() => setTick((n) => n + 1), Math.max(0, state.recheckAt - Date.now()) + 1000);
    return () => clearTimeout(timer);
  }, [state?.recheckAt]);
  const label = subagentLabel(state);
  if (!label) return null;
  return (
    <span
      className="shrink-0 cursor-default text-xs text-zinc-500 tabular-nums"
      title="Worker subagents seen via hooks. ? = started but no stop seen and the tab or session ended. Internal children (e.g. Codex guardian) aren't counted."
    >
      {label}
    </span>
  );
}
