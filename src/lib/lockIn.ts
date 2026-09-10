export type LockInMode = "off" | "indefinite" | "timed";

export const TIMED_LOCK_IN_MS = 60 * 60 * 1000;

export function isLockInActive(mode: LockInMode): boolean {
  return mode !== "off";
}

export function shouldExpireTimedLockIn(
  mode: LockInMode,
  currentGeneration: number,
  scheduledGeneration: number
): boolean {
  return mode === "timed" && currentGeneration === scheduledGeneration;
}

/** Lock-in hides the dock badge without changing the underlying count, so
 * unlocking can reveal the still-current state immediately. */
export function visibleDockBadgeCount(waitingCount: number, lockIn: boolean): number {
  return lockIn ? 0 : waitingCount;
}
