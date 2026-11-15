# Stop slow leaks in a long-running app

Status: **BUILT 2026-11-15, awaiting `PHASE 69 ACCEPTED`.** Approved
2026-11-15 (`PHASE 69 APPROVED`) with the four default decisions. Manual checks
in docs/TESTING.md Phase 69 not yet run.

Planned at `03b2063` (`main`). Source: the 2026-11-15 repo review, measured on
the installed app after 8 days 17 hours of uptime.

Estimated effort: about one day. One new TS module, one new check, two Rust
files, two changed lines in `App.tsx`, one CI line. No schema change, no
migration, no new dependency, no prompt change.

## Revisions during the build (2026-11-15)

1. `tail_until_idle` takes a `poll_first` flag besides the idle duration and
   emit callback; that is how a resumed reader polls before its first sleep.
2. The reader table missed `buildProjectWorkLog` (`dashboard.ts`, via
   `projectWorkLogEvents`). It reads tool rows only through `summarizeDelta`,
   which Step 4 compared, so no stop.
3. Step 4 ran the real `listToolEvents` by stubbing Tauri IPC
   (`window.__TAURI_INTERNALS__.invoke`) to serve clone rows.
4. Part B's test built a `PtySession` in about ten lines, so it was kept.
   Superseded by revision 5.
5. **R1 (review).** The reader thread, at PTY EOF, removes its session from
   `PtyManager.sessions` and reaps it with `reap_exited`: `try_wait` up to 50
   times, 100 ms apart, the session lock held only per call, no signal sent.
   This brings "a shell that exited on its own" into scope, replacing the
   "Not covered" note under Part B and the matching Out of scope line.
   `kill_and_reap` stays, its comment noting the library's `kill()` usually
   reaps first. The test `killed_shell_is_reaped_not_left_a_zombie` is
   replaced by `shell_that_exits_by_itself_is_reaped_not_left_a_zombie`
   (`/usr/bin/true`), which failed with `reap_exited`'s body short-circuited
   ("exited shell left a zombie") and passes with it. Frontend check:
   `ptyResize` runs only for live tabs; `ptyWrite` callers are fire-and-forget
   and a dead session's write could already reject ("writer closed"), so
   "no such session" is the same failure. `live_count` stops counting dead
   shells. Manual check 2 changed as R1 step 5 says.
6. **R2 (review).** A parked reader is stored with its path and resumes only on
   that path (`resumable`); a different path opens fresh at the end. Test
   `parked_reader_is_not_resumed_on_a_different_path` parks on A, resumes with
   B holding two lines, and sees none; with the guard removed it fails.

## Review of the build (2026-11-15, plan author)

Gates rerun independently and passing: `npx tsc --noEmit`, `npm run check`,
`npm run build`, `cargo test --lib` (199 passed, 1 ignored),
`cargo clippy --all-targets -- -D warnings`, `git diff --check`. Parts A, C and
D match the plan. Two changes are needed before acceptance.

**R1. Part B fixes the wrong path. The plan's diagnosis was wrong, not the
build.** portable-pty 0.9.0's `kill()` on unix sends SIGHUP and then calls
`try_wait` up to five times, 50 ms apart
(`portable-pty-0.9.0/src/lib.rs:340-370`), so a killed shell was already being
reaped. The zombies come from shells that exit on their own:

- The reader thread at EOF (`pty.rs`, after the read loop) emits `pty://exit`
  and leaves the session in `PtyManager.sessions`.
- The frontend only calls `ptyKill` for a tab that is still `live`
  (`App.tsx:803`). `markDead` (`App.tsx:872`) and `restartTab` (`App.tsx:876`)
  never release the old PTY id.

So each shell that exits by itself keeps a zombie child, its PTY handles and
its writer thread until the app quits. Seen on the installed app 80 minutes
after a relaunch: 3 live shells and 1 zombie.

Required:

1. In the reader thread, after the read loop, remove the session from
   `sessions` and reap it off that lock. Do not signal anything: the shell
   exited by choice, and `killpg` could take down what it left running. Poll
   `try_wait` with the session lock held only for each call (for example 50
   tries, 100 ms apart) rather than a blocking `wait`, so a command that cloned
   the session just before removal can never wait behind it on the main thread.
