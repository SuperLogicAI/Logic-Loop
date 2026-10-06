import { SidebarLmControl } from "./SidebarLmControl";
import { PanelIcon } from "./PanelIcon";

interface Props {
  compact?: boolean;
  hideInbox?: boolean;
  onOpenTraffic: () => void;
  onOpenAttention: () => void;
  attentionCount: number;
  attentionLoading: boolean;
  attentionStale: boolean;
  inboxBadgeEnabled: boolean;
  lockIn: boolean;
}

export function SidebarControls({ compact = false, hideInbox = false, onOpenTraffic, onOpenAttention,
  attentionCount, attentionLoading, attentionStale, inboxBadgeEnabled, lockIn }: Props) {
  const button = `flex shrink-0 items-center justify-center gap-1 rounded-full text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-400 ${compact ? "h-10 w-10" : "h-7 px-1.5"}`;
  return (
    <div className={`flex shrink-0 items-center gap-1 ${compact ? "flex-col py-1" : "h-10 min-w-0 border-b border-zinc-800 px-2"}`} data-sidebar-controls aria-label="App controls">
      <SidebarLmControl compact={compact} />
      <button type="button" className={button} onClick={onOpenTraffic} aria-label="View Safe Router traffic across all projects" title="View Safe Router traffic across all projects">
        {!compact && <span data-control-label>Traffic</span>}<img src="/bounce.svg" alt="" className={compact ? "h-6 w-6" : "h-4 w-4"} />
      </button>
      {!hideInbox && <button type="button" data-tour-target="attention" onClick={onOpenAttention}
        aria-label={`Open Attention Inbox${attentionCount ? `, ${attentionCount} items` : ""}${attentionLoading ? ", loading" : attentionStale ? ", data may be stale" : ""}`}
        title={`Global Inbox across all projects (⌘K)${attentionLoading ? " — loading" : attentionStale ? " — data may be stale" : ""}`}
        className={`${button} ${compact ? "" : "ml-auto"} ${lockIn ? "text-zinc-500" : attentionStale ? "text-attn-300" : attentionCount > 0 ? "text-info-300" : ""}`}>
        <PanelIcon name="attention" className="h-4 w-4" />
        {!compact && <span data-control-label>Inbox</span>}
        {!lockIn && inboxBadgeEnabled && attentionCount > 0 && <span className="rounded bg-zinc-700 px-1 text-[10px]">{attentionCount > 99 ? "99+" : attentionCount}</span>}
      </button>}
    </div>
  );
}
