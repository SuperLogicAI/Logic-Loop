# Stop the events table growing

Status: **Approved 2026-11-06 (`PHASE 68 APPROVED`). Built; the installed-app run
(Step 5) is pending. Not accepted.** The readable-text rule and the nudge were
accepted in chat on 2026-11-06.

Prerequisite: PR #100 (`events` indexes, migrations 15 and 16) installed. It
targets the 300-900% CPU on its own. Without it, constant scans could block
`VACUUM`.

## Revisions during the build (2026-11-06)

1. **Sync hash instead of `crypto.subtle`.** The approved approach claimed
   ordering held. It didn't: async digests resolve out of order, and two lines
   written in the same millisecond tie on `ts`, so a larger line could get the
   later id and `lastAssistantText` could pick the wrong one. `payloadHash` is a
   small 64-bit hash plus the length, synchronous like the code it replaces. A
   collision needs equal length inside one session, type and 500 ms bucket, and
   costs one row.
2. **The `ts` index went into PR #100, not this phase.** CPU stayed at 30-300%
   after migration 15, and spike samples pointed at `eventsSince`. This phase
   stays schema-free.
3. **One Rust test added, no app Rust.** `dashboard_checks.rs` runs the real
   delete SQL and `VACUUM` through a WAL pool with a second connection open.
4. **Reader output is not strictly identical.** Sampled across all six agents,
   every field matched, but 2 of 87 Claude session-days vanished.
   Both held only unreadable lines, so they were blank work-log rows.
5. **Clone rehearsal merged into the real run (maintainer approved 2026-11-06).**
   A second instance takes over the shared `ingest.env` while it runs, so a
   rehearsal beside the live app would send real hooks to the clone. Rehearsing
   needs the real app quit anyway, at which point a `cp -c` backup gives the same
   safety on the real database. The per-agent reader comparison already ran on a
   clone, so Step 5 is now the real run.

Source: maintainer request 2026-11-06 after a repo check-in. Follows
`docs/IDEAS.md` "Transcript copies in SQLite — retention, investigate".

Estimated effort: about a day and a half. One new module, one new check, a few
`repo.ts` functions, one control, one nudge row. No schema change, no migration,
no app Rust, no new dependency, no prompt change.

## Stated revision from the request

The maintainer asked for two things: hash the dedupe key, and keep the last N
transcript lines per session. This plan keeps the hash and **replaces last-N
with "keep every line a reader can use"**. The maintainer accepted that swap in
chat on 2026-11-06.

Why: the check-in said `recentTranscript` was the only reader. That was wrong.
`lastAssistantText` (`delta.ts`) feeds the since-you-left brief and the project
work log, and `groupIterations` (`loop.ts`) feeds the loop digest. All of them
read text through `textFromTranscriptLine`, so a line it returns null for is
never used by anything. Last-N also deletes old message text for good: Claude
Code removes its own transcripts after about 30 days (oldest file on disk is
2026-10-07, `cleanupPeriodDays` unset), so for older sessions `events` is the
only copy left.

| Rule | Rows kept | Payload | Work-log excerpts lost, of 1,250 |
|---|---:|---:|---:|
| Today | 374,357 | 5,089 MB | 0 |
| Last 20 | 18,166 | 177 MB | 78 |
| Last 50 | 40,225 | 415 MB | 51 |
| Last 200 | 121,936 | 1,648 MB | 34 |
| **Lines with readable text** | **23,541** | **229 MB** | **0** |

Last-N rows are simulated. The last row was run on a clone, below.

## Problem

The maintainer database is 18.3 GB, up from 4.9 GB on 2026-10-14, about
580 MB/day. Nothing removes rows. `dedupeKey` (`repo.ts:131`) puts the whole
payload in the key for events with no natural id, so a transcript line is stored
three times: 5.1 GB payload, 4.9 GB `dedupe_key` column, 5.4 GB unique index.
That is 15.4 GB of the file. 94% of transcript rows hold no text any reader
uses: tool results, `event_msg`, `api-request-blob`, `attachment` and similar.

This phase is about disk and growth, not CPU. The 300-900% CPU found the same day
came from `listAttentionEvidence` scanning `events` after every hook, and PR #100
targets that with an index. Cleanup alone would not have: that query only fell
from 14.4 s to 3.7 s, still slow enough to pile up, against 112 ms with the index
on the full 18 GB database.

## Measured on an APFS clone (2026-11-06)

Run through `node:sqlite` with the real `textFromTranscriptLine`, warm cache,
aggregates only. The in-app path through `tauri-plugin-sql` is **not** measured
yet (Step 5). Query times below predate the index: with it on the full database,
`listToolEvents` is 4 ms and `lastLeft` under 1 ms. `eventsSince` filters on `ts`
alone, so its gain here should still apply.

