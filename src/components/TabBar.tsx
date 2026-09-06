import { useState } from "react";
import { deriveClock, formatAge } from "../lib/ingest";
import type { Tab } from "../types";

// WAITING pulses — that dot is the whole point of the product. A stalled
// "working" dot loses its blue for a dim amber ring instead — distinct from
// waiting's pulse ("needs you now" vs. "check on me").
function dotClass(tab: Tab, stalled: boolean): string {
  if (tab.status === "dead") return "bg-red-500";
  switch (tab.agentState) {
    case "working":
      return stalled ? "bg-blue-900 ring-2 ring-amber-500/70" : "bg-blue-400";
    case "waiting":
      return "bg-amber-400 animate-pulse";
    case "idle":
      return "bg-green-500";
    case "error":
      return "bg-red-400";
    default:
      return "bg-zinc-500";
  }
}

interface Props {
  tabs: Tab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onFanOut: () => void;
  onIsolateLoop: () => void;
  onReorder: (srcId: string, dstId: string) => void;
  blockerCount: (tab: Tab) => number;
  decisionCount: (tab: Tab) => number;
  /** An agent finished on this tab and it hasn't been switched to since. */
  unclaimed: (tab: Tab) => boolean;
  /** Fan-out child (any group) — purple glow. */
  isFanOutChild: (tab: Tab) => boolean;
  /** Isolate-loop worktree tab — blue glow. */
  isWorktreeBound: (tab: Tab) => boolean;
  /** Clock tick (Phase 14b) — drives stalled/age display, nothing else
   * changes agentState on its own. */
  now: number;
}

// Left/right/top only, no bottom — the tab visually joins the terminal pane
// along its bottom edge, so a glow there would look like a seam, not a badge.
function groupGlow(rgb: string): string {
  return `0 -3px 8px -2px rgba(${rgb},0.55), -3px 0 8px -2px rgba(${rgb},0.55), 3px 0 8px -2px rgba(${rgb},0.55)`;
}
const FAN_OUT_GLOW = groupGlow("168,85,247"); // purple
const ISOLATE_GLOW = groupGlow("59,130,246"); // blue

