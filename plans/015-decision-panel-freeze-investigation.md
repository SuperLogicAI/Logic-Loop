# Plan 015 — Decision panel freeze investigation (outcomes)

## Phase gate

Not a build plan — a closing write-up for `feat/phase33.1-haiku-default`
before moving to a new branch. Live-tested 2026-09-12, the first real
Claude-CLI-backed UI pass since Phase 33.1's rebuild. No implementation in
this plan; see Plan 016 for what actually gets built next.

## What was confirmed working

Phase 33.1's token-spend fix and the haiku-reconciliation-default sidequest
both hold under live use. Real `extractor: claude usage` log lines during
testing landed in the 1.1-2k token range (one unexplained outlier at
`input_tokens=800`, zero cache — not investigated, low priority), matching
the ~1.1-1.4k figures measured in Plan 013/014. Not the problem here.

## The bug: app-wide freeze on extractor-triggered actions

Every action that could trigger `run_extractor` — a card appearing, "Answer
now", a natural-language reply, even a manual card dismiss — produced a real
macOS beachball (not a CSS spinner; mouse control over the whole app,
including *other* project tabs, was lost) for ~20-30s per call, matching the
CLI's real wall-clock latency almost exactly.

### Attempt 1: `pub fn` → `pub async fn`

Hypothesis: `run_extractor` was a sync Tauri command. Per Tauri v2 docs
(confirmed live via context7/tauri-apps/tauri-docs, "Async Commands"): a
non-async command runs on the **main thread**; the codebase's existing
comment ("Tauri runs commands off the main thread") assumed Tauri v1's
opposite default. Marked it `async fn`. Verified clean (`cargo check`,
clippy, `cargo test` 60/60). **Retested live: no measurable change.**

### Attempt 2: `spawn_blocking`

Refined hypothesis: `async fn` alone only moves the call onto a tokio
*cooperative* worker thread. `wait_with_timeout`'s `std::thread::sleep(50ms)`
busy-poll loop then occupies that worker synchronously for the CLI's full
duration with no `.await` yield — exactly the anti-pattern Tauri's own docs
warn about ("if you sleep the thread instead of the Tokio task you'll be
locking all tasks scheduled to run on that thread... causing your app to
freeze"). Restructured `run_extractor` into a thin async wrapper dispatching
the entire synchronous body (`run_extractor_blocking`) via
`tauri::async_runtime::spawn_blocking`, which runs on tokio's separate
blocking-thread pool, never the cooperative one. Verified clean. Ruled out a
stale-binary artifact both times via binary/source mtime + running-process
start-time checks (`stat`, `ps`) — the live process genuinely postdated each
rebuild.

**Retested live: first call clean (~10s, fully responsive). Second call,
same code path, froze ~30s — same signature as before the fix.** This is the
finding that matters: identical code shouldn't behave differently
call-to-call if the bug were purely about which thread executes it.
`spawn_blocking` is being kept (it's a real, docs-confirmed improvement over
the original anti-pattern) but is not, by itself, sufficient — something
else is also involved.

### The freeze predates Phase 33

Re-reading `src/lib/decisions.ts`'s `onTranscript`/`reconcile()`: Answer-Now's
close is a deterministic string match (`matchAnswerNowReply`) — it returns
before ever calling `run_extractor`. Yet Answer-Now froze identically to
every other path during live testing. That rules out reconciliation's LLM
call as the (sole) cause. The remaining candidate is `enqueue()`'s plain
extraction call — the Phase 3 (2026-07-11) mechanism, unchanged since before
Phase 33 existed, gated only by a cheap regex prefilter
(`/\?|assum/i.test(pair.assistant)`) with no reconciliation-specific logic
in the way. Every test scenario that involved the assistant asking a
question (nearly all of them) would trigger this path regardless of what
happens to reconciliation.

**Conclusion: the freeze is a Phase-3-era bug in the extraction call path,
not something Phase 33 introduced.** Phase 33 made it worse by adding a
second, higher-frequency trigger (reconciliation, on every user message)
on top of an already-present bug — but removing reconciliation only reduces
frequency, it does not fix the underlying issue.

A card also failed to close on an unambiguous natural-language answer
("20" → "20 or 200?") during this pass — separate from the freeze,
undiagnosed; plausibly `shouldSkipReconciliation`'s short-reply heuristic
treating a 2-character reply as bare/ambiguous. Not chased further this
session; low priority now that reconciliation is being descoped (Plan 016).

## Also this session: an unrelated process incident

A `Plan`-type subagent (model override `fable`) dispatched to investigate
this freeze and draft a fix plan ran for 35 minutes and an estimated ~300k
tokens before being killed — its own transcript showed it had only reached
"I'll start by reading the key files..." Diagnosis above was done directly
instead, in a fraction of the time/cost. Filed as product feedback
separately; not a code change. Lesson for future sessions: don't delegate
an investigation to a fresh subagent when the coordinator already holds
full context and the task doesn't obviously need a separate context window.

## Decision

Two independent tracks, not one:

1. **Descope automatic reconciliation** (Plan 016) — the LLM-guessed
   natural-language card-closing path. Not load-bearing: manual dismiss and
   Answer-Now already close cards deterministically at zero latency/cost,
   notifications + the Attention Inbox already surface open decisions
   (and the inbox already discounts stale sessions), and this path is the
   source of both the duplicate-card artifact (already a known landmine)
   and the card-not-closing bug found this session. Worth doing regardless
   of the freeze bug's status.
2. **The freeze itself** — still open, still lives in Phase 3's extraction
   call, still needed even after (1) ships, since extraction stays. Not
   scoped or scheduled here; whoever picks it up should start from "Answer
   Now froze with zero `run_extractor` calls" as the key falsifying fact
   against a pure Rust-dispatch theory, and look at what else runs
   unconditionally on every reply (`SidePanel.tsx`'s `reload()` — notably
   its `git_log` invoke, which is *still* a sync command per the same
   Tauri v2 main-thread rule — and `scheduleAttentionRefresh`) before
   re-deriving the thread-dispatch path this plan already covered.

## Changes kept on this branch

- `src-tauri/src/extractor.rs` — `run_extractor` split into an async
  `spawn_blocking` wrapper plus a `run_extractor_blocking` helper carrying
  the original synchronous body, unchanged otherwise. Legitimate fix for a
  real anti-pattern; kept even though it didn't resolve the user-visible
  freeze on its own.

## Not done

- Freeze not root-caused. No fix landed for it.
- Card-not-closing-on-clear-answer bug not investigated.
- The `input_tokens=800`/zero-cache log outlier not explained.