| Measure | Before | After |
|---|---:|---:|
| File size | 18.3 GB | 2.1 GB |
| Transcript rows | 374,357 | 23,541 |
| `eventsSince` (1 h) | 1,885 ms | 520 ms |
| `lastLeft` | 302 ms | 82 ms |
| `listToolEvents` | 1,540 ms | 1,277 ms |

- Delete: 350,816 rows in 18 s, 500 per batch; p50 13 ms, p95 73 ms, max 586 ms.
- Null old keys: 23,541 rows in 2.7 s.
- `VACUUM`: 14.3 s, WAL peak 2.1 GB, `quick_check` ok.
- Reader output: `lastAssistantText` per session and day hashed identically
  before and after, across 120 sessions.
- Attention Inbox output: `listAttentionEvidence` hashed identically before and
  after cleanup.
- Per agent, through the real `summarizeDelta` and `groupIterations`: identical
  for Pi (5 sessions), Codex (60), Antigravity (9), OpenCode (5) and DeepSeek
  (14). Claude (60): zero field and loop differences, with 2 of 87 empty
  session-days gone (Revision 4).
- Transcript payload for the last 14 days: 222 MB/day stored three times today,
  12 MB/day stored once after this phase.

Side benefit: in 20 of 1,204 sessions the last 20 raw lines hold no text, so
the landing draft comes back empty today. With text-only rows,
`recentTranscript`'s 20 rows are all usable. The prompt text doesn't change.

## Scope

Done = lines with no readable text are never stored, dedupe keys are a fixed
size, and a human-triggered action, offered once by a nudge, takes the maintainer
database to about 2 GB with panels showing the same content.

## Approach

### Part A: stop the growth (automatic, nothing deleted)

- **Write filter.** In the `onTranscriptLine` handler (`App.tsx:1236`), store
  the line only if `textFromTranscriptLine(p.line)` is non-null. The rest of the
  handler reads `p.line` live, and the schema-drift tripwire reads the tailed
  line, so neither depends on the row.
- **Fixed-size key.** The fallback branch of `dedupeKey` uses `payloadHash`, a
  synchronous hash of the payload (Revision 1). Natural-id keys don't change. Old
  and new keys can only meet inside one 500 ms bucket at upgrade, which is
  harmless.

### Part B: reclaim the space (human-triggered, destructive)

- **`repo.ts` functions** hold all the SQL: page transcript rows by id, delete a
  list of ids, null old keys, read file size, `VACUUM`,
  `wal_checkpoint(TRUNCATE)`.
- **`src/lib/compaction.ts`** runs them in order, because `repo.ts` can't import
  `decisions.ts` (circular). Page 200 rows, classify with the real
  `textFromTranscriptLine`, delete the rest, yield. Then null `dedupe_key` on
  `type = 'transcript'` rows older than 60 s; keys only matter inside a 500 ms
  bucket, and nothing else reads them. Then `VACUUM` and truncate the WAL. Any
  error stops the run and shows the message. Finished batches stay done, and
  re-running is safe because it rescans.
- **Control.** A storage row in the existing Sidebar LM settings popover:
  current size and a "Reclaim space" button behind native `ask()`, same as
  the quit guard. Disabled while any agent is `working`, the unsafe moment for
  `VACUUM`. Dialog text must say it permanently deletes stored tool output and
  metadata lines, keeps messages, decisions, notes and work history, and can't
  be undone.

No timer, no background sweep, no persisted cursor. The write filter means this
is a one-time job.

### Part C: one-time nudge

A button in a popover won't get found, and the cleanup only ever needs to run
once, so the app offers it once. There is no tutorial: the action is one click,
and the confirmation dialog already explains it.

- **Trigger.** Pure `shouldNudge()` in `compaction.ts`, evaluated once per launch:
  file at least 5 GB (`PRAGMA page_count` times `page_size`, instant), cleanup
  never run, not snoozed. "Never run" matters: on size alone, `hook:PostToolUse`
  growth would keep nagging about space the button can't reclaim.
- **Surface.** One row in the existing side-panel warning strip
  (`SidePanel.tsx:1104`), shown only while no agent is `working`. No OS
  notification, no modal.
- **Copy.** "Logic Loop is using 18.3 GB. Most of it is old tool output nothing
  reads." Buttons: `Review` and `Not now`. It can't state the exact reclaimable
  amount, because that needs a scan of about 5 GB.
- **`Review`** opens the same `ask()` dialog as the popover button. On success
  the row shows the space reclaimed, such as "Reclaimed 16.2 GB".
- **`Not now`** snoozes 30 days and notes that the button also lives in Sidebar
  LM.
- **State.** Two settings keys through `repo.ts`: `events_compacted_at`, set after
  any successful run, and `compaction_nudge_snoozed_until`.

## Steps (each with its check)

1. Part A plus `dedupe-check.ts` updates. Check: `npm run dedupe:check`; a 1 MB
   payload gives a key under 200 chars; same payload in one bucket collides,
   different payload doesn't.