2. Replace `killed_shell_is_reaped_not_left_a_zombie` with a test for this
   path: spawn a child that exits by itself (`/usr/bin/true`), drive the same
   reap helper, assert `libc::kill(pid, 0)` fails. Confirm by removing the reap
   that the test then fails. The current test passes with or without
   `kill_and_reap`'s thread, because the library's `kill()` reaps first; that
   reading comes from the library source and was not run.
3. `kill_and_reap` may stay; it is harmless and covers a child that outlives
   the 200 ms grace. Say in its comment that the library usually reaps first.
4. Check that nothing in the frontend depends on a dead session staying in the
   map: `pty_write` and `pty_resize` on a removed id return "no such session".
   `pty_live_count` (the quit guard) stops counting dead shells, which is a fix.
5. Manual check 2 becomes: run `exit` in three shell tabs, restart one and
   close two, then expect 0 zombies.

**R2. A parked reader can be resumed against a different file.**
`ensure_tailer` passes the current hook's `path` to a reader parked under the
same session id. If that path differs from the one the reader was tailing,
`poll` sees a new identity, resets to offset 0 and emits the whole file as new
lines: duplicate transcript rows and old text fed to detectors. Before this
phase a re-armed tailer always started at the end. Park the path with the
reader and, when the path differs on resume, drop the parked reader and open
fresh. Add a test: park on file A, resume with file B that already has lines,
expect none of B's existing lines.

**Second pass (2026-11-15, plan author): R1 and R2 are done as asked; no
further code changes requested.** Read the full diff again and reran every
gate: `npx tsc --noEmit`, `npm run check`, `npm run build`, `cargo test --lib`
(200 passed, 1 ignored), `cargo clippy --all-targets -- -D warnings`,
`git diff --check`. The exit path removes the session before reaping and never
signals; `reap_exited` holds the lock only per `try_wait`; a parked reader
resumes only on its own path. The two mutation checks are the builder's report
and were not rerun here. What remains is the installed-app list in
docs/TESTING.md.

Checked and fine: a tailer that parks in the middle of a turn. The next hook
resumes it with a poll before its first sleep, and `decisions.onStop` waits
2,000 ms before reading (`decisions.ts:372`), so the turn's last lines arrive
in time.

## Problem

The maintainer leaves the app open for a week or more. Four things get worse
the longer it runs or the longer the database lives.

1. **Transcript tailers never stop.** Every session the app sees starts one
   thread that holds its transcript file open and polls it twice a second until
   the file is deleted. Measured on the installed app: 282 threads, 80 open
   `.jsonl` handles, 138 file descriptors in total. The macOS default soft limit
   is 256 (`launchctl limit maxfiles`). At about 9 new handles a day the limit
   is roughly two more weeks away, and past it new tabs, tailers and database
   opens can fail. The process's own limit was not read, so 256 is the default,
   not a confirmed ceiling.
2. **Closed tabs leave zombie shells.** `kill_session` sends SIGKILL and never
   waits. Measured: 22 defunct children.
3. **Tool payloads are now most of the database.** `hook:PostToolUse` rows hold
   1.9 GB of the 2.58 GB file. Over the last 14 days: 11,105 rows, 525.1 MB.
   `Read` results alone were 331 MB and `view_image` 85 MB. No reader of stored
   rows uses that text. Growth is about 35 MB a day. Plan 068 named this as the
   largest item left.
4. **CI never runs the production build.** `ci.yml` runs `tsc` and the check
   scripts, so a Vite-only build break would reach `main`.

## Current code

`src-tauri/src/ingest.rs`:

