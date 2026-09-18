// Plan 023: "Claude usage" sidebar block — wraps the user's existing
// statusLine.command (never creates one from scratch) so its rate_limits/
// model JSON is mirrored here. Pure state/format helpers are exported for
// scripts/statusline-check.ts; see docs/IDEAS.md's Claude build brief and
// plans/023-claude-statusline-limits-meter.md for the full design record.
import { useEffect, useState } from "react";
import { claudeStatuslineRemove, claudeStatuslineSetup, claudeStatuslineStatus } from "../lib/ingest";
import { setClaudeStatuslineWrapperEnabled } from "../lib/repo";
import type {
  ClaudeRateLimitWindow,
  ClaudeRateLimits,
  ClaudeStatuslinePayload,
  ClaudeStatuslineSnapshot,
  ClaudeStatuslineStatus,
} from "../types";

export type ClaudeUsageState =
  | "not-offered"
  | "wrapper-not-installed"
  | "unavailable-old-cli"
  | "unavailable-ineligible"
  | "wrapper-installed-loading"
  | "available"
  | "stale";

// ponytail: fixed window; tune from dogfood if the real statusLine cadence
// (session start/resume, new assistant message, /compact, …) disagrees.
export const STATUSLINE_STALE_MS = 15_000;

export function claudeUsageState(args: {
  agent?: string;
  sessionId: string | null;
  status: ClaudeStatuslineStatus | null;
  sawSnapshot: boolean;
  hasRateLimits: boolean;
  stale: boolean;
}): ClaudeUsageState {
  if (args.agent || !args.sessionId) return "not-offered";
  if (!args.status || args.status.state !== "installed") return "wrapper-not-installed";
  if (args.status.cli_version_ok === false) return "unavailable-old-cli";
  if (!args.hasRateLimits) return args.sawSnapshot ? "unavailable-ineligible" : "wrapper-installed-loading";
  return args.stale ? "stale" : "available";
}

/** Bar fill only — never the displayed number. `spend_limit` can
 * legitimately exceed 100 for gateway/spend-limit accounts. */
export function clampBarFill(usedPercentage: number): number {
  if (!Number.isFinite(usedPercentage)) return 0;
  return Math.max(0, Math.min(100, usedPercentage));
}