2. `compaction.ts` with injected store functions, plus
   `scripts/compaction-check.ts` wired into `npm run check`. Check: fixtures for
   all six adapters keep text lines and drop the rest, non-transcript rows are
   untouched, and a mid-run failure resumes cleanly.
3. Control and dialog. Check: preview harness pass in dark and light.
4. Nudge. Check: `shouldNudge()` assertions in `compaction-check.ts` cover below
   threshold, snoozed, already cleaned and agent working; preview harness pass
   for `Review` and `Not now`.
5. Maintainer run on the real database, after quitting the app and taking a
   `cp -c` of the `.db` and `-wal` files as the rollback (Revision 5). Check: size
   falls to about 2 GB, real run time recorded, manual list below.
6. Gates and docs: `npm run check`, `npx tsc --noEmit`, `npm run build`,
   `git diff --check`; `docs/TESTING.md`, `docs/LANDMINES.md`,
   `docs/PROGRESS.md`, and mark the `docs/IDEAS.md` entry resolved. Cargo gates
   rerun for the new Rust test (Revision 3).

## Risks

- **In-app speed is unknown.** The clone run shipped no rows over IPC. In the app
  about 5 GB crosses to the webview in pages, so expect minutes, not 18 s, and
  possible UI jank on 40 MB lines. Step 5 measures it; a smaller page is the
  first mitigation.
- **`VACUUM` in the installed app is unproven.** A Rust test proves it through a
  sqlx WAL pool with an idle connection open, but not through
  `tauri-plugin-sql` under real traffic. It can fail if another connection holds
  a read open, which is why the indexes are a prerequisite. It is atomic, so
  failure leaves data intact. Writes that hit the lock after sqlx's busy timeout
  fail and are swallowed by the existing `.catch`, which drops those events only.
  Gating on agent state makes that unlikely, not impossible.
- **Peak disk** is about twice the final size (temp copy plus WAL). SQLite rolls
  back on a full disk, so no pre-check.
- **A future transcript format break** makes `textFromTranscriptLine` return
  null, so lines stop being stored until a fix ships. Source files stay on disk
  about 30 days, and the tripwire still fires.
- **`events` is no longer a full transcript copy.** Any future reader wanting
  tool output must read the source file, which only lasts about 30 days. Recorded
  in `docs/LANDMINES.md`.
- **False nudge.** A new install that reaches 5 GB later gets one nudge that frees
  little. Rare and harmless, and the first run ends it. Mark this with a
  `ponytail:` comment.

## Invariants

- **#2 fail open:** Part A's filter can only skip a row. Part B is
  human-triggered, and terminals don't touch the database. Step 5 confirms
  output continues during `VACUUM`. The nudge only shows a row.
- **#3 append-only:** Part A changes what ingestion stores. Part B is a one-time
  exception and needs the maintainer's explicit approval, as `docs/IDEAS.md`
  requires.
- **#5 untrusted content:** lines are classified, never acted on. Logs and
  checks print counts only.
- **#1, #4, #6:** untouched. All SQL stays in `repo.ts`.

## Decisions

Settled in chat 2026-11-06:

1. **Retention rule: keep lines with readable text.** This permanently drops
   stored tool output for sessions whose source files are gone. Nothing reads it
   today.
2. **One-time nudge, no teaching step.** Part C.

Defaults to confirm or change at approval:

3. **Agents active during `VACUUM`: the button is disabled and the nudge hidden
   while any agent is `working`.** This replaces the earlier dialog warning.
4. **Control location: Sidebar LM popover**, or a separate storage surface.
5. **Nudge threshold 5 GB, snooze 30 days.**

## Out of scope

- `hook:PostToolUse` payloads, now 1.63 GB of the remaining 2.01 GB in `events`.
  Largest item left and still growing; needs its own plan.
- CPU and query speed: PR #100.
- A guard limiting the Attention query to one run at a time, and debouncing
  side-panel refreshes. Add either only if CPU stays high after #100.
- About 330 tailer threads that never exit until their file disappears, and 8
  zombie child processes. A separate leak, not the cause of the CPU.
- Capping large text lines (largest kept line is 10 MB).
- Automatic recurring cleanup, in-app backup.

## Manual checks (docs/TESTING.md Phase 68)

On the installed app during Step 5:

1. Size drops to about 2 GB and the popover shows it.
2. Work log excerpts, re-entry brief and loop digest match pre-run screenshots.
3. A live terminal keeps printing during `VACUUM`, and hooks still exit 0.
4. Landing draft still appears; check a session that was empty before.
5. A second run finishes quickly and reclaims almost nothing.
6. Dashboard and Accomplished panel feel no slower after relaunch.
7. The nudge appears on launch above 5 GB with agents idle, hides while one is
   `working`, stays away for 30 days after `Not now` (shift the stored timestamp
   to test), and never returns after a successful run.
