import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import * as repo from "../lib/repo";
import { burst } from "../lib/confetti";
import type { AgentState, Blocker, Commit, Decision, Note, ToolEvent } from "../types";

interface Props {
  cwd: string; // expanded absolute project dir of the active tab
  accent: string | null; // matching bookmark's color, if the project is bookmarked
  refreshKey: number; // bump to force reload (new events / blocker changes)
  prevCwd: string | null; // project of the tab we switched away from (residue)
  prevState?: AgentState; // that tab's last agent state
  blindPaths: string[]; // transcripts that failed to open — panels are incomplete
  onBlockersChanged: () => void;
  onDecisionsChanged: () => void;
  onAnswerNow: (d: Decision) => void; // prefill terminal — user still hits Enter
}

const STATE_DOT: Record<AgentState, string> = {
  working: "bg-sky-400",
  waiting: "bg-amber-400",
  idle: "bg-zinc-500",
  error: "bg-red-400",
};

// Long lists collapse to this many rows behind a full-width ＋ toggle.
const ROW_CAP = 5;
const EXPAND_BTN =
  "mt-1.5 w-full rounded border border-zinc-800 py-0.5 text-center text-zinc-500 hover:border-zinc-700 hover:bg-zinc-800/50 hover:text-zinc-200";

function ago(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function SidePanel({ cwd, accent, refreshKey, prevCwd, prevState, blindPaths, onBlockersChanged, onDecisionsChanged, onAnswerNow }: Props) {
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [blockers, setBlockers] = useState<Blocker[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [landing, setLanding] = useState<Note | null>(null); // active project, momentum
  const [prevLanding, setPrevLanding] = useState<Note | null>(null); // previous project
  const [residue, setResidue] = useState<Note[]>([]); // previous project, open residue
  const [context, setContext] = useState<Decision | null>(null);
  const [draft, setDraft] = useState("");
  const [residueDraft, setResidueDraft] = useState("");
  const [showAllTools, setShowAllTools] = useState(false);
  const [showAllCommits, setShowAllCommits] = useState(false);
  const [expandedBlockers, setExpandedBlockers] = useState<Set<number>>(new Set());

  const toggleBlocker = (id: number) =>
    setExpandedBlockers((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const reload = useCallback(async () => {
    const [te, bl, gl, dc, ln] = await Promise.all([
      repo.listToolEvents(cwd).catch(() => []),
      repo.listBlockers(cwd).catch(() => []),
      invoke<Commit[]>("git_log", { cwd, limit: 15 }).catch(() => []),
      repo.listDecisions(cwd).catch(() => []),
      repo.latestLandingNote(cwd).catch(() => null),
    ]);
    setToolEvents(te);
    setBlockers(bl);
    setCommits(gl);
    setDecisions(dc);
    setLanding(ln);
  }, [cwd]);

  const reloadResidue = useCallback(async () => {
    if (!prevCwd || prevCwd === cwd) {
      setPrevLanding(null);
      setResidue([]);
      return;
    }
    const [pl, rn] = await Promise.all([
      repo.latestLandingNote(prevCwd).catch(() => null),
      repo.listNotes(prevCwd, "residue").catch(() => []),
    ]);
    setPrevLanding(pl);
    setResidue(rn.filter((n) => n.status === "open").slice(0, 3));
  }, [prevCwd, cwd]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  useEffect(() => {
    void reloadResidue();
  }, [reloadResidue, refreshKey]);

  const addResidue = async () => {
    const text = residueDraft.trim();
    if (!text || !prevCwd) return;
    await repo.addNote(prevCwd, "residue", text, null);
    setResidueDraft("");
    await reloadResidue();
  };

  const dismissResidue = async (n: Note) => {
    await repo.setNoteStatus(n.id, "done");
    await reloadResidue();
  };

  // Momentum: latest open landing note → oldest open decision → oldest open
  // blocker. Nothing open → no card. Done advances to the next candidate.
  const doneRef = useRef<HTMLButtonElement>(null);
  const oldestOpenDecision = decisions
    .filter((d) => d.status === "open")
    .reduce<Decision | null>((a, d) => (!a || d.ts < a.ts ? d : a), null);
  const oldestOpenBlocker = blockers
    .filter((b) => b.resolved === 0)
    .reduce<Blocker | null>((a, b) => (!a || b.ts < a.ts ? b : a), null);
  const momentum: { label: string; text: string; done: () => Promise<void> } | null = landing
    ? { label: "landing note", text: landing.body, done: () => repo.setNoteStatus(landing.id, "done") }
    : oldestOpenDecision
      ? {
          label: "decision",
          text: oldestOpenDecision.question,
          done: () => repo.setDecisionStatus(oldestOpenDecision.id, "answered"),
        }
      : oldestOpenBlocker
        ? {
            label: "blocker",
            text: oldestOpenBlocker.text,
            done: () => repo.setBlockerResolved(oldestOpenBlocker.id, true),
          }
        : null;

  const finishMomentum = async () => {
    if (!momentum) return;
    if (doneRef.current) burst(doneRef.current);
    await momentum.done();
    await reload();
    onBlockersChanged();
    onDecisionsChanged();
  };

  const addManual = async () => {
    const text = draft.trim();
    if (!text) return;
    await repo.addBlocker(cwd, text, "manual");
    setDraft("");
    await reload();
    onBlockersChanged();
  };

  const resolve = async (b: Blocker) => {
    await repo.setBlockerResolved(b.id, b.resolved === 0);
    await reload();
    onBlockersChanged();
  };

  const remove = async (b: Blocker) => {
    await repo.deleteBlocker(b.id);
    await reload();
    onBlockersChanged();
  };

  const setStatus = async (d: Decision, status: Decision["status"]) => {
    await repo.setDecisionStatus(d.id, status);
    await reload();
    onDecisionsChanged();
  };

  const open = blockers.filter((b) => b.resolved === 0);
  const done = blockers.filter((b) => b.resolved !== 0).slice(0, 10);
  const openDecisions = decisions.filter((d) => d.status === "open");
  const closedDecisions = decisions.filter((d) => d.status !== "open").slice(0, 10);

  return (
    <div className="flex h-full w-72 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900 text-xs text-zinc-300">
      {/* Pinned header: never scrolls away. Text takes the project's bookmark
          color when one exists; plain grey otherwise. */}
      <p
        className="shrink-0 truncate border-b border-zinc-800 px-3 pt-3 pb-1.5 font-mono text-[10px] text-zinc-500"
        style={accent ? { color: accent } : undefined}
        title={cwd}
      >
        project: {cwd.split("/").filter(Boolean).pop() ?? cwd}
      </p>
      {/* Blind sessions: hooks arrive but the transcript file will not open, so
          decisions and every transcript-fed panel are silently incomplete. This
          says so rather than looking like a quiet day. */}
      {blindPaths.length > 0 && (
        <p
          className="shrink-0 border-b border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[10px] text-red-300"
          title={blindPaths.join("\n")}
        >
          ⚠ no transcript for {blindPaths.length} session{blindPaths.length > 1 ? "s" : ""} — decisions
          incomplete
        </p>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
      {momentum && (
        <section className="rounded-lg border border-yellow-500/30 bg-yellow-400/5 p-3">
          <h2 className="mb-1 flex items-center gap-1.5 font-semibold tracking-wide text-yellow-300 uppercase">
            ▸ Next
            <span className="ml-auto font-normal text-[10px] normal-case text-zinc-500">{momentum.label}</span>
          </h2>
          <p className="mb-2 break-words text-zinc-200">{momentum.text}</p>
          <button
            ref={doneRef}
            className="ml-auto block rounded bg-yellow-400 px-2.5 py-1 font-medium text-zinc-950 hover:bg-yellow-300"
            onClick={() => void finishMomentum()}
          >
            ✓ Done
          </button>
        </section>
      )}

      <section>
        <h2 className="mb-1.5 font-semibold tracking-wide text-orange-400 uppercase">
          Decisions {openDecisions.length > 0 && `(${openDecisions.length})`}
        </h2>
        {openDecisions.length === 0 && <p className="text-zinc-600">Nothing waiting on you.</p>}
        <ul className="flex flex-col gap-2">
          {openDecisions.map((d) => (
            <li key={d.id} className="relative rounded border border-yellow-800/60 bg-yellow-950/20 p-2">
              <button
                className="absolute top-1 right-1 leading-none text-yellow-800 hover:text-yellow-500"
                title="Dismiss — not a real decision"
                onClick={() => void setStatus(d, "dismissed")}
              >
                ✕
              </button>
              <p className="break-words pr-5 text-orange-300">{d.question}</p>
              {d.assumption && (
                <p className="mt-1 text-zinc-400">agent assumed: {d.assumption}</p>
              )}
              <div className="mt-1.5 flex gap-2 text-zinc-400">
                <button className="text-red-400 hover:text-red-300" title="Prefill answer in terminal" onClick={() => onAnswerNow(d)}>
                  ✎ answer
                </button>
                <button className="text-yellow-400 hover:text-yellow-300" title="Show surrounding conversation" onClick={() => setContext(d)}>
                  ⌕ context
                </button>
                <button className="text-green-400 hover:text-green-300" title="Fine — agent's call" onClick={() => void setStatus(d, "delegated")}>
                  ⤳ delegate
                </button>
                <span className="ml-auto text-zinc-600">{ago(d.ts)}</span>
              </div>
            </li>
          ))}
        </ul>
        {closedDecisions.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1 border-t border-zinc-800 pt-2 text-zinc-600">
            {closedDecisions.map((d) => (
              <li key={d.id} className="truncate" title={`${d.question}${d.user_answer ? ` → ${d.user_answer}` : ""}`}>
                {d.status === "delegated" ? "⤳" : d.status === "dismissed" ? "✕" : "✓"} {d.question}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-1.5 font-semibold tracking-wide text-red-400 uppercase">
          Blockers {open.length > 0 && `(${open.length})`}
        </h2>
        <div className="mb-2 flex gap-1">
          <input
            className="min-w-0 flex-1 rounded bg-zinc-800 px-2 py-1 text-zinc-200 outline-none placeholder:text-zinc-600"
            placeholder="Add blocker…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void addManual()}
          />
        </div>
        {open.length === 0 && <p className="text-zinc-600">None open.</p>}
        <ul className="flex flex-col gap-2">
          {open.map((b) => (
            <li key={b.id} className="relative flex items-start gap-2 rounded border border-red-800/60 bg-red-950/20 p-2 pr-5">
              <button
                className="absolute top-1 right-1 leading-none text-red-800 hover:text-red-500"
                title="Delete"
                onClick={() => void remove(b)}
              >
                ✕
              </button>
              <input
                type="checkbox"
                checked={false}
                onChange={() => void resolve(b)}
                className="mt-0.5 accent-red-500"
              />
              <span className="min-w-0 flex-1">
                {b.source !== "manual" ? (
                  // Detector blockers: human label leads, raw match line below,
                  // clamped to two lines with a ＋ to expand.
                  <>
                    <span className="break-words text-red-300">
                      {b.source}
                      <button
                        className="ml-1 text-zinc-100 hover:text-white"
                        title={expandedBlockers.has(b.id) ? "Collapse" : "Expand"}
                        onClick={() => toggleBlocker(b.id)}
                      >
                        {expandedBlockers.has(b.id) ? "−" : "＋"}
                      </button>
                    </span>
                    <p
                      className={`break-all font-mono text-[10px] text-zinc-500 ${
                        expandedBlockers.has(b.id) ? "" : "line-clamp-2"
                      }`}
                    >
                      {b.text}
                    </p>
                  </>
                ) : (
                  <span className="break-words text-red-300">{b.text}</span>
                )}
                <span className="mt-1.5 block text-right text-zinc-600">{ago(b.ts)}</span>
              </span>
            </li>
          ))}
        </ul>
        {done.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1 border-t border-zinc-800 pt-2">
            {done.map((b) => (
              <li key={b.id} className="flex items-start gap-2 text-zinc-600 line-through">
                <input type="checkbox" checked onChange={() => void resolve(b)} className="mt-0.5" />
                <span className="min-w-0 flex-1 break-words">{b.text}</span>
                <button className="shrink-0 text-zinc-700 hover:text-zinc-200" title="Delete" onClick={() => void remove(b)}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-1.5 font-semibold tracking-wide text-emerald-400 uppercase">Accomplished</h2>
        {toolEvents.length === 0 && <p className="text-zinc-600">No tool activity recorded.</p>}
        <ul className="flex flex-col gap-1.5">
          {(showAllTools ? toolEvents : toolEvents.slice(0, ROW_CAP)).map((e) => (
            <li key={e.id} className="flex gap-2">
              <span className="w-8 shrink-0 text-right text-zinc-600">{ago(e.ts)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-emerald-300" title={e.plain}>
                  {e.plain}
                </span>
                {e.detail && (
                  <span className="block truncate font-mono text-[10px] text-zinc-600" title={e.detail}>
                    {e.tool} {e.detail}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
        {toolEvents.length > ROW_CAP && (
          <button
            className={EXPAND_BTN}
            onClick={() => setShowAllTools((s) => !s)}
          >
            {showAllTools ? "−" : `＋ ${toolEvents.length - ROW_CAP}`}
          </button>
        )}
      </section>

      <section>
        <h2 className="mb-1.5 font-semibold tracking-wide text-sky-400 uppercase">Git log</h2>
        {commits.length === 0 && <p className="text-zinc-600">Not a git repo.</p>}
        <ul className="flex flex-col gap-1">
          {(showAllCommits ? commits : commits.slice(0, ROW_CAP)).map((c) => (
            <li key={c.hash} className="flex gap-2">
              <span className="w-8 shrink-0 text-right text-zinc-600">{ago(c.ts * 1000)}</span>
              <span className="min-w-0 flex-1 truncate text-sky-300" title={c.subject}>
                <span className="font-mono text-zinc-500">{c.hash}</span> {c.subject}
              </span>
            </li>
          ))}
        </ul>
        {commits.length > ROW_CAP && (
          <button
            className={EXPAND_BTN}
            onClick={() => setShowAllCommits((s) => !s)}
          >
            {showAllCommits ? "−" : `＋ ${commits.length - ROW_CAP}`}
          </button>
        )}
      </section>

      {prevCwd && prevCwd !== cwd && (
        <section className="border-t border-zinc-800 pt-3">
          <h2 className="mb-1.5 flex items-center gap-1.5 font-semibold tracking-wide text-zinc-400 uppercase">
            Left behind
            {prevState && <span className={`h-2 w-2 rounded-full ${STATE_DOT[prevState]}`} title={prevState} />}
            <span className="ml-auto truncate font-normal text-[10px] normal-case text-zinc-600" title={prevCwd}>
              {prevCwd.split("/").filter(Boolean).pop() ?? prevCwd}
            </span>
          </h2>
          <p className="mb-2 text-zinc-500">
            {prevLanding ? (
              <>
                <span className="text-zinc-600">landing: </span>
                <span className="text-zinc-300">{prevLanding.body}</span>
              </>
            ) : (
              "no landing note"
            )}
          </p>
          <input
            className="mb-2 w-full rounded bg-zinc-800 px-2 py-1 text-zinc-200 outline-none placeholder:text-zinc-600"
            placeholder="Park a thought before it's gone…"
            value={residueDraft}
            onChange={(e) => setResidueDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void addResidue()}
          />
          <ul className="flex flex-col gap-1">
            {residue.map((n) => (
              <li key={n.id} className="flex items-start gap-2">
                <span className="min-w-0 flex-1 break-words text-zinc-400">{n.body}</span>
                <button className="shrink-0 text-zinc-600 hover:text-zinc-200" title="Clear" onClick={() => void dismissResidue(n)}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {context && (
        // top-7 keeps the titlebar drag region reachable under the overlay
        <div className="fixed inset-x-0 top-7 bottom-0 z-30 flex items-center justify-center bg-black/60" onClick={() => setContext(null)}>
          {/* Same skin as a decision card (border-yellow-800/60 +
              bg-yellow-950/20), but the modal floats over a translucent
              overlay — so the tint is pre-composited against zinc-900 rather
              than layered. Keep in sync with the decision <li> above. */}
          <div
            className="max-h-[70vh] w-[36rem] max-w-[90vw] overflow-y-auto rounded-lg border border-yellow-800/60 bg-[#201a17] p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 font-semibold text-orange-300">{context.question}</h3>
            {(() => {
              try {
                const pair = JSON.parse(context.context_json) as { assistant: string; user: string | null };
                return (
                  <>
                    <p className="mb-1 text-zinc-500">agent said:</p>
                    <pre className="mb-3 whitespace-pre-wrap rounded bg-black/30 p-2 text-zinc-300">{pair.assistant}</pre>
                    <p className="mb-1 text-zinc-500">you replied:</p>
                    <pre className="whitespace-pre-wrap rounded bg-black/30 p-2 text-zinc-300">
                      {pair.user ?? "(no reply — turn ended)"}
                    </pre>
                  </>
                );
              } catch {
                return <p className="text-zinc-500">context unavailable</p>;
              }
            })()}
            <button
              className="mt-3 rounded bg-orange-400 px-3 py-1 font-medium text-zinc-950 hover:bg-orange-300"
              onClick={() => setContext(null)}
            >
              Close
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
