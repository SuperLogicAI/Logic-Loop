// Plan 068: one-time cleanup of stored transcript lines no reader can use.
// New lines are already filtered at write time, so this only ever runs once.
import { textFromTranscriptLine } from "./decisions";

export const NUDGE_MIN_BYTES = 5 * 1024 ** 3;
export const NUDGE_SNOOZE_MS = 30 * 86_400_000;
const PAGE_SIZE = 200;
const KEY_CUTOFF_MS = 60_000;

export interface CompactionStore {
  transcriptPage(afterId: number, limit: number): Promise<{ id: number; payload_json: string }[]>;
  deleteTranscriptRows(ids: number[]): Promise<void>;
  clearTranscriptKeys(before: number): Promise<void>;
  databaseBytes(): Promise<number>;
  vacuumDatabase(): Promise<void>;
  markEventsCompacted(at: number): Promise<void>;
}

/** Any failure propagates and leaves finished batches done. A rerun rescans,
 * so it picks up where this one stopped. */
export async function compactEvents(
  store: CompactionStore,
  onProgress: (removed: number) => void = () => undefined,
  now = Date.now()
): Promise<{ removed: number; reclaimedBytes: number }> {
  const before = await store.databaseBytes();
  let afterId = 0;
  let removed = 0;
  for (;;) {
    const page = await store.transcriptPage(afterId, PAGE_SIZE);
    if (page.length === 0) break;
    afterId = page[page.length - 1].id;
    const unreadable = page.filter((row) => !textFromTranscriptLine(row.payload_json)).map((row) => row.id);
    if (unreadable.length > 0) await store.deleteTranscriptRows(unreadable);
    removed += unreadable.length;
    onProgress(removed);
    await new Promise((resolve) => setTimeout(resolve)); // let the UI paint
  }
  await store.clearTranscriptKeys(now - KEY_CUTOFF_MS);
  await store.vacuumDatabase();
  await store.markEventsCompacted(now);
  return { removed, reclaimedBytes: Math.max(0, before - (await store.databaseBytes())) };
}

// ponytail: gated on "never cleaned", not on what's reclaimable, because
// measuring that needs a scan of about 5 GB. A new install that reaches 5 GB
// through hook payloads gets one nudge that frees little; its first run ends it.
export function shouldNudge(s: {
  bytes: number | null;
  compactedAt: number | null;
  snoozedUntil: number | null;
  agentsWorking: boolean;
  now: number;
}): boolean {
  return (
    s.bytes !== null &&
    s.bytes >= NUDGE_MIN_BYTES &&
    s.compactedAt === null &&
    (s.snoozedUntil === null || s.now >= s.snoozedUntil) &&
    !s.agentsWorking
  );
}

export function formatBytes(bytes: number): string {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}
