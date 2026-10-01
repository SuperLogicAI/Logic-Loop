/** Dashboard-only reads. Timeouts stop waiting, not native work; coalescing
 * prevents StrictMode/retry from duplicating an outstanding invocation. */
export type ReadState<T> =
  | { state: "loading" }
  | { state: "ready"; value: T }
  | { state: "error"; reason: "timeout" | "failed" };

export interface ReadDiagnostic {
  source: string;
  outcome: "ready" | "failed" | "timeout" | "cancelled";
  durationMs: number;
  count?: number;
}

interface Clock {
  now: () => number;
  schedule: (callback: () => void, ms: number) => () => void;
}

const systemClock: Clock = {
  now: () => Date.now(),
  schedule: (callback, ms) => {
    const timer = setTimeout(callback, ms);
    return () => clearTimeout(timer);
  },
};

/** Observe one source independently. Never exposes raw errors/content in
 * diagnostics. Disposing suppresses every subsequent state update. */
export function observeDashboardRead<T>(
  source: string,
  promise: Promise<T>,
  publish: (state: ReadState<T>) => void,
  diagnostic: (event: ReadDiagnostic) => void,
  clock: Clock = systemClock,
  timeoutMs = 10_000,
): () => void {
  let active = true;
  const start = clock.now();
  const report = (outcome: ReadDiagnostic["outcome"], value?: T) => diagnostic({
    source, outcome, durationMs: clock.now() - start,
    ...(Array.isArray(value) ? { count: value.length } : {}),
  });
  const cancelTimer = clock.schedule(() => {
    if (!active) return;
    active = false;
    report("timeout");
    publish({ state: "error", reason: "timeout" });
  }, timeoutMs);
  void promise.then((value) => {
    if (!active) return;
    active = false;
    cancelTimer();
    report("ready", value);
    publish({ state: "ready", value });
  }, () => {
    if (!active) return;
    active = false;
    cancelTimer();
    report("failed");
    publish({ state: "error", reason: "failed" });
  });
  return () => {
    cancelTimer();
    if (active) report("cancelled");
    active = false;
  };
}

interface CachedRead {
  promise: Promise<unknown>;
  settledAt: number | null;
}

export class DashboardReadCache {
  private entries = new Map<string, CachedRead>();
  constructor(private now: () => number = () => Date.now()) {}

  read<T>(key: string, load: () => Promise<T>, ttlMs = 0): Promise<T> {
    const previous = this.entries.get(key);
    if (previous && (previous.settledAt === null || this.now() - previous.settledAt < ttlMs)) {
      return previous.promise as Promise<T>;
    }
    // A microtask catches synchronous throws and lets StrictMode coalesce.
    const promise = Promise.resolve().then(load);
    const entry: CachedRead = { promise, settledAt: null };
    this.entries.set(key, entry);
    void promise.then(() => {
      entry.settledAt = this.now();
      if (ttlMs === 0 && this.entries.get(key) === entry) this.entries.delete(key);
      // Opportunistically remove expired settled entries; pending native
      // reads are retained until they really finish, including after timeout.
      for (const [otherKey, other] of this.entries) {
        if (other.settledAt !== null && this.now() - other.settledAt >= 30_000) this.entries.delete(otherKey);
      }
    }, () => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    return promise;
  }
}

export const dashboardReads = new DashboardReadCache();
