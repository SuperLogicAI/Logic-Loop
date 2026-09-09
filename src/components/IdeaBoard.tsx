import { useEffect, useRef, useState } from "react";
import * as repo from "../lib/repo";
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
}

const COLUMNS: { status: BoardStatus; label: string }[] = [
  { status: "idea", label: "Idea" },
  { status: "planned", label: "Planned" },
  { status: "building", label: "Building" },
  { status: "later", label: "Later" },
  { status: "done", label: "Done" },
];

const MIN_HEIGHT = 80;
const MAX_HEIGHT = 480;
const DEFAULT_HEIGHT = 160;

/** Momentum tie-in: top `planned` card, `next:` line else title. Exported so
 * SidePanel's momentum chain can consume it without duplicating the pick. */
export function topPlannedCard(cards: Card[]): Card | null {
  return cards.filter((c) => c.status === "planned")[0] ?? null;
}

export function IdeaBoard({ cwd }: Props) {
  const [md, setMd] = useState<string | null>(null); // null = not loaded yet
  const [collapsed, setCollapsed] = useState(true);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [draft, setDraft] = useState("");
  const [expandedCard, setExpandedCard] = useState<string | null>(null); // card title, plain-text expand
  const [colorPickerFor, setColorPickerFor] = useState<string | null>(null); // card title, popover open
  const resizeStart = useRef<{ y: number; height: number } | null>(null);

  const reload = async () => {
    const [text, storedCollapsed, storedHeight] = await Promise.all([
      readBoard(cwd),
      repo.getBoardCollapsed(cwd),
      repo.getBoardHeight(cwd),
    ]);
    setMd(text);
    setCollapsed(storedCollapsed);
    if (storedHeight) setHeight(storedHeight);
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd]);

  useEffect(() => {
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd]);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    void repo.setBoardCollapsed(cwd, next);
  };

  const onResizePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    resizeStart.current = { y: e.clientY, height };
    let liveHeight = height;
    const onMove = (ev: PointerEvent) => {
      if (!resizeStart.current) return;
      // Dragging up (negative clientY delta) should grow a bottom dock.
      const next = resizeStart.current.height - (ev.clientY - resizeStart.current.y);
      liveHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, next));
      setHeight(liveHeight);
    };
    const onUp = () => {
      resizeStart.current = null;
      void repo.setBoardHeight(cwd, liveHeight);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Reload-before-write: re-read the live file immediately before splicing,
  // so a hand-edit made outside the app (or in another window) since our
  // last read is never clobbered by writing from a stale parse.
  const withFreshBoard = async (mutate: (fresh: string) => string) => {
    const fresh = await readBoard(cwd);
    const next = mutate(fresh);
    await writeBoard(cwd, next);
    setMd(next);
  };

  const addCard = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    await withFreshBoard((fresh) => appendCard(fresh, { title: "", body: text }));
  };

  const move = async (card: Card, status: BoardStatus) => {
    await withFreshBoard((fresh) => {
      // Card offsets are only valid against the md they were parsed from —
      // re-find the same card by title in the freshly-read text.
      const match = parseBoard(fresh).find((c) => c.title === card.title) ?? card;
      return moveCard(fresh, match, status);
    });
  };

  const remove = async (card: Card) => {
    if (expandedCard === card.title) setExpandedCard(null);
    if (colorPickerFor === card.title) setColorPickerFor(null);
    await withFreshBoard((fresh) => {
      const match = parseBoard(fresh).find((c) => c.title === card.title) ?? card;
      return deleteCard(fresh, match);
    });
  };

  const setColor = async (card: Card, color: string | null) => {
    setColorPickerFor(null);
    await withFreshBoard((fresh) => {
      const match = parseBoard(fresh).find((c) => c.title === card.title) ?? card;
      return spliceCard(fresh, { ...match, color });
    });
  };

  const [capNotice, setCapNotice] = useState(false);

  const star = async (card: Card) => {
    setCapNotice(false);
    await withFreshBoard((fresh) => {
      const freshCards = parseBoard(fresh);
      const match = freshCards.find((c) => c.title === card.title) ?? card;
      const result = toggleNow(fresh, match, freshCards);
      if (result === fresh && !match.now) setCapNotice(true); // toggle-on no-op means the cap was hit
      return result;
    });
  };

  const cards = md === null ? [] : parseBoard(md);
  const nowCards = cards.filter((c) => c.now);

  if (collapsed) {
    return (
      <div
        className="flex h-7 shrink-0 cursor-pointer items-center gap-1.5 border-t border-zinc-800 bg-zinc-900 px-3 text-xs text-zinc-500 hover:text-zinc-300"
        onClick={toggleCollapsed}
      >
        {nowCards.length > 0 ? (
          <span className="truncate">
            <span className="text-yellow-500">★</span> {nowCards.map((c) => c.title).join(" · ")}
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <Chevron collapsed={true} /> Idea Board {cards.length > 0 && `(${cards.length})`}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex shrink-0 flex-col border-t border-zinc-800 bg-zinc-900 text-xs text-zinc-300" style={{ height }}>
      <div
        className="absolute inset-x-0 top-0 z-10 h-1.5 -mt-0.5 cursor-row-resize hover:bg-zinc-600/60 active:bg-zinc-500"
        onPointerDown={onResizePointerDown}
      />
      <div className="flex h-7 shrink-0 items-center gap-1.5 px-3 text-zinc-500">
        <span className="flex cursor-pointer items-center gap-1.5 hover:text-zinc-300" onClick={toggleCollapsed}>
          <Chevron collapsed={false} /> Idea Board {cards.length > 0 && `(${cards.length})`}
        </span>
        {capNotice && <span className="text-yellow-600">Now is full ({NOW_CAP}/{NOW_CAP}) — remove one first</span>}
      </div>
      <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto px-2 pb-2">
        {COLUMNS.map((col) => (
          <div key={col.status} className="flex min-w-[160px] flex-1 flex-col overflow-hidden rounded bg-zinc-950/40">
            <h3 className="shrink-0 border-b border-zinc-200/20 px-2 py-1 font-semibold tracking-wide text-zinc-500 uppercase">
              {col.label}
            </h3>
            <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1.5 pb-1.5">
              {cards
                .filter((c) => c.status === col.status)
                .map((c) => (
                  <li
                    key={c.title}
                    className={`relative rounded border bg-zinc-900 p-1.5 ${c.color ? "" : "border-zinc-800"}`}
                    style={c.color ? { borderColor: c.color } : undefined}
                  >
                    <div
                      className="-m-1.5 mb-0 flex items-center gap-1 rounded-t p-1.5"
                      style={{ backgroundColor: c.color ? `${c.color}26` : undefined }}
                    >
                      <button
                        className="shrink-0 text-zinc-400 hover:text-zinc-200"
                        title="Click to expand"
                        onClick={() => setExpandedCard(expandedCard === c.title ? null : c.title)}
                      >
                        <Chevron collapsed={expandedCard !== c.title} />
                      </button>
                      <button
                        className={c.now ? "shrink-0 text-xs text-yellow-500" : "shrink-0 text-xs text-zinc-700 hover:text-zinc-500"}
                        title={c.now ? "Remove from Now" : "Add to Now"}
                        onClick={() => void star(c)}
                      >
                        ★
                      </button>
                      <button
                        className="h-2 w-2 shrink-0 rounded-full p-px"
                        style={{ background: "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)" }}
                        title="Set accent color"
                        onClick={() => setColorPickerFor(colorPickerFor === c.title ? null : c.title)}
                      >
                        <span className="block h-full w-full rounded-full bg-zinc-500" />
                      </button>
                      <p
                        className="min-w-0 flex-1 cursor-pointer truncate text-zinc-200"
                        title="Click to expand"
                        onClick={() => setExpandedCard(expandedCard === c.title ? null : c.title)}
                      >
                        {c.title}
                      </p>
                      <button
                        className="shrink-0 text-zinc-700 hover:text-red-400"
                        title="Delete card"
                        onClick={() => void remove(c)}
                      >
                        ✕
                      </button>
                    </div>
                    {colorPickerFor === c.title && (
                      <div className="mt-1 flex flex-wrap items-center gap-1 rounded bg-zinc-800 p-1">
                        <button
                          className="h-4 w-4 rounded-full border border-zinc-600 bg-zinc-900 text-[8px] leading-none text-zinc-400"
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
                            title={hex}
                            onClick={() => void setColor(c, hex)}
                          />
                        ))}
                      </div>
                    )}
                    {expandedCard === c.title && (
                      <>
                        {c.body && <p className="mt-1 break-words whitespace-pre-wrap text-zinc-400">{c.body}</p>}
                        {c.next && <p className="mt-1 text-teal-400">next: {c.next}</p>}
                        {c.link && <p className="mt-1 truncate font-mono text-[10px] text-zinc-600">{c.link}</p>}
                      </>
                    )}
                    <select
                      className="mt-1 w-full rounded bg-zinc-800 px-1 py-0.5 text-[10px] text-zinc-400 outline-none"
                      value={c.status}
                      onChange={(e) => void move(c, e.target.value as BoardStatus)}
                    >
                      {COLUMNS.map((opt) => (
                        <option key={opt.status} value={opt.status}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
      <form
        className="flex shrink-0 gap-1.5 border-t border-zinc-800 p-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void addCard();
        }}
      >
        <input
          className="min-w-0 flex-1 rounded bg-zinc-800 px-2 py-1 text-zinc-200 outline-none placeholder:text-zinc-600"
          placeholder="+ quick add…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </form>
    </div>
  );
}
