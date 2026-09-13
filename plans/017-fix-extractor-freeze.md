# Plan 017 — Fix the decision-extractor app freeze

## Phase gate

Not a new numbered phase — a P0 bug fix for the freeze landmine documented in
CLAUDE.md ("Extractor calls can freeze the whole app for ~20-30s — not
root-caused, not fixed"), open since Phase 33.1's first live
Claude-CLI-backed UI pass (2026-09-12) and still present after Plan 016's
descope of automatic reconciliation (confirmed during that plan's own
`docs/TESTING.md` §48 live pass). Two prior fix attempts (Plan 015,
2026-09-12) were independently correct engineering and both failed to
resolve the user-visible symptom — see "What's known" below. Per that
plan's own retrospective, a third blind guess is not warranted.

**Gate:** awaiting explicit maintainer go-ahead in chat before
implementation begins — write `PLAN 017 ACCEPTED` when ready. This doc is
the spec for that approval, not authorization to start building. Given the
history of two failed attempts already shipped and kept, this plan
deliberately front-loads a mandatory diagnostic step (below) instead of
proposing a fix up front — there isn't yet a fix to propose that isn't
another guess.

## What's known (Plan 015, not re-derived here)

- **Symptom.** A real macOS beachball — not a CSS spinner, mouse control
  lost app-wide including *other* project tabs — lasting ~20-30s, matching
  the extractor CLI's real wall-clock latency closely. Triggered by any
  action that can spawn `run_extractor`: a card appearing, Answer-Now, a
  natural-language reply, even a manual dismiss.
- **Kept, real fixes, neither resolved the freeze alone:**
  - `run_extractor` (`src-tauri/src/extractor.rs`) went from a plain `pub
    fn` to `pub async fn` — no measurable change on its own.
  - Restructured to dispatch the whole synchronous body via
    `tauri::async_runtime::spawn_blocking` rather than a bare `async fn`
    (which only moves work onto a tokio *cooperative* worker, still
    starved by `wait_with_timeout`'s `std::thread::sleep` busy-poll).
    Verified correct against Tauri's own documented anti-pattern warning.
    **Retested live: first call clean (~10s, fully responsive). Second
    call, identical code path, froze ~30s** — the finding that rules out a
    purely deterministic Rust-dispatch theory. Kept anyway as a genuine
    improvement.
- **Falsifying fact, with a caveat.** Answer-Now's own code path
  (`matchAnswerNowReply`) never calls `run_extractor` — yet it froze
  identically. This doesn't prove zero extractor calls happened in that
  window: Phase 3's own `enqueue()` extraction (`src/lib/decisions.ts`)
  fires independently on nearly every assistant turn containing `?` or
  "assum", and Answer-Now is typically clicked right after such a turn.
  Plan 015's conclusion: the freeze most likely lives in this Phase-3-era
  extraction call, predating Phase 33 entirely — Phase 33 only added a
  second, higher-frequency trigger (reconciliation) on top of it.
- Plan 016 removed that second trigger (guessed reconciliation). This
  reduces how often the freeze fires but does not fix it — extraction
  stays, and the landmine stayed open through Plan 016's own live test.

## New research this pass

- **`SidePanel.tsx`'s `reload()`** — fired on every `refreshKey` bump,
  which itself fires after nearly every ingested event via
  `scheduleAttentionRefresh` (`App.tsx`) — awaits five Tauri commands
  beyond the `tauri-plugin-sql`-backed repo queries: `git_log`,
  `git_current_branch` (`pty.rs:385`), `git_has_changes` (`pty.rs:403`),
  `git_untracked_files` (`pty.rs:437`), and `read_board` (`board.rs:18`).
  **All five are synchronous `pub fn` commands, none `async`.** Per Tauri
  v2's command-dispatch model (confirmed via context7 in Plan 015), a sync
  command handler runs on the app's main thread — the same thread macOS's
  window server watches for responsiveness. Four of the five shell out to
  `git` as a blocking subprocess. Individually fast (tens of ms) under
  normal conditions. **Not proven to be the cause** — flagged as an audit
  target for the diagnostic step below, not assumed.
- **Ruled out: dual-connection SQLite lock contention.** `ingest.rs`'s
  local HTTP server never touches SQLite directly — it only re-emits hook
  payloads as Tauri events (`app.emit("ingest://hook", ...)`); the sole DB
  writer is the JS side via `tauri-plugin-sql`. One writer path, so a
  Rust/JS dual-connection lock fight isn't the mechanism.
- **Relevant precedent, not yet conclusive.** Phase 15 (2026-09-06) fixed a
  related-but-distinct symptom: unserialized concurrent `claude -p`
  extractor spawns caused visible typing/render lag from CPU contention
  (`extractorQueue.ts`'s own comment states this plainly) — fixed by
  serializing to one call at a time. That serialization is still in effect
  today and does not prevent the current freeze. Either a single spawn
  alone is enough to cause this class of stall on this machine under some
  conditions, or the freeze has an unrelated cause — this codebase has
  already confirmed once, though, that spawning this specific child
  process can visibly degrade UI responsiveness here.

## Decision: diagnose before guessing again

Two independently correct Rust-side fixes have already shipped and neither
resolved the symptom. This plan's mandatory first step is capturing a real
stack trace of the blocked thread during an actual live freeze with
macOS's own profiler — the tool built for exactly this class of bug —
before any further code changes. No fix ships in this plan without a
diagnostic sample pointing at it.

## Sequence

1. **Diagnostic capture (mandatory, blocks everything else).**
   - Reproduce live: `npm run tauri dev` against a disposable scratch repo.
     Trigger an extractor call (ask a question that gets a card).
   - The moment the beachball appears, run `sample <pid> 30 -f
     ~/freeze-sample-1.txt` (find `<pid>` via `ps aux | grep
     context-terminal` or Activity Monitor → the Logic Loop process, not
     the `claude` child). `spindump <pid> -o ~/freeze-spindump-1.txt` for a
     fuller system-wide view if `sample` proves inconclusive.
   - In parallel, capture the *child* `claude` process's state during the
     same window (`top -pid <claude_pid> -stats pid,cpu,th,state` or
     Activity Monitor): CPU-bound (doing real work) vs. idle/sleeping
     (blocked on network I/O) distinguishes "the child process itself is
     starving the machine" from "something in Logic Loop's own code is
     stuck."
   - Capture **at least two separate freeze occurrences** — Plan 015 saw
     call-to-call inconsistency (first clean, second froze on identical
     code), so one sample isn't enough to trust.
   - Check: two freeze samples in hand, each showing the actual blocked
     thread's top frames plus the child process's CPU/wait state during
     the same window. Stop here and report findings before proceeding —
     do not skip to step 2 on a hunch.

2. **Interpret the samples, then apply the one fix they point to.** Do not
   fix multiple candidates speculatively — this plan explicitly forbids
   repeating Plan 015's blind-guess pattern. Consult a candidate below only
   if the sample confirms that lead; otherwise follow what the sample
   actually shows:
   - *Main-thread-blocking sync command* (`git_log` and the four other
     `pub fn` commands `reload()` awaits) → convert to `async fn` +
     `spawn_blocking`, the same treatment `run_extractor` already got.
   - *The `claude` child process itself starving the machine* (CPU-bound
     during the stall, not idle) → lower its scheduling class at spawn
     time (macOS: `taskpolicy -c utility <cmd>`, or a `nice` equivalent),
     so it competes less aggressively with the UI-critical thread; verify
     this doesn't unacceptably extend the child's own wall-clock latency.
   - *SQLite contention inside the single JS-side connection* (many
     overlapping writes serializing badly) → check `tauri-plugin-sql`'s
     pool config; consider `PRAGMA journal_mode=WAL` regardless — cheap,
     standard practice for a one-writer/many-reader shape, low risk even
     if it turns out not to be this bug's cause.
   - *Something else the sample reveals* — the expected-likely outcome
     given two prior misses. Update this plan with the real finding before
     writing any fix.

3. **Fix.** Scope is unknown until step 2 lands — see "Scope" below for
   placeholders, to be replaced with the actual finding.

4. **Verify.** Reproduce the same trigger **10 times in a row** (not 1-2 —
   Plan 015's own inconsistency was "first call clean, second froze" on
   identical code). Zero freezes over 2s counts as fixed. Re-run whichever
   of `tsc --noEmit` / `npm run check` / `cargo test` / `cargo clippy -D
   warnings` / `git diff --check` apply to the files step 3 actually
   touched.

## Scope

Cannot be fully specified before step 2's finding — this is deliberate,
not an oversight. Likely candidates, one of which will actually apply:
`src-tauri/src/pty.rs` (sync → async command conversions), `src-tauri/src/
extractor.rs` (child process scheduling priority), or `src-tauri/src/
lib.rs` / the `tauri-plugin-sql` DB init (WAL pragma). Update this section
once step 2 is done, per CLAUDE.md's "plan revisions mid-phase must be
stated explicitly, never silent."

## Risk

Medium. This is the third attempt at a bug that has resisted two prior
fixes. Diagnostic-first sequencing bounds the downside to "more
investigation time," not "a third shipped no-op." No user-facing behavior
changes happen before step 3, which is gated on real evidence from step 1.

## Explicitly out of scope

- The card-not-closing-on-clear-answer bug (Plan 015) — moot, guessed
  reconciliation is gone (Plan 016).
- The `input_tokens=800`/zero-cache log outlier (Plan 015) — unrelated,
  low priority, not chased here.
- The tab-restore-loses-a-tab bug — separate, untouched landmine.

## Addendum: unintended `~/.git` and the `has_own_repo` guard (2026-09-12)

Live verification after the fix surfaced a second, related issue: `dt-scratch`
(the test project) has no `.git` of its own, and an unintended `~/.git`
existed (created 2026-09-11, empty, no commits, no remote — confirmed not
created by this codebase, `git init` appears nowhere in it). `git -C
<dt-scratch> ...` therefore silently walked up and resolved `$HOME` as the
repo root (`git rev-parse --show-toplevel` → `/Users/vandershark`). This
almost certainly explains why the original freeze was ~31s specifically:
`git_untracked_files`'s `--untracked-files=all` was enumerating every
untracked file under the entire home directory, not just `dt-scratch`.

Fixed: `pty::has_own_repo(cwd)` (mirrors `project_key`'s existing walk/`$HOME`
boundary, bool instead of a key string) gates all 15 git-shelling `_blocking`
functions — each refuses with its existing "not a repo" fallback before
spawning `git` at all when no `.git` exists between `cwd` and `$HOME`. A
stray home-directory repo, intended or not, can no longer make any git panel
action operate outside a tab's own project tree. Regression test:
`has_own_repo_refuses_a_home_directory_git_it_did_not_create` (`pty.rs`).

Separately, live testing surfaced two unrelated findings, neither caused by
this plan's changes, both out of scope here:
- Claude Code CLI stopped writing transcript `.jsonl` files for new sessions
  in `dt-scratch` starting ~9:31am on 2026-09-12 (confirmed via directory
  mtime — no new file entries since, across 3 separate test sessions that
  otherwise ran normally per their `Stop` hook payloads). This is a Claude
  Code CLI/environment issue, not Logic Loop code — decisions extraction
  reads transcripts, not hook payloads, so no transcript file means no card
  regardless of anything in this plan. Not root-caused.
- The `extractor: claude usage` log occasionally shows
  `cache_creation_input_tokens` in the ~25-27k range instead of the expected
  ~1.4k (Phase 33.1 baseline) during this same live session. Not chased —
  noted for whoever looks at extractor spend next.

## Verification

- [ ] Two live freeze samples captured and reviewed (step 1) — attach
      findings to this plan before step 2.
- [ ] Fix applied matches what the sample showed, not a guess.
- [ ] 10-repeat live retest, zero freezes over 2s.
- [ ] Automated gates for whatever step 3 touches: `npx tsc --noEmit`,
      `npm run check`, `npm run golden` (only if extraction prompts move),
      `cd src-tauri && cargo test`, `cargo clippy --all-targets -- -D
      warnings`, `git diff --check`.
- [ ] `docs/TESTING.md` — new manual section for this plan's repro + fix
      confirmation.
- [ ] CLAUDE.md landmine entry rewritten from "not root-caused, not fixed"
      to the actual finding and fix, matching how the Phase 33 landmine
      above it was rewritten once Phase 33.1 got a measured answer.
