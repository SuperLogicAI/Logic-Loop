// Shared serialization for extractor subprocess calls. `decisions.ts` and
// `landing.ts` each spawn a `claude -p` child (extractor.rs) — unserialized,
// a tab switch mid-decision-extraction could stack two concurrent LLM
// processes on top of whatever the foreground tab's agent is already doing,
// felt as real typing/render lag (CPU contention, not an IPC block).
let queue: Promise<unknown> = Promise.resolve();

/** Runs `fn` only after every previously queued call has settled (success or
 * failure); a rejection never breaks the chain for calls queued after it. */
export function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}
