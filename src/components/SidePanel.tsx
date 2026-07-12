import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import * as repo from "../lib/repo";
import type { Blocker, Commit, Decision, ToolEvent } from "../types";

interface Props {
  cwd: string; // expanded absolute project dir of the active tab
  refreshKey: number; // bump to force reload (new events / blocker changes)
  onBlockersChanged: () => void;
  onDecisionsChanged: () => void;
  onAnswerNow: (d: Decision) => void; // prefill terminal — user still hits Enter
}

function ago(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function SidePanel({ cwd, refreshKey, onBlockersChanged, onDecisionsChanged, onAnswerNow }: Props) {
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [blockers, setBlockers] = useState<Blocker[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [context, setContext] = useState<Decision | null>(null);
  const [draft, setDraft] = useState("");

  const reload = useCallback(async () => {
    const [te, bl, gl, dc] = await Promise.all([
      repo.listToolEvents(cwd).catch(() => []),
      repo.listBlockers(cwd).catch(() => []),
      invoke<Commit[]>("git_log", { cwd, limit: 15 }).catch(() => []),
      repo.listDecisions(cwd).catch(() => []),
    ]);
    setToolEvents(te);
    setBlockers(bl);
    setCommits(gl);
    setDecisions(dc);
  }, [cwd]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

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
    <div className="flex h-full w-72 shrink-0 flex-col gap-4 overflow-y-auto border-r border-zinc-800 bg-zinc-900 p-3 text-xs text-zinc-300">
      <p className="truncate border-b border-zinc-800 pb-1.5 font-mono text-[10px] text-zinc-500" title={cwd}>
        project: {cwd.split("/").filter(Boolean).pop() ?? cwd}
      </p>
      <section>
        <h2 className="mb-1.5 font-semibold tracking-wide text-violet-400 uppercase">
          Decisions {openDecisions.length > 0 && `(${openDecisions.length})`}
        </h2>
        {openDecisions.length === 0 && <p className="text-zinc-600">Nothing waiting on you.</p>}
        <ul className="flex flex-col gap-2">
          {openDecisions.map((d) => (
            <li key={d.id} className="rounded border border-violet-900/50 bg-violet-950/20 p-2">
              <p className="break-words">{d.question}</p>
              {d.assumption && (
                <p className="mt-1 text-amber-400/90">agent assumed: {d.assumption}</p>
              )}
              <div className="mt-1.5 flex gap-2 text-zinc-400">
                <button className="hover:text-zinc-100" title="Prefill answer in terminal" onClick={() => onAnswerNow(d)}>
                  ✎ answer
                </button>
                <button className="hover:text-zinc-100" title="Show surrounding conversation" onClick={() => setContext(d)}>
                  ⌕ context
                </button>
                <button className="hover:text-zinc-100" title="Fine — agent's call" onClick={() => void setStatus(d, "delegated")}>
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
                {d.status === "delegated" ? "⤳" : "✓"} {d.question}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-1.5 font-semibold tracking-wide text-amber-400 uppercase">
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
        <ul className="flex flex-col gap-1">
          {open.map((b) => (
            <li key={b.id} className="flex items-start gap-2">
              <input type="checkbox" checked={false} onChange={() => void resolve(b)} className="mt-0.5" />
              <span className="min-w-0 flex-1 break-words">
                {b.text}
                <span className="ml-1 text-zinc-600">
                  {b.source !== "manual" && `· ${b.source} `}· {ago(b.ts)}
                </span>
              </span>
              <button className="shrink-0 text-zinc-600 hover:text-zinc-200" title="Delete" onClick={() => void remove(b)}>
                ✕
              </button>
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
        <ul className="flex flex-col gap-1">
          {toolEvents.map((e) => (
            <li key={e.id} className="flex gap-2">
              <span className="w-8 shrink-0 text-right text-zinc-600">{ago(e.ts)}</span>
              <span className="min-w-0 flex-1 truncate" title={e.detail}>
                <span className="text-zinc-100">{e.tool}</span>
                {e.detail && <span className="text-zinc-500"> {e.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-1.5 font-semibold tracking-wide text-sky-400 uppercase">Git log</h2>
        {commits.length === 0 && <p className="text-zinc-600">Not a git repo.</p>}
        <ul className="flex flex-col gap-1">
          {commits.map((c) => (
            <li key={c.hash} className="flex gap-2">
              <span className="w-8 shrink-0 text-right text-zinc-600">{ago(c.ts * 1000)}</span>
              <span className="min-w-0 flex-1 truncate" title={c.subject}>
                <span className="font-mono text-zinc-500">{c.hash}</span> {c.subject}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {context && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60" onClick={() => setContext(null)}>
          <div
            className="max-h-[70vh] w-[36rem] max-w-[90vw] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 font-semibold text-violet-400">{context.question}</h3>
            {(() => {
              try {
                const pair = JSON.parse(context.context_json) as { assistant: string; user: string | null };
                return (
                  <>
                    <p className="mb-1 text-zinc-500">agent said:</p>
                    <pre className="mb-3 whitespace-pre-wrap rounded bg-zinc-800 p-2 text-zinc-300">{pair.assistant}</pre>
                    <p className="mb-1 text-zinc-500">you replied:</p>
                    <pre className="whitespace-pre-wrap rounded bg-zinc-800 p-2 text-zinc-300">
                      {pair.user ?? "(no reply — turn ended)"}
                    </pre>
                  </>
                );
              } catch {
                return <p className="text-zinc-500">context unavailable</p>;
              }
            })()}
            <button className="mt-3 rounded bg-zinc-700 px-3 py-1 text-zinc-200 hover:bg-zinc-600" onClick={() => setContext(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
