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
    if (r.type !== "hook:PostToolUse") continue;
    const p = parsePayload(r);
    if (!p) continue;
    const tool = p["tool_name"];
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
