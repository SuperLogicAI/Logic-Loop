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
    if ((tool === "Edit" || tool === "Write" || tool === "NotebookEdit") && typeof input.file_path === "string") {
      files.add(input.file_path);
    }
    if (tool === "Bash") {
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
