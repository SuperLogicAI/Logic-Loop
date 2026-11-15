// Plan 069: what ingestion stores for a tool payload. Tool output was most of
// the database, and no reader of stored rows uses its text — they read
// tool_name, tool_input.file_path/command/description, tool_response.is_error
// and the routing fields. The live payload (detectors, tab state,
// AskUserQuestion) is read before storage and never passes through here.
// Text is cut by length only, never interpreted (invariant #5).

export const STORED_STRING_CAP = 2000;

function cap(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > STORED_STRING_CAP
      ? `${value.slice(0, STORED_STRING_CAP)} … [+${value.length - STORED_STRING_CAP} chars not stored]`
      : value;
  }
  if (Array.isArray(value)) return value.map(cap);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cap(v)]));
  }
  return value;
}

/** A failed tool's output is the useful part — kept whole. */
function failed(resp: unknown): boolean {
  if (resp === null || typeof resp !== "object") return false;
  const r = resp as Record<string, unknown>;
  const exit = (r.metadata as { exit?: unknown } | null | undefined)?.exit;
  return r.is_error === true || (typeof exit === "number" && exit !== 0);
}

/** Copy of a PostToolUse payload with long tool strings capped; anything else
 * is returned as is. Never mutates the input; any throw returns it unchanged
 * (fail open, invariant #2). Old rows are not rewritten. */
export function trimForStorage(payload: unknown): unknown {
  try {
    if (payload === null || typeof payload !== "object") return payload;
    const p = payload as Record<string, unknown>;
    if (p.hook_event_name !== "PostToolUse") return payload;
    const out: Record<string, unknown> = { ...p };
    if ("tool_input" in p) out.tool_input = cap(p.tool_input);
    if ("tool_response" in p && !failed(p.tool_response)) out.tool_response = cap(p.tool_response);
    return out;
  } catch {
    return payload;
  }
}
