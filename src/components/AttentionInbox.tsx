import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { AttentionItem } from "../types";
import {
  attentionProjectLabel,
  filterAttentionItems,
  partitionAttentionItems,
  type AttentionViews,
} from "../lib/attention";

type AttentionView = keyof AttentionViews;

interface Props {
  items: AttentionItem[];
  now: number;
  loading: boolean;
  stale: boolean;
  onClose: () => void;
  onOpenTab: (tabId: string) => void;
  onSetArchived: (targetIds: string[], archived: boolean) => Promise<void>;
}

const KIND_LABEL: Record<AttentionItem["kind"], string> = {
  decision: "Decision",
  waiting: "Waiting",
  result: "Result",
  blocker: "Blocker",
  stalled: "Quiet",
};

const VIEW_LABEL: Record<AttentionView, string> = {
  active: "Active",
  backlog: "Backlog",
  archived: "Archived",
};

function age(ts: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - ts) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function emptyCopy(view: AttentionView, hasUnfilteredItems: boolean): string {
  if (hasUnfilteredItems) return "No Attention items match this search.";
  if (view === "active") return "Nothing currently needs attention.";
  if (view === "backlog") return "No unavailable items in the backlog.";
  return "No archived Attention items.";
}

export function AttentionInbox({ items, now, loading, stale, onClose, onOpenTab, onSetArchived }: Props) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<AttentionView>("active");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mutating, setMutating] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const priorFocusRef = useRef<HTMLElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const views = useMemo(() => partitionAttentionItems(items), [items]);
  const viewItems = views[view];
  const filtered = useMemo(() => filterAttentionItems(viewItems, query), [query, viewItems]);
  const visible = filtered.slice(0, 100);
  const selectedIndex = visible.findIndex((item) => item.id === selectedId);
  const current = (selectedIndex >= 0 ? visible[selectedIndex] : visible[0]) ?? null;
  const currentId = current?.id ?? null;

  useEffect(() => {
    priorFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    searchRef.current?.focus();
    return () => priorFocusRef.current?.focus();
  }, []);

  useEffect(() => setSelectedId(currentId), [currentId]);
  useEffect(() => {
    if (currentId) rowRefs.current.get(currentId)?.scrollIntoView({ block: "nearest" });
  }, [currentId]);

  const moveSelection = (delta: number) => {
    if (visible.length === 0) return;
    const index = selectedIndex >= 0 ? selectedIndex : 0;
    const next = Math.min(Math.max(index + delta, 0), visible.length - 1);
    setSelectedId(visible[next].id);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      moveSelection(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter") {
      const target = event.target as HTMLElement;
      const navigates = target === searchRef.current || target.getAttribute("role") === "option";
      if (navigates && current?.tabId) {
        event.preventDefault();
        event.stopPropagation();
        onOpenTab(current.tabId);
      }
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>('input, button:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const changeArchive = async (targetIds: string[], archived: boolean, key: string) => {
    setMutating(key);
    try {
      await onSetArchived(targetIds, archived);
    } catch {
      // App retains the last-good snapshot and exposes its stale state.
    } finally {
      setMutating(null);
    }
  };

  const archiveBacklog = () => {
    const ids = views.backlog.map((item) => item.id);
    if (ids.length === 0) return;
    const confirmed = window.confirm(
      `Archive all ${ids.length} unavailable Attention items? Their underlying decisions, blockers, and results will be retained.`
    );
    if (confirmed) void changeArchive(ids, true, "bulk");
  };

  return (
    <div className="fixed inset-x-0 bottom-0 top-7 z-50 flex items-start justify-center bg-black/55 px-4 pt-[8vh]" role="presentation">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Attention Inbox"
        onKeyDownCapture={onKeyDown}
        className="flex max-h-[78vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
      >
        <header className="border-b border-zinc-800 p-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-zinc-100">Attention</h2>
            <span className="text-[10px] text-zinc-500">Actionable first, then oldest.</span>
            {stale && <span className="ml-auto text-[10px] text-orange-300">Attention may be stale</span>}
            <button
              type="button"
              aria-label="Close Attention Inbox"
              title="Close (Esc)"
              className={`${stale ? "" : "ml-auto"} rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200`}
              onClick={onClose}
            >
              Esc
            </button>
          </div>
          <div className="mt-3 flex items-center gap-1" role="tablist" aria-label="Attention views">
            {(Object.keys(VIEW_LABEL) as AttentionView[]).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={view === key}
                className={`rounded px-2.5 py-1 text-xs ${view === key ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"}`}
                onClick={() => setView(key)}
              >
                {VIEW_LABEL[key]} <span className="font-mono text-[10px]">{views[key].length > 99 ? "99+" : views[key].length}</span>
              </button>
            ))}
            {view === "backlog" && views.backlog.length > 0 && (
              <button
                type="button"
                disabled={mutating !== null}
                className="ml-auto rounded px-2.5 py-1 text-xs text-orange-300 hover:bg-orange-950/40 disabled:text-zinc-600"
                onClick={archiveBacklog}
              >
                {mutating === "bulk" ? "Archiving…" : "Archive all unavailable"}
              </button>
            )}
          </div>
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects, kinds, adapters, and text…"
            aria-label="Search Attention"
            aria-controls="attention-items"
            aria-activedescendant={current ? `attention-option-${visible.indexOf(current)}` : undefined}
            role="combobox"
            aria-expanded="true"
            className="mt-3 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-sky-500"
          />
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(220px,0.8fr)]">
          <div id="attention-items" className="min-h-0 overflow-y-auto border-r border-zinc-800 p-2" role="listbox" aria-label={`${VIEW_LABEL[view]} Attention items`}>
            {loading && items.length === 0 ? (
              <p className="p-4 text-sm text-zinc-500">Loading Attention…</p>
            ) : visible.length === 0 ? (
              <p className="p-4 text-sm text-zinc-500">{emptyCopy(view, viewItems.length > 0)}</p>
            ) : (
              visible.map((item, index) => (
                <button
                  id={`attention-option-${index}`}
                  key={item.id}
                  ref={(node) => {
                    if (node) rowRefs.current.set(item.id, node);
                    else rowRefs.current.delete(item.id);
                  }}
                  type="button"
                  role="option"
                  aria-selected={item.id === currentId}
                  onClick={() => setSelectedId(item.id)}
                  className={`mb-1 flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left ${item.id === currentId ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-800/60"}`}
                >
                  <span className="mt-0.5 w-14 shrink-0 text-[9px] font-semibold uppercase tracking-wide text-zinc-500">{KIND_LABEL[item.kind]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{attentionProjectLabel(item.projectKey)}</span>
                    <span className="block truncate text-[11px] text-zinc-500">{item.text}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[9px] text-zinc-600">{age(item.createdAt, now)}</span>
                </button>
              ))
            )}
            {filtered.length > visible.length && (
              <p className="px-3 py-2 text-[10px] text-zinc-600">{filtered.length - visible.length} more items not rendered</p>
            )}
          </div>
          <aside className="min-h-0 overflow-y-auto p-4" aria-label="Selected Attention item preview">
            {current ? (
              <>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{KIND_LABEL[current.kind]}</p>
                <h3 className="mt-1 break-words text-sm font-medium text-zinc-100">{attentionProjectLabel(current.projectKey)}</h3>
                <p className="mt-3 whitespace-pre-wrap break-words text-xs leading-5 text-zinc-300">{current.text}</p>
                <dl className="mt-4 space-y-1 text-[10px] text-zinc-500">
                  <div className="flex gap-2"><dt>Route</dt><dd className="text-zinc-300">{current.route}</dd></div>
                  <div className="flex gap-2"><dt>Provider</dt><dd className="text-zinc-300">{current.adapterId ?? "unknown"}</dd></div>
                  <div className="flex gap-2"><dt>Confidence</dt><dd className="text-zinc-300">{current.confidence}</dd></div>
                  <div className="flex gap-2"><dt>Age</dt><dd className="text-zinc-300">{age(current.createdAt, now)}</dd></div>
                </dl>
                <button
                  type="button"
                  disabled={!current.tabId}
                  className="mt-5 w-full rounded-md bg-sky-600 px-3 py-2 text-xs font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600"
                  onClick={() => current.tabId && onOpenTab(current.tabId)}
                >
                  {current.tabId ? "Open tab" : "Destination unavailable"}
                </button>
                <button
                  type="button"
                  disabled={mutating !== null}
                  className="mt-2 w-full rounded-md border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800 disabled:text-zinc-600"
                  onClick={() => void changeArchive([current.id], view !== "archived", current.id)}
                >
                  {mutating === current.id ? "Saving…" : view === "archived" ? "Restore to Attention" : "Archive from Attention"}
                </button>
              </>
            ) : (
              <p className="text-xs text-zinc-600">Select an item to inspect its evidence and route.</p>
            )}
          </aside>
        </div>
      </section>
    </div>
  );
}
