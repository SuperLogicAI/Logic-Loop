// Since-you-left digest (Phase 14a). Pure reducer over `repo.eventsSince`
// rows + `repo.decisionsOpenedSince` rows — deterministic only, no LLM.
import { textFromTranscriptLine } from "./decisions";

export interface EventRow {
  id: number;
  ts: number;
  type: string; // 'hook:PostToolUse' | 'hook:Stop' | 'transcript' | ...
  payload_json: string;
}

export interface DeltaDecision {
  id: number;
  question: string;
  ts: number;
}

export interface Delta {
  files: string[];
  bashRuns: number;
  bashErrors: number;
  turns: number;
  stops: number;
  decisions: DeltaDecision[];
  lastWords: string;
}

function parsePayload(r: EventRow): Record<string, unknown> | null {
  try {
    return JSON.parse(r.payload_json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Newest assistant transcript line with real text among the rows — a final
 * message that's tool_use-only yields no text and is skipped in favor of the
 * previous one. */
export function lastAssistantText(rows: EventRow[]): string {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].type !== "transcript") continue;
    const msg = textFromTranscriptLine(rows[i].payload_json);
    if (msg && msg.role === "assistant") return msg.text.slice(0, 400);
  }
  return "";
}

export function summarizeDelta(rows: EventRow[], decisionsSince: DeltaDecision[]): Delta {
  const files = new Set<string>();
  let bashRuns = 0;
  let bashErrors = 0;
  let turns = 0;
  let stops = 0;
  for (const r of rows) {
    if (r.type === "hook:UserPromptSubmit") turns++;
    if (r.type === "hook:Stop") stops++;
    // Claude Code reports a failed tool as PostToolUseFailure, not PostToolUse
    // with is_error (Plan 058 live check) — count it as a failed run, same
    // interrupt rule as detectors.ts.
    const failure = r.type === "hook:PostToolUseFailure";
    if (r.type !== "hook:PostToolUse" && !failure) continue;
    const p = parsePayload(r);
    if (!p) continue;
    const tool = p["tool_name"];
    if (failure) {
      if (tool === "Bash" || tool === "run_command") {
        bashRuns++;
        if (p["is_interrupt"] !== true) bashErrors++;
      }
      continue; // a failed edit changed nothing
    }
    const input = (p["tool_input"] ?? {}) as Record<string, unknown>;
    // write_to_file/replace_file_content are Antigravity's own edit tools
    // (Phase 16) — file_path is normalized onto tool_input in antigravity.rs.
    if (
      (tool === "Edit" || tool === "Write" || tool === "NotebookEdit" || tool === "write_to_file" || tool === "replace_file_content") &&
      typeof input.file_path === "string"
    ) {
      files.add(input.file_path);
    }
    // run_command is Antigravity's shell-command tool; bashRuns/bashErrors is
    // a shorthand for "shell-like command count" across adapters, not a
    // literal Bash-only field.
    if (tool === "Bash" || tool === "run_command") {
      bashRuns++;
      const resp = p["tool_response"];
      if (typeof resp === "object" && resp !== null && (resp as Record<string, unknown>)["is_error"] === true) {
        bashErrors++;
      }
    }
  }
  return {
    files: [...files],
    bashRuns,
    bashErrors,
    turns,
    stops,
    decisions: decisionsSince,
    lastWords: lastAssistantText(rows),
  };
}

/** Plan 050 Part C: same "anything to show" test the sidebar section uses. */
export function hasDelta(d: Delta): boolean {
  return d.files.length > 0 || d.bashRuns > 0 || d.turns > 0 || d.stops > 0 || d.decisions.length > 0 || d.lastWords !== "";
}

/** One-line deterministic summary for a dashboard card row. */
export function describeDelta(d: Delta): string {
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const parts: string[] = [];
  if (d.files.length > 0) parts.push(plural(d.files.length, "file"));
  if (d.turns > 0) parts.push(plural(d.turns, "turn"));
  if (d.decisions.length > 0) parts.push(plural(d.decisions.length, "new decision"));
  if (d.bashErrors > 0) parts.push(plural(d.bashErrors, "failed command"));
  return parts.length > 0 ? parts.join(" · ") : "Agent activity";
}

// --- Re-entry brief (Plan 058): the since-you-left card as four fields. ---

export interface BriefInput {
  delta: Delta;
  loopIterations: number | null; // Phase 15 loop run, else null
  project: string;
  agent: string;
  branch: string;
  dirty: boolean;
  goal: string | null; // board Now card title — an explicit human pick only
  landing: string | null; // open landing note body
  agentWaiting: boolean;
  next: string | null; // momentum text
}

export interface Brief {
  context: string;
  goal: string | null;
  youLeft: string | null;
  changed: string | null;
  needsYou: string | null;
  next: string | null;
}

/** Deterministic, no prose generation. Null when there's nothing to come
 * back to: no agent activity, no landing note, nothing waiting on you. */
export function buildBrief(input: BriefInput): Brief | null {
  const { delta } = input;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

  let changed: string | null = null;
  if (input.loopIterations != null) {
    changed = `${plural(input.loopIterations, "iteration")} while away`;
  } else {
    const parts: string[] = [];
    if (delta.files.length > 0) parts.push(plural(delta.files.length, "file"));
    if (delta.bashRuns > 0) {
      parts.push(plural(delta.bashRuns, "command") + (delta.bashErrors > 0 ? ` (${delta.bashErrors} failed)` : ""));
    }
    if (delta.turns > 0) parts.push(plural(delta.turns, "turn"));
    changed = parts.length > 0 ? parts.join(" · ") : delta.lastWords ? "agent replied" : null;
  }

  const needs: string[] = [];
  if (delta.decisions.length > 0) needs.push(plural(delta.decisions.length, "new decision"));
  if (input.agentWaiting) needs.push("agent waiting");
  const needsYou = needs.length > 0 ? needs.join(" · ") : null;

  const youLeft = input.landing?.trim() || null;
  if (!changed && !needsYou && !youLeft) return null;

  const branch = input.branch ? ` · ${input.branch}${input.dirty ? " ●" : ""}` : "";
  const goal = input.goal?.trim() || null;
  return {
    context: `${input.project} · ${input.agent}${branch}`,
    goal,
    youLeft,
    changed,
    needsYou,
    // The Next cascade starts at the landing note, then the Now card — both
    // already shown above, so don't say them twice.
    next: input.next && input.next !== youLeft && input.next !== goal ? input.next : null,
  };
}
