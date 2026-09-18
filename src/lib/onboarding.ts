export type AdapterId = "claude" | "codex" | "opencode" | "antigravity" | "pi" | "deepseek";

export interface AdapterMetadata {
  id: AdapterId;
  label: string;
  command: string;
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

export const ONBOARDING_VERSION = 2;

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
    configLocation: "~/.claude/settings.json",
    capabilities: { activity: true, decisions: true, reentry: true },
  },
  {
    id: "codex",
    label: "Codex",
    command: "codex",
    configLocation: "~/.codex/hooks.json",
    capabilities: { activity: true, decisions: true, reentry: true },
  },
  {
    id: "opencode",
    label: "OpenCode",
    command: "opencode",
    configLocation: "global OpenCode plugin",
    capabilities: { activity: true, decisions: false, reentry: false },
  },
  {
    id: "antigravity",
    label: "Antigravity",
    command: "agy",
    configLocation: "~/.gemini/config/hooks.json",
    capabilities: { activity: true, decisions: false, reentry: true },
  },
  {
    id: "pi",
    label: "Pi Agent",
    command: "pi",
    configLocation: "~/.pi/agent/extensions/logic-loop.ts",
    // reentry flips true only once Build step 4's resume_command lands and
    // its live re-entry gate passes (Plan 026) — not yet built.
    capabilities: { activity: true, decisions: false, reentry: false },
  },
  {
    id: "deepseek",
    label: "DeepSeek Harness",
    command: "dsh",
    configLocation: "~/.dsh/profiles/logic-loop (dsh-terminal-app plugin)",
    // No shipped first-party or safely-adoptable third-party terminal UI
    // exists upstream (plans/027) — this is Logic Loop's own first-party
    // profile patch (plans/028), not an install of anything DeepSeek ships.
    // decisions stays false: no extraction prompt targets this adapter.
    // reentry is true — cross-process `--resume <sessionId>` proven live.
    capabilities: { activity: true, decisions: false, reentry: true },
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
