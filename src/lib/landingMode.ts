import type { LandingNoteMode } from "../types";

export type LandingDepartureAction = "none" | "consume" | "prompt";

/** Invalid or absent persisted values preserve the pre-Phase-28 Auto default. */
export function parseLandingNoteMode(value: string | null | undefined): LandingNoteMode {
  return value === "manual" ? "manual" : "auto";
}

/** Pure departure policy. Manual consumes eligible activity so re-enabling
 * Auto cannot surface a stale prompt for work that was already left. */
export function landingDepartureAction(args: {
  mode: LandingNoteMode;
  activity?: number;
  lastPrompt?: number;
  now: number;
  modalOpen: boolean;
}): LandingDepartureAction {
  const lastPrompt = args.lastPrompt ?? 0;
  if (!args.activity || args.activity <= lastPrompt) return "none";
  if (args.mode === "manual") return "consume";
  if (args.modalOpen || args.now - lastPrompt < 10 * 60 * 1000) return "none";
  return "prompt";
}
