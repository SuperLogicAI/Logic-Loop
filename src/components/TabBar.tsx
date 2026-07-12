import type { Tab } from "../types";

// WAITING pulses — that dot is the whole point of the product.
function dotClass(tab: Tab): string {
  if (tab.status === "dead") return "bg-red-500";
  switch (tab.agentState) {
    case "working":
      return "bg-blue-400";
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
  blockerCount: (tab: Tab) => number;
  decisionCount: (tab: Tab) => number;
}

export function TabBar({ tabs, activeId, onSelect, onClose, onNew, blockerCount, decisionCount }: Props) {
  return (
    <div className="flex items-end gap-1 bg-zinc-900 px-2 pt-2">
      <div className="tab-strip flex min-w-0 items-end gap-1 overflow-x-auto">
        {tabs.map((tab) => (
        <div
          key={tab.id}
          onClick={() => onSelect(tab.id)}
          onAuxClick={(e) => {
            if (e.button === 1) onClose(tab.id);
          }}
          className={`group flex max-w-52 min-w-28 cursor-pointer items-center gap-2 rounded-t-md border-t-2 px-3 py-1.5 text-sm ${
            tab.id === activeId
              ? "bg-[#1e2127] text-zinc-100"
              : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
          }`}
          style={{ borderTopColor: tab.color }}
        >
          <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass(tab)}`} />
          <span className="truncate">{tab.title}</span>
          {blockerCount(tab) > 0 && (
            <span className="shrink-0 rounded-full bg-amber-500/20 px-1.5 text-[10px] font-semibold text-amber-400">
              {blockerCount(tab)}
            </span>
          )}
          {decisionCount(tab) > 0 && (
            <span className="shrink-0 rounded-full bg-violet-500/20 px-1.5 text-[10px] font-semibold text-violet-400">
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
        ))}
      </div>
      <button
        className="mb-0.5 shrink-0 rounded px-2.5 py-1 text-lg leading-none text-zinc-400 hover:bg-zinc-700"
        onClick={onNew}
        title="New tab (⌘T)"
      >
        +
      </button>
    </div>
  );
}