export function TabBar({
  tabs,
  activeId,
  onSelect,
  onClose,
  onNew,
  onFanOut,
  onIsolateLoop,
  onReorder,
  blockerCount,
  decisionCount,
  unclaimed,
  isFanOutChild,
  isWorktreeBound,
  now,
}: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  return (
    // data-tauri-drag-region: empty strip space moves the window, Chrome-style
    // select-none: a pointer-drag starting here otherwise runs a DOM text
    // selection into the terminal below, which only paints on pointerup.
    <div
      data-tauri-drag-region
      // release outside a tab cancels the drag instead of leaving it armed
      onPointerUp={() => setDragId(null)}
      onPointerLeave={() => setDragId(null)}
      className="flex select-none items-end gap-1 bg-zinc-900"
    >
      {/* overflow-x-auto forces the y-axis to clip too, so the glow's
          bleed needs its padding inside THIS box, not the outer wrapper —
          the last tab's rightward bleed (and the first tab's leftward
          bleed) hits this container's own clip edge, one level in from
          where the old outer px-2 lived. Outer px-2 dropped in favor of
          this to avoid double-padding the tab-strip/button gap. */}
      <div className="tab-strip flex min-w-0 items-end gap-1 overflow-x-auto px-2 pt-2">
        {tabs.map((tab) => {
        const clock = deriveClock(tab, now);
        return (
        <div
          key={tab.id}
          onClick={() => onSelect(tab.id)}
          onAuxClick={(e) => {
            if (e.button === 1) onClose(tab.id);
          }}
          // ponytail: pointer events, not HTML5 drag — the webview's native
          // drag-drop handler (App.tsx onDragDropEvent, needed for file drops)
          // swallows DOM drop events, so draggable never completes here.
          onPointerDown={() => setDragId(tab.id)}
          // reorder live as the cursor crosses a tab, Chrome-style — the strip
          // reflows under the pointer, so no separate drop indicator is needed
          onPointerEnter={() => {
            if (dragId && dragId !== tab.id) onReorder(dragId, tab.id);
          }}
          onPointerUp={() => setDragId(null)}
          className={`group relative flex max-w-52 min-w-28 cursor-pointer items-center gap-2 rounded-t-md border-t-2 px-3 py-1.5 text-sm transition-[background-color,opacity] ${
            tab.id === activeId
              ? "bg-zinc-700 text-zinc-100"
              : "bg-zinc-800/70 text-zinc-500 hover:bg-zinc-700/50 hover:text-zinc-300"
          } ${dragId === tab.id ? "opacity-60 ring-1 ring-zinc-500" : ""} ${
            isFanOutChild(tab) || isWorktreeBound(tab) ? "z-10" : "z-0"
          }`}
          style={{
            borderTopColor: tab.color,
            // relative+z-10 above (plain flex siblings are static, so
            // without it, a later-DOM-order neighbor paints over this
            // shadow's bleed into their shared gap — the missing
            // right-side glow on a middle tab).
            boxShadow: isFanOutChild(tab)
              ? FAN_OUT_GLOW
              : isWorktreeBound(tab)
                ? ISOLATE_GLOW
                : undefined,
          }}
        >
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${dotClass(tab, clock.stalled)} ${
              unclaimed(tab) ? "shadow-[0_0_6px_2px_rgba(16,185,129,0.6)]" : ""
            }`}
            title={tab.agentState ? `${tab.agentState} · quiet ${formatAge(clock.quietMs)}` : undefined}
          />
          {tab.agentState === "waiting" && clock.quietMs > 2 * 60 * 1000 && (
            <span className="shrink-0 text-[9px] text-amber-400/70">{formatAge(clock.quietMs)}</span>
          )}
          <span className="truncate">{tab.title}</span>
          {blockerCount(tab) > 0 && (
            <span className="shrink-0 rounded-full bg-red-500/20 px-1.5 text-[10px] font-semibold text-red-400">
              {blockerCount(tab)}
            </span>
          )}
          {decisionCount(tab) > 0 && (
            <span className="shrink-0 rounded-full bg-orange-500/20 px-1.5 text-[10px] font-semibold text-orange-400">
              {decisionCount(tab)}
            </span>
          )}
          <button
            className="ml-auto shrink-0 rounded px-1 text-zinc-500 opacity-0 group-hover:opacity-100 hover:bg-zinc-600 hover:text-zinc-200"
            onClick={(e) => {
              e.stopPropagation();
              onClose(tab.id);
            }}
          >
            ✕
          </button>
        </div>
        );
        })}
      </div>
      <button
        className="mb-0.5 shrink-0 rounded px-2.5 py-1 text-lg leading-none text-zinc-400 hover:bg-zinc-700"
        onClick={onNew}
        title="New tab (⌘T)"
      >
        +
      </button>
      <button
        className="mb-0.5 flex shrink-0 items-center gap-1.5 rounded-full border border-zinc-700 px-2.5 py-1 text-sm leading-none text-zinc-400 hover:border-purple-500 hover:text-zinc-200"
        style={{ boxShadow: "inset 0 0 0 1px rgba(168,85,247,0.4)" }}
        onClick={onFanOut}
        title="Fan out the active tab into N child tabs"
      >
        Fan out
        <img src="/fan.svg" alt="" className="h-4 w-4 shrink-0" />
      </button>
      <button
        className="mr-2 mb-0.5 flex shrink-0 items-center gap-1.5 rounded-full border border-zinc-700 px-2.5 py-1 text-sm leading-none text-zinc-400 hover:border-blue-500 hover:text-zinc-200"
        style={{ boxShadow: "inset 0 0 0 1px rgba(59,130,246,0.4)" }}
        onClick={onIsolateLoop}
        title="Spawn a tab bound to a fresh git worktree"
      >
        Isolate loop
        <img src="/isolate.svg" alt="" className="h-4 w-4 shrink-0" />
      </button>
    </div>
  );
}
