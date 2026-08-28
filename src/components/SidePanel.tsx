import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import * as repo from "../lib/repo";
import { burst } from "../lib/confetti";
import { generateCommitMessage } from "../lib/commitMessage";
import {
  gitAddAll,
  gitAddU,
  gitCommit,
  gitCreateBranch,
  gitCheckout,
  gitCurrentBranch,
  gitDiffCached,
  gitHasChanges,
  gitPrCreate,
  gitPush,
  gitUntrackedFiles,
} from "../lib/pty";
import { RainbowText } from "./RainbowText";
import type { Blocker, Commit, Decision, FanOutRollup, Note, ToolEvent } from "../types";

interface Props {
  cwd: string; // expanded absolute project dir of the active tab
  sessionId: string | null; // session currently bound to the active tab, for scoping decisions/tool events away from sibling tabs on the same cwd
  accent: string | null; // matching bookmark's color, if the project is bookmarked
  refreshKey: number; // bump to force reload (new events / blocker changes)
  blindPaths: string[]; // transcripts that failed to open — panels are incomplete
  fanOut: FanOutRollup[]; // every fan-out group the active tab belongs to (as parent, possibly several; as child, at most one), oldest first
  onSelectTab: (id: string) => void; // jump to a fan-out child/parent tab
  onDismissMember: (groupId: string, childTabId: string) => void; // drop a lingering row from the fan-out rollup
  onBlockersChanged: () => void;
  onDecisionsChanged: () => void;
  onAnswerNow: (d: Decision) => void; // prefill terminal — user still hits Enter
  onMuteChanged: () => void; // App's notify-hot-path mute cache needs a refresh
}

// Long lists collapse to this many rows behind a full-width ＋ toggle.
const ROW_CAP = 5;
const EXPAND_BTN =
  "mt-1.5 w-full rounded border border-zinc-800 py-0.5 text-center text-zinc-500 hover:border-zinc-700 hover:bg-zinc-800/50 hover:text-zinc-200";

