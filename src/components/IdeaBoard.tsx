import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { boardColumns, dropCard, freshBoardCard, kanbanLane, kanbanStatus, WORKFLOW_COLUMNS, KANBAN_COLUMNS, type BoardMode, type KanbanLane } from "../lib/boardModes";
import * as repo from "../lib/repo";
import { PanelIcon } from "./PanelIcon";
import {
  appendCard,
  deleteCard,
  moveCard,
  NOW_CAP,
  parseBoard,
  spliceCard,
  toggleNow,
  type BoardStatus,
  type Card,
  readBoard,
  writeBoard,
} from "../lib/board";

// Fixed accent palette — plain hex, no picker library, "None" clears.
const COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6", "#a855f7", "#ec4899"];

// Same chevron glyph as SidePanel's collapsible sections, for a consistent look.
function Chevron({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 transition-transform ${collapsed ? "-rotate-90" : ""}`}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

interface Props {
  cwd: string; // project key of the active tab — same value SidePanel receives
  trailing?: ReactNode; // Plan 054: right-aligned in the bar (context meter)
}

/** Plan 067: an in-flight card drag. `anchor` is the start offset of the card
 * it would land before; null = end of column `col`. */
type Drag = { card: Card; x: number; y: number; col: string | null; anchor: number | null };

/** Column and insertion point under the pointer — first card whose midpoint
 * is below it, else the column's end. */
function dropTarget(x: number, y: number): Pick<Drag, "col" | "anchor"> {
  const col = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-board-col]");
  if (!col) return { col: null, anchor: null };
  const below = [...col.querySelectorAll<HTMLElement>("[data-card]")].find((li) => {
    const r = li.getBoundingClientRect();
    return y < r.top + r.height / 2;
  });
  return { col: col.dataset.boardCol ?? null, anchor: below ? Number(below.dataset.card) : null };
}

const MIN_HEIGHT = 80;
const MAX_HEIGHT = 480;
const DEFAULT_HEIGHT = 160;
const TERMINAL_RESERVE = 96;

/** Momentum tie-in: top `planned` card, `next:` line else title. Exported so
 * SidePanel's momentum chain can consume it without duplicating the pick. */
export function topPlannedCard(cards: Card[]): Card | null {
  return cards.filter((c) => c.status === "planned")[0] ?? null;
}

export function IdeaBoard(props: Props) {
  // A project owns its drafts, requests and ephemeral card state.
  return <ProjectIdeaBoard key={props.cwd} {...props} />;
}

function ProjectIdeaBoard({ cwd, trailing }: Props) {
  const [md, setMd] = useState<string | null>(null); // null = not loaded yet
  const [collapsed, setCollapsed] = useState(true);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const dockRef = useRef<HTMLDivElement>(null);
  const [heightLimit, setHeightLimit] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [expandedCard, setExpandedCard] = useState<number | null>(null); // source offset, plain-text expand
  const [colorPickerFor, setColorPickerFor] = useState<number | null>(null); // source offset, popover open
  const resizeStart = useRef<{ y: number; height: number } | null>(null);

  const [mode, setMode] = useState<BoardMode>("workflow");
  const [error, setError] = useState("");
  const [preferenceError, setPreferenceError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const alive = useRef(false);
  const generation = useRef(0);
  const modeVersion = useRef(0);
  const resizeCleanup = useRef<(() => void) | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragCleanup = useRef<(() => void) | null>(null);

  useEffect(() => {
    const dock = dockRef.current;
    const workspace = dock?.parentElement;
    const terminals = dock?.previousElementSibling;
    if (!dock || !workspace || !terminals) return;
    const measure = () => {
      // The toolbar sits above the terminal area. Reserve terminal space even
      // when a saved dock height exceeds the newly resized workspace.
      const available = workspace.getBoundingClientRect().bottom
        - terminals.getBoundingClientRect().top - TERMINAL_RESERVE;
      setHeightLimit(Math.max(0, Math.min(MAX_HEIGHT, available)));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(workspace);
    const toolbar = terminals.previousElementSibling;
    if (toolbar) observer.observe(toolbar);
    measure();
    return () => observer.disconnect();
  }, [collapsed]);

  useEffect(() => {
    alive.current = true;
    const reload = async () => {
      if (busyRef.current) return;
      const request = ++generation.current;
      const version = modeVersion.current;
      const [text, storedCollapsed, storedHeight, storedMode] = await Promise.all([
        readBoard(cwd),
        repo.getBoardCollapsed(cwd).catch(() => true),
        repo.getBoardHeight(cwd).catch(() => null),
        repo.getBoardMode(cwd).catch(() => "workflow" as const),
      ]);
      if (!alive.current || request !== generation.current) return;
      setMd(text);
      setExpandedCard(null);
      setColorPickerFor(null);
      setCollapsed(storedCollapsed);
      setHeight(storedHeight ?? DEFAULT_HEIGHT);
      // A local selection, including an unsaved one, owns this session.
      if (version === 0 && modeVersion.current === 0) setMode(storedMode);
    };
    void reload();
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => {
      alive.current = false;
      generation.current++;
      resizeCleanup.current?.();
      dragCleanup.current?.();
      window.removeEventListener("focus", onFocus);
    };
  }, [cwd]);

  const changeMode = (next: BoardMode) => {
    const version = ++modeVersion.current;
    setMode(next);
    setPreferenceError("");
    void repo.setBoardMode(cwd, next)
      .catch(() => {
        if (alive.current && version === modeVersion.current) {
          setPreferenceError("View changed for this session; couldn't save preference.");
        }
      });
  };

  const toggleCollapsed = () => {
    if (md === null) return;
    generation.current++;
    const next = !collapsed;
    setCollapsed(next);
    void repo.setBoardCollapsed(cwd, next).catch(() => {
      if (alive.current) setError("Couldn’t save board collapse preference.");
    });
  };

  const onResizePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    generation.current++;
    resizeCleanup.current?.();
    const displayedHeight = dockRef.current?.getBoundingClientRect().height ?? height;
    resizeStart.current = { y: e.clientY, height: displayedHeight };
    let liveHeight = displayedHeight;
    const onMove = (ev: PointerEvent) => {
      if (!resizeStart.current) return;
      // Dragging up (negative clientY delta) should grow a bottom dock.
      const next = resizeStart.current.height - (ev.clientY - resizeStart.current.y);
      liveHeight = Math.min(heightLimit ?? MAX_HEIGHT, Math.max(MIN_HEIGHT, next));
      setHeight(liveHeight);
    };
    const onUp = () => {
      resizeStart.current = null;
      void repo.setBoardHeight(cwd, liveHeight).catch(() => {
        if (alive.current) setError("Couldn’t save board height preference.");
      });
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    resizeCleanup.current = () => {
      resizeStart.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Read-before-write preserves unrelated edits observed at read time. This
  // is not atomic against another filesystem writer between read and write.
  const withFreshBoard = async (mutate: (fresh: string) => string): Promise<boolean> => {
    if (busyRef.current || md === null) return false;
    busyRef.current = true;
    generation.current++; // invalidate pending focus loads
    setBusy(true);
    setError("");
    try {
      const fresh = await readBoard(cwd);
      if (!alive.current) return false;
      const next = mutate(fresh);
      if (next !== fresh) await writeBoard(cwd, next);
      if (alive.current) {
        setMd(next);
        setExpandedCard(null);
        setColorPickerFor(null);
      }
      return true;
    } catch (e) {
      if (alive.current) setError(String(e));
      return false;
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  };

  const addCard = async () => {
    const text = draft.trim();
    if (!text) return;
    if (await withFreshBoard((fresh) => appendCard(fresh, { title: "", body: text }))) {
      if (alive.current) setDraft("");
    }
  };

  const resolveCard = (fresh: string, card: Card) =>
    freshBoardCard(card, parseBoard(md ?? ""), parseBoard(fresh));

  const move = async (card: Card, value: string) => {
    await withFreshBoard((fresh) => {
      const match = resolveCard(fresh, card);
      const status = mode === "kanban"
        ? kanbanStatus(match.status, value as KanbanLane) : value as BoardStatus;
      return status === match.status ? fresh : moveCard(fresh, match, status);
    });
  };

  const drop = async (card: Card, key: string, anchor: number | null) => {
    await withFreshBoard((fresh) => {
      const before = cards.find((c) => c.start === anchor);
      return dropCard(fresh, mode, resolveCard(fresh, card), key, before ? resolveCard(fresh, before) : null);
    });
  };

  // ponytail: pointer events, not HTML5 drag — same as TabBar: the webview's
  // file-drop handler (App.tsx onDragDropEvent) swallows DOM drop events.
  const onCardPointerDown = (e: React.PointerEvent<HTMLElement>, card: Card) => {
    if (e.button !== 0 || disabled) return;
    dragCleanup.current?.();
    const handle = e.currentTarget;
    const { pointerId, clientX, clientY } = e;
    let last: Drag | null = null;
    const end = () => {
      document.documentElement.classList.remove("select-none");
      setDrag(null);
      dragCleanup.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", end);
    };
    const onMove = (ev: PointerEvent) => {
      if (!(ev.buttons & 1)) return end(); // missed pointerup: cancel, never drop
      // Slack before a drag starts keeps clicks on the header's buttons working.
      if (!last && Math.hypot(ev.clientX - clientX, ev.clientY - clientY) < 4) return;
      if (!last) {
        handle.setPointerCapture(pointerId); // keep events if the pointer leaves the window
        // WebKit extends a selection from a select-none handle into nearby
        // text (status labels, column headers); block it page-wide mid-drag.
        document.documentElement.classList.add("select-none");
        window.getSelection()?.removeAllRanges();
      }
      last = { card, x: ev.clientX, y: ev.clientY, ...dropTarget(ev.clientX, ev.clientY) };
      setDrag(last);
    };
    const onUp = () => {
      end();
      if (last?.col) void drop(last.card, last.col, last.anchor);
    };
    dragCleanup.current = end;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", end);
  };

  const remove = async (card: Card) => {
    await withFreshBoard((fresh) => deleteCard(fresh, resolveCard(fresh, card)));
  };

  const setColor = async (card: Card, color: string | null) => {
    await withFreshBoard((fresh) => spliceCard(fresh, { ...resolveCard(fresh, card), color }));
  };

  const [capNotice, setCapNotice] = useState(false);
  const star = async (card: Card) => {
    setCapNotice(false);
    await withFreshBoard((fresh) => {
      const match = resolveCard(fresh, card);
      const result = toggleNow(fresh, match, parseBoard(fresh));
      if (result === fresh && !match.now) setCapNotice(true);
      return result;
    });
  };

  const cards = md === null ? [] : parseBoard(md);
  const disabled = busy || md === null;
  const nowCards = cards.filter((c) => c.now);

  if (collapsed) {
    return (
      <div
        data-tour-target="idea-board"
        className="flex h-7 shrink-0 cursor-pointer items-center gap-1.5 border-t border-zinc-800 bg-zinc-900 px-3 text-xs text-zinc-500 hover:text-zinc-300"
        onClick={toggleCollapsed}
      >
        {nowCards.length > 0 ? (
          <span className="flex min-w-0 items-center gap-1.5 text-xs">
            <PanelIcon name="idea-board" className="h-4 w-4 shrink-0" />
            <span className="truncate">
              <span className="text-attn-500">★</span> {nowCards.map((c) => c.title).join(" · ")}
            </span>
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-xs">
            <Chevron collapsed={true} />
            <PanelIcon name="idea-board" className="h-4 w-4 shrink-0" />
            Idea Board {cards.length > 0 && `(${cards.length})`}
          </span>
        )}
        {trailing}
      </div>
    );
  }

  return (
    <div
      ref={dockRef}
      data-tour-target="idea-board"
      className="relative flex shrink-0 flex-col overflow-y-auto border-t border-zinc-800 bg-zinc-900 text-xs text-zinc-300"
      style={{ height, maxHeight: heightLimit ?? "50%" }}
    >
      <div
        className="absolute inset-x-0 top-0 z-10 h-1.5 -mt-0.5 cursor-row-resize hover:bg-zinc-600/60 active:bg-zinc-500"
        onPointerDown={onResizePointerDown}
      />
      <div className="flex min-h-7 shrink-0 flex-wrap items-center gap-1.5 px-3 py-1 text-zinc-500">
        <span className="flex cursor-pointer items-center gap-1.5 text-xs hover:text-zinc-300" onClick={toggleCollapsed}>
          <Chevron collapsed={false} />
          <PanelIcon name="idea-board" className="h-4 w-4 shrink-0" />
          Idea Board {cards.length > 0 && `(${cards.length})`}
        </span>
        {/* Same segmented pills as SidePanel's landing-notes mode. */}
        <div className="flex rounded border border-zinc-700 p-0.5" role="group" aria-label="Board view">
          {(["list", "kanban", "workflow"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={mode === option}
              disabled={md === null}
              className={`rounded px-1.5 py-0.5 capitalize focus-visible:outline-2 focus-visible:outline-focus-400 disabled:opacity-50 ${
                mode === option ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-200"
              }`}
              onClick={() => changeMode(option)}
            >
              {option}
            </button>
          ))}
        </div>
        {capNotice && <span className="text-attn-600">Now is full ({NOW_CAP}/{NOW_CAP}) — remove one first</span>}
        {trailing}
      </div>
      {(error || preferenceError) && <p role="alert" className="shrink-0 px-3 text-danger-400">{error || preferenceError}</p>}
      {md === null && <p role="status" className="px-3">Loading board…</p>}
      <fieldset disabled={disabled} aria-label="Board cards" className="flex min-h-0 min-w-0 flex-1 gap-2 overflow-x-auto border-0 px-2 pb-2">
        {boardColumns(mode, cards).map((col) => (
          <div
            key={col.key}
            data-board-col={col.key}
            className={`flex min-w-[160px] flex-1 flex-col overflow-hidden rounded bg-zinc-950/40 ${drag?.col === col.key ? "ring-1 ring-focus-500/60" : ""}`}
          >
            <h3 className="shrink-0 border-b border-zinc-200/20 px-2 py-1 font-semibold tracking-wide text-zinc-500 uppercase">
              {col.label} ({col.cards.length})
            </h3>
            <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1.5 pt-1 pb-1.5">
              {col.cards.length === 0 && <li className="p-2 text-zinc-500">No cards yet</li>}
              {col.cards.map((c) => (
                  <li
                    key={c.start}
                    data-card={c.start}
                    className={`relative rounded border bg-zinc-900 p-1.5 ${c.color ? "" : "border-zinc-800"} ${
                      drag?.card.start === c.start ? "opacity-40" : ""} ${
                      drag?.col === col.key && drag.anchor === c.start
                        ? "before:absolute before:inset-x-0 before:-top-[3px] before:h-0.5 before:rounded before:bg-focus-500" : ""}`}
                    style={c.color ? { borderColor: c.color } : undefined}
                  >
                    <div
                      className="-m-1.5 mb-0 flex cursor-grab items-center gap-1 rounded-t p-1.5 select-none"
                      style={{ backgroundColor: c.color ? `${c.color}26` : undefined }}
                      title="Drag to move"
                      onPointerDown={(e) => onCardPointerDown(e, c)}
                    >
                      <button
                        className="shrink-0 text-zinc-400 hover:text-zinc-200"
                        aria-label="Expand card"
                        title="Click to expand"
                        onClick={() => setExpandedCard(expandedCard === c.start ? null : c.start)}
                      >
                        <Chevron collapsed={expandedCard !== c.start} />
                      </button>
                      <button
                        className={c.now ? "shrink-0 text-xs text-attn-500" : "shrink-0 text-xs text-zinc-700 hover:text-zinc-500"}
                        aria-label={c.now ? "Remove from Now" : "Add to Now"}
                        title={c.now ? "Remove from Now" : "Add to Now"}
                        onClick={() => void star(c)}
                      >
                        ★
                      </button>
                      <button
                        className="h-2 w-2 shrink-0 rounded-full p-px"
                        style={{ background: "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)" }}
                        aria-label="Set accent color"
                        title="Set accent color"
                        onClick={() => setColorPickerFor(colorPickerFor === c.start ? null : c.start)}
                      >
                        <span className="block h-full w-full rounded-full bg-zinc-500" />
                      </button>
                      <p
                        className="min-w-0 flex-1 cursor-pointer truncate text-zinc-200"
                        title="Click to expand"
                        onClick={() => setExpandedCard(expandedCard === c.start ? null : c.start)}
                      >
                        {c.title}
                      </p>
                      <button
                        className="shrink-0 text-zinc-700 hover:text-danger-400"
                        aria-label="Delete card"
                        title="Delete card"
                        onClick={() => void remove(c)}
                      >
                        ✕
                      </button>
                    </div>
                    {colorPickerFor === c.start && (
                      <div className="mt-1 flex flex-wrap items-center gap-1 rounded bg-zinc-800 p-1">
                        <button
                          className="h-4 w-4 rounded-full border border-zinc-600 bg-zinc-900 text-[8px] leading-none text-zinc-400"
                          aria-label="No color"
                          title="No color"
                          onClick={() => void setColor(c, null)}
                        >
                          ✕
                        </button>
                        {COLORS.map((hex) => (
                          <button
                            key={hex}
                            className="h-4 w-4 rounded-full ring-1 ring-black/30"
                            style={{ background: hex }}
                            aria-label={`Accent ${hex}`}
                            title={hex}
                            onClick={() => void setColor(c, hex)}
                          />
                        ))}
                      </div>
                    )}
                    {expandedCard === c.start && (
                      <>
                        {c.body && <p className="mt-1 break-words whitespace-pre-wrap text-zinc-400">{c.body}</p>}
                        {c.next && <p className="mt-1 text-info-400">next: {c.next}</p>}
                        {c.link && <p className="mt-1 truncate font-mono text-[10px] text-zinc-600">{c.link}</p>}
                      </>
                    )}
                    {mode === "kanban" && <p className="mt-1 text-zinc-400">{WORKFLOW_COLUMNS.find((col) => col.key === c.status)?.label}</p>}
                    {/* Keyboard/screen-reader path for moving; drag is the visible one. */}
                    <select
                      aria-label={`Status for ${c.title}`}
                      className="sr-only rounded bg-zinc-800 text-[10px] text-zinc-400 outline-none focus:not-sr-only focus:mt-1 focus:w-full focus:px-1 focus:py-0.5"
                      value={mode === "kanban" ? kanbanLane(c.status) : c.status}
                      onChange={(e) => void move(c, e.target.value)}
                    >
                      {(mode === "kanban" ? KANBAN_COLUMNS : WORKFLOW_COLUMNS).map((opt) => (
                        <option key={opt.key} value={opt.key}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              {drag?.col === col.key && drag.anchor === null && <li aria-hidden className="h-0.5 shrink-0 rounded bg-focus-500" />}
            </ul>
          </div>
        ))}
      </fieldset>
      {drag && createPortal(
        <div
          className="pointer-events-none fixed z-50 max-w-48 truncate rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 shadow-lg"
          style={{ left: drag.x + 10, top: drag.y + 10 }}
        >
          {drag.card.title}
        </div>,
        document.body,
      )}
      <form
        className="flex shrink-0 gap-1.5 border-t border-zinc-800 p-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void addCard();
        }}
      >
        <input
          className="min-w-0 flex-1 rounded bg-zinc-800 px-2 py-1 text-zinc-200 outline-none placeholder:text-zinc-600"
          aria-label="Quick add card"
          disabled={disabled}
          placeholder="+ quick add…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </form>
    </div>
  );
}
