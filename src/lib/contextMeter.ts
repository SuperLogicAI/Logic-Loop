// Plan 054: live context-window usage for the active Claude / Codex tab.
// Pure parsers over untrusted agent data: read numeric fields only.

export interface ContextUsage {
  percent: number;
  usedTokens: number | null;
  windowTokens: number | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** Claude statusLine `context_window`. `used_percentage` is input-only, same
 * as `/context`. Null `current_usage` (before the first response, or right
 * after `/compact`) hides the meter. */
export function claudeContext(contextWindow: unknown): ContextUsage | null {
  const cw = obj(contextWindow);
  const usage = obj(cw?.["current_usage"]);
  if (!cw || !usage) return null;
  const percent = num(cw["used_percentage"]);
  if (percent === null || percent < 0) return null;
  const windowTokens = num(cw["context_window_size"]);
  const parts = ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"].map((k) => num(usage[k]));
  const usedTokens = parts.every((p) => p !== null) ? parts.reduce((a, b) => a! + b!, 0) : null;
  return { percent, usedTokens, windowTokens: windowTokens !== null && windowTokens > 0 ? windowTokens : null };
}

/** Codex rollout line: `event_msg` / `token_count` with
 * `info.last_token_usage.total_tokens` over `info.model_context_window`. */
export function codexContext(line: string): ContextUsage | null {
  if (!line.includes('"token_count"')) return null; // cheap skip for every other rollout line
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return null;
  }
  const r = obj(record);
  const payload = obj(r?.["payload"]);
  if (r?.["type"] !== "event_msg" || payload?.["type"] !== "token_count") return null;
  const info = obj(payload["info"]);
  const used = num(obj(info?.["last_token_usage"])?.["total_tokens"]);
  const windowTokens = num(info?.["model_context_window"]);
  if (used === null || used < 0 || windowTokens === null || windowTokens <= 0) return null;
  return { percent: (used / windowTokens) * 100, usedTokens: used, windowTokens };
}

/** Bar fill only; the displayed number is never clamped. */
export function contextFill(percent: number): number {
  return Math.max(0, Math.min(100, percent));
}

export function formatTokens(n: number): string {
  return n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`;
}