```rust
// :45
/// Sessions with an active transcript tailer.
#[derive(Default)]
pub struct TailerRegistry(Mutex<HashSet<String>>);

// :462  called from the hook handler (:242) for every non-subagent hook
// that carries a transcript_path, so a stopped tailer is re-armed by the
// next hook.
fn ensure_tailer(app: &AppHandle, session_id: String, path: String) {
    // ... insert into the set, return if already present ...
    std::thread::spawn(move || {
        tail(&app, &session_id, &path);
        // Every exit path lands here — missing file, deleted file, seek error.
        if let Ok(mut set) = app.state::<TailerRegistry>().0.lock() {
            set.remove(&session_id);
        }
    });
}

// :538
struct TranscriptReader {
    file: fs::File,          // held for the life of the thread
    offset: u64,
    pending: Vec<u8>,
    identity: Option<(u64, u64)>,
}

// :573  poll() already opens a fresh `probe` handle on every call to check
// identity and length, then seeks and reads through `self.file`.

// :626
fn tail(app: &AppHandle, session_id: &str, path: &str) {
    let Ok(mut reader) = TranscriptReader::open(Path::new(path)) else { /* emit tailer-failed */ return; };
    loop {
        std::thread::sleep(std::time::Duration::from_millis(500));
        match reader.poll(Path::new(path)) {
            TailOutcome::Gone => { /* emit tailer-failed */ return; }
            TailOutcome::Records(records) => { /* emit ingest://transcript per line */ }
        }
    }
}
```

`TranscriptReader::open` seeks to the end of the file, so a tailer that simply
exited and was re-armed later would lose every line written in between.

`src-tauri/src/pty.rs`:

```rust
// :74
fn kill_session(s: &mut PtySession) {
    #[cfg(unix)]
    if let Some(pid) = s.child.process_id() {
        unsafe { libc::killpg(pid as i32, libc::SIGKILL); }
    }
    let _ = s.child.kill();
}

// :582  a sync command, so it runs on the main thread
pub fn pty_kill(state: State<'_, PtyManager>, id: u32) -> Result<(), String> {
    state.launches.pty_closed(id);
    let removed = state.sessions.lock().map_err(|e| e.to_string())?.remove(&id);
    if let Some(session) = removed {
        if let Ok(mut session) = session.lock() {
            kill_session(&mut session);
        }
    }
    Ok(())
}
```

`PtyManager::kill_all` (`pty.rs:91`) drains every session and calls
`kill_session` the same way.

`src/App.tsx` stores raw hook payloads at two sites that can carry
`PostToolUse` (`:1146` and `:1162`), both in this shape:

```ts
repo.addHookEvent(p.session_id, `hook:${p.hook_event_name}`, JSON.stringify(payload), /* ... */)
```

The site at `:1024` stores subagent lifecycle hooks only and is not touched.

Readers of stored `hook:PostToolUse` rows, and what each one reads:

| Reader | Fields |
|---|---|
| `listToolEvents` (`repo.ts:279`) | `cwd`, `tool_name`, `tool_input.file_path`, `tool_input.command`, `tool_input.description` |
| `summarizeDelta` (`delta.ts:48`) | `tool_name`, `tool_input.file_path`, `tool_response.is_error` |
| `groupIterations` (`loop.ts:93`) | `tool_response.is_error` |
| `dedupeKey` (`repo.ts:147`) | `tool_use_id`, `agent_id` |
| `eventsSince`, attention queries | `tab_id`, `project_key`, `cwd` |

Detectors, tab state and AskUserQuestion handling run on the live payload in
the hook handler, before anything is stored.

## Scope

Done = an app left open for weeks holds no transcript handles for quiet
sessions and no zombie shells, new tool payloads are stored at a few KB each,
and CI fails when the production build fails.

Files in scope: `src-tauri/src/ingest.rs`, `src-tauri/src/pty.rs`,
`src/lib/payloadTrim.ts` (new), `src/App.tsx` (the two call sites only),
`scripts/payload-trim-check.ts` (new), `package.json`,
`.github/workflows/ci.yml`, `docs/TESTING.md`, `docs/PROGRESS.md`,
`docs/LANDMINES.md`, `plans/README.md`, this file.

## Approach

### Part A: tailers hold no handle and stop when quiet

- **No held handle.** Remove `file` from `TranscriptReader`. `poll` already
  opens `probe` each time; seek and read through `probe`. `open` takes the
  length and identity from a handle it drops before returning. The seven
  existing reader tests (`ingest.rs:1004-1110`) must pass unchanged.
