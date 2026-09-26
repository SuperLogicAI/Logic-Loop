export type AdapterId = "claude" | "codex" | "opencode" | "antigravity" | "pi" | "deepseek";

export interface AdapterMetadata {
  id: AdapterId;
  label: string;
  command: string;
  installUrl?: string;
  configLocation: string;
  capabilities: {
    activity: true;
    decisions: boolean;
    reentry: boolean;
  };
}

export type AdapterOperation = "checking" | "enabling" | "disabling" | null;

export interface AdapterRuntimeState {
  available: boolean | null;
  enabled: boolean | null;
  operation: AdapterOperation;
  error: string | null;
}

export type AdapterProgress =
  | "checking"
  | "not-detected"
  | "not-enabled"
  | "enabling"
  | "disabling"
  | "waiting"
  | "connected"
  | "error";

export const ONBOARDING_VERSION = 3;

export function parseOnboardingVersion(value: string | null): number {
  if (value === null || !/^\d+$/.test(value)) return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

export const ADAPTERS: readonly AdapterMetadata[] = [
  {
    id: "claude",
    label: "Claude Code",
    command: "claude",
    installUrl: "https://claude.com/claude-code",
    configLocation: "~/.claude/settings.json",
    capabilities: { activity: true, decisions: true, reentry: true },
  },
  {
    id: "codex",
    label: "Codex",
    command: "codex --no-daemon",
    installUrl: "https://openai.com/codex/",
    configLocation: "~/.codex/hooks.json",
    capabilities: { activity: true, decisions: true, reentry: true },
  },
  {
    id: "opencode",
    label: "OpenCode",
    command: "opencode",
    installUrl: "https://opencode.ai/",
    configLocation: "global OpenCode plugin",
    // decisions: live-verified 2026-09-22 (Plan 038 Part 1, v3+v4) — both
    // a plain-text question and OpenCode's built-in `question` tool
    // correctly produced a Decisions card. reentry: live-verified
    // 2026-09-22 (Plan 038 Part 2) — quit/relaunch/Re-enter passed twice
    // back to back with a real TUI resume. A ghost tab re-entering a
    // process that started before a plugin version bump keeps running
    // that process's already-loaded (stale) plugin code — a fresh tab is
    // needed to pick up a new version, same as any other Node plugin.
    capabilities: { activity: true, decisions: true, reentry: true },
  },
  {
    id: "antigravity",
    label: "Antigravity",
    command: "agy",
    installUrl: "https://antigravity.google/product/antigravity-cli/",
    configLocation: "~/.gemini/config/hooks.json",
    capabilities: { activity: true, decisions: true, reentry: true },
  },
  {
    id: "pi",
    label: "Pi Agent",
    command: "pi",
    installUrl: "https://pi.dev",
    configLocation: "~/.pi/agent/extensions/logic-loop.ts",
    // Re-entry passed live in Plan 026. Decision extraction uses finalized
    // visible message_end text from Pi's in-process extension (Plan 039),
    // never PTY bytes or Pi's session files.
    capabilities: { activity: true, decisions: true, reentry: true },
  },
  {
    id: "deepseek",
    label: "DeepSeek Harness",
    command: "dsh --profile logic-loop",
    installUrl: "https://www.npmjs.com/package/@deepseek-ai/dsh",
    configLocation: "~/.dsh/profiles/logic-loop (dsh-terminal-app plugin)",
    // No shipped first-party or safely-adoptable third-party terminal UI
    // exists upstream (plans/027) — this is Logic Loop's own first-party
    // profile patch (plans/028), not an install of anything DeepSeek ships.
    // Decision extraction uses only finalized, appended assistant messages
    // from the in-memory Harness session plus the exact submitted user line.
    // reentry is true — cross-process `--resume <sessionId>` proven live.
    capabilities: { activity: true, decisions: true, reentry: true },
  },
] as const;

export function adapterIdForHook(agent: string | undefined): AdapterId | null {
  if (agent === undefined) return "claude";
  return agent === "codex" ||
    agent === "opencode" ||
    agent === "antigravity" ||
    agent === "pi" ||
    agent === "deepseek"
    ? agent
    : null;
}

/** Single source of truth for "does this agent support decision
 * extraction" — used by SidePanel's empty-state messaging so a future
 * adapter's capabilities flip doesn't also require remembering to update a
 * second, hardcoded check elsewhere (the exact staleness this file's
 * ADAPTERS array and that duplicate check drifted into, 2026-09-22). An
 * unrecognized/future agent string defaults to unsupported rather than
 * guessing. */
export function adapterSupportsDecisions(agent: string | undefined): boolean {
  const id = adapterIdForHook(agent);
  if (id === null) return false;
  return ADAPTERS.find((a) => a.id === id)?.capabilities.decisions ?? false;
}

export function adapterProgress(state: AdapterRuntimeState, observed: boolean): AdapterProgress {
  if (state.error) return "error";
  if (state.operation === "checking" || state.available === null) return "checking";
  if (!state.available) return "not-detected";
  if (state.operation === "enabling") return "enabling";
  if (state.operation === "disabling") return "disabling";
  if (!state.enabled) return "not-enabled";
  return observed ? "connected" : "waiting";
}

export function formatAdapterError(error: unknown): string {
  let message: string;
  if (error instanceof Error) message = error.message;
  else if (typeof error === "string") message = error;
  else {
    try {
      message = JSON.stringify(error) ?? String(error);
    } catch {
      message = String(error);
    }
  }
  const normalized = message.trim() || "Unknown setup error";
  return normalized.slice(0, 400);
}
