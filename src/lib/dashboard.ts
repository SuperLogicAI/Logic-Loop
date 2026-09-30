// Plan 048 (Home dashboard): pure shaping only — no DB/Tauri calls here, same
// discipline as momentum.ts/delta.ts/attention.ts. Callers (repo.ts reads,
// eventually the Home/Overview components) gather rows; this module turns
// them into numbers and strings a panel can render, deterministically.
import type { AgentState } from "../types";

// --- Agent time (Plan 048 §4) ---

export interface AgentTimeObservation {
  sessionId: string;
  runId: string;
  state: AgentState;
  observedAt: number;
}

export interface ObservedAgentTime {
  totalMs: number;
  /** Earliest observation across every session, closed interval or not —
   * null only when there are no observations at all. */
  sinceDate: number | null;
  /** Sessions that contributed at least one closed interval. A session whose
   * only observation never closed (or closed with zero elapsed time) doesn't
   * count — this is "sessions the hours came from", matching the "14h 20m
   * across 6 sessions" header, not "sessions ever observed". */
  sessionCount: number;
}

/** Per session+run, each `"working"` observation opens an interval closed by
 * the next observation in that same run — regardless of its state, since any
 * later observation proves the session moved on from working. An interval
 * still open when its run's observations run out is dropped, not extended to
 * "now" or to the next run: a crash must not silently bill hours the process
 * was never actually proven to be working through. A new run for the same
 * session (relaunch, resumed) never closes a previous run's trailing open
 * interval either — see Plan 048 §4. */
export function observedAgentTime(observations: readonly AgentTimeObservation[]): ObservedAgentTime {
  if (observations.length === 0) return { totalMs: 0, sinceDate: null, sessionCount: 0 };

  const groups = new Map<string, AgentTimeObservation[]>();
  for (const o of observations) {
    const key = `${o.sessionId}\u0000${o.runId}`;
    const list = groups.get(key);
    if (list) list.push(o);
    else groups.set(key, [o]);
  }

  let totalMs = 0;
  let sinceDate = Infinity;
  const sessionsWithClosedInterval = new Set<string>();

  for (const group of groups.values()) {
    group.sort((a, b) => a.observedAt - b.observedAt);
    sinceDate = Math.min(sinceDate, group[0].observedAt);
    for (let i = 0; i < group.length - 1; i++) {
      const cur = group[i];
      if (cur.state !== "working") continue;
      const next = group[i + 1];
      const elapsed = next.observedAt - cur.observedAt;
      if (elapsed <= 0) continue; // out-of-order/duplicate timestamps contribute nothing
      totalMs += elapsed;
      sessionsWithClosedInterval.add(cur.sessionId);
    }
    // group[group.length - 1]: if "working", it's the open-at-run-end
    // interval this function deliberately drops.
  }

  return {
    totalMs,
    sinceDate: Number.isFinite(sinceDate) ? sinceDate : null,
    sessionCount: sessionsWithClosedInterval.size,
  };
}

// --- Copy update (Plan 048 §3 "Copy update") ---

export interface UpdateMarkdownDecision {
  question: string;
  assumption: string | null;
}

export interface UpdateMarkdownInput {
  projectName: string;
  /** Already formatted, e.g. "Sep 22–29" — this module does no date math. */
  rangeLabel: string;
  /** Already-curated, human-readable progress notes — never raw tool_input
   * (file paths, shell commands) or a transcript body. Each entry is
   * truncated to its first line as a defense-in-depth backstop, not as the
   * primary guarantee: the caller owns picking prose-safe sources (an
   * agent-reported note, not a tool event) in the first place. */
  progressLines: readonly string[];
  commitSubjects: readonly string[];
  decisionsNeeded: readonly UpdateMarkdownDecision[];
  blockerLines: readonly string[];
  nextStep: string | null;
}

function oneLine(text: string): string {
  return text.split("\n")[0]!.trim();
}

function bulletsOrNoneRecorded(lines: readonly string[]): string[] {
  return lines.length > 0 ? lines.map((l) => `- ${oneLine(l)}`) : ["- none recorded"];
}

/** Deterministic Markdown for the Copy update modal — no model call, ever.
 * Empty sections say "none recorded" rather than being omitted, so the
 * reader never mistakes "nothing tracked" for "everything's fine" (Plan 048
 * §3: "never imply health"). The draft is meant to be read and edited before
 * Copy, not sent anywhere by this function. */
export function buildUpdateMarkdown(input: UpdateMarkdownInput): string {
  const progress = [...input.progressLines];
  if (input.commitSubjects.length > 0) {
    const n = input.commitSubjects.length;
    progress.push(`${n} local commit${n === 1 ? "" : "s"}: ${input.commitSubjects.map(oneLine).join("; ")}`);
  }

  const lines: string[] = [];
  lines.push(`## ${input.projectName} — update (${input.rangeLabel})`);
  lines.push("**Progress**");
  lines.push(...bulletsOrNoneRecorded(progress));
  lines.push("**Decisions needed**");
  lines.push(
    ...bulletsOrNoneRecorded(
      input.decisionsNeeded.map((d) =>
        d.assumption ? `${d.question} (current assumption: ${d.assumption})` : d.question
      )
    )
  );
  lines.push("**Blockers**");
  lines.push(...bulletsOrNoneRecorded(input.blockerLines));
  lines.push("**Next**");
  lines.push(...bulletsOrNoneRecorded(input.nextStep ? [input.nextStep] : []));
  return lines.join("\n");
}