- **Stop when quiet.** `tail` returns the reader when no new record has arrived
  for `TAILER_IDLE` (30 minutes). Split the loop into a function that takes the
  idle duration and an emit callback, so a test can use 50 ms.
- **Resume, don't restart.** `TailerRegistry` becomes
  `Mutex<HashMap<String, Option<TranscriptReader>>>`. `None` means a thread is
  running. `Some(reader)` means it stopped for quiet and can pick up at the
  same offset, pending bytes and identity. `ensure_tailer` takes a parked
  reader when there is one and passes it to the new thread. A resumed tailer
  polls once before its first sleep. Missing or deleted files keep today's
  behavior: emit `ingest://tailer-failed`, remove the entry, start fresh on the
  next hook.

Why 30 minutes: any hook re-arms the tailer and no line is lost, so the only
cost of stopping is one thread spawn. A long window keeps an in-flight turn's
tailer alive in practice, which avoids reasoning about a resumed tailer racing
the `Stop` extraction.

A parked reader stays in the map for the life of the app, about 100 bytes per
session. Mark it with a `ponytail:` comment naming that ceiling.

### Part B: reap killed shells

After `kill_session` in `pty_kill`, and after the loop in `kill_all`, hand the
killed sessions to a new thread that calls `child.wait()` on each. `wait` must
not run on the command thread: `pty_kill` is a sync command and Plan 017 traced
an app-wide freeze to blocking calls there.

Not covered: a tab whose shell exited on its own stays a zombie until the tab
is closed or restarted. Reaping it at reader EOF would hold the session lock in
`wait` while `pty_kill` wants it.

### Part C: store tool payloads small

- **`src/lib/payloadTrim.ts`**, pure, no imports from `repo.ts`:
  `trimForStorage(payload)`. For a payload whose `hook_event_name` is
  `PostToolUse`, return a copy in which every string anywhere inside
  `tool_input` and `tool_response` longer than `STORED_STRING_CAP` (2,000
  chars) is cut to the cap plus ` … [+N chars not stored]`. A response with
  `is_error === true` or a non-zero `metadata.exit` is kept whole. Every other
  payload is returned as is. The input is never mutated. Any throw returns the
  original payload.
- **`App.tsx:1146` and `:1162`**: `JSON.stringify(trimForStorage(payload))`.
  Nothing else in the handler changes; it keeps reading the live payload.
- **Old rows stay.** This stops growth only. Nothing is deleted or rewritten.

Measured read-only on the maintainer database with this rule, last 14 days:
11,105 rows, 5,093 changed, 525.1 MB to 28.7 MB.

### Part D: build in CI

Add `- run: npm run build` to the `frontend` job in
`.github/workflows/ci.yml`, after the check scripts.

## Steps (each with its check)

1. Part A. Check: `cd src-tauri && cargo test --lib ingest` passes, with the
   seven existing reader tests untouched and three new ones: the loop returns
   the reader after the idle window; a returned reader fed back in emits lines
   appended while it was parked, and emits them before sleeping; a deleted file
   still ends as `Gone`. `grep -n "file: fs::File" src-tauri/src/ingest.rs`
   returns nothing.
2. Part B. Check: a unix-only test spawns a real child through the same PTY
   path, runs the kill-and-reap helper, joins the thread, and asserts
   `libc::kill(pid, 0)` fails (a zombie would still answer). If building a
   `PtySession` in a test takes more than about 20 lines of setup, drop the
   test, say so as a stated revision, and rely on manual check 2.
3. Part C module plus `scripts/payload-trim-check.ts`, wired into
   `npm run check`. Check: `npm run payload-trim:check` covers a 300 KB `Read`
   result stored under 5 KB; nested arrays of text blocks; an `is_error`
   response kept whole; a non-zero `metadata.exit` kept whole; a non-PostToolUse
   payload returned unchanged; a short payload byte-identical; the input object
   not mutated; `tool_name`, `tool_use_id`, `cwd`, `session_id`, `tab_id` and
   `tool_input.file_path` untouched.