export function formatResetTime(resetsAt: number | null | undefined): string | null {
  if (typeof resetsAt !== "number" || !Number.isFinite(resetsAt)) return null;
  return new Date(resetsAt * 1000).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** No update since a cadence event (a hook event for this tab, which should
 * have rerun Claude's statusLine command) that is older than the stale
 * window and newer than the latest snapshot — labels last-good data as
 * stale rather than silently freezing it as current. */
export function isStatuslineStale(
  lastCadenceEventTs: number | undefined,
  lastSnapshotReceivedAt: number | null,
  now: number
): boolean {
  if (lastCadenceEventTs === undefined) return false;
  if (lastSnapshotReceivedAt !== null && lastSnapshotReceivedAt >= lastCadenceEventTs) return false;
  return now - lastCadenceEventTs > STATUSLINE_STALE_MS;
}

export function claudeModelLabel(model: ClaudeStatuslinePayload["model"] | undefined): string | null {
  if (!model) return null;
  if (typeof model === "string") return model;
  return model.display_name ?? model.id ?? null;
}

export function hasAnyRateLimitWindow(rl: ClaudeRateLimits | null | undefined): boolean {
  return !!(rl && (rl.five_hour || rl.seven_day || rl.spend_limit));
}

function Bar({ label, window }: { label: string; window: ClaudeRateLimitWindow | null | undefined }) {
  if (!window) return null;
  const fill = clampBarFill(window.used_percentage);
  const reset = formatResetTime(window.resets_at);
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline justify-between text-[9px] text-zinc-500">
        <span>{label}</span>
        <span>
          {Math.round(window.used_percentage)}% used{reset ? ` · resets ${reset}` : ""}
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full rounded-full ${fill >= 90 ? "bg-red-500" : fill >= 70 ? "bg-amber-400" : "bg-sky-500"}`}
          style={{ width: `${fill}%` }}
        />
      </div>
    </div>
  );
}

interface Props {
  agent?: string; // active tab's adapter marker — undefined for plain Claude
  sessionId: string | null; // session bound to the active tab
  lastEventTs?: number; // Phase 14b clock — doubles as the last cadence-event signal
  now: number; // Phase 14b tick
  snapshot: ClaudeStatuslineSnapshot | null; // latest mirrored statusLine payload for this exact session
}

export function ClaudeUsageBlock({ agent, sessionId, lastEventTs, now, snapshot }: Props) {
  const [status, setStatus] = useState<ClaudeStatuslineStatus | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const offered = !agent && !!sessionId;
  useEffect(() => {
    if (!offered) return;
    void claudeStatuslineStatus().then(setStatus).catch(() => setStatus(null));
    // Re-checks whenever this block becomes relevant for a (possibly new)
    // session — not on every clock tick.
  }, [offered, sessionId]);

  if (!offered) return null; // "not-offered": unbound tab, or a non-Claude adapter

  const sawSnapshot = snapshot?.payload.session_id === sessionId;
  const rateLimits = sawSnapshot ? snapshot?.payload.rate_limits ?? null : null;
  const model = sawSnapshot ? claudeModelLabel(snapshot?.payload.model) : null;
  const stale = isStatuslineStale(lastEventTs, sawSnapshot ? snapshot?.receivedAt ?? null : null, now);
  const state = claudeUsageState({
    agent,
    sessionId,
    status,
    sawSnapshot,
    hasRateLimits: hasAnyRateLimitWindow(rateLimits),
    stale,
  });

  const refresh = () => void claudeStatuslineStatus().then(setStatus).catch(() => setStatus(null));

  const run = (action: () => Promise<void>, nextEnabled: boolean) => {
    setBusy(true);
    setError(null);
    action()
      .then(() => setClaudeStatuslineWrapperEnabled(nextEnabled))
      .then(refresh)
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <div
      className="flex shrink-0 flex-col gap-1.5 border-b border-zinc-800 px-3 py-1.5 text-[10px] text-zinc-400"
      title="Shared across this Claude.ai account, including activity outside this project."
    >
      <div className="flex items-center justify-between text-zinc-500">
        <span>Claude usage{model ? ` · ${model}` : ""}</span>
        {status?.state === "installed" && (
          <button
            type="button"
            className="text-zinc-600 hover:text-zinc-300 disabled:opacity-40"
            disabled={busy}
            onClick={() => run(claudeStatuslineRemove, false)}
          >
            disable
          </button>
        )}
      </div>

      {state === "wrapper-not-installed" && status?.state === "foreign" && (
        <div className="flex flex-col gap-1 rounded border border-sky-900/50 bg-sky-950/20 p-1.5 text-sky-200">
          <span>
            Found your statusLine command: <span className="font-mono">{status.detected_command}</span>
          </span>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            Wrap it to show usage here (original preserved, restorable)
          </label>
          <button
            type="button"
            className="self-start rounded bg-sky-900/40 px-2 py-0.5 text-sky-100 disabled:opacity-40"
            disabled={!confirmed || busy}
            onClick={() => run(claudeStatuslineSetup, true)}
          >
            {busy ? "enabling…" : "Enable Claude usage meter"}
          </button>
        </div>
      )}
      {state === "wrapper-not-installed" && status?.state !== "foreign" && (
        <span className="text-zinc-600">No status line configured — nothing to connect.</span>
      )}
      {state === "unavailable-old-cli" && (
        <span className="text-zinc-600">Claude Code CLI is older than v2.1.251 — usage isn't reported.</span>
      )}
      {state === "wrapper-installed-loading" && (
        <span className="text-zinc-600">Waiting for the session's first response…</span>
      )}
      {state === "unavailable-ineligible" && (
        <span className="text-zinc-600">Usage isn't reported for this account.</span>
      )}
      {(state === "available" || state === "stale") && rateLimits && (
        <>
          {state === "stale" && <span className="text-amber-400">last update may be stale</span>}
          <Bar label="Claude · 5h" window={rateLimits.five_hour} />
          <Bar label="Claude · weekly" window={rateLimits.seven_day} />
          {rateLimits.spend_limit && <Bar label="Claude · spend limit" window={rateLimits.spend_limit} />}
        </>
      )}
      {error && <span className="text-red-400">{error}</span>}
    </div>
  );
}
