# Plan 032: Preserve context and terminal responsiveness

## Status

DONE 2026-09-19 — maintainer authorized in-session ("Let's start 032"),
same precedent as Plans 016/017/025/026/029. All three fixes implemented;
automated gates clean (`docs/TESTING.md` §60, `PLAN.md`). PTY cancellation
did not require a release-blocker fallback — an ordered off-thread writer
thread per session (`spawn_ordered_writer` in `pty.rs`) resolved it cleanly,
no portable-pty limitation hit. Live manual pass completed by the
maintainer on the `npm run tauri dev` build: paste order/responsiveness,
bounded close, LM Studio connection-refused fail-open, transcript
replacement (safe-write over an active session, no data loss), and
recovery all confirmed. A separate real bug (adapter-warning strip never
cleared) was found live during this pass and fixed the same session — see
`docs/TESTING.md` §60's addendum; its own live pass ("tested and working")
also confirmed. Not separately live-verified: the 120s deadline on a
*stalled* (not refused) LM Studio response — unit-tested only. Original
candidate framing below, preserved as written at kickoff.

## Why and what to build

A lost transcript record and a permanently blocked extraction queue both make trustworthy panels appear empty. A backpressured input writer threatens the terminal itself. Address the three bounded failure mechanisms before adding features.

## Current state and scope

- `src-tauri/src/ingest.rs:293–305`: `offset += n as u64;` occurs before checking for a full newline-terminated record. The path metadata is refreshed but the descriptor is not reopened on replacement.
- `src-tauri/src/extractor.rs:215`: `ureq::post(...).send_json(&body)...read_json()` has no configured total deadline. CLI extraction already uses wait_with_timeout: preserve it.
- `src/lib/extractorQueue.ts:10`: `const run = queue.then(fn, fn);` deliberately serializes callers and recovers on rejection, but not on a promise that never settles.
- `src-tauri/src/pty.rs:316–319`: synchronous `pty_write` gets the session lock and calls `writer.write_all`. Follow the file's existing spawn_blocking_result error-return convention, but do not simply parallelize unordered writes.

Allowed: those Rust files, `src/lib/extractorQueue.ts` only if required, `scripts/extractor-queue-check.ts`, narrow new Rust reader/input modules registered in lib.rs, and `src/lib/pty.ts` / Terminal.tsx only if the ordered-write contract requires it. Out: extraction prompts, adapters, schema migrations, history retention policy, broad terminal rewrite.

## Steps and regression plan

1. Characterize all three paths before changing behavior. Add Rust fixtures for two writes forming one JSONL record, two records plus a partial tail, CRLF, malformed complete line, truncation and replacement. Add a local fake HTTP server that withholds headers/body. Use a blocked/paused fake writer to establish event-thread and close behavior without a live agent. Verify `(cd src-tauri && cargo test --lib)`; new cases should expose current failures, existing cases remain green.
2. Extract a bounded incremental byte reader. Commit offsets only for complete records, preserving split UTF-8 bytes as well as split JSON. Explicitly handle replacement, same-size replacement, truncation, deletion/recreation and first-open seek-to-end semantics. Do not backfill all old transcripts accidentally. Decide max incomplete-record size and visible fail-open handling rather than unbounded buffering. Keep malformed complete records from blocking later good records. Verify the new Rust fixtures pass without duplicate delivery in each fixture. Do not promise globally exactly-once delivery; existing DB dedupe remains authoritative.
3. Add a total LM Studio HTTP deadline covering body reads (start with the existing CLI deadline for consistent policy). Inject a shorter duration for tests. A timeout is a recoverable error, no retry storm. Verify fake-server tests finish within a bounded margin; `npm run extractor-queue:check` proves a rejected first call permits the next call. Do not add a settings UI unless separately scoped.
4. Reproduce PTY backpressure in a disposable local session. Use ordered per-session off-thread writes, bounded buffering/backpressure and explicit shutdown behavior. Preserve input byte order and make close/kill independent of a lock held by the blocked writer. Naive concurrent spawn_blocking calls are insufficient. Verify byte-for-byte large-paste order, responsive second tab, bounded close, child death and repeated open/close. If portable-pty prevents safe cancellation without a wider change, stop this slice and report a release blocker; do not claim it fixed by moving threads alone.
5. Run all gates and document a real release-app paste/switch/close pass plus terminal operation while LM Studio is unavailable. No real model call is needed for timeout tests.

## Maintenance

Future transcript formats must still pass framing tests; framing and semantic parsing are separate. New extractor backends must settle within a deadline. Any future input queue must preserve human intent, order, and bounded resource use.


## Execution contract

This is a candidate draft, not authorization. Planned at `a87bafd` on 2026-09-19. First read AGENTS.md, CLAUDE.md, CONTRIBUTING.md, PLAN.md, and this file. Confirm the current phase and its literal acceptance; write a PLAN.md for this sprint only and obtain approval before code changes. No implied phase-number assignment. Never start the next phase without `PHASE N ACCEPTED`.

Run `git status --short` and `git diff --stat a87bafd..HEAD -- <in-scope paths below>`. Compare live code to the excerpts. Expected predecessor edits are normal: reconcile them explicitly. If a behavior no longer exists, revise the candidate before implementation instead of reintroducing it. Preserve user changes. Use an isolated `feat/<sprint-slug>` branch/worktree if needed; do not commit, push, publish, or message people without the operator's instruction. Match existing conventional commit style, e.g. `fix(pty): ...`.

Keep Tauri v2/Rust/portable-pty/React/strict TypeScript/Tailwind/xterm/SQLite. All DB access through src/lib/repo.ts, migrations new and numbered, structured semantics only, PTY bytes untouched, no autonomous terminal input. Agent/transcript text is untrusted. Hooks/panels fail open. Launch commands are explicit user-triggered spawn configuration only. Preserve generated adapters and regeneration markers. Tauri listeners need the existing cancelled-flag cleanup under StrictMode. Never change global configuration merely to test a feature.

Run the focused checks named in the steps first, then applicable gates:

```sh
npm run opencode:check
npm run check
npx tsc --noEmit
npm run build
(cd src-tauri && cargo test --lib)
(cd src-tauri && cargo clippy --all-targets -- -D warnings)
git diff --check
```

Every applicable command must exit 0. Rust tests/clippy may be marked not applicable only for exclusively frontend/docs changes, with an explanation. Never run `npm run golden` unless extraction prompts changed; these drafts do not require prompt changes. No dependency installation is part of kickoff inspection; use the existing lockfile/environment. If adding the specifically scoped test dependencies, update manifest/lock together after plan approval.

## Final acceptance and stop rules

- All focused regression cases below pass, not merely source-string assertions.
- Applicable gates pass; `git diff --name-only` stays within scope plus PLAN.md, this candidate, plans/README.md, and docs/TESTING.md.
- Record actual manual results in docs/TESTING.md with build SHA/platform; unrun is unrun.
- Report behavior, evidence, remaining risks and exact acceptance token required. Mark BUILT pending manual acceptance rather than DONE when appropriate.
- Stop and report for missing phase approval, unexpected baseline drift, required scope expansion, absent platform credentials, global configuration changes, unsupported adapter contracts, or failing unrelated gates. Do unaffected preparatory work, but do not invent passing evidence or bypass a release requirement.