4. Reader comparison on real rows, read-only, counts only (method in
   `docs/TESTING.md` Phase 68: `node:sqlite` under `tsx`, real functions). For
   the last 14 days of `hook:PostToolUse` rows, compare the `listToolEvents`
   mapping, `summarizeDelta` and `groupIterations` on original and trimmed
   payloads. Check: zero differences, except `detail` on commands longer than
   2,000 chars; record that count.
5. Wire the two `App.tsx` call sites. Check: `npx tsc --noEmit`,
   `npm run check`.
6. Part D. Check: `npm run build` exits 0 locally; the PR's `frontend` job runs
   it.
7. Gates and docs: `npm run check`, `npx tsc --noEmit`, `npm run build`,
   `cd src-tauri && cargo test --lib`,
   `cargo clippy --all-targets -- -D warnings`, `git diff --check`.
   `docs/TESTING.md` gets the manual list below, `docs/LANDMINES.md` a note
   that stored tool payloads are capped, `docs/PROGRESS.md` the phase entry.

## Stop and report instead of improvising

- The code at the lines above no longer matches these excerpts.
- An existing reader test needs changing to pass.
- Step 4 finds any reader difference beyond long-command `detail`.
- A reader of stored rows turns out to use a long string (search
  `tool_response` and `tool_input` under `src/` before Step 5).
- Part A needs a change to how `Stop` extraction waits for transcript lines.

## Risks

- **A resumed tailer racing `Stop`.** Covered by the 30-minute window and the
  poll-before-sleep on resume, not by proof. Manual check 3 exercises it.
- **Windows.** Opening the transcript on every poll is what the code does
  today, so no new sharing behavior. Not holding the file open should make
  rename and delete by the agent easier, unverified.
- **A future reader wants full tool output.** It will not be in `events` for
  new rows. Claude Code keeps its own transcripts about 30 days. Recorded in
  `docs/LANDMINES.md`.
- **Reap thread on a child that ignores SIGKILL.** Not possible for SIGKILL
  short of a kernel-stuck process, and then only that one thread waits.

## Invariants

- **#1:** the tailer still frames bytes into lines and nothing more.
- **#2 fail open:** tailer failure paths are unchanged, reaping happens off the
  command thread, and the trim falls back to the original payload on any throw.
- **#3 append-only:** Part C changes what ingestion stores. Nothing is deleted.
- **#5:** payload text is cut by length, never interpreted.
- **#4, #6:** untouched.

## Decisions

Defaults to confirm or change at approval:

1. **Idle window 30 minutes.**
2. **Cap 2,000 chars, failures kept whole.**
3. **Old tool payloads (1.9 GB) are left alone.** Rewriting them is a second
   exception to the append-only rule and needs its own approval.
4. **All four parts in one phase.** If Step 4 finds reader differences, Part C
   moves to its own phase and the rest ships.

## Out of scope

- Rewriting or deleting stored payloads.
- Reaping a shell that exited on its own while its tab stays open.
- Raising the process file-descriptor limit.
- The Attention query guard and side-panel debounce that Plan 068 deferred.
  Idle CPU measured 4% after PR #100.

## Manual checks (docs/TESTING.md Phase 69)

On the installed app, with `<pid>` from
`pgrep -f "Logic Loop.app/Contents/MacOS/app"`:

1. After a day of normal use, `lsof -p <pid> | grep -c '\.jsonl'` prints 0 or
   close to it, and the thread count (`ps -M -p <pid> | wc -l`) is far below
   one per session seen.
2. Run `exit` in three shell tabs, restart one and close two.
   `ps -axo ppid,stat | awk -v p=<pid> '$1==p && $2 ~ /Z/' | wc -l` prints 0.
3. Leave an agent session idle for over 30 minutes, then send a prompt. Its
   decisions, work log line and re-entry brief appear as usual.
4. After a few days, daily `hook:PostToolUse` payload is a few MB:
   `SELECT date(ts/1000,'unixepoch'), sum(length(payload_json))/1048576 FROM events WHERE type='hook:PostToolUse' GROUP BY 1 ORDER BY 1 DESC LIMIT 5`.
5. The Accomplished panel, diff pop-out and since-you-left brief show tool rows
   as before.
