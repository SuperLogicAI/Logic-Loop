import { useEffect, useRef, useState } from "react";
import * as repo from "../lib/repo";
import { trafficStateMessage, trafficTime, trafficToken } from "../lib/modelTraffic";

interface Props { onClose: () => void }

export function TrafficRowItem({ row }: { row: repo.TrafficRow }) {
  return (
    <div className="grid grid-cols-[130px_90px_130px_130px_90px_75px_120px_110px] gap-2 border-b border-zinc-800 py-1.5">
      <div className="min-w-0"><span className="block truncate" title={row.ts}>{trafficTime(row.ts)}</span><span className="block truncate text-zinc-500" title={row.keyId}>{row.keyId}</span></div>
      <span className="truncate" title={row.plane}>{row.plane}</span>
      <span className="truncate" title={row.modelReq}>{row.modelReq}</span>
      <span className="truncate" title={row.modelServed ?? undefined}>{row.modelServed ?? "—"}</span>
      <span className="truncate" title={row.backend ?? undefined}>{row.backend ?? "—"}</span>
      <span title={row.disposition}>{row.status ?? "—"}<span className="block truncate text-zinc-500">{row.disposition}</span></span>
      <span>{trafficToken(row.tokensIn)} / {trafficToken(row.tokensOut)}</span>
      <span>{row.usageState.replace("_", " ")}</span>
      <span className="col-span-8 block truncate text-[10px] text-zinc-500" title={row.clientTag ?? undefined}>
        {row.clientTag ? <>Tag: {row.clientTag}</> : "No tag"} · Unattributed
      </span>
    </div>
  );
}

export function ModelTraffic({ onClose }: Props) {
  const [snapshot, setSnapshot] = useState<repo.TrafficSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const closeButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const priorFocus = useRef<HTMLElement | null>(null);

  const refresh = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const current = generation.current;
    setLoading(true);
    const result = await repo.readSafeRouterTraffic();
    if (current === generation.current) {
      setSnapshot(result);
      setLoading(false);
      inFlight.current = false;
    }
  };

  useEffect(() => {
    priorFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 15_000);
    return () => {
      generation.current += 1;
      inFlight.current = false;
      window.clearInterval(timer);
      priorFocus.current?.focus();
    };
  }, []);

  const message = snapshot ? trafficStateMessage(snapshot) : null;
  const rows = snapshot?.kind === "ready" ? snapshot.rows : [];

  return (
    <div className="fixed inset-x-0 bottom-0 top-7 z-50 flex items-start justify-center bg-black/55 px-4 pt-[8vh]" role="presentation">
      <section ref={dialog} role="dialog" aria-modal="true" aria-label="Model traffic" onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
        if (event.key === "Tab") {
          const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])");
          if (!buttons?.length) return;
          const first = buttons[0];
          const last = buttons[buttons.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }} className="flex max-h-[78vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <header className="flex shrink-0 items-center gap-3 border-b border-zinc-800 p-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-zinc-100">Model traffic</h2>
            <p className="text-[10px] text-zinc-500">Safe Router · latest 100 routed requests · provider-reported usage</p>
          </div>
          <button type="button" onClick={() => void refresh()} disabled={loading} className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-40">{snapshot?.kind === "error" ? "Retry" : "Refresh"}</button>
          <button ref={closeButton} type="button" onClick={onClose} className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">Close</button>
        </header>
        <div className="min-h-0 overflow-auto p-3 text-xs text-zinc-300">
          {loading && <p role="status" className="text-zinc-500">Reading traffic…</p>}
          {!loading && message && <p role="status" className="text-zinc-400">{message}</p>}
          {rows.length > 0 && (
            <div className="min-w-[850px] space-y-1">
              <div className="grid grid-cols-[130px_90px_130px_130px_90px_75px_120px_110px] gap-2 border-b border-zinc-700 pb-1 text-[10px] text-zinc-500">
                <span>Time / key ID</span><span>Plane</span><span>Requested</span><span>Served</span><span>Backend</span><span>Status</span><span>Tokens in / out</span><span>Usage</span>
              </div>
              {rows.map((row) => <TrafficRowItem key={row.id} row={row} />)}
            </div>
          )}
        </div>
        <footer className="shrink-0 border-t border-zinc-800 px-3 py-2 text-[10px] text-zinc-500">Unknown usage is not zero. Usage state describes recorded counters, not billing. Tags are client-supplied and do not prove a tab or project.</footer>
      </section>
    </div>
  );
}