// Unicode ▾/▸ render as an unstyled fallback glyph (tofu dot) at 9px in the
// webview font — SVG avoids relying on font glyph coverage.
function Chevron({ collapsed, className }: { collapsed: boolean; className?: string }) {
  return (
    <svg
      width="8"
      height="8"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 transition-transform ${collapsed ? "-rotate-90" : ""} ${className ?? ""}`}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function ago(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function SidePanel({
  cwd,
  sessionId,
  accent,
  refreshKey,
  blindPaths,
  fanOut,
  onSelectTab,
  onDismissMember,
  onBlockersChanged,
  onDecisionsChanged,
  onAnswerNow,
  onMuteChanged,
}: Props) {
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [muted, setMuted] = useState(false);
  const [unclaimed, setUnclaimed] = useState<{ session_id: string; ts: number }[]>([]);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [blockers, setBlockers] = useState<Blocker[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [landing, setLanding] = useState<Note | null>(null); // active project, momentum
  const [notes, setNotes] = useState<Note[]>([]); // active project, open notes & reminders
  const [context, setContext] = useState<Decision | null>(null);
  const [draft, setDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [showAllTools, setShowAllTools] = useState(false);
  const [showAllCommits, setShowAllCommits] = useState(false);
  const [showAllFanOut, setShowAllFanOut] = useState(false);
  const [expandedBlockers, setExpandedBlockers] = useState<Set<number>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Commit & Push footer (Phase 9): gitBranch "" means "not a repo / not
  // loaded yet" — the footer hides rather than flashing "no changes".
  const [gitBranch, setGitBranch] = useState("");
  const [gitDirty, setGitDirty] = useState(false);
  // Files `git add -u` never stages (new, not yet tracked) — surfaced as a
  // warning rather than silently omitted from the commit. `includeUntracked`
  // is the user's opt-in to stage them too; defaults off per commit/cwd.
  const [untrackedFiles, setUntrackedFiles] = useState<string[]>([]);
  const [includeUntracked, setIncludeUntracked] = useState(false);
  const [commitMsg, setCommitMsg] = useState("");
  const [footerBusy, setFooterBusy] = useState<"generate" | "commit" | "pr" | null>(null);
  const [footerError, setFooterError] = useState<string | null>(null);
  const [footerOpen, setFooterOpen] = useState(false);
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [width, setWidth] = useState(288); // w-72
  const resizeStart = useRef<{ x: number; width: number } | null>(null);
  // cwd -> the diff a cached message was generated from, so a repeat click
  // (or an unrelated panel refresh) never re-calls the LLM for the same diff.
  const commitCacheRef = useRef(new Map<string, { diff: string; message: string }>());
  // cwd currently generated/generating for — reset when the tree goes clean,
  // so a genuinely new dirty state regenerates but a `refreshKey` tick while
  // the same diff is still pending (or the user is mid-edit) does not.
  const generatingForRef = useRef<string | null>(null);

  const toggleBlocker = (id: number) =>
    setExpandedBlockers((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const dismissUnclaimed = async (sessionId: string) => {
    await repo.addEvent(sessionId, "result_claimed", "{}");
    await reload();
  };

  const toggleSection = (key: string) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // A fan-out child never picked up its own tether (its CLI fires no Claude
  // Code hooks, so `sessionId` stays null forever) is not the same "no
  // session yet" as a plain tab or a genuinely external terminal — those get
  // scopeBySession's cwd-wide fallback because there's no better signal. A
  // spawn-launched child already has a definite identity (it's this specific
  // fan-out row); showing it the whole project's decisions/tool-events
  // instead is wrong, not a fallback. Isolate it to empty instead.
  const isUnboundFanOutChild = !sessionId && fanOut.some((f) => !f.isParent);

  // gitDirty alone misses untracked-only changes (git_has_changes excludes
  // them on purpose — see git_add_u's landmine note in CLAUDE.md). The
  // footer must still open in that case so the untracked-files warning is
  // reachable, even though nothing is staged until the box is checked.
  const hasStageable = gitDirty || untrackedFiles.length > 0;

  const reload = useCallback(async () => {
    const [te, bl, gl, dc, ln, nt, uc, branch, dirty, untracked] = await Promise.all([
      repo.listToolEvents(cwd).catch(() => []),
      repo.listBlockers(cwd).catch(() => []),
      invoke<Commit[]>("git_log", { cwd, limit: 15 }).catch(() => []),
      repo.listDecisions(cwd).catch(() => []),
      repo.latestLandingNote(cwd).catch(() => null),
      repo.listNotes(cwd, "residue").catch(() => []),
      repo.unclaimedResults(cwd).catch(() => []),
      gitCurrentBranch(cwd).catch(() => ""),
      gitHasChanges(cwd).catch(() => false),
      gitUntrackedFiles(cwd).catch(() => []),
    ]);
    setToolEvents(isUnboundFanOutChild ? [] : repo.scopeBySession(te, sessionId));
    setBlockers(bl);
    setCommits(gl);
    setDecisions(isUnboundFanOutChild ? [] : repo.scopeBySession(dc, sessionId));
    setLanding(ln);
    setNotes(nt.filter((n) => n.status === "open").slice(0, 3));
    setUnclaimed(uc);
    setGitBranch(branch);
    setGitDirty(dirty);
    setUntrackedFiles(untracked);
  }, [cwd, sessionId, isUnboundFanOutChild]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  // Footer state (error/PR link/expanded) belongs to whichever cwd produced
  // it — carrying it across a tab switch makes a stale error from tab A read
  // as if it just happened on tab B's branch. Reset on cwd change only;
  // commitAndPush already clears/sets these itself mid-action.
  useEffect(() => {
    setFooterError(null);
    setPrUrl(null);
    setFooterOpen(false);
    setIncludeUntracked(false);
  }, [cwd]);

  useEffect(() => {
    void repo.isProjectMuted(cwd).then(setMuted).catch(() => undefined);
  }, [cwd]);

  // Auto-generate the commit message once per genuinely-new dirty state, not
  // on every `refreshKey` tick — that would stomp an in-progress manual edit
  // and re-call the LLM for the same diff. Stages with `git add -u` first so
  // the diff (and therefore the message) matches exactly what a commit click
  // is about to commit.
  useEffect(() => {
    if (!hasStageable) {
      generatingForRef.current = null;
      setCommitMsg("");
      return;
    }
    const genKey = `${cwd}:${includeUntracked}`;
    if (generatingForRef.current === genKey) return;
    generatingForRef.current = genKey;
    let cancelled = false;
    setFooterBusy("generate");
    void (async () => {
      try {
        await (includeUntracked ? gitAddAll(cwd) : gitAddU(cwd));
        const diff = await gitDiffCached(cwd);
        if (cancelled) return;
        if (!diff.trim()) {
          // Untracked-only change, box still unchecked — nothing staged yet,
          // nothing to generate a message from.
          setCommitMsg("");
          return;
        }
        const cached = commitCacheRef.current.get(genKey);
        const message = cached && cached.diff === diff ? cached.message : await generateCommitMessage(diff);
        if (cancelled) return;
        commitCacheRef.current.set(genKey, { diff, message });
        setCommitMsg(message);
      } catch {
        // fail open — footer still shows an empty, editable, committable field
      } finally {
        if (!cancelled) setFooterBusy(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasStageable, cwd, includeUntracked]);

  const commitAndPush = async (target: "branch" | "main") => {
    if (target === "main") {
      const ok = await ask("Push to origin/main?", {
        title: "Push to main",
        kind: "warning",
        okLabel: "Push",
        cancelLabel: "Cancel",
      });
      if (!ok) return;
    }
    setFooterError(null);
    setPrUrl(null);
    setFooterBusy("commit");
    // `gitCreateBranch` below is a real `git checkout -b` in the tab's live
    // working directory (not a worktree) — set only when we actually switch,
    // so the `finally` can check the tab back out to where it started rather
    // than stranding it on the new wip branch regardless of how this ends.
    let switchedFrom: string | null = null;
    try {
      let branch = gitBranch;
      if (target === "branch" && gitBranch === "main") {
        const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
        branch = `wip/${stamp}`;
        switchedFrom = gitBranch;
        await gitCreateBranch(cwd, branch);
      }
      await (includeUntracked ? gitAddAll(cwd) : gitAddU(cwd));
      const msg = commitMsg.trim();
      if (!msg) throw new Error("commit message is empty");
      await gitCommit(cwd, msg);
      try {
        await gitPush(cwd, branch, false);
      } catch (e) {
        // no upstream yet is a config gap, not a rejected push — safe to
        // retry with -u; any other failure (e.g. diverged remote) surfaces.
        if (/upstream/i.test(String(e))) {
          await gitPush(cwd, branch, true);
        } else {
          throw e;
        }
      }
      setGitBranch(branch);
      setGitDirty(false);
      setUntrackedFiles((prev) => (includeUntracked ? [] : prev));
      generatingForRef.current = null;
      commitCacheRef.current.delete(`${cwd}:${includeUntracked}`);
      setCommitMsg("");
      // PR only makes sense off main — a push to main has nothing to PR
      // against. Best-effort: the commit/push above already landed, so a
      // failure here (no gh, unauthenticated, PR already open) surfaces
      // separately and must not read as the commit having failed.
      if (target === "branch") {
        setFooterBusy("pr");
        try {
          const [title, ...rest] = msg.split("\n");
          setPrUrl(await gitPrCreate(cwd, title, rest.join("\n").trim()));
        } catch (e) {
          setFooterError(`pushed — PR failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } catch (e) {
      setFooterError(e instanceof Error ? e.message : String(e));
    } finally {
      // Runs on every exit path (success, push failure, PR failure) — a
      // half-finished wip flow must not leave a live terminal parked on a
      // branch the user never asked to be on.
      if (switchedFrom) {
        await gitCheckout(cwd, switchedFrom).catch(() => undefined);
        setGitBranch(switchedFrom);
      }
      setFooterBusy(null);
    }
  };

  const toggleMute = async () => {
    const next = !muted;
    setMuted(next); // optimistic — matches the rest of the panel's local-first pattern
    await repo.setProjectMuted(cwd, next).catch(() => undefined);
    onMuteChanged();
  };

  const addQuickNote = async () => {
    const text = noteDraft.trim();
    if (!text) return;
    await repo.addNote(cwd, "residue", text, sessionId);
    setNoteDraft("");
    await reload();
  };

  const dismissNote = async (n: Note) => {
    await repo.setNoteStatus(n.id, "done");
    await reload();
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

  // A tab is a member of at most one group (a child is only ever created by a
  // single launch), but can *parent* several — fan out again from a tab
  // before clearing the last group, and both exist. Oldest first, so the
  // original fan-out stays put and a newer one queues behind it rather than
  // silently replacing it in the lookup (the bug this replaced).
  // ponytail: pointer events, not native resize-x — resize-x's grip only
  // lives in the bottom-right corner, unreachable on a full-height panel.
  const onResizePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    resizeStart.current = { x: e.clientX, width };
    const onMove = (ev: PointerEvent) => {
      if (!resizeStart.current) return;
      const next = resizeStart.current.width + (ev.clientX - resizeStart.current.x);
      setWidth(Math.min(512, Math.max(192, next)));
    };
    const onUp = () => {
      resizeStart.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const childStrip = fanOut.find((f) => !f.isParent) ?? null;
  const parentGroups = fanOut.filter((f) => f.isParent);
  const visibleParentGroups = showAllFanOut ? parentGroups : parentGroups.slice(0, 1);

  return (
    <div
      className="relative flex h-full shrink-0 flex-col overflow-hidden border-r border-zinc-800 bg-zinc-900 text-xs text-zinc-300"
      style={{ width }}
    >
      <div
        className="absolute right-0 top-0 z-10 h-full w-1.5 -mr-0.5 cursor-col-resize hover:bg-zinc-600/60 active:bg-zinc-500"
        onPointerDown={onResizePointerDown}
      />
      {/* Pinned header: never scrolls away. Text takes the project's bookmark
          color when one exists; plain grey otherwise. */}
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-zinc-800 px-3">
        <p
          className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-500"
          style={accent ? { color: accent } : undefined}
          title={cwd}
        >
          project: {cwd.split("/").filter(Boolean).pop() ?? cwd}
        </p>
        <button
          className={`flex shrink-0 items-center gap-1 rounded px-1 leading-none ${muted ? "text-zinc-600 hover:text-zinc-400" : "text-zinc-400 hover:text-zinc-200"}`}
          title={muted ? "Notifications muted for this project — click to unmute" : "Mute notifications for this project"}
          onClick={() => void toggleMute()}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0"
          >
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            {muted && (
              <>
                <line x1="4" y1="4" x2="20" y2="20" />
                <line x1="20" y1="4" x2="4" y2="20" />
              </>
            )}
          </svg>
          {muted ? "muted" : "notify"}
        </button>
      </div>
      {/* Blind sessions: hooks arrive but the transcript file will not open, so
          decisions and every transcript-fed panel are silently incomplete. This
          says so rather than looking like a quiet day. */}
      {blindPaths.length > 0 && (
        <p
          className="flex shrink-0 items-start gap-1 border-b border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[10px] text-red-300"
          title={blindPaths.join("\n")}
        >
          <span>
            ⚠ no transcript for {blindPaths.length} session{blindPaths.length > 1 ? "s" : ""} — decisions
            incomplete
          </span>
          {/* Not every blind session is a failure: Claude Desktop cowork sessions
              share ~/.claude/settings.json (so they send hooks) but never write a
              flat <id>.jsonl, so they warn forever. Detecting them is Phase 6;
              until then, say so here rather than let the strip cry wolf. */}
          <span
            className="ml-auto cursor-help text-red-300/60"
            title={
              "Expected for Claude Desktop cowork sessions: they send hooks but never write a transcript file, so this warning will not clear.\n\n" +
              "For a Claude Code session it means decisions are genuinely being missed."
            }
          >
            ⓘ
          </span>
        </p>
      )}
      {childStrip && (
        <p
          className="flex shrink-0 cursor-pointer items-center gap-1 border-b border-purple-500/20 bg-purple-400/5 px-3 py-1.5 text-[10px] text-purple-300 hover:bg-purple-400/10"
          onClick={() => onSelectTab(childStrip.parentTabId)}
          title="Jump to the parent tab"
        >
          part of {childStrip.label ?? "a fan-out"} ({childStrip.parentTitle} ↗)
        </p>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
      <section className="border-b border-zinc-800 pb-3">
        <h2 className="mb-1.5 font-semibold tracking-wide uppercase">
          <RainbowText text="Notes and reminders" />
        </h2>
        <input
          className="mb-2 w-full rounded bg-zinc-800 px-2 py-1 text-zinc-200 outline-none placeholder:text-zinc-600"
          placeholder="Leave a note for this project…"
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void addQuickNote()}
        />
        {notes.length === 0 ? (
          <p className="text-zinc-600">Nothing parked here.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {notes.map((n) => (
              <li key={n.id} className="flex items-start gap-2">
                <span className="min-w-0 flex-1 break-words text-zinc-400">{n.body}</span>
                <button className="shrink-0 text-zinc-600 hover:text-zinc-200" title="Clear" onClick={() => void dismissNote(n)}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {parentGroups.length > 0 && (
      <div className="flex flex-col gap-1.5">
      {visibleParentGroups.map((f) => (
        <section key={f.groupId} className="rounded-lg border border-purple-500/30 bg-purple-400/5 p-3">
          <h2
            className="mb-1.5 flex cursor-pointer items-center gap-1.5 font-semibold tracking-wide text-purple-300 uppercase select-none"
            onClick={() => toggleSection(`fanout-${f.groupId}`)}
          >
            <Chevron collapsed={collapsed.has(`fanout-${f.groupId}`)} className="text-purple-300/85" />
            Fan-out
            {f.label && (
              <span className="ml-auto font-normal text-[10px] normal-case text-zinc-500">{f.label}</span>
            )}
          </h2>
          {!collapsed.has(`fanout-${f.groupId}`) && (
            <>
          <p className="mb-2 text-zinc-500">
            {f.members.filter((m) => m.status === "done").length}/{f.members.length} done
          </p>
          <ul className="flex flex-col gap-1">
            {f.members.map((m) => (
              <li
                key={m.childTabId}
                className={`flex items-center gap-2 rounded px-1.5 py-1 ${
                  m.status !== "gone" ? "cursor-pointer hover:bg-purple-500/10" : ""
                }`}
                onClick={() => m.status !== "gone" && onSelectTab(m.childTabId)}
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    m.status === "flag"
                      ? "bg-emerald-400 shadow-[0_0_6px_2px_rgba(16,185,129,0.6)]"
                      : m.status === "done"
                        ? "bg-emerald-700"
                        : m.status === "dead"
                          ? "bg-red-500"
                          : m.status === "gone"
                            ? "bg-zinc-700"
                            : "bg-blue-400"
                  }`}
                />
                <span className="min-w-0 flex-1 truncate text-zinc-300">{m.title}</span>
                <span className="shrink-0 text-zinc-600">{m.status}</span>
                <button
                  className="shrink-0 leading-none text-zinc-600 hover:text-red-400"
                  title="Remove from group"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDismissMember(f.groupId, m.childTabId);
                  }}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
            </>
          )}
        </section>
      ))}
      {parentGroups.length > 1 && (
        <button
          className="w-full rounded border border-purple-500/10 bg-purple-400/[0.015] py-0.5 text-center text-zinc-500 hover:border-purple-500/27 hover:bg-purple-400/[0.09] hover:text-purple-300/90"
          onClick={() => setShowAllFanOut((v) => !v)}
        >
          {showAllFanOut ? "− hide newer fan-outs" : `+ ${parentGroups.length - 1} more fan-out${parentGroups.length - 1 === 1 ? "" : "s"}`}
        </button>
      )}
      </div>
      )}
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
        <h2
          className="mb-1.5 flex cursor-pointer items-center gap-1.5 font-semibold tracking-wide text-orange-400 uppercase select-none"
          onClick={() => toggleSection("decisions")}
        >
          <Chevron collapsed={collapsed.has("decisions")} className="text-orange-400/85" />
          Decisions {openDecisions.length > 0 && `(${openDecisions.length})`}
        </h2>
        {!collapsed.has("decisions") && (
          <>
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
          </>
        )}
      </section>

      <section>
        <h2
          className="mb-1.5 flex cursor-pointer items-center gap-1.5 font-semibold tracking-wide text-red-400 uppercase select-none"
          onClick={() => toggleSection("blockers")}
        >
          <Chevron collapsed={collapsed.has("blockers")} className="text-red-400/85" />
          Blockers {open.length > 0 && `(${open.length})`}
        </h2>
        {!collapsed.has("blockers") && (
          <>
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
          </>
        )}
      </section>

      <section>
        <h2
          className="mb-1.5 flex cursor-pointer items-center gap-1.5 font-semibold tracking-wide text-emerald-400 uppercase select-none"
          onClick={() => toggleSection("accomplished")}
        >
          <Chevron collapsed={collapsed.has("accomplished")} className="text-emerald-400/85" />
          Accomplished
        </h2>
        {!collapsed.has("accomplished") && (
          <>
            {unclaimed.length > 0 && (
              <ul className="mb-1.5 flex flex-col gap-1 border-b border-emerald-800/40 pb-1.5">
                {unclaimed.map((u) => (
                  <li key={u.session_id} className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_6px_2px_rgba(16,185,129,0.6)]" />
                    <span className="flex-1 text-emerald-200">Agent finished, unclaimed</span>
                    <span className="text-zinc-600">{ago(u.ts)}</span>
                    <button
                      className="shrink-0 text-zinc-600 hover:text-zinc-200"
                      title="Dismiss"
                      onClick={() => void dismissUnclaimed(u.session_id)}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {toolEvents.length === 0 && unclaimed.length === 0 && (
              <p className="text-zinc-600">No tool activity recorded.</p>
            )}
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
          </>
        )}
      </section>

      <section>
        <h2
          className="mb-1.5 flex cursor-pointer items-center gap-1.5 font-semibold tracking-wide text-sky-400 uppercase select-none"
          onClick={() => toggleSection("gitlog")}
        >
          <Chevron collapsed={collapsed.has("gitlog")} className="text-sky-400/85" />
          Git log
        </h2>
        {!collapsed.has("gitlog") && (
          <>
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
          </>
        )}
      </section>

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
      {/* Pinned footer: never scrolls away. Hidden entirely when gitBranch is
          unresolved (not a repo, or not loaded yet). Passive by default — a
          branch pill, not a block — and discloses the commit UI only on
          click, so a dirty repo doesn't permanently eat footer space. */}
      {gitBranch !== "" && (
        <div className="flex shrink-0 flex-col gap-1.5 border-t border-sky-800/40 p-2">
          <button
            className="flex items-center gap-1.5 self-start rounded px-1.5 py-0.5 font-mono text-sky-400/60 hover:bg-zinc-800 hover:text-sky-300 disabled:hover:bg-transparent"
            disabled={!hasStageable}
            onClick={() => setFooterOpen((o) => !o)}
            title={hasStageable ? "commit + push + PR" : "no changes"}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 text-zinc-500">
              <path
                fillRule="evenodd"
                d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
              />
            </svg>
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${hasStageable ? "bg-amber-400" : "bg-zinc-700"}`} />
            {gitBranch}
            {hasStageable && <Chevron collapsed={!footerOpen} className="text-sky-400/60" />}
          </button>
          {prUrl && (
            <p className="truncate text-sky-300" title={prUrl}>
              PR opened: <span className="font-mono">{prUrl}</span>
            </p>
          )}
          {hasStageable && footerOpen && (
            <>
              <textarea
                className="h-14 w-full resize-none rounded bg-zinc-800 p-1.5 font-mono text-[10px] text-zinc-200 outline-none placeholder:text-zinc-600"
                placeholder={footerBusy === "generate" ? "generating message…" : "commit message"}
                value={commitMsg}
                onChange={(e) => setCommitMsg(e.target.value)}
              />
              {untrackedFiles.length > 0 && (
                <label
                  className="flex items-start gap-1.5 rounded border border-amber-900/50 bg-amber-950/30 p-1.5 text-amber-300"
                  title={untrackedFiles.join("\n")}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 shrink-0"
                    checked={includeUntracked}
                    onChange={(e) => setIncludeUntracked(e.target.checked)}
                  />
                  <span>
                    {untrackedFiles.length} new file{untrackedFiles.length === 1 ? "" : "s"} not staged (
                    <span className="font-mono">{untrackedFiles[0]}</span>
                    {untrackedFiles.length > 1 && ` +${untrackedFiles.length - 1} more`}) — include in this commit?
                  </span>
                </label>
              )}
              {footerError && <p className="text-red-400">{footerError}</p>}
              <div className="flex gap-1.5">
                <button
                  className="flex-1 rounded bg-sky-900/40 px-2 py-1 font-medium text-sky-200 hover:bg-sky-900/70 disabled:opacity-40"
                  disabled={!commitMsg.trim() || footerBusy !== null}
                  onClick={() => void commitAndPush("branch")}
                >
                  {footerBusy === "commit" && "committing…"}
                  {footerBusy === "pr" && "opening PR…"}
                  {footerBusy === null &&
                    (gitBranch === "main" ? "commit + push (new branch) + PR" : "commit + push + PR")}
                </button>
                {/* Direct-to-main is the one path with no PR step (nothing
                    to PR against), kept as a distinct, confirm-gated,
                    danger-styled action rather than folded into the button
                    above. */}
                {gitBranch === "main" && (
                  <button
                    className="rounded border border-red-900/60 bg-zinc-950 px-2 py-1 font-medium text-red-200 hover:bg-red-950 disabled:opacity-40"
                    disabled={!commitMsg.trim() || footerBusy !== null}
                    onClick={() => void commitAndPush("main")}
                  >
                    {footerBusy === "commit" ? "…" : "→ main"}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
