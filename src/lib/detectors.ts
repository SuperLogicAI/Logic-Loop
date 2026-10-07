// Blocker detectors — run in the ingestion layer only. Each regex fires on
// the text `detectorTextFor` extracts from a structured hook or rollout:
// a failed shell command's output, never a successful command's stdout (just
// whatever an agent read or grepped). Matches become blocker rows deduped
// per (cwd, label) while unresolved.

export interface Detector {
  label: string;
  re: RegExp;
}

export const DETECTORS: Detector[] = [
  { label: "Permission denied", re: /permission denied|EACCES|EPERM/i },
  { label: "Tests failing", re: /\btests? (?:are )?fail(?:ing|ed)\b|\bFAILED \(|\b[1-9]\d* fail(?:ed|ures)/i },
  { label: "Merge conflict", re: /merge conflict|CONFLICT \(|Automatic merge failed/i },
  { label: "Rate limited", re: /rate.?limit(?:ed)?|429 Too Many Requests|overloaded_error/i },
  { label: "Missing file/module", re: /command not found|Cannot find module|ModuleNotFoundError/i },
  { label: "Port in use", re: /\bEADDRINUSE\b|address already in use|port (?:\d+ )?(?:is )?already in use/i },
  { label: "Disk full", re: /\bENOSPC\b|No space left on device|disk (?:is )?full/i },
  { label: "Docker daemon down", re: /Cannot connect to the Docker daemon|Is the docker daemon running|docker daemon is not running/i },
  { label: "TLS/cert error", re: /\bCERT_HAS_EXPIRED\b|certificate has expired|SSL certificate problem|self.?signed certificate|unable to verify the first certificate|x509: certificate/i },
  { label: "Lock held", re: /\bELOCKED\b|Unable to acquire lock|another process has locked|Waiting for (?:the )?(?:cache )?lock|could not get lock/i },
];

export function detectBlockers(text: string): Detector[] {
  return DETECTORS.filter((d) => d.re.test(text));
}

const SHELL_TOOLS = new Set(["Bash", "bash", "run_command"]);

/** The text detectors may scan for a structured hook or rollout, or null.
 * Failure-only (Plan 053): only a structured failure signal qualifies; no signal, no text.
 * - Claude: `PostToolUseFailure.error` (an interrupt is an abort, not a failure).
 * - OpenCode: bash `metadata.exit` is a non-zero number -> `output`.
 * - Antigravity: `{ is_error: true, error: <text> }` (tool-level errors only;
 *   an ordinary non-zero exit sends an empty error upstream).
 * - Codex: rollout CommandExecution completion, integer non-zero exit + output.
 * - Codex hook text, Pi, DeepSeek and every successful command: null. */
export function detectorTextFor(p: Record<string, unknown>): string | null {
  if (p["agent"] === "codex") {
    if (p["type"] !== "event_msg") return null;
    const event = asRecord(p["payload"]);
    if (event?.["type"] !== "item_completed") return null;
    const item = asRecord(event["item"]);
    if (item?.["type"] !== "CommandExecution") return null;
    const exit = item["exit_code"];
    return typeof exit === "number" && Number.isInteger(exit) && exit !== 0
      && typeof item["aggregated_output"] === "string" ? item["aggregated_output"] : null;
  }
  const tool = p["tool_name"];
  if (typeof tool !== "string" || !SHELL_TOOLS.has(tool)) return null;
  if (p.hook_event_name === "PostToolUseFailure") {
    const err = p["error"];
    return p["is_interrupt"] !== true && typeof err === "string" ? err : null;
  }
  if (p.hook_event_name !== "PostToolUse") return null;
  const resp = p["tool_response"];
  if (!resp || typeof resp !== "object") return null;
  const r = resp as Record<string, unknown>;
  if (r["is_error"] === true) return typeof r["error"] === "string" ? r["error"] : null;
  const exit = (r["metadata"] as { exit?: unknown } | undefined)?.exit;
  return typeof exit === "number" && exit !== 0 && typeof r["output"] === "string" ? r["output"] : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** Existing transcript route only. Adapter identity comes from the session's
 * hook context, never transcript content; malformed/other records fail open. */
export function detectorTextForTranscript(line: string, agent?: string): string | null {
  if (agent !== "codex") return null;
  try {
    const record = asRecord(JSON.parse(line));
    return record ? detectorTextFor({ ...record, agent }) : null;
  } catch {
    return null;
  }
}
