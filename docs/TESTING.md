# Manual Test Script — v2

Latest audit: [computer-use checklist review, 2026-10-07–08](#computer-use-testing-audit).
Combined rows stay open when any subcase is unverified. Latest numbered
manual tests now use task boxes while retaining their original IDs. Boxes
53–59 and 61–69 reflect the existing explicit maintainer passes, not a new
execution of those agent prompts.

## v4 — Plan 033 first-useful-session re-verify (2026-09-19, live pass closed 2026-09-21)

**Plan 033 ACCEPTED 2026-09-21.** Doc-gate reconciled — see docs/PROGRESS.md
and PLAN.md.

Live matrix run 2026-09-21 on a clean Mac mini profile (`jvandershark`),
release build. Four real findings surfaced, filed under "Findings" at the
end of this section, fixed same day on `fix/dsh-path-and-readability`
(merged PR #48), and re-verified live against a rebuilt release app —
all pass.

### 11. First-run launch flow (new — Setup modal "Start a session")

- [x] Setup opens, "Start a session" block present above the adapter list.
- [x] Cancel on the folder dialog is a no-op.
- [x] Valid folder pick shows path, no error.
- [x] Folder deleted after pick, before Start — now inline error, no tab
      spawned. Finding 1 fix re-verified live 2026-09-21.
- [x] Start disabled with no folder, enabled once one's picked.
- [x] Plain shell launch — new tab, no agent run, correct status line.
- [~] Agent launch waiting→connected — works, but gated on the agent's own
      trust-folder prompt (Claude's "Yes, I trust this folder") rather than
      just first activity, and reopening Setup resets the launch section to
      blank with no memory of the tab just started. Not a contract
      violation, just a rough edge — not filed as a numbered finding.
- [x] Double-click "Start session" — one tab only, reproduced attempts no
      longer double-spawn. Finding 3 fix re-verified live 2026-09-21.
- [x] Spawn failure (permission-denied folder) — inline `Permission denied
      (os error 13)`, no tab spawned, selection preserved.

### 9 (re-verify). Bookmarks — save/delete failure handling

- [x] Save-in-flight "Saving…" disabled state confirmed (happens fast).
- [x] Bookmark pointing at a deleted/typo'd folder: no longer materializes
      the directory on retry; consistent inline error both clicks.
      Finding 2 fix re-verified live 2026-09-21.
- [x] Forced save failure (DB chmod 444): correct error + Retry state shown.
      Restoring `.db`, `.db-wal`, and `.db-shm` together (corrected
      procedure — see Finding 4) then Retry succeeds.
- [x] Same for delete: Retry succeeds once all three files are restored.

### Findings — filed 2026-09-21, code fixes landed same day (batched one PR)

**Status: code-fixed and live re-verified 2026-09-21.** All four have a fix
on the working tree, `tsc --noEmit`/`cargo clippy -D warnings`/`cargo test
--lib`/`npm run check`/`npm run golden` all clean, each Rust fix has a new
regression test, and the GUI re-verify of §9/§11 above against a rebuilt
release app confirms all four in practice. Per-finding notes:

1. **Fixed.** `pty_spawn` (`pty.rs`) now takes a `strict_cwd` flag, threaded
   through only from Setup's launch flow (`App.tsx`'s `onLaunch` →
   `openTab({ ..., strictCwd: true })` → `ptySpawn(...)`). When set and the
   resolved cwd isn't a directory, `pty_spawn` now returns
   `Err("\"<path>\" is not a folder Logic Loop can open")` *before*
   allocating a pty, and `OnboardingModal.startSession`'s existing catch
   block (already used for the permission-denied case) surfaces it inline.
   Every other `pty_spawn` caller (bookmarks, ghost-tab restore, fan-out,
   split, isolate-loop) omits the flag and keeps the exact silent fallback
   they need. New tests: `pty::tests::resolve_spawn_cwd_*` (4 cases).
2. **Fixed — root cause confirmed.** Not a bookmark-launch bug at all: the
   Idea Board panel (`SidePanel.tsx`) calls `read_board(tab.cwd)` for
   whichever tab is active, and `board.rs`'s `read_board_blocking`, on a
   missing `board.md`, seeded the example board via
   `write_board_blocking` → `create_dir_all(project_key/.logic-loop)`.
   `create_dir_all` creates *every* missing ancestor, `project_key` itself
   included — so opening a bookmark tab whose folder didn't exist yet
   silently `mkdir`'d it as a side effect of the sidebar loading, and the
   *second* click's `pty_spawn` then correctly found a real directory and
   landed in it. Fix: both `read_board_blocking` and `write_board_blocking`
   now refuse (empty string / `Err`, fail open per invariant #2) unless
   `project_key` already exists as a directory — no path-creation beyond
   the `.logic-loop` subdirectory of an already-real project folder. New
   tests: `board::tests::read_missing_project_dir_returns_empty_and_creates_nothing`,
   `write_to_missing_project_dir_errors_and_creates_nothing`.
3. **Fixed — root cause confirmed, and it wasn't a wiring bug.** The
   `startingRef.current` guard *is* airtight against two overlapping
   `startSession()` calls — but it only blocks calls while one is in
   flight. Local Tauri IPC (`canonicalizeCwd` → `projectKeyOf` → `ptySpawn`)
   resolves fast enough that a real second click, landing after the first
   click's promise has already settled, sails right through as a
   legitimate new launch — no double-wiring, no second `OnboardingModal`
   instance, just a mutex with no memory once it's released. Fix: the
   Start button now also disables once `launched !== null` (a session was
   actually started for the current pick), and `pickFolder` clears
   `launched` on a fresh pick so starting a different folder still works.
   A rapid double-click can now produce at most one tab regardless of how
   fast the IPC round-trip is.
4. **Not a code bug — confirmed via isolated repro, no code change.**
   Reproduced the exact mechanism in a scratch SQLite db (WAL mode, same as
   this app's `tauri-plugin-sql` default): `chmod 444` the main `.db` file
   and attempt a write — SQLite, as a side effect of that failed write,
   also leaves the `-wal` sidecar at `444` (confirmed via `stat` before/
   after). Restoring *only* `context-terminal.db` back to `644` (as the
   original repro did) leaves `context-terminal.db-wal` stuck at `444`,
   which independently blocks every subsequent write — including from a
   brand-new process, since this is on-disk state, not anything an app
   restart could clear. No orphan process was involved (`ps aux` showed a
   single running instance at repro time). The fix is to the *retest
   procedure*, not the app: restoring access to a WAL-mode db means
   `chmod` the `.db`, `.db-wal`, **and** `.db-shm` together. Re-verify note
   added to §9 below.

1. **Silent cwd fallback still reachable at spawn time.** Plan 033 added
   `validate_project_dir` (`pty.rs:131`) for the Setup picker's *pick-time*
   check only. `pty_spawn`'s own cwd handling (`pty.rs:~300`,
   `cwd.filter(|c| ... is_dir())`) still silently omits `.cwd()` and spawns
   normally if the path is gone by launch time — the exact gap PLAN.md's own
   drift note flagged as unresolved against candidate `a87bafd`. Repro: pick
   a valid folder, `rm -rf` it, click Start.
2. **Bookmark retry-creates-folder.** A bookmark pointing at a missing path:
   1st click → silent fallback shell (Finding 1's mechanism). 2nd click on
   the same bookmark → folder gets created and the session launches into it.
   Root cause not yet identified — needs tracing through whatever bookmark
   launch does differently on a retry vs. Finding 1's direct Setup path.
3. **Double-click on "Start session" spawns two tabs.** `startSession`'s
   `startingRef.current` guard (`OnboardingModal.tsx`) should block this
   synchronously but didn't in the built app — reproduced twice on a real
   double-click, not a one-off.
4. **DB stays wedged read-only after chmod restore + full app restart.**
   `context-terminal.db` forced to 444, then restored to 644 — the app,
   even after a complete quit and relaunch, kept returning
   `SQLITE_READONLY (code 8)` on write. Suspect an orphaned process holding
   the old read-only fd (matches this repo's known orphan-process landmine
   pattern) or a `-wal`/`-shm` sidecar file that didn't get the permission
   restore. Needs `ps aux | grep context-terminal` and a check for WAL/SHM
   files before assuming it's a code bug vs. a test-environment artifact.

**Already fixed, shipped separately:** the Setup adapter list only showed a
clickable "Install" link for Pi/DeepSeek (the only two adapters with an
`installUrl` in `onboarding.ts`) — Claude/Codex/OpenCode/Antigravity showed
a dead-end disabled "Enable" instead. Fixed same day by adding `installUrl`
to all four remaining adapters (`onboarding.ts`). Not filed as a numbered
finding since it's already resolved on `main`.

## v3 — Bug-fix sprint re-verify (2026-07-11)

**First run was invalidated**: the stale copy at `/Applications/Context
Terminal.app` was tested, not the new build. That copy has now been replaced
with the current build — launch from /Applications (or Dock/Spotlight) and
re-run. Also new this round: ✕ button on blocker rows deletes them
permanently.

Rebuild first, then re-check ONLY these (everything else unchanged):

- [x] **Panels follow the real project** (was: blockers shared across empty
      tabs / no history loading): open a plain ⌘T tab, `cd` into a project,
      run `claude`, give it a task. The rail should now show THAT project's
      blockers/decisions/accomplished + git log (not home-folder data), and
      the tab's dot should track the agent. History from earlier sessions in
      that project should appear.
      Note: two idle ⌘T tabs where no agent has run still share home-folder
      blockers — cwd is only known once an agent reports it. Accepted limit.
      *blockers still pre-existing from previous tests- for instance brand new terminal window upon launch has leftover 'test' blocker from last test session even though it's a fresh brand new terminal. Also it might make sense to have an 'x' so you can make them go away overtime those hanging on could get annoying.*
- [x] **⌘Q guard**: several tabs open, press ⌘Q → confirm dialog appears.
      Cancel keeps everything; confirm quits.
      *⌘Q unguarded - 5 terminals open bookmarked and non-bookmarked immediately closes upon ⌘Q*
- [x] **Dock badge on finish**: run claude, minimize/switch away, let it
      finish → dock badge appears; clicking back into the app clears it.
- [x] **No orphan shell**: `echo $$` in a tab, close the tab, `ps -p <pid>`
      elsewhere → header line only.
      *I think this passed the response was ' PID TTY           TIME CMD '*
- [x] **Multiline paste into claude**: paste a 3-line block → lands intact in
      the input box, does not submit line-by-line.
      *when copy/pasting from 'Notes' app in mac the line breaks are not preserved but when copy/pasting from terminal copy the line breaks are preserved - Is that a pass or fail? *
- [x] **Tab overflow**: open 12+ tabs, shrink the window → tab strip scrolls
      horizontally (thin scrollbar), + button stays visible.
- [x] **⚙ settings** button now larger with a label.

Judgment calls resolved: 1.2 colors = pass (default LSCOLORS is blue/white);
5.2 heap crash = user typed `` `yes` `` in backticks (command substitution
captured infinite output — zsh died, not the app; overlay behaved correctly);
5.3 orphan shell = real bug, fixed this sprint (process-group kill).


Fresh run, all manual checkboxes reset. Items marked *(auto ✓)* were verified by
script on 2026-07-11 and don't need redoing.

## Before you start — use the RELEASE build

The earlier failures (app wiping all tabs when you resized or clicked away) were
caused by testing in dev mode (`npm run tauri dev`), where the app auto-reloads
itself. **Do not test in dev mode.**

Open the release app instead:

```
open "src-tauri/target/release/bundle/macos/Logic Loop.app"
```

(You can also double-click it in Finder at that path.)

How to mark results: `[x]` = passed, `[Failed]` = failed — add a line below
describing exactly what you saw and what you did right before it happened.

---

## 1. Launch

- [x] App opens with one tab showing a live shell prompt (you can type commands).
- [-] Colors work: type `ls -G` and press Enter — folder names should be colored.
      Then type `echo $TERM` — it should print `xterm-256color`.
      *Result: I see color but only blue and white if that's the expected outcome if so passed*
- [x] Full-screen apps work: type `vim` and Enter (opens a text editor that takes
      over the whole terminal). Press `i`, type a few words, then press `Esc`,
      type `:q!`, Enter. You should be back at a normal prompt with no leftover
      garbage on screen.

## 2. Three simultaneous sessions under load

- [x] Open 3 tabs total (⌘T twice). In each tab run `claude` and give it a task —
      or for a simpler stress test run: `yes | head -100000` (floods the screen
      with output for a few seconds).
- [x] While all 3 tabs are producing output, click rapidly between the tabs for
      ~10 seconds. App should stay up — no blank screen, no reset to one tab.
      *caught a little lag but it didn't break! the 'DECISIONS (1)' section in the left sidebar is properly surfacing claude code decisions to be made*
- [x] Check each tab: output belongs to that tab only (no lines from tab 1
      showing up in tab 2), and scrolling up shows that tab's own history.
- [x] Open 10+ tabs (keep pressing ⌘T), then click back to the first few — each
      should still show its terminal, not a blank area.
- [x] While one tab is streaming output, drag the window to resize it AND switch
      tabs a few times. App should not reset or go blank.

## 3. Resize

- [x] Drag the window edges and corners around for a few seconds. The prompt
      should reflow to the new width — no frozen/smeared text, no app reset.
- [x] After resizing, type `tput cols` and Enter. The number printed should
      roughly match how many characters fit across the window (bigger window =
      bigger number; make the window wider and rerun to confirm it changes).
- [-] With two tabs open: stay on tab A, resize the window, then click tab B.
      Tab B should fit the new window size correctly (no cut-off or dead space).
        *This works but when the window is smaller there is no way to navigate to terminals at the end so multiple 'terminal tabs' are cutoff and inaccessible with smaller windows we may need a horizontal scrollbar you can use when sceen is smaller. - if this is acceptable then it passes*
## 4. Paste

- [x] Copy these three lines somewhere (e.g. from this file), then paste (⌘V)
      into a shell tab:
      ```
      echo one
      echo two
      echo three
      ```
      They should appear as pasted text waiting for you — NOT run themselves
      line-by-line the instant you paste.
- [failed] Run `claude`, then paste a multi-line block into its prompt. The whole
      block should land in the input box intact (line breaks preserved), not
      submit after the first line.
    *Line breaks are not preserved but the paste itself works*
    
## 5. Tab close

- [x] In a tab, type `echo $$` and Enter — this prints the shell's process ID
      (a number, e.g. 48231). Write it down.
      *got it for 5.3 below*
- [failed] Start something long-running in that tab (e.g. `yes` — endless output), then close the tab (✕ on the tab, or ⌘W).
    *I have like ten terminals open and when I typed '`yes` — endless output' and hit enter I got 'zsh: fatal error: out of heap memory' in the terminal and separately a pop-up grey box that reads "Process exited" with a 'Restart' button. terminal still available but reset.* 
- [-] In ANOTHER tab (or Terminal.app), run `ps -p <that number>` (e.g.
      `ps -p 48231`). It should show only the header line — meaning the process
      is gone. If it lists a process, that's a fail (orphaned shell).
      * if this is acceptable pass output was: '   PID TTY           TIME CMD
 <that number> ttys005    0:00.01 /bin/zsh -l  '*

## 6. Dead tab

- [x] In a tab, type `exit` and Enter. An overlay saying "Process exited" should
      appear and the tab's dot should turn red.
- [x] Click the Restart button in the overlay — you get a fresh working shell in
      the same tab, screen cleared.

## 7. Quit with live sessions

- [failed] With 3 open tabs, press ⌘Q. A dialog should warn "3 active sessions will be terminated."
    *I had approximately ten tabs open and it immediately closed the application*
- [-] Click Cancel — app stays open, all tabs still work.
    *unable to test initially - retested on test 9.3 see notes in test 9.3*
- [-] ⌘Q again and confirm — app quits.
    *unable to test*
- [x] No orphan shells after quit. *(auto ✓ 2026-07-11: SIGTERM quit, 0 orphan shells)*

## 8. Relaunch recovery

- [x] Relaunch opens clean with one fresh tab. *(auto ✓ 2026-07-11)*
- [x] Bookmarks survive relaunch. *(auto ✓ 2026-07-11)*

## 9. Bookmarks

- [x] Click "＋ bookmark". Fill in a name, a working directory (e.g.
      `~/Desktop/dev/context_terminal`), pick a color, Save. A colored chip appears
      in the bookmarks bar.
- [x] Click the chip — a new tab opens. Type `pwd` and Enter: it should print
      that directory. Tab shows the bookmark's name and color.
      *After unexpected abrupt ⌘Q closure- the DECISIONS (1) in the sidebar still remain from previous session* 
- [x] Right-click the chip → Edit. Change the name, Save, then quit and relaunch
      the app — the change should still be there.
      *The expected pop-up from 7.1 test - dialog should warn "3 active sessions will be terminated." did work when clicking the red x to quit the app - I did test the cancel button and all terminal windows stayed open*
- [x] Right-click the chip → Delete. Chip disappears, and stays gone after
      relaunch.
- [x] NEW BUG FIX TO VERIFY: create a bookmark with name + color but leave the
      working directory EMPTY — Save should work now (previously blocked).
      Clicking the chip opens a tab in your home folder (`pwd` prints
      your `$HOME`).
- [x] Also try a bookmark with a made-up directory like `~/does-not-exist` —
      the tab should still open (falls back to home folder), no crash.

## 10. Phase 1 — Event spine

Background: when hooks are ON, Claude Code sessions report their activity to the
app, which drives the colored status dot on each tab.

- [x] Click the "hooks off" button (top right) → it turns "hooks on".
- [ ] Click it again a couple of times, ending at whatever state you want.
      Nothing should error, and your other Claude Code setups keep working.
- [x] `~/.context-terminal/ingest.env` exists, private permissions. *(auto ✓ 2026-07-11)*
- [-] With hooks ON: run `claude` in a tab, give it a task. Watch the tab's dot:
      - Blue = agent working (should appear when it starts using tools)
      - Amber + pulsing = agent waiting on you (asks permission or finishes and
        wants input)
      - Back to blue the moment you answer it
      - Green = agent idle/done
      *during other tests earlier I saw the color dots in the terminal tabs working but during this test it was not? odd outcome*
- [failed] Minimize the app while the agent works. When it needs you, the dock icon should show a red badge number. Answering clears it.
    *executed something with claude and minimized when it finished the app icon in dockhad no notification signal*
      *(badge mechanics auto ✓ 2026-07-11; visual check still worth one pass)*
- [x] Open two tabs in the SAME project folder, run `claude` in both. Each tab's
      dot should track its own session, not mirror each other.
- [x] Run `claude` in Terminal.app (OUTSIDE this app) — nothing in the app
      should change (no dots, no errors), and that outside session works fine.
      *tested both claude outputs the terminal app and context terminal and both worked as expected*
- [x] Events landing in database. *(auto ✓ 2026-07-11)*
- [x] Fail open: QUIT the app entirely, then run `claude` in Terminal.app —
      it must work completely normally (no hangs, no errors) even though the
      app isn't there to receive events.

## 11. Phase 2 — Deterministic panels

- [x] Press ⌘B — a left rail appears with Blockers / Accomplished / Git log for
      the active tab's project. ⌘B again hides it.
- [x] Accomplished feed populates from agent tool use. *(auto ✓ 2026-07-11)*
- [x] Git log section: with a tab in a git project (e.g. context_terminal), the
      rail lists recent commits. In a tab on a non-git folder it says
      "Not a git repo."
- [x] Switch between tabs in different projects — the rail's content follows.
- [x] Blocker detector fires on "permission denied" / test failures / merge
      conflict in agent output. *(auto ✓ 2026-07-11)*
- [x] Duplicate detector hits collapse to one row. *(auto ✓ 2026-07-11)*
- [-] Manual blocker: type into the rail's input, Enter — it appears in the
      list. Click its checkbox — it moves to a struck-through "resolved" list.
      Un-check — it reopens.
      *This worked well but I was testing edge cases and found this - blockers on an empty terminal are shared accross other empty terminal tabs. Even if the two empty terminals diverge (I open a different folder in one and the other remains in initial state) the blockers are still shared in each.* 
- [x] Tabs whose project has open blockers show an amber count badge; resolving
      clears it.
- [failed] Real-world drill: open a project you worked on yesterday — can the rail alone (blockers + accomplished + git log) tell you where you left off in
      under 30 seconds?
        *the git log is the only one that populates no historical Decisions, Blockers, or Accomplished loads from previous sessions*

      Re-proof 2026-09-11: **still failed** on the active Logic Loop project
      after a substantial testing/planning session. Since You Left exposed the
      latest agent prose but reported only command counts (`4 commands`, `0
      turns`, `0 stops`); Accomplished primarily listed raw command activity
      plus an old generic “Agent finished” row, not the completed testing and
      planning outcomes. Attention's two active items were detector noise from
      command/document text (`EPERM` and an intentional missing-path `rg`
      result), while Backlog contained 46 mostly unavailable historical items.
      The rail was enough to identify that work was active, but not enough to
      choose the next productive action confidently within 30 seconds without
      reading terminal history. No week-long “zero unnoticed decisions” claim
      can be made from this pass.

## 12. Phase 3 — Decision Tracker

Background: when an agent asks you a question and moves on without an answer,
the app should surface it as an open "decision" so nothing slips by.

- [x] Golden set: 12/12 extraction cases pass. *(auto ✓ 2026-07-11, claude backend.
      Rerun `npm run golden` after ANY prompt change.)*
- [x] E2E: question in transcript → open decision row within ~15s. *(auto ✓ 2026-07-11)*
- [-] Rail shows the open decision card with the question (and the agent's
      assumption, if it stated one); tab gets a violet count badge.
      *In earlier tests this was working but this current run the questions aren't surfacing in the decisions side bar - reference test 2.2*
- [-] Click ⌕ on a decision — modal shows the agent's message and your reply
      (or "no reply").
      *unable to test*
- [-] Click ✎ — app switches to that tab and pre-types
      `Re: "<question>" — ` into the terminal WITHOUT sending it. You finish
      the sentence and press Enter yourself.
        *failed on 2026-09-11 with a labeled disposable database row bound to
        the active Codex tab: clicking ✎ inserted the unsent draft but changed
        the row from `open` to `answered` immediately with `user_answer =
        NULL`. After focusing the terminal and clearing the entire draft
        without submitting, the row remained `answered`. The synthetic row was
        deleted after verification; no real decision was changed. This is the
        Phase 33 truthful-answer-state bug.*
- [-] Click ⤳ (delegate) — decision moves to the closed list marked delegated,
      badge count drops.
        *unable to test currently but in earlier tests I was clicking around and got this reaction*
- [-] Questions you already answered in the conversation show up pre-closed and
      never badge.
        *unable to test*
- [-] ⚙ settings → switch extractor to LM Studio. With LM Studio running,
      decisions still get extracted. With LM Studio STOPPED, extraction just
      silently does nothing — terminals must be completely unaffected.
        *unable to test - I need to setup LM studio properly but I can confirm the UI for ' ⚙ ' is too small it looks microscopic and needs to be more visible*
- [-] Week-of-use exit criterion: zero "agent decided without me and I didn't
      know" incidents. Any miss becomes a new golden fixture.
        *unable to test - less than 24hrs of testing*

## 13. Phase 4 — Landing note / residue / momentum

Background: the ritual layer — reduce switch-recovery cost. Leaving a tab that
had agent activity prompts a "next physical action" note; the rail shows what
you left behind and one thing to do next.

### Landing Note modal
- [x] In tab A, let an agent do something (any hook event — a tool use, a Stop).
      Switch to tab B. → Landing-note modal appears for A within a moment.
- [x] The textarea pre-fills with a suggested next action (drafted from A's last
      transcript turns). If the draft backend is slow/off, the box stays empty —
      terminals unaffected either way.
- [x] 60s circular countdown ticks down. Hitting zero auto-skips (modal closes,
      never held hostage).
- [x] Esc skips. Skip closes with no saved action (but IS logged — see metric).
- [x] Type an action, Save (or ⌘/Ctrl+Enter). Modal closes.
- [x] Flip A↔B repeatedly within 10 min → at most ONE prompt per tab (debounce).
- [x] Close a tab (⌘W or ✕) that had agent activity → modal appears after the
      PTY dies; the draft still works (reads persisted transcript).
- [x] App quit (⌘Q) → NO landing modal; only the existing quit-confirm dialog.
- [x] Skip-rate metric: skips write a `notes` row with `kind='landing',
      status='skipped', body=''`. Verify:
      `sqlite3 <db> "SELECT status,count(*) FROM notes WHERE kind='landing' GROUP BY status"`

### Attention Residue (rail, "Left behind" section)
- [x] Switch A→B: the rail's "Left behind" section shows A's project name, A's
      last agent-state dot, and A's landing note (or "no landing note").
- [ ] Type in its quick-add input + Enter → residue row filed against A's cwd,
      input clears, row appears in the list (up to 3 shown).
      *The whole section — header, landing note, quick-add, list — belongs to
      the PREVIOUS tab. Sitting in B, that box files against A. To file a note
      about B, type it while sitting in A (spec §3.3).*
      **PENDING RETEST** — failed 2026-07-18: rows vanished across tab flips.
      Tab cwd started as the bookmark's spelling then got overwritten by the
      agent's real cwd on first hook, so writes and reads used differently-cased
      keys. Fixed via `pty::canon()`; needs rebuild + rerun to close.
- [ ] Switch back to A: the section now shows B (the tab you just left), not A.
      With two tabs it swaps rather than disappearing — it only disappears when
      there is no previous tab, or previous and current share a cwd.
- [X] ✕ on a residue row clears it (marked done).

### Momentum Builder (rail top, "Next" card)
- [x] Seed an open landing note + an open decision + an open blocker for a
      project. The "Next" card shows the landing note (labeled `landing note`).
- [x] Click ✓ Done → ~800ms confetti burst; card advances to the oldest open
      decision → Done → oldest open blocker → Done → card disappears entirely.
- [x] Underlying rows actually change state (landing→done, decision→answered,
      blocker→resolved); badges update.

### Exit criterion (self-tracked, manual)
- [x#1] Note the clock at a context switch; note when the first productive
      keystroke lands after returning. Switch-recovery time should measurably
      drop with landing notes vs. without.

## 14. UX fix sprint (2026-07-18)

### Window drag
- [-] Open the landing-note modal (or a decision's ⌕ context modal) → the
      titlebar above the overlay still drags the window.
      Partial fail - sometimes it's allowing me to move the window but frequently after a move there is a blocked period where I can't move it again. I find that if I am in a different app and try to move the window I can but if I move the window without changing apps I cant move the window again.  
- [failed] Drag empty space in the tab strip / bookmarks bar → window moves
      (Chrome-style). Clicking tabs/bookmarks still works.
      It let's me drag a tab or bookmark and a green plus sign shows on the dragged tab/bookmark but when I let go or un-click nothing happens

### Paste (no permission pill)
- [x] ⌘V into a terminal and into the "Add blocker…" input → text pastes
      immediately, no macOS "Paste" popup.
- [x] Multi-line paste into claude still arrives as one bracketed paste.

### Images into claude
- [x] Screenshot to clipboa
rd (⌃⇧⌘4), ⌘V in a terminal running claude → a
      `~/.context-terminal/pastes/paste-*.png` path is pasted; claude can read it.
- [x] Drag an image file from Finder onto the terminal → its quoted path is
      typed into the active terminal.

### Sidebar
- [-] Accomplished: plain-English headline per row, raw tool line under it,
      max 10 rows, `＋ N more` expands / `− show less` collapses.
      It does say in plain english but it is vauge 'edited TESTING.md' without context of why if thats accurate then pass
- [-] Blockers (detector rows): label leads, raw match line clamped to 2 lines,
      ＋ expands.
      Same as above maybe not the most helpful notes 'Permission denied' and 'Tests failing' what permission and what test? why does it matter?
- [x] Decisions: ✕ dismisses without answering/delegating; row moves to the
      closed list with a ✕ marker; badge count drops.

### Tabs & bookmarks
- [x] Active tab is visibly lighter than inactive tabs.
- [x] Drag a tab onto another → order changes. Drag a bookmark onto another →
      order changes and survives app restart. *(reverified 2026-07-19)*

## 15. Phase 5 — Hardening (project identity / tab tether / hook contract)

**Do this first:** the hook command changed (it now sends the tether and
contract-version headers). Toggle hooks **off then on** in ⚙ Settings, or every
check below silently tests the old contract.

### Project identity
- [x] Open a tab at a repo root, run `claude`, let it produce a blocker or
      decision. Open a second tab, `cd` into a subdir of the same repo
      (e.g. `src-tauri`), run `claude` there. Both tabs' side panels show the
      **same** rows — the project no longer splits by subdir.
  
- [x] With both tabs from the previous check still open, confirm no **new** row
      landed under a subdir key. Run from `~/Library/Application Support/
      com.vandershark.context-terminal/` (the space in the path breaks
      copy-paste; `cd` there first):
      `sqlite3 -header -column context-terminal.db "SELECT cwd, datetime(ts/1000,'unixepoch','localtime') t FROM blockers WHERE ts > (strftime('%s','now')-3600)*1000 ORDER BY ts;"`
      → every row from the last hour reads `…/context_terminal`, none reads
      `…/context_terminal/src-tauri`.
      **Rows written before the Phase 5 fix stay under their old split key** —
      the fix changes writes only, there is no backfill. Without the time
      window this check fails forever on a working build. *(cost an hour of
      false debugging 2026-07-19)*

- [x] Open a tab in a non-repo dir (e.g. `~/Desktop/inbox`) → panels key on that
      dir itself, not on `~`, and not on some parent repo.

### Tab tether
- [x] Two tabs, **same repo**, agent running in each. The **state dot** on each
      tab reflects that tab's own session (tether governs dot/session
      ownership only). Blockers and Decisions cards are project-scoped by
      design (`WHERE cwd = $1`, invariant #3) and correctly show identical
      rows in both tabs — that is not a tether concern, doc previously implied
      otherwise. Verified 2026-08-11: no code bug, `bindSession` in
      `src/lib/ingest.ts` binds tether-first correctly.
- [x] Run `claude` in an **outside** terminal (Terminal.app/iTerm) in a repo you
      have a tab open for → still binds to that tab (untethered cwd fallback).
      *(verified 2026-08-11: landed on `context_terminal` tab, state dot updated)*
- [x] Close a tab while its agent is mid-turn → its late events bind to nothing;
      no other tab's dot flickers.

### Ingestion failure is visible
- [x] **Missing transcript warns.** Run `claude` in a tab, send one prompt, then
      delete that session's JSONL while it is still live:
      `rm ~/.claude/projects/<slug>/<session-id>.jsonl` (the path is in the
      `transcript_path` of its hook rows). Send another prompt → within ~5s the
      side panel shows a red strip: `⚠ no transcript for 1 session — decisions
      incomplete`, and hovering it lists the missing path. Deleting a transcript
      is safe: Claude Code recreates it, which also verifies recovery — the
      strip clears on its own once lines flow again. *(verified 2026-08-11:
      strip appeared on next prompt, cleared on its own once JSONL recreated)*
- [x] **The app never ingests its own extractor.** With the decision extractor
      set to `claude` (⚙ Settings), use the app until a decision is extracted,
      then check no session keyed on `/` was ingested:
      `sqlite3 context-terminal.db "SELECT COUNT(*) FROM events WHERE json_extract(payload_json,'\$.project_key')='/';"`
      → the count must not grow. It growing means the extractor tether broke and
      the app is observing itself (see CLAUDE.md landmines). Cross-check that
      `project:` in the side panel still shows a real directory name on every
      tab — a blank one is this bug's first visible symptom.

### Hook contract
- [x] Back up `~/.claude/settings.json`. Toggle hooks off → on → off. `diff`
      against the backup: **byte-identical**, and your pre-existing non-Logic-Loop
      hooks survive untouched. *(verified 2026-08-11: only `hooks` key changes;
      no pre-existing non-Logic-Loop hooks present, so `{}` is correct off-state;
      round-trip confirmed byte-identical after even toggle count)*
- [x] With hooks on, the installed command contains both `X-Logic-Loop-Tab` and
      `X-Logic-Loop-Hook: 1`. *(verified 2026-08-11)*

## 16. Phase 6 — Re-entry / unclaimed results / nudges

**Do this first:** toggle hooks **off then on** in ⚙ Settings — this phase
adds `SessionStart` to the registered hook set, and a stale install won't
send it.

### Re-entry
- [x] Mid-run process death: with an agent running in a tab (known
      `sessionId`), kill its shell out from under it (e.g. `kill` the PTY's
      shell PID from another terminal). The dead-tab overlay reads
      **"Re-enter"**, not "Restart". Click it → resumes with the prior
      conversation's context intact (ask it something only visible earlier in
      that conversation).
- [x] Full relaunch: open 3 tabs, run an agent in each, quit through the
      confirm dialog, relaunch → 3 ghost ("Re-enter") tabs appear, one per
      session, each resuming its own context correctly.
- [x] Before quitting in the check above, explicitly close one of the 3 tabs
      (✕, not quit) → relaunch shows only the other 2 ghost tabs; the closed
      one does not come back.
- [x] A tab opened fresh (no `sessionId` yet) still shows the old plain
      "Restart" wording on death — unchanged path.

### Unclaimed results
- [x] Two tabs, both running agents. While tab A is active, let tab B's agent
      finish (`Stop`) → tab B's dot gets the emerald glow; tab A's does not.
- [x] Switch to tab B → glow clears on B only; any other still-flagged tab is
      unaffected.
- [x] Background the whole app (⌘-Tab away) while a foregrounded tab's agent
      finishes → its tab still flags (app-level backgrounding, not just
      cross-tab), and refocusing the app (window `focus`) while that tab is
      still the active one claims it.
- [x] Trigger an unclaimed result, then quit and relaunch before claiming it
      (re-entry from the section above) → the Accomplished panel still
      headlines "Agent finished, unclaimed" for that project — the event
      survived the restart.
- [x] **Claim it after that relaunch** — the other half of the check above, and
      the one that was broken. Let an agent finish on a *background* tab, quit
      **without** ever switching to it, relaunch, then switch to that tab with
      the window focused → the emerald glow clears **and** the Accomplished
      panel's "Agent finished, unclaimed" row disappears. It must not come back
      on a later relaunch.

      Why it gets its own step: until the 2026-08-12 fix, `claimTab` gated on
      an in-memory flag set that a restart left empty, so a surviving result
      could be *displayed* but never *claimed* — the row pinned forever. The
      check above passes even when this one fails, so persistence alone was
      never proof the feature worked. See docs/AUDIT-2026-08-12.md finding 1.

      Also confirm ordering while here: the **first** ghost tab (auto-activated
      at startup) claims correctly too — seeding runs before activation, and
      getting that backwards strands exactly that one tab.

### Nudges
- [x] Background a tab (switch away or background the app), let its agent hit
      a `Notification` (permission prompt / waiting-for-input) → one OS
      notification appears ("Waiting for input"). Let it sit — a repeated
      idle-reminder `Notification` for the same still-waiting session must
      **not** produce a second OS notification (edge-triggered, not level).
- [x] Background a tab, let its agent finish (`Stop`) → one OS notification
      ("Finished").
- [x] Click "notify" in the side panel's pinned header to mute the active
      project → repeat either scenario above for that project → no OS
      notification, panel still shows "muted". Click again to unmute →
      notifications resume.
- [x] First launch after granting/denying the OS permission prompt: denying it
      must not affect anything else in the app (terminals, panels) — nudges
      just silently never fire.

## 17. Phase 7 — Fan-out spawn (RAH)

- [x] Fan out 3 children from a parent tab (mixed cwds, one row with a
      `claude` command, one plain shell). All 3 spawn, each tethered (hook
      events bind by tether, not the cwd fallback — check they land in the
      right tab even if two share a cwd). Parent tab's side panel shows a
      "Fan-out" section, 0/3 done.
- [x] Finish one child's agent run → switch to the parent tab → its rollup
      row for that child shows the flag dot (unclaimed). Claim it by
      activating the child tab, then switch back to the parent → the row
      flips to done and the aggregate count increments.
- [x] Kill one child's shell process externally (e.g. `kill` its PTY shell
      PID from another terminal) → that child's dead-tab overlay appears;
      its rollup row shows dead; siblings and the parent are unaffected
      (fail open).
- [x] Relaunch the app → group membership survives (persisted tables); the
      rollup rebuilds against the restored re-entry bindings. The Phase 6
      §16 "claim it after that relaunch" behavior still holds for a fan-out
      child, not just an ordinary tab.
- [x] Inspect `session_bindings` after a fan-out — no child ever carries the
      extractor sentinel tether (`ingest::EXTRACTOR_TETHER`), and extractor
      runs still don't get ingested. This is the 2026-07-19 self-ingest
      failure mode; fan-out children are tethered the *opposite* way from
      the extractor's exemption, and conflating the two reproduces it.
- [x] A child tab shows the "part of `<label>` (`<parent title>` ↗)" strip
      pinned under its side-panel header; clicking it jumps to the parent
      tab.
- [x] Paste a JSON array (e.g. `[{"cwd": "...", "cmd": "claude"}, {"cwd":
      "..."}]`) into the Fan out modal's paste box, click "Load into rows
      above" → the form's rows populate for review/edit; nothing spawns
      until Launch is clicked (paste never auto-launches).
- [x] Fan out with one row's cwd deliberately invalid/unspawnable → that
      child fails silently (fail open, invariant #2); the other rows still
      spawn and the group still forms.

## 18. Phase 8 — OpenCode adapter

- [x] Binary detection: with `opencode` on `$PATH`, the "opencode ?/on/off"
      pill appears in the bookmarks bar next to "hooks on". *(2026-08-18:
      first pass found a real gap, not a bug — `opencode` had only ever been
      run via `npx`, no persistent binary on `$PATH` for detection to find.
      `npm i -g opencode-ai` fixed it; pill appeared after a window reload —
      `opencode_detect` is a live PATH check at mount, doesn't need a
      rebuild, just a remount.)* Rename/remove `opencode` from `$PATH` (or
      test on a machine without it) → pill is absent entirely, not just
      disabled. *(not yet re-verified now that it's installed — low risk,
      logic unchanged since the empty-PATH case above proved it works)*
- [x] Click the pill off→on: `~/.config/opencode/opencode.json` gains a
      `"plugin"` entry pointing at
      `~/.context-terminal/logic-loop-opencode-plugin.mjs`; that file exists
      and is non-empty. Any pre-existing unrelated content in
      `opencode.json` (model, other plugins) is untouched. *(2026-08-18:
      confirmed — file went from `{}` to the expected `"plugin"` array.)*
- [x] Click on→off: our plugin entry is removed; unrelated content in
      `opencode.json` is still untouched (byte-identical minus our entry).
      *(2026-08-18: confirmed — file went to `{"$schema": "..."}`, an
      unrelated key opencode itself had added; our entry gone, that key
      untouched.)*
- [x] With the pill on, open a tab and run `opencode`, send one message,
      let it use a tool, let it go idle. Inspect the app's sqlite DB
      (`events` table) directly — rows with `hook_event_name` in
      `SessionStart`/`UserPromptSubmit`/`PostToolUse`/`Stop` appear, tagged
      with the session id OpenCode reports and the tab's real tether (not
      cwd-fallback). *(2026-08-18: confirmed directly in sqlite — real
      `ses_...`-format session id, real tab-uuid tether (not cwd-fallback),
      full `SessionStart → UserPromptSubmit → PostToolUse → Stop` sequence
      across two turns. `PostToolUse` carried the real tool name
      (`"read"`, lowercase — opencode's own naming, cosmetic difference
      from Claude's `"Read"`) plus full args/output, so the Accomplished
      panel gets real content, not just a state dot.)*
- [x] Tab dot reflects real agent state (not stuck on "running" the way an
      unadapted CLI does per the 2026-08-17/18 fan-out smoke test findings,
      ROADMAP.md). *(2026-08-18: confirmed — blue on execution, green on
      completion, matching the DB's PostToolUse/Stop rows.)*
- [x] Fan out with `opencode` as a child's launch command (§17's scenario,
      re-run): the child's rollup status advances past "running" off a real
      `session.idle` signal; the child's own decisions/tool-events panel is
      no longer forced into `isUnboundFanOutChild`'s empty state (a real
      session is bound) — confirm it shows *its own* activity, not the
      parent's. *(2026-08-18: confirmed both visually — blue on execution,
      green on completion, matching Phase 7's own state colors — and in
      sqlite: real `ses_...` session id tethered to the child tab uuid
      specifically (not `tab-23`/the parent, not cwd-fallback), clean
      `SessionStart → UserPromptSubmit → Stop` sequence. Also incidentally
      confirmed the landing-note popup fix from the same session — no
      spurious prompt fired during this fan-out launch.)*
- [x] Kill the ingest server (or point `ingest.env` at a dead port) while
      opencode is mid-session → opencode's own session is completely
      unaffected (responds normally, no hang, no visible delay) — the
      fire-and-forget requirement (PLAN.md Phase 8 Mechanism §2) holds even
      when every POST fails. *(2026-08-18: confirmed — `CT_PORT` pointed at
      port 1, fresh `opencode` session responded to a message completely
      normally. Tab dot correctly stayed grey/no-transition the whole time —
      expected, not a failure: no event could possibly land against a dead
      port, so no state change is the correct outcome, not evidence of a
      hang.)*
- [x] Uninstall/quit without removing the plugin, relaunch app, click pill
      off then on again → still idempotent, no duplicate `"plugin"` entries.
      *(2026-08-18: confirmed — off/on/off/on across a relaunch left exactly
      one `logic-loop-opencode-plugin` entry, `$schema` untouched.)*

## 20. Phase 10 — Codex adapter

- [x] Toggle "codex on" with `codex` installed → `~/.codex/hooks.json`
      contains exactly our 5 events (`SessionStart`, `Stop`, `PostToolUse`,
      `UserPromptSubmit`, `PermissionRequest`), each `command` the same
      curl one-liner already registered for Claude in
      `~/.claude/settings.json`. A pre-existing unrelated `hooks.json` entry
      (if any) survives untouched. *(2026-08-27: confirmed — fresh
      `~/.codex/hooks.json`, exactly the 5 events, `PostToolUse` alone
      carries `"matcher": "*"`, all 5 `command` values identical to the
      shared `hook_command()` string. No pre-existing hooks.json on this
      machine, so nothing to check for survival.)*
- [x] Launch a real `codex` session in a Logic Loop tab, cwd inside a
      tracked project → Codex's TUI shows the one-time hook-trust prompt;
      approve it. *(2026-08-27: confirmed — "Hooks need review / 5 hooks
      are new or changed", matching all 5 registered events; chose "Trust
      all and continue".)*
- [x] After trust is approved: side panel shows the tab transitioning
      working → idle across a real turn, tether-bound (not cwd-fallback) —
      verify via sqlite, same check style as Phase 8's §18. *(2026-08-27:
      confirmed in sqlite — real `01a043fc-...`-format Codex session id
      (uuid-v7 shape, distinct from Claude's v4), clean `SessionStart →
      UserPromptSubmit → PostToolUse ×4 → Stop` sequence for one turn ("Read
      this root folder and tell me what's here"), every row carrying the
      same real tab uuid (`149d9bad-b47c-408a-904d-2834765e2612`) — not
      cwd-fallback.*

      **Found and fixed during this check:** the same hook payloads also
      carry Codex's `transcript_path` (its own rollout-*.jsonl), and
      `ensure_tailer` in `ingest.rs` is agent-agnostic — it was tailing and
      persisting that file's raw content (encrypted reasoning blobs, full
      shell output) into the `events` table as `type: 'transcript'`, one
      turn alone writing 24 such rows. This directly contradicted PLAN.md's
      stated non-goal ("No use of ... the rollout transcript as a live
      ingestion source"). Decision extraction itself was unaffected —
      `decisions.ts`'s strict `assistant`/`user` type check silently drops
      Codex's `response_item`/`event_msg` shape — so this was a storage/
      scope leak, not a cost or crash bug. Fixed same session:
      `is_claude_transcript_path()` gates the tailer to `/.claude/projects/`
      paths only; new test `ingest::tests::
      only_claude_transcript_paths_are_tailed`. See PLAN.md's non-goals
      section and CLAUDE.md's Phase 10 status entry for the full note.)*
- [x] Trigger a tool call inside the Codex session → a `PostToolUse` row
      lands with a real `tool_use_id`, dedupe key behaves (no duplicate row
      on a second identical-content event). *(2026-08-27: confirmed post-fix
      — a fresh Codex session, "Tell me what's in this folder", produced 4
      distinct `PostToolUse` rows each with a real unique `tool_use_id`
      (`call_BrUCpVkMPD2IFTJ8ai2U5DPx`, etc.), no collisions. Also
      re-confirmed the transcript-tailer fix holds: zero `type='transcript'`
      rows for this session, only `hook:*` rows.)*
- [x] Trigger a permission-request moment (a sandboxed command needing
      approval) → tab shows "waiting" state via the new `PermissionRequest`
      case. *(2026-08-27: confirmed at the hook/plumbing level — asking
      Codex to `curl -I https://superlogicai.com` (network access is
      outside the default sandbox) produced a real `hook:PermissionRequest`
      row, correct tool context and tab tether. `stateForHook`'s new case
      maps this to `"waiting"` unless `Stop` already fired for that
      session, which it hadn't at that point in the turn — logically the
      dot should have pulsed amber, but the user didn't specifically watch
      for it in the moment (was looking at a different tab), so the visual
      itself is unconfirmed. DB-level confirmation is solid; re-verify
      visually only if you want the belt-and-suspenders check.)*
- [x] Toggle "codex off" → `hooks.json` either loses just our entries (if
      the user had other hooks) or is removed/emptied entirely; re-toggle
      on → idempotent, no duplicate entries. *(2026-08-27: confirmed —
      off/on cycle left exactly one entry per event, no duplicates,
      `PostToolUse` still the only one carrying `"matcher": "*"`.)*
- [x] Fan-out and isolate-loop children running `codex` (not just `claude`)
      still bind correctly — spot-check one fan-out child, confirm no
      regression to `findGroupForTab`/`isUnboundFanOutChild`. *(2026-08-27:
      confirmed — fan-out group `3c0bd698...` off parent tab `149d9bad...`,
      two `Codex` children (`spawn_group_members.cmd`), each ran a turn.
      sqlite: child session `01a044a7-2a82-...` bound tether
      `1e7d1186-...`, child session `01a044a7-3658-...` bound tether
      `24f43fdb-...` — each its own child tab, not the parent's
      `149d9bad`, not collapsed onto one binding (no cwd-fallback).)*
- [x] Dead-port test (ingest server unreachable) — confirm the reused
      `hook_command()`'s existing 2s-timeout/fail-silent behavior holds for
      Codex the same as it does for Claude. *(2026-08-27: confirmed —
      `hook_command()`'s literal shell string run with `HOME` pointed at a
      fake `ingest.env` (`CT_PORT=1`) and a real hook payload piped to stdin
      returned in 0.013s, exit 0. Port 1 refuses instantly — didn't even
      need the 2s `-m` timeout to kick in. Same conclusion as Phase 8's
      dead-port check for opencode: no event lands, no hang, no exit-code
      failure.)*
- [ ] Quality gates (recorded 2026-08-27, pre-manual-test): `cargo test`
      17/17 (4 new `codex::tests`), `cargo clippy --all-targets -- -D
      warnings` clean, `tsc --noEmit` clean, `npm run golden` 12/12
      (unchanged — no extraction-prompt work this phase), all 9 check
      scripts pass (unchanged — no ingestion/binding/dedupe logic touched;
      the one frontend change, `stateForHook`'s new `PermissionRequest`
      case, has no dedicated check script per PLAN.md's non-goals).

## 19. Phase 9 — Isolate loop (git worktrees) + Commit & Push footer

1. [x] "Isolate loop…" on a repo tab, new branch "try-x" → worktree appears
       under `~/.context-terminal/worktrees/<project>/try-x`, new tab opens
       there, branch is `loop/try-x` checked out from the source tab's HEAD.
       *(2026-08-18: confirmed.)*
2. [x] Same flow, "Existing branch" tab, pick a branch with a `/` in its
       name (e.g. `feature/foo`) → directory is sanitized (`feature-foo`),
       branch checked out unchanged (`feature/foo`). *(2026-08-18: confirmed
       — dir `feature-foo`, `git branch --show-current` inside it reports
       `feature/foo`.)*
3. [x] Confirm project identity isolation: the worktree tab's side panel
       shows its own decisions/blockers, not the source repo tab's.
       *(2026-08-18: confirmed on the try-x tab.)*
4. [x] Close the worktree tab → `ask()` prompt appears; **Keep** → tab
       closes, worktree + branch survive on disk (`git worktree list` still
       shows it). *(2026-08-18: confirmed on try-x via `git worktree list`.)*
5. [x] Reopen a tab isolate loop, close with **Remove worktree** → directory
       gone, `git worktree list` no longer shows it, branch still exists
       (`git branch --list` shows `loop/<slug>`). *(2026-08-18: confirmed on
       try-y — dir gone from `git worktree list`, `loop/try-y` still in
       `git branch --list`.)*
6. [x] Make an uncommitted change in a worktree tab, close, choose **Remove
       worktree** → second confirm names the dirty state explicitly;
       declining leaves the worktree intact; confirming force-removes it.
       *(2026-08-18: confirmed both halves — declined on try-z, `git status
       --short` still showed the dirty `README.md`; confirmed force-remove
       on a fresh try-w, dir gone from `git worktree list`, `loop/try-w`
       branch survived. try-z's worktree was left dirty on disk afterward —
       harmless leftover, not cleaned up as part of this test.)*
7. [x] Quit and relaunch the app with a worktree tab open → re-entry
       restores it as an ordinary ghost tab (Phase 6 behavior, unchanged);
       closing it post-relaunch still offers the cleanup prompt
       (`worktree_tabs` survived the restart, not just in-memory state).
       *(2026-08-18: confirmed on try-b, with a real `claude` session
       running in it before quitting — ghost-tab restore is keyed off
       `session_bindings`, populated only by an agent's `SessionStart` hook,
       so a worktree tab with no agent run in it (try-v, tried first) does
       not ghost back; that's Phase 6 behavior, not a Phase 9 gap. After
       relaunch, closing the restored try-b tab still fired the cleanup
       prompt and Remove worked — `git worktree list` lost the entry, DB
       row deleted, `loop/try-b` branch survived.)*
8. [x] Attempt "Isolate loop" with a slug that collides with an existing
       worktree dir/branch → the git error surfaces visibly in the modal,
       no tab is created, no crash. *(2026-08-18: confirmed incidentally —
       tried to reopen `loop/try-z` via "Existing branch" while its
       worktree was still checked out; git's "already used by worktree at
       ...” error rendered inline in red in the modal, Launch/Cancel still
       responsive, no crash.)*
9. [x] Commit & Push footer on a branch that already has an upstream → one
       click commits + pushes, no `-u` retry needed. *(2026-08-20: confirmed
       on `loop/footer-test` — two separate commit+push+PR clicks (`a7afe53`,
       then `369a968`), both landed on the first plain `git push`, both
       confirmed on `origin/loop/footer-test` via `git ls-remote`, no error
       either time.)*
10. [x] Commit & Push footer on `main` → the "commit + push → main" button
        triggers the `ask()` confirm. Accept path: pushes straight to `main`.
        Decline path: no-op. *(2026-08-27, accept path: confirmed live — user
        clicked through the confirm dialog on `main`, commit `fbd03a8` landed
        on `origin/main` via a plain push. 2026-08-27, decline path: confirmed
        — `git status`/`HEAD`/`origin/main` all verified byte-identical to a
        pre-click baseline after Cancel.)*

        **Bug found during the accept-path check (not in the original
        plan):** the commit that landed added `mod codex;` and 4 `codex::*`
        command registrations to `lib.rs` but never staged the new `codex.rs`
        file itself — `git add -u` only stages tracked files, and
        `git_has_changes` (the footer's dirty gate) queries with
        `--untracked-files=no`, so a change consisting only of a new file is
        invisible to the footer at both the gate and the staging step.
        `origin/main` failed `cargo check` for a fresh clone as a result.
        Fixed same session (commit `fb79dea`): `git_untracked_files`/
        `git_add_all` new Tauri commands, a `hasStageable` footer gate that
        also counts untracked files, and an amber warning box in the footer
        listing untracked files with an opt-in checkbox — never silently
        included, never silently dropped. See CLAUDE.md's Known landmines
        for the full note.
11. [x] Clicking the left button while on `main` creates and pushes a real
        `wip/<timestamp>` branch — `main` itself untouched locally and on
        the remote. *(2026-08-27: confirmed on two separate runs —
        `wip/20260828015619` (throwaway, PR #2, closed + branch deleted
        after verification) and `wip/20260828022446` (real Phase 11 work,
        PR #4, kept). Both times `main`'s local ref and `origin/main` stayed
        at `efca58f` throughout, untracked-file opt-in checkbox correctly
        defaulted off and was honored, not silently included or dropped.)*

        **Bug found during the first run (not in the original plan):**
        `commitAndPush`'s wip-branch path (`SidePanel.tsx`) does a real
        `git checkout -b` in the tab's own live working directory (not a
        worktree) to create the wip branch, commits, pushes — and never
        checked back out to the original branch afterward. `main`'s ref and
        remote were technically untouched (satisfying this item's literal
        wording), but the tab's actual git checkout was silently left on the
        new wip branch permanently, with only the footer's branch pill
        (UI state, not real git state) suggesting anything had changed. This
        surfaced as an apparent working-tree data-loss scare: a later
        unrelated `git checkout main` (cleanup after the throwaway PR) then
        correctly reverted tracked files to `main`'s committed content per
        normal git semantics, since the real Phase 11 diff had by that point
        been committed onto the abandoned wip branch, not lost — recovered
        via `git fsck --dangling` since the commit object was still in the
        odb. Fixed same session: new `git_checkout` Tauri command (plain
        checkout of an *existing* branch, `pty.rs`) plus a `switchedFrom`
        tracker in `commitAndPush` whose `finally` checks the tab back out
        to its original branch on every exit path (success, push failure,
        PR failure) — never strands a live terminal on a branch it didn't
        ask to be on. Rebuilt/reinstalled and re-verified live on a second
        run (`wip/20260828022446`): tab correctly landed back on `main`
        after push+PR, `main` stayed clean throughout.

        **Second bug found on the same second run (not in the original
        plan, same class as item 10's):** PR #4 (the real Phase 11 work)
        also left `antigravity.rs` untracked/unstaged — the opt-in checkbox
        worked exactly as designed, but was left unchecked on real wanted
        work rather than a throwaway, so the pushed PR branch didn't build.
        Not an app bug (the checkbox is deliberately opt-in and was visible
        the whole time) — a recurring human workflow trap worth being aware
        of. Fixed by hand: checked out `wip/20260828022446`, staged
        `antigravity.rs` + `docs/IDEAS.md`, committed (`db485a5`), pushed;
        `cargo check` confirmed clean on the branch afterward.
12. [x] With nothing dirty, the footer shows "no changes" and no buttons.
        *(2026-08-27: confirmed via code + live screenshot on a clean
        isolate-loop worktree tab — `hasStageable` false renders a disabled
        button with a gray dot (not amber), no chevron, and the expandable
        section doesn't render at all, so there is nothing to click into;
        `"no changes"` is the button's hover title. `SidePanel.tsx:159,
        896-937`.)*
13. [x] The cached commit message survives a second click without a second
        LLM call (no observable delay/spinner), and differs (triggers one
        generation) after the diff actually changes. *(2026-08-27: confirmed
        live on a throwaway isolate-loop worktree (`loop/try-item13`, PR #3,
        closed + branch deleted after verification) — first dirty edit
        generated "Add test1 line to README" once (spinner shown), reopening
        the footer with no further edits reused it instantly with no spinner,
        commit+push+PR cleared the footer to the item-12 empty state, a
        second distinct edit regenerated a new, different message ("Add
        test2 line to README") with the spinner reappearing once. Matches
        the design intent in `SidePanel.tsx:205-246`'s comment: the message
        regenerates once per dirty-state *onset* (`hasStageable` false→true),
        not on every background poll tick while continuously dirty.)*

**Quality gates rerun for item 11's `git_checkout` fix (2026-08-27):**
`cargo test` 34/34 (unchanged — the fix is a thin subprocess wrapper in
`git_create_branch`'s own style, no new unit tests needed), `cargo clippy
--all-targets -- -D warnings` clean, `tsc --noEmit` clean. Rebuilt via
`npm run reinstall` and reinstalled to `/Applications` before the live
re-verification of item 11 above.

**Bugs found and fixed during 1-8 (not in the original plan):**
- Launching "Isolate loop" left the source tab's landing-note popup firing
  spuriously on switch (same class of bug as the 2026-08-18 fan-out fix,
  `suppressLandingRef` in `App.tsx`) — `isolateLoop` never set the
  suppression flag at all. First fix (mirroring `fanOut`'s exact shape, an
  extra await before clearing) reduced but did not eliminate it — the
  underlying issue is that clearing the flag from the spawn call site races
  the tab-switch effect's own scheduling, and `fanOut` only avoided it by
  incidental extra-await timing, not by design. Real fix: the switch effect
  (`App.tsx`, activeId-watch effect) now consumes the flag itself
  (check-and-clear in one place) instead of the caller clearing it on a
  timer; `isolateLoop`/`fanOut` only reset it early on an error path where
  no switch ever happens to consume it. Confirmed no longer firing on
  isolate-loop launch after the fix.
- Isolate loop border styling adjusted per request: grey border with a
  subtle purple (fan-out) / blue (isolate loop) inset tint at rest,
  full-color border on hover (`TabBar.tsx`).

**Bugs found and fixed during 9 (not in the original plan):**
- `git_pr_create` spawned `gh` by bare name — worked from a terminal but
  ENOENTed (`No such file or directory (os error 2)`) when Logic Loop is
  launched as a GUI app, since a GUI process doesn't inherit the shell's
  PATH and `gh` lives under Homebrew (`/opt/homebrew/bin` or
  `/usr/local/bin`), not the default system PATH. Fixed with `gh_binary()`
  in `pty.rs`, checking both Homebrew locations before falling back to bare
  `"gh"`. Confirmed fixed: PR step no longer errors after rebuild.
- Footer state (`footerError`/`prUrl`/`footerOpen`) was never reset on
  `cwd` change — switching tabs left a previous tab's error or PR link
  showing under the new tab's (unrelated) branch pill, reading as if it
  just happened on the current branch. Found when a `footer-test` worktree
  PR failure appeared to follow the user back to the `main` tab. Fixed:
  `SidePanel.tsx` now clears all three on every `cwd` change; `commitAndPush`
  still owns setting/clearing them during an action.

## 21. Phase 11 — Antigravity (`agy`) adapter

Third non-Claude ingestion pipeline. Unlike Codex (Phase 10, a near-literal
clone of Claude's hook contract reused verbatim), Antigravity's real hook
contract — read from the installed CLI's own bundled docs
(`~/.gemini/antigravity-cli/builtin/skills/agy-customizations/docs/hooks.md`)
during this phase's build, not from web sources alone — differs enough from
both the web-sourced plan and from Claude/Codex's shape that PLAN.md was
revised before writing code (see its "Build-time revision" section): a
different `hooks.json` namespacing (one owned hook name, not a flat per-event
object), grouped vs. flat array shapes per event. `PreToolUse` is the only
event with a real `toolCall`-with-blocking-response contract, and it is
deliberately never registered (its contract expects a blocking
`{"decision": ...}` response; the doc's own "Current Limitations" confirms
hooks run synchronously and can block the loop).

**Corrected during manual testing (2026-08-27, item 2/3), superseding the
doc's claims above:** the doc says `PostToolUse` "carries no toolCall" — a
live payload captured mid-test had a fully populated one (`toolCall.name`/
`toolCall.args`), so `translate()` was fixed to map `tool_name`/`tool_input`
from it (was previously dropped entirely as a documented "gap" that turned
out to be a bug — see `antigravity.rs`'s `translate()` doc comment and its
`translate_post_tool_use_maps_tool_call_name_and_args` test). Separately, the
doc's `error` example (`"exit status 1"`) does not reflect live behavior: a
real shell command that genuinely exited 1 (confirmed by agy's own "Command
exited with return code 1" reply) still produced `"error": ""` on
`PostToolUse` — captured twice, before and after a full app rebuild/`agy`
restart, so not a stale-process artifact.

**Root-caused 2026-08-27 (superseding the "unresolved gap" this was first
filed as).** Two things settled it: decoding `hooks.proto`'s embedded
`FileDescriptorProto` out of the `agy` Mach-O, and capturing paired
`PostToolUse` payloads for a failing and a succeeding command from a probe
hook registered as the *sole* hook (see the merge caveat below).

* The real `PostToolHookArgs` is `step_idx`, `tool_call`, `error`, and an
  **undocumented fourth field `result`** (string).
* Failing `ls /this_path_does_not_exist_xyz` and succeeding `echo hello_ok`
  produced byte-identical `"error": ""`. `error` is not the failure signal.
* `result` never arrives. Neither do `PostInvocationHookArgs.model_output`/
  `.model_thinking` nor `StopHookArgs.final_model_output` — yet zero-valued
  fields (`executionNum: 0`, `invocationNum: 0`) *are* emitted, which proves
  those four are actively stripped by `jsonhook.dropUnsupportedFields`, not
  merely empty. All four are free-text output fields, apparently reserved for
  prompt-mode hooks (the doc lists prompt hooks as unimplemented).
  `jsonhook.Caller.UseFullHookInterface` is an SDK-level setter, not a
  `hooks.json` key, so a command hook cannot opt in.

**Conclusion: a non-zero exit is not observable from an agy command hook.**
This is an upstream contract limit, not a bug in `translate()` — there is no
field to map. Locked in by
`translate_real_failing_run_command_payload_carries_no_failure_signal`, which
asserts the verbatim captured failing payload yields no `tool_response`; if a
future agy release delivers `result` or populates `error`, that test fails and
that is the cue to wire `is_error` up. Do **not** close this gap by inferring
failure from `PostInvocation` model prose or the transcript — agent content is
untrusted (invariant #5) and parsing it for meaning is exactly what invariant
#1 forbids.

**Two side findings from the same probe, both independent of the above:**

* **Named hooks do not merge on `PostToolUse`**, contradicting the doc's
  "multiple named hooks … are merged and executed sequentially". With both
  `logic-loop` and a probe hook registered for `PostToolUse`, only
  `logic-loop` fired — zero probe invocations across six tool calls, while
  flat-shaped `PostInvocation`/`Stop` fired for both. So a user with any
  pre-existing `PostToolUse` hook in `~/.gemini/config/hooks.json` may get
  *no* Logic Loop tool events at all, silently. Same class as the
  `~/.claude/settings.json` foreign-hook landmine, but worse: our
  setup/remove is still correctly non-destructive (item 6 unaffected), the
  loss is at dispatch time. Untested: which of the two wins, and whether
  grouped-shape events merge when matchers differ.
* **`workspacePaths` can be `[]`** on a projectless/headless agy session
  (reproduced with `agy -p` outside any trusted workspace). `translate()`
  then emits no `cwd`, which is correct — app-spawned tabs bind by tether
  regardless — but an `agy` session started *outside* Logic Loop carries no
  tether and cannot cwd-fallback either, so it will not bind. Covered by
  `translate_empty_workspace_paths_omits_cwd`.

1. [x] Toggle "antigravity on" with `agy` installed → `~/.gemini/config/
       hooks.json` gains a `"logic-loop"` key containing exactly
       `PostToolUse` (grouped, `"matcher": "*"`), `PostInvocation` (flat),
       `Stop` (flat), each `command` pointing at this app's own binary path
       with `--antigravity-hook <Event>`. *(2026-08-27: confirmed via `cat
       ~/.gemini/config/hooks.json` — exact shape matches. No foreign hook
       was present to test survival against.)*
2. [x] Launch a real `agy` session in a Logic Loop tab, cwd inside a tracked
       project → trigger a tool call → confirm via sqlite a `PostToolUse` row
       lands with a correctly-translated `session_id`/`cwd` (from
       `conversationId`/`workspacePaths[0]`), tether-bound (not
       cwd-fallback) — same check style as Phase 8/10. *(2026-08-27: confirmed
       live. Also surfaced that `agy` only reads `hooks.json` at process
       startup — a session already running when hooks are toggled on won't
       pick it up; must be a fresh `agy` process. Original item wording
       expected no `tool_name`; superseded — see finding above, `tool_name`/
       `tool_input` now populate correctly.)*
3. [x] Trigger a tool failure (a command that exits non-zero) → the
       translated `PostToolUse` row's `tool_response.is_error` is `true`,
       tab state shows "error", not "working". **Cannot pass as originally
       specified; closed as an upstream contract limit, not a gap in our
       code — see the root-cause block above.** `tool_name`/`tool_input` do
       correctly populate on the failing call's row; `tool_response` is
       absent because agy sends no field that distinguishes a failed
       `run_command` from a successful one. Re-verify only if agy's hook
       contract changes — the unit test named above is the tripwire.
4. [x] Trigger `Stop` (end the turn/session) → tab transitions to idle in
       the side panel. *(2026-08-27: passed.)*
5. [x] Confirm no stall: time a tool call with the ingest server killed
       (dead-port test, same style as Phase 8/10's) — the agy session shows
       no perceptible added latency beyond `hook_command()`'s existing 2s
       timeout, and never surfaces an error/block to the user. *(2026-08-27:
       passed.)*
6. [x] Toggle "antigravity off" → `hooks.json` loses just the `"logic-loop"`
       key; any foreign hook name survives; re-toggle on → idempotent, no
       duplicate keys. *(2026-08-27: passed, after resolving a build-path /
       `/Applications` drift — the installed bundle was stale relative to the
       dev build, so the `command` string written by the toggle didn't match
       the binary under test. Unrelated to the adapter; same class as the
       "rebuild and reinstall before testing a hook-command change" step item
       8 already notes. **Not covered:** foreign-hook survival was verified at
       the file level only — no foreign `PostToolUse` hook was present, so
       this did not exercise the non-merging dispatch bug documented above.)*
7. [x] Fan-out children running `agy` get real tether binding (not "stuck
       running") — same check style as Phase 7/10's fan-out retest.
       *(2026-08-27: passed — two children produced two distinct
       `session_id`s bound to two distinct `tab_id`s, each different from the
       other and from the parent tab. Real tether binding, not a cwd-fallback
       collapse onto one tab.)*
8. [x] Quality gates (2026-08-27, pre-manual-test): `cargo test` 29/29 (11
       new `antigravity::tests` — `apply_setup`/`strip_ours` idempotency
       and foreign-hook preservation, the grouped/flat shape split, `error`→
       `tool_response` mapping, missing-field omission, and the `sh -c`
       single-quote escaping `command_for` relies on for paths with spaces),
       `cargo clippy --all-targets -- -D warnings` clean, `tsc --noEmit`
       clean, `npm run golden` 12/12 (unchanged — no extraction-prompt work
       this phase), all 9 check scripts pass (unchanged — this phase's only
       frontend change is the `AgentStatusBar.tsx` toggle and two new
       `src/lib/ingest.ts` bindings; no ingestion/binding/dedupe logic
       touched, and `dedupeKey`'s existing tool_use_id-presence branching
       already handles a `PostToolUse` payload with no such field correctly,
       confirmed by reading it rather than assumed). **Rerun 2026-08-27
       post-fix** (item 2/3 findings above): `cargo test` 32/32 (3 more —
       empty-error-string non-fabrication, `toolCall` name/args mapping,
       non-`PostToolUse` events never map `toolCall`), clippy clean, app
       rebuilt via `npm run reinstall` and reinstalled to `/Applications`
       twice during this test pass to pick up both fixes. **Final rerun
       2026-08-27** (item 3 root-cause writeup): `cargo test` 34/34 (2 more —
       the verbatim captured failing-`run_command` payload asserting no
       `tool_response`, and empty `workspacePaths` omitting `cwd`), clippy
       clean, `tsc --noEmit` clean. No source behavior changed in that pass —
       the two tests pin an upstream limit, so no reinstall was needed.

## 22. Clickable links in terminal output (2026-08-29)

All passed 2026-09-05.

- [x] Have an agent print a bare `https://` URL (or `cat` a file containing
      one). Hovering underlines it; clicking opens the system default browser.
- [x] The Logic Loop window itself does **not** navigate — the webview must
      still show the app, not the linked page.
- [x] Click a URL in a background tab's scrollback after switching to it;
      still opens externally (addon is loaded per-terminal, not per-visible).

## 23. Since-you-left delta + Clock on state (Phase 14)

Steps 1-3 passed 2026-09-05 (order shuffled by real usage — see notes).

- [x] Two tabs, agent edits 3 files on tab A while tab B is active → switch to
      A: "Since you left" shows 3 files, correct turn/stop counts, agent's
      last message text. Accomplished below it unchanged.
- [x] Stay on A, agent edits one more file → section grows to 4 files.
      Switch away and back → resets to the new delta only. *(Confirmed the
      reset half first, incidentally — checking step 1's result meant
      leaving and returning to A, which itself wrote a fresh anchor and
      correctly excluded the earlier edits. Grow-while-staying then
      re-verified cleanly: two further writes with no tab switch in
      between showed 1 file, then 2 — never reset.)*
- [x] Cmd-Tab to another app while A is active, agent finishes → return:
      section present, `result_claimed` also written (existing behaviour).
      *(Triggered by an accidental Cmd-Tab mid-test — window blur reset the
      anchor exactly like a tab switch does. `result_claimed`/`result_landed`
      pair confirmed via sqlite.)*
- [x] Quit with A live, relaunch, Re-enter → run one turn → section shows
      only post-relaunch activity; verify in sqlite whether the resumed
      `session_id` changed and that the tether path handled either case.
      *(Confirmed via natural usage across this test session, not a staged
      run: `session_bindings` for tab_tether `1b9a1780-...` shows session_id
      `137ff132-...` bound at one relaunch, then `8194fef1-...` at three
      later ones — the tether stayed the stable key exactly as designed
      while session_id changed underneath it. Also surfaced a real product
      question along the way — an interrupted turn doesn't survive a quit at
      all, distinct from the resume-changes-session-id question this step
      is actually testing — logged separately in `docs/IDEAS.md`, not a
      failure of this check.)*
- [x] Tab with no bound session, and an unbound fan-out child: no section.
      *(Both cases confirmed 2026-09-05: a fresh shell tab with no agent
      run, and a fan-out child launched with a blank `cmd` row.)*
- [x] Start a `sleep 240` inside an agent turn on a background tab → after 3
      min the dot shows the amber ring, tooltip reads `working · quiet 3m`,
      one OS nudge fires (and does not re-fire). When the command ends and
      PostToolUse lands, ring clears. *(All confirmed 2026-09-05 — bare
      `sleep` is blocked by a harness guardrail, substituted `caffeinate -t
      240`. First pass was watched from the active tab, which correctly
      suppressed the nudge per `shouldNotify` (`ingest.ts:171`) — not a
      miss. Second pass, genuinely backgrounded: ring, tooltip, single
      nudge (Notification Center: "Agent quiet 3m"), and clear-on-completion
      all confirmed. "mute suppresses it" was NOT re-verified live this
      pass — covered by `notify:check`'s `shouldNotify` assertions, not by
      a manual muted run.)*
- [ ] Leave an agent in `waiting` for 3 min → dot shows `3m` age text.
- [ ] Terminals: throughout, typing latency and PTY output unaffected.

## 24. Landing-note rainbow border (2026-09-05)

All passed 2026-09-05.

- [x] Work in tab A with real agent activity, switch to tab B, let the
      landing-note prompt fire, and save a note.
- [x] Return to the tab holding that note's project → the Next card border
      shows the ROYGBV gradient ring (not the plain `yellow-500/30` border),
      and the corners stay rounded, not squared off underneath.
- [x] The grey label in the card's top-right corner now reads `landing note`
      in per-letter rainbow. Phase 28 intentionally supersedes the old modal
      comparison: the modal heading is now solid and the gradient moved to its
      card border; the Next-card label remains unchanged.
- [x] Trigger a plain decision or blocker card afterward → confirm it still
      renders the solid yellow border and grey label — no gradient bleeding
      into the unrelated card.
- [x] Click ✓ Done on the landing-note card → status still flips as before;
      the style change touched only borders and label text.

## 25. Turn provenance + loop digest (Phase 15)

- [x] Type a prompt by hand, hit Enter immediately → tagged `human`, no `⟳`
      on the tab, flat Since-you-left shape (unchanged from Phase 14a).
- [x] Run `/loop 30s /some-command` (or equivalent auto-resubmit) for 3+
      wakeups with no manual input in between → each wakeup's
      `UserPromptSubmit` tagged `auto`, TabBar shows `⟳`, Since-you-left
      switches to loop-digest shape with correct iteration count.
- [x] Mixed session: one human turn, then 2 auto loop turns → digest shows
      the 2 auto turns collapsed into the loop shape. *(verified 2026-09-06:
      human turn preceded 3 auto iterations, digest showed "3 iterations
      while you were away" excluding the human turn; post-stop the panel
      correctly reverted to flat delta shape for the stop-message's own
      human turn)*
- [x] A loop iteration whose closing message is a no-op phrase ("no
      change", "nothing to do", "still waiting", "all good") → collapses
      into the `×N no change` line; a real-work iteration renders its own
      line with tool/error counts and its first assistant line. *(verified
      2026-09-06, safe_router: a 1m cron replying exactly "no change" twice
      collapsed into "×2 no change"; a separate cron tick running `ls` and
      summarizing the actual listing rendered its own line with tool count
      and first-assistant-line text, not folded into the collapsed run.)*
- [x] A decision opened mid-loop → shown pinned at the top of the digest,
      not buried inside an iteration line. *(found+fixed 2026-09-06: decision
      extraction is async and its row always lands ~6-7s after the
      iteration's own Stop — confirmed live via safe_router session
      `4e8ea829`, decisions at 01:21:11/01:22:23 landing after Stops at
      01:21:05/01:22:16. `groupIterations`' old `[startTs, endTs)` window
      (`loop.ts:96`) never matched, so the decision silently attached to no
      iteration and never rendered. Fixed: a decision now attaches to
      whichever iteration has the latest `startTs` at or before the
      decision's ts — that iteration owns the gap up to the next iteration's
      start, not just up to its own Stop. Regression case added to
      `loop-check.ts` (decision ts in the post-Stop gap). Re-verified live
      2026-09-06 in safe_router: a repeating unanswered either/or question
      fired across 2 auto cron ticks, producing 2 decisions — both rendered
      pinned above the iteration lines in digest shape, not folded into
      either iteration's own text.)*
- [x] Outside-terminal session (cwd-fallback, no tether) →
      `UserPromptSubmit` always tagged `human`, never misclassified `auto`.
      *(verified 2026-09-06, safe_router: a 1m cron run from a terminal
      outside Logic Loop, bound via cwd-fallback — no `⟳` appeared on the
      matching tab across 2+ auto-fired ticks.)*
- [x] Human pastes a multi-line block via ⌘V into the prompt, submits
      within 5s → tagged `human` (paste counts as input). *(verified
      2026-09-06, safe_router: pasted while a "no change" cron was actively
      running (`lastInputTs` guaranteed stale) — no `⟳` on the pasted turn,
      rendered with the normal human `>` prompt marker, didn't fold into the
      auto no-change streak.)*
- [x] Terminals: throughout, typing latency and PTY output unaffected.
      *(confirmed 2026-09-06 — no lag observed during §25 testing; separate,
      pre-existing lag noted on tab-switch while the landing note
      auto-generates, tracked as a follow-up, not a §25 regression.)*

## 26. Phase 16 — Codex + Antigravity follow-up fixes

Scope: `plans/Codex_Implementation_Plans.md` (Plans 001-003) and
`plans/Antigravity_Implementation_Plans.md` (Plans 001-002). Agy 003/004
deferred to a later phase (see PLAN.md).

### Live verification performed during the build (not just unit tests)

- [x] **Agy 001's live-verification gate** (mandatory per the plan before
      registering any `Pre*` hook): built a scratch `.agents/hooks.json`
      probe and temporarily swapped it into the real
      `~/.gemini/config/hooks.json` (backed up first, restored byte-for-byte
      after — confirmed via `diff`), then drove real `agy` 1.1.27 turns via
      `--input-format stream-json` (non-interactive, multiple turns in one
      long-lived process). Findings:
      - A bare `{}` `PreInvocation` response never blocked, denied, or
        errored a turn, across a trivial no-tool turn and a 2-tool-call
        turn.
      - A deliberately slow (2s sleep) + malformed (empty stdout) response
        added exactly that latency and nothing worse — degraded to slow,
        never stuck.
      - **`PreInvocation` fires multiple times per top-level turn** (3
        firings observed for one turn with 2 tool calls — once per
        intra-turn model round-trip, not once per turn as the source review
        assumed) — this would have inflated Since-you-left's turn count and
        corrupted Phase 15 turn-provenance if translated naively.
      - **`invocationNum` resets to `0` at the start of every new top-level
        turn**, confirmed by resuming the same conversation for a second
        turn in the same process and seeing `invocationNum: 0` again — this
        is the reliable once-per-turn signal the fix actually uses (see
        `antigravity.rs`'s `ANTIGRAVITY_HOOK_EVENTS` doc comment and
        `translate()`'s `PreInvocation` branch).
      - This changed the plan's implementation from the reviewed proposal
        (map every `PreInvocation` → `UserPromptSubmit`) to the corrected
        one (map only when `invocationNum == 0`) — recorded as a landmine in
        CLAUDE.md.
- [x] Manually exercised the real Antigravity turn-epoch fix end to end via
      the same stream-json harness: turn 1 → `UserPromptSubmit`-mapped
      `PreInvocation` (`invocationNum: 0`) → `working`; turn 2 (same
      process, same conversation) → another `invocationNum: 0`
      `PreInvocation` → epoch correctly reopens. This is the direct fix for
      the bug (a real second Antigravity turn no longer gets silently
      dropped by the `stoppedSessions` epoch guard).
- [x] Codex 003's `Interrupt`/`SessionEnd` events, live-verified against
      installed `codex-cli` 0.153.4 (temporarily swapped `~/.codex/hooks.json`
      for a probe file, same backup/restore discipline): a plain `codex exec`
      turn fired `SessionStart → UserPromptSubmit → Stop → SessionEnd`, all
      with real `session_id`/`cwd`/`transcript_path`; `SIGINT`-ing a
      long-running turn (proxy for interactive Esc) fired `Interrupt` (real
      `turn_id`, no error field) immediately followed by `SessionEnd`
      (`reason: "other"`) — exactly the event/field shapes Plan 003 assumed
      from upstream source, and exactly what `stateForHook`'s new cases and
      `App.tsx`'s `isTerminalResult` predicate already handle. Codex did not
      reject the 7-event hooks.json (validates the STOP condition about an
      unrecognized event key never triggered).
- [x] Codex 002's resume syntax, live-verified: `codex resume --help`
      confirms `codex resume [SESSION_ID] [PROMPT]` (matches `pty.rs`'s
      `resume_command` exactly); a real resumed session
      (`codex exec resume <sid>`) correctly recalled context from the prior
      turn ("what word did I ask you to reply with?" → correctly answered
      from the earlier turn, same `session_id`).
- [x] Quality gates: `cargo test --lib` 49/49 (11 new — 2 ingest, 1 codex
      marker, 2 codex lifecycle-adjacent already counted in setup loops, 2
      pty resume-selection, 6 antigravity translate/normalize), `cargo
      clippy --all-targets -- -D warnings` clean, `npx tsc --noEmit` clean,
      `npm run check` 13/13 (unchanged script count — extended
      `reentry-check.ts`, `epoch-check.ts`, `delta-check.ts` in place,
      no new script needed), `npm run golden` 12/12 (unchanged — no
      extraction-prompt files touched), `git diff --check` clean.

### Still needs a human, live GUI pass (not verifiable headlessly)

- [x] Toggle "codex on" in the real app → `~/.codex/hooks.json` gets all 7
      events (5 existing + `Interrupt`/`SessionEnd`), each `command`
      carrying `X-Logic-Loop-Agent: codex`; toggle off/on again → idempotent.
      *(2026-09-07: confirmed live — hooks.json had all 7 events with the
      header on every command, all 7 trust hashes present in config.toml.
      Live testing surfaced a real timing gap, not a hooks.json bug: toggling
      on while a Codex process from before the toggle is still running has
      no effect — Codex reads hooks.json once at session start, so that
      already-running session never fires hooks (session started 03:38:42,
      hooks.json rewritten 03:40:51, zero events in the DB for it). A fresh
      Codex session/turn started after the toggle picked up hooks correctly
      — `session_bindings` bound `agent='codex'`, `UserPromptSubmit`→`Stop`
      landed with real timestamps. Not a regression, just an undocumented
      "toggle before starting the session, not mid-session" caveat.)*
- [x] Run a real Codex session in a Logic Loop tab, quit/relaunch the app,
      confirm a re-entry ghost tab appears, click Re-enter, confirm the
      resumed prompt is the same Codex conversation (visually, not just via
      the headless check above). *(2026-09-07: passed live.)*
- [x] Interrupt a real interactive Codex turn with Esc (not `SIGINT` on
      `exec`) in a Logic Loop tab → tab dot returns to idle, no stuck
      "working" state, no spurious duplicate result. Esc in the real
      interactive TUI is very likely the same underlying path as the
      `SIGINT`-on-`exec` test above (same `Interrupt`/`SessionEnd` sequence
      appeared), but this is the one part of Plan 003's manual test not
      literally reproduced with the real interactive keypress.
      *(2026-09-07: confirmed live — tab dot went blue (working) on run,
      Esc brought it back to green (idle). DB showed `hook:Interrupt` fired,
      no `SessionEnd` (fine — `isTerminalResult` in App.tsx already treats
      `Interrupt` alone as terminal), and zero `result_landed`/
      `result_claimed` rows — no stuck state, no spurious duplicate result.)*
- [x] Run a real two-turn Antigravity session in a Logic Loop tab (not the
      headless stream-json harness) → tab visibly returns to `working` on
      turn 2 instead of staying `idle`. Record the `agy` version used.
      *(2026-09-07: passed live, Antigravity CLI 1.1.27.)*
- [ ] Antigravity Accomplished panel + Since-you-left digest: run
      `run_command` and `write_to_file` in a real Antigravity tab, confirm
      real detail text (not a bare tool name) and non-zero file/command
      counts. **BLOCKED 2026-09-07**: hit account-level API quota
      ("Individual quota reached") mid-session, unrelated to this app —
      cooldown ~142h (~6 days), resets ~2026-09-13. Recheck then.
- [ ] A failing Antigravity `run_command` still does not surface a blocker
      (this is expected, not a regression — agy strips the failure signal
      from command hooks, per the pinned tripwire test; confirm the app
      doesn't crash or misbehave, just correctly shows nothing).
      **BLOCKED 2026-09-07**: same quota cooldown as above, not yet
      attempted — a real quota-exhaustion error *did* correctly surface as
      a "Rate limited" blocker card during the item-1 test, but that's a
      different signal (account-level API error, not a `run_command`
      tool-call failure) and doesn't exercise this check. Recheck ~2026-09-13.

## 27. Decisions cleanup — grouped by session, bulk-dismiss (Phase 17)

- [x] Project with open decisions across 2+ sessions: Decisions section
      shows one collapsible cluster per session, most-recent expanded,
      older ones collapsed. Header reads relative age + count (e.g. "~2
      months ago · 12 decisions"). **Found + fixed a real bug during this
      check**: `SidePanel.tsx`'s `reload()` was passing decisions through
      `scopeBySession(dc, sessionId)` before grouping — every tab could
      only ever see its own session's cluster, so cross-session grouping
      was dead on arrival. Surfaced live: tab badge showed 10 open
      decisions for the project while the active tab's own Decisions
      section read "Nothing waiting on you." Fixed by dropping the scoping
      for `decisions` state only (tool events keep it — that scoping is
      correct there). Passed after fix.
- [x] Toggling a cluster's chevron expands/collapses just that cluster;
      others unaffected.
- [x] A session with exactly 1 open decision shows no "dismiss all" button
      on its cluster header; a session with 2+ does.
- [x] "dismiss all" on a cluster clears every open decision in that session
      only — sibling clusters' counts and rows unchanged, badge count in the
      section header (`Decisions (N)`) drops by exactly that cluster's
      count.
- [x] "dismiss all" on the only remaining cluster collapses the whole
      section to "Nothing waiting on you."
- [x] Per-row actions (answer/context/delegate/dismiss) inside an expanded
      cluster behave exactly as before grouping was added.
- [x] Switching project tabs re-seeds which cluster is expanded (newest for
      the new project); a manual expand/collapse made earlier in the
      previous project is not carried over. (Confirmed decisions persisting
      across a new session start in the same project is correct by design —
      decisions are cwd-scoped, not session-scoped, and only clear on
      answer/dismiss.)
- [x] Closed-decisions tail below the open clusters is unchanged in
      appearance and behavior. Bonus check confirmed too: dismissing in one
      tab is reflected in a second tab on the same project (shared DB, no
      per-tab staleness).

## 28. Idea Board (Phase 18)

- [x] Collapsed dock strip shows under the terminal pane by default (first
      run, no `.logic-loop/board.md` yet); clicking it expands to five
      columns (Idea/Planned/Building/Later/Done), all empty, `+` quick-add
      live.
- [x] Quick-add with just text (no title) creates a card in Idea whose
      title is the first line typed; `.logic-loop/board.md` now exists on
      disk with that one `## ` card.
- [x] Moving a card via its status dropdown updates the column it renders
      in immediately, and the on-disk file's `status:` line for that card
      changes — no other card's lines change.
- [x] Hand-edit `.logic-loop/board.md` in an external editor (add a card,
      change a `next:` line) while the app is open, switch tabs away and
      back → the board picks up the external edit; then move a card in the
      UI → confirm the hand-edited card and its edit are still there in the
      file afterward (reload-before-write didn't clobber it).
- [x] Click a card's title → expands in place showing body/next/link, no
      markdown rendering (raw text only); click again collapses it. First
      attempt read as a fail on a body/next/link-less quick-add card (nothing
      to show is correct, not a bug); passed once retested against a card
      with `body`/`next`/`link` lines added by hand.
- [x] Drag the top resize handle → dock height changes; collapse the app
      and relaunch (or switch away and back to the project tab) → collapsed
      state and height both persisted per project.

### Scope added mid-sprint (not in the original Phase 18 plan, built and
### verified in this pass, ship with the same stamp as the rest of §28)

- [x] Per-card delete (✕, far right of the title row) — removes the card
      from the board and from `.logic-loop/board.md` permanently (`board.ts`
      `deleteCard`, wired as `remove()` in `IdeaBoard.tsx`).
- [x] Per-card accent color — grey dot with a rainbow-gradient ring next to
      the star opens a swatch popover; picking a color tints the card's
      border and title-row background and persists as a `color: #hex` line
      (`board.ts` `Card.color` + `parseBoard`/`serializeCard`, `setColor()`
      in `IdeaBoard.tsx`). "No color" swatch clears it.
- [x] Row order finalized: chevron (expand) → star (Now) → color dot →
      title → ✕ (delete), far right.
- [x] All triangle glyphs (▸/▾/▼/▲) replaced with the same `Chevron` SVG
      used by Decisions/Blockers, for visual consistency — per-card expand
      toggle, the dock's own collapse/expand row, and the momentum "NEXT"
      card header (`SidePanel.tsx`) all now share the one chevron style.
- [x] `npx tsc --noEmit` and `npm run check` (incl. `board:check`) clean
      after all of the above.
- [x] Switch to a different project tab with its own (or no) board → shows
      that project's own file, not the previous tab's cards.
- [x] With no landing note, no open decision, and no open blocker, but a
      `planned` card exists → SidePanel's momentum card shows that card's
      `next:` (or title if no `next:`); clicking Done moves the card to
      `building`, not `done`, and it disappears from momentum (blocker/
      decision fallback resumes, or "nothing waiting" if truly empty).
- [x] Terminals: opening/collapsing/resizing the board and adding/moving
      cards while an agent is streaming output — typing latency and PTY
      output unaffected, no input ever sent to the terminal session.

## 29. Decisions empty-state clarity (Phase 19)

- [x] Idle Claude project, transcript readable, zero open decisions →
      Decisions section reads "Nothing waiting on you." (unchanged text,
      now specifically meaning confirmed-empty).
- [x] Simulate a blind session (kill/deny the tailer, or point a session's
      transcript at a bad path) with zero open decisions → the Decisions
      section itself (not just the top banner) reads "Can't tell — no
      transcript for this session (extraction never ran)."
- [x] An OpenCode/Antigravity tab with zero open decisions → "Decision
      tracking isn't available for this agent yet." — never the
      confirmed-empty text. Codex is covered by Phase 21 below and now uses
      the confirmed-empty text when its transcript is readable.
- [x] An unbound fan-out child tab → "Can't tell — this tab isn't bound to
      a tracked session yet." — outranks both blind and non-Claude-agent
      when more than one would apply.
- [x] Blockers and notes empty states are unchanged — this phase touches
      only the Decisions section's zero-state text.

## 30. Idea Board "Now" set (Phase 20)

- [x] Star (★) a card from any column → it appears in the collapsed dock
      strip's title list (visible without expanding the board); un-starring
      it removes it from that strip.
- [x] Star 3 cards; attempt to star a 4th → inline "Now is full (3/3) —
      remove one first" message, the 4th card's star does not fill in, and
      the file's `now:` count stays at 3.
- [x] Un-star one of the 3, then star a different card → succeeds (cap only
      blocks adding, never removing).
- [x] With a Now card starred and a different `planned` card that isn't
      starred: SidePanel's momentum card shows the Now card's `next:` (or
      title), not the top-planned one.
- [x] Clicking Done on that momentum card moves it to `building` in the
      board and un-stars it (frees the Now slot); momentum then falls back
      correctly (another Now card if any, else top-planned, else "nothing
      waiting").
- [x] Un-star all cards → momentum reverts to the plain top-planned pick,
      matching Phase 18 behavior.
- [x] Hand-edit the board file to add `now: true` to a card externally,
      switch tabs away and back → the star and collapsed-strip title
      appear without any app-side toggle.

## 31. Codex decision/blocker tracking (Phase 21)

- [x] Enable Codex hooks before starting a fresh Codex session. Existing Codex
      processes do not reload hooks after the toggle; if hook command text has
      changed and trust is stale, follow the Codex trust-hash landmine in
      `CLAUDE.md` and approve the fresh-session prompt.
- [x] In a Logic Loop Codex tab, produce an assistant message containing an
      explicit question and confirm a decision appears after the turn ends.
- [x] Produce an unanswered Codex question and confirm it is stored as an
      open decision; answer a later question and confirm it is stored as
      answered.
- [x] Confirm a Codex tab with a readable transcript and zero open decisions
      says "Nothing waiting on you."; a blind Codex session still says it
      cannot tell because no transcript was readable.
- [x] Trigger a Codex tool failure and confirm the existing Bash-scoped
      blocker path behaves as it does for Claude. Do not expect quoted
      transcript prose to create a blocker.
- [x] Relaunch and re-enter the Codex session; confirm the session remains
      bound to the Codex tab and new transcript lines continue extracting.
- [x] While extraction runs, confirm no second observed Codex session,
      recursive extraction, cwd overwrite, or terminal impact appears. The
      extractor child must remain covered by the
      `LOGIC_LOOP_TAB_ID=__logic_loop_extractor__` tether.

## 32. Cross-project Attention foundation (Phase 22)

- [x] Open two agent tabs for the same project and trigger the same detector
      in each. Confirm each new blocker remains tied to its own session/tab;
      a manually added blocker remains project-level.
- [x] Produce an extractable decision, switch tabs before extraction
      completes, then inspect the row. Its session, tether, and adapter must
      remain from the observed assistant turn, never the newly active tab.
- [x] In Codex and OpenCode sessions, confirm observed activity retains the
      correct adapter marker. Unmarked Claude and legacy observations remain
      unknown rather than being labeled as another provider.
- [ ] Repeat the adapter-marker check in a real Antigravity session.
      *(Deferred 2026-09-08: weekly Antigravity limit exhausted. Required
      before Phase 22 acceptance; does not block a draft PR.)*
- [x] Trigger a parent Stop followed by a late subagent event. The parent
      stays idle, and the subagent neither creates a parent lifecycle
      observation nor lands/flags an unclaimed result on the parent tab.
- [x] Temporarily make the database unavailable while a hook arrives. The
      terminal remains usable; the app may lose attention evidence but does
      not block, type, or alter the terminal session.

## 33. OpenCode repo contract and baseline checks (Phase 23)

- [x] Launch OpenCode 1.x from this repository and ask it to state the phase
      gate, primary TypeScript/Rust checks, and structured-only ingestion
      invariant from `AGENTS.md`.
- [x] Request `git push --dry-run`, `rm` against a disposable test file, and
      one package mutation command. Confirm OpenCode asks for approval for
      each, then reject each request.
- [x] Confirm ordinary `git status`, `rg`, focused checks, edits inside the
      repository, and `npm run opencode:check` do not gain unexpected prompts.
- [x] Toggle the Logic Loop OpenCode adapter on, start a new OpenCode session,
      and confirm activity binds to the correct tab and is stored with
      `agent: opencode`. OpenCode transcript extraction and tool-error state
      are not supported by this phase.
- [x] If validating a change to `AGENTS.md`, restart the OpenCode session first;
      instruction content is session context, not a live-reloaded UI setting.

## 34. Blockers bulk clear (Phase 24)

- [x] With two or more open blockers, confirm `clear all` is visible; with one
      or zero open blockers, confirm it is hidden.
- [x] Click `clear all` and confirm every open blocker moves to resolved
      history, the Blockers count and project tab badge clear, and momentum
      advances to its next candidate.
- [x] Confirm another project's blockers are unchanged.
- [x] Confirm clicking `clear all` does not collapse the Blockers section and
      per-row resolve, reopen, and delete still work.

## 35. Folded side rail (Phase 25)

Implementation built and accepted 2026-09-09 from baseline `b623569`.
Automated layout, type, build, frontend, and Rust gates are recorded below.
The live macOS GUI matrix passed after the first visual review revised the
control placement: fold/expand now stays in the shared hook bar, while Sidebar
LM and Notify occupy a second expanded-panel row.

- [x] Start expanded at a custom width, compact, expand, and confirm the custom
      width returns. Relaunch and confirm the selected mode and width restore.
- [x] Exercise `Cmd+B` from expanded, compact, and hidden. Exercise
      `Cmd+Shift+B` from each visible mode and restore. Confirm no characters
      appear in the active terminal.
- [x] Populate decisions, blockers, notes, a Next candidate, a Since You Left
      delta, and an unclaimed result. Confirm presence, count, and accent rules.
- [x] Click each compact section icon. Confirm the panel expands, routes to the
      correct destination, opens collapsed sections, and changes no semantic
      decision, blocker, note, or result state.
- [x] With adapter and transcript warnings present, confirm compact mode keeps
      a visible warning indicator with explanatory tooltip and accessible copy.
- [x] At the narrowest practical window and a short window, confirm the middle
      rail scrolls while project state and expand stay pinned, with no overlap
      over the terminal or Idea Board.
- [x] Confirm the expanded panel's mute, resize, section collapse, commit
      footer, context modal, blocker actions, and decision actions are unchanged.
- [x] Confirm fold/expand stays at the left edge of the hook bar instead of
      moving to the compact rail bottom; hook pills are vertically aligned and
      ordered Antigravity, Claude, Codex, OpenCode when all are available.
- [x] Confirm expanded headings reuse the compact section icons, and the pinned
      compact GitHub icon expands and routes to Git log without opening or
      triggering commit/push controls.
- [x] Confirm the compact rail contains no Inbox, Lock-In, timed-lock, or
      commit/push controls. *(Fan-out was added in the follow-up below.)*

Follow-up visual polish (2026-09-09):

- [ ] With a fan-out group present, confirm the expanded Fan-out heading and
      compact rail both show the purple fan-out icon; click the compact icon
      and confirm it expands and scrolls to the first fan-out group.
- [ ] Confirm warning triangles use an orange/pink outline with no fill and a
      white exclamation mark in both compact and expanded panel warnings.

## 36. Cross-project Attention Inbox (Phase 26)

Implementation built 2026-09-09 on top of the accepted Phase 25 working tree
and accepted by the maintainer on 2026-09-09 after live six-tab dogfood. The
dogfood populated all five kinds across two projects with correct labels,
counts, ages, and ordering. Acceptance carries two findings into Phase 27:
Claude required a repeated question before one decision appeared, and initial
Up/Down navigation did not work until a row received mouse focus. Unrun checks
remain unchecked below rather than being inferred from acceptance.

- [x] Open at least two projects and six tabs. Produce decisions, observed
      waiting, unclaimed results, unresolved blockers, and a quiet working
      session. Confirm cross-project presence, project labels, ages, count,
      and actionability-first ordering. *(live pass 2026-09-09; one Claude
      decision required asking the agent to repeat its question before the
      extractor populated it)*
- [x] Open Attention from terminal focus with `Cmd+K`, the compact mail icon,
      and the expanded-panel header control. Confirm no `k` or other bytes
      appear in the terminal.
- [ ] Search, use Up/Down/Enter, select a row and use `Open tab`, then press
      Escape. Confirm preview behavior, empty-search copy, keyboard focus
      trapping, and restoration to the previously focused control. *(failed
      initial-focus path 2026-09-09: the search field received focus, but
      Up/Down began working only after clicking a result row; carried into
      Phase 27)*
- [ ] Preview an unclaimed result without navigating and confirm it remains
      unclaimed. Navigate to it and confirm the existing claim behavior runs
      once.
- [ ] Create same-project sibling tabs, then close or retarget destinations.
      Confirm ambiguous, conflicting, dead, and stale routes show unavailable
      rather than selecting a guessed sibling.
- [x] Relaunch with durable decisions, blockers, and results. Confirm they
      remain, while prior-run waiting/stalled rows stay absent until fresh live
      evidence arrives. *(live pass 2026-09-09: decisions persisted before
      re-entry, blocker routes became available after re-entry, and an
      unclaimed result persisted and was claimed by re-entering its tab)*
- [ ] Let a working tab cross the real three-minute quiet boundary. Confirm the
      shared clock adds the quiet row after the boundary and fresh accepted
      activity removes it without per-row polling.
- [ ] Temporarily make the Attention query unavailable. Confirm `Attention may
      be stale` retains the last good list and terminals and existing panels
      remain usable.
- [ ] Confirm compact/expanded/hidden panel shortcuts, persisted width,
      section routing, notifications, tab badges, and the dock badge retain
      their Phase 25 behavior.
- [ ] Dogfood Attention for three normal work sessions. Record whether it was
      used instead of scanning tabs and note duplicate, misleading, or missing
      rows before approving any pin/snooze/badge follow-up.
      *2026-10-07–08: search, initial Up/Down selection, empty state and
      Escape tested; route/Enter and exhaustive focus-trap cases remain open.
      See the computer-use audit at the end of this file.*

Automated evidence (2026-09-09):

- [x] `npm run attention-inbox:check` — all five kinds, strict stall boundary,
      current-run eligibility, deterministic rank/search, safe route cases,
      one global query shape, shortcut/UI wiring, and reserved icons pass.
- [x] `npm run check` — all 22 configured checks pass, including the new
      `attention-inbox:check` aggregate entry.
- [x] `npx tsc --noEmit` — strict TypeScript clean.
- [x] `npm run build` — production frontend build clean; only the existing
      chunk-size advisory is emitted.
- [x] `cd src-tauri && cargo test --lib` — 57/57 pass.
- [x] `cd src-tauri && cargo clippy --all-targets -- -D warnings` — clean.
- [x] `git diff --check` — clean.

## 37. Lock-in / Do Not Disturb sidequest

Implementation built 2026-09-09 under the explicitly approved Phase 26
sequencing exception. Phase 26 remains unaccepted and its dogfood matrix above
is unchanged. Live macOS manual testing passed 2026-09-09.

- [x] Enter Lock-in from expanded mode. Confirm the side panel becomes neutral
      gray, Attention and section count badges disappear, and the locked icon
      has a visible pressed treatment and accessible label.
- [x] Fold, expand, hide, and restore the side panel while locked in. Confirm
      Lock-in remains active and the prior panel width/mode preferences are not
      overwritten. Exit Lock-in and confirm category colors and live counts
      return from the unchanged state.
- [x] While locked in, trigger waiting, finished, and three-minute-stalled
      nudges from background tabs and with the app backgrounded. Confirm no OS
      notifications appear and the macOS dock badge remains clear.
- [x] During the same run, confirm hooks, tab state dots/ages/glows/badges,
      Attention evidence, decisions, blockers, and unclaimed results continue
      updating. Exit Lock-in and confirm the current dock count returns.
- [x] In both compact and expanded modes, confirm the neutral Attention and
      warning controls remain reachable and readable rather than appearing
      absent.
- [x] Add and clear a Note; add, resolve, reopen, and clear Blockers while
      locked in. Confirm every action remains functional and sends no input to
      the terminal.
- [x] Relaunch after leaving Lock-in active. Confirm the app starts unlocked
      and ordinary notification behavior resumes.

Automated evidence (2026-09-09):

- [x] `npm run lock-in:check` — notification suppression, unclaimed-state
      independence, dock-badge derivation, App ownership, panel controls,
      neutral styling, hidden compact counts, and lock icons pass.
- [x] `npm run check` — all 23 configured checks pass.
- [x] `npx tsc --noEmit` — strict TypeScript clean.
- [x] `npm run build` — production frontend build clean; only the existing
      chunk-size advisory is emitted.
- [x] `cd src-tauri && cargo test --lib` — 57/57 pass.
- [x] `cd src-tauri && cargo clippy --all-targets -- -D warnings` — clean.
- [x] `git diff --check` — clean.

## 38. Lock-in header + 60-minute timer polish sidequest

Implementation built 2026-09-09 under the explicitly approved Phase 26
sequencing exception. Phase 26 remains unaccepted and its dogfood matrix is
unchanged.

- [x] In expanded, compact, and hidden panel modes, confirm the gray bordered
      Lock-in pill stays immediately right of Fold/Expand and adapter pills
      retain their established order.
- [ ] While unlocked, keyboard-focus and activate each icon independently.
      Confirm labels/tooltips distinguish indefinite Lock-in from 60-minute
      Lock-in.
- [ ] Activate indefinite Lock-in. Confirm the pill collapses to Unlock only,
      existing suppression/neutral presentation works, and manual Unlock
      restores live state.
- [ ] Activate timed Lock-in. Confirm the pill collapses to Unlock only and its
      accessible copy identifies the 60-minute mode. Manually unlock before a
      shortened developer-timer expiry, start a new Lock-in session, and
      confirm the stale timer cannot unlock it.
- [ ] Confirm a timed Lock-in automatically unlocks once at the real 60-minute
      boundary and restores future notification, dock-badge, and panel
      presentation behavior from live underlying state.
- [ ] Relaunch during indefinite and timed Lock-in. Confirm the app starts
      unlocked and no previous timer resumes.
      *2026-10-07–08: timed accessible label, collapsed Unlock and manual
      unlock passed; shortened/stale-timer and real expiry cases unrun.*

Automated evidence (2026-09-09):

- [x] `npm run lock-in:check` — 60-minute constant, mode policy, stale-timer
      guard, header placement/wiring, accessible choices, collapsed Unlock,
      side-panel de-duplication, and timed icon pass.
- [x] `npm run notify:check`, `npm run panel-layout:check`, and
      `npm run attention-inbox:check` — existing related contracts pass.
- [x] `npm run check` — all 23 configured checks pass.
- [x] `npx tsc --noEmit` — strict TypeScript clean.
- [x] `npm run build` — production frontend build clean; only the existing
      chunk-size advisory is emitted.
- [x] `cd src-tauri && cargo test --lib` — 57/57 pass.
- [x] `cd src-tauri && cargo clippy --all-targets -- -D warnings` — clean.
- [x] `git diff --check` — clean.

## 39. Attention triage and backlog control (Phase 27)

Implementation built 2026-09-09 on top of accepted Phase 26. Automated
Attention, aggregate frontend, TypeScript, production build, and Rust gates are
clean. The live macOS matrix passed and Phase 27 was accepted by the operator
on 2026-09-10.

**Acceptance:** `PHASE 27 ACCEPTED`

- [x] With Active above 99 and a mixture of routable and unavailable rows,
      confirm the rail badge equals only Active while Backlog shows its own
      count.
- [x] Open with `Cmd+K`. Before clicking a row, use Up/Down/Enter from the
      autofocus search field. Confirm selection and navigation work, no key
      reaches the terminal, and Escape restores focus.
- [x] Archive one Active decision, blocker, and result. Confirm each leaves
      Active without changing the source decision/blocker status or claiming
      the result.
- [x] Restore each from Archived. Confirm it returns to Active or Backlog based
      on its current safe route.
- [x] Archive one unavailable Backlog row, then use `Archive all unavailable`.
      Confirm the dialog states the exact count, underlying records are
      retained, and Backlog becomes empty after the write succeeds.
- [x] Create a new occurrence after archiving an older item with similar text.
      Confirm the new occurrence appears normally.
- [x] Dismiss an unclaimed result with the Accomplished-row `✕`. Confirm
      Attention counts and views update immediately without relaunch.
- [x] Relaunch and confirm archive state persists while underlying source
      history remains unchanged and eligible archived rows can be restored.
- [x] Temporarily fail the Attention query/write path. Confirm the last-good
      list and `Attention may be stale` remain while terminals and panels work.
- [x] Confirm compact/expanded/hidden modes, Lock-in, notifications, tab
      badges, and safe unavailable routing retain their prior behavior.

Automated evidence (2026-09-09):

- [x] `npm run attention-inbox:check` — Active/Backlog/Archived partitioning,
      occurrence-scoped interaction payloads, recurrence isolation, query
      projection wiring, dialog-owned keys, bulk archive, restore, and shared
      result-dismiss invalidation pass.
- [x] `npm run check` — all 23 configured checks pass.
- [x] `npx tsc --noEmit` — strict TypeScript clean.
- [x] `npm run build` — production frontend build clean; only the existing
      chunk-size advisory is emitted.
- [x] `cd src-tauri && cargo test --lib` — 57/57 pass.
- [x] `cd src-tauri && cargo clippy --all-targets -- -D warnings` — clean.
- [x] `git diff --check` — clean.

## 40. Landing-note manual/auto capture (Phase 28)

Implementation authorized with `PHASE 28 ACCEPTED` on 2026-09-10. Automated
evidence is recorded below. The live macOS matrix passed and the maintainer
wrote `PHASE 28 APPROVED` on 2026-09-10.

- [x] On an existing database with no `landing_note_mode` key, confirm Auto is
      selected. Create agent activity, switch away, and confirm the existing
      drafted 60-second landing modal still appears.
- [x] Select Manual, relaunch, and confirm Manual persists.
- [x] In Manual, create agent activity and switch repeatedly. Confirm no modal
      opens, no landing-draft extractor starts, switching stays responsive, and
      no skipped landing row is written.
- [x] Re-enable Auto without new activity and leave the project. Confirm no
      stale prompt appears. Create new activity and leave again; exactly one
      automatic prompt appears.
- [x] Confirm **Set landing note** has the established rainbow-gradient border.
      Click it and confirm the existing Notes input gains the same border,
      receives focus, and shows “What's the next physical action here when you
      come back?” beneath it. No popup or draft starts. Both borders should use
      the same subtle opacity as the automatic popup's Save button, not the
      brighter Next-card gradient.
- [x] Click **Set landing note** again. Confirm the input returns to ordinary
      note styling without writing a landing row or skip metric; typed text is
      retained.
- [x] Activate landing capture, type an action, and press Enter. Confirm it
      becomes the rainbow-labeled first Momentum/Next item for that project and
      the existing Done action clears it.
- [x] Trigger the automatic landing popup. Confirm its 0.3-opacity gradient
      border is quieter than the 0.6-opacity Save button, and the solid heading
      reads only **Landing note** — no `context_terminal` suffix and no
      per-letter rainbow title.
- [x] Exercise tab close, fan-out, and isolate-loop switching in both modes.
      Existing suppression remains correct and landing modals never stack.
- [x] Exercise expanded, compact, and hidden panels plus Lock-in. Confirm the
      Notes rail route, counts, resizing, terminal input, and shortcuts retain
      prior behavior.
- [x] Simulate preference read/write failure. Confirm terminals and tab changes
      keep working and a failed write restores the prior displayed mode with a
      concise error.

Automated evidence (2026-09-10):

- [x] `npm run landing:check` — draft parsing, persisted-mode fallback,
      Auto/Manual departure policy, inline note-kind routing, prompt copy, and
      rainbow wiring assertions pass.
- [x] `npm run panel-layout:check`
- [x] `npm run opencode:check`
- [x] `npm run check` — all 23 configured checks pass.
- [x] `npx tsc --noEmit` — strict TypeScript clean.
- [x] `npm run build` — production build clean; existing chunk-size advisory
      only.
- [x] `cd src-tauri && cargo test --lib` — 57/57 pass.
- [x] `cd src-tauri && cargo clippy --all-targets -- -D warnings` — clean.
- [x] `git diff --check` — clean.

## 41. Bookmark tab presentation through re-entry (Phase 29)

Implementation authorized with `PHASE 29 ACCEPTED` on 2026-09-10. Automated
and live evidence is recorded below; after the relaunch matrix passed, the
maintainer wrote `PHASE 29 APPROVED` on 2026-09-10.

- [x] Create a bookmark with a distinctive custom name and non-gray color.
      Open it, start a supported agent so the tab has a resumable binding, quit,
      and relaunch. Before and after clicking **Re-enter**, confirm the ghost tab
      keeps that exact displayed name and top-border color.
- [x] Open two differently named/colored bookmarks targeting the same repository,
      start separate agent sessions, quit, and relaunch. Confirm each tether
      restores its own presentation and session; cwd does not merge them.
- [x] Open a plain terminal tab, start an agent, quit, and relaunch. Confirm its
      displayed title/color restore consistently without creating or changing a
      bookmark.
- [x] Relaunch an existing pre-Phase-29 database row with no `tab_title` or
      `tab_color`. Confirm startup succeeds and the ghost uses the established
      project-basename and gray fallback.
- [x] Explicitly close a restored tab, relaunch again, and confirm it stays gone.
- [x] Carry an unclaimed result through the same relaunch. Confirm the first
      auto-active ghost still claims correctly; presentation hydration must not
      disturb the Phase 6 seed-before-activation ordering.
- [x] Confirm bookmark chips still persist, edit, delete, reorder, and open in
      the expected cwd.

Automated evidence (2026-09-10):

- [x] `npm run reentry:check` — latest-per-tether selection, adapter identity,
      presentation round-trip/newest-row precedence, and legacy null/blank
      fallback assertions pass.
- [x] `npx tsc --noEmit` — strict TypeScript clean.
- [x] `cd src-tauri && cargo test --lib` — 57/57 pass, including compilation of
      migration 12.
- [x] `npm run opencode:check`
- [x] `npm run check` — all 23 configured checks pass.
- [x] `npm run build` — production build clean; existing chunk-size advisory
      only.
- [x] `cd src-tauri && cargo clippy --all-targets -- -D warnings` — clean.
- [x] `git diff --check` — clean.

## 42. Repeatable window dragging (Phase 30)

Implementation authorized with `PHASE 30 ACCEPTED` on 2026-09-10. Computer
control of the running Logic Loop window was unavailable at implementation
time, so the maintainer explicitly directed the build to proceed using the
historical failure in section 14 as baseline evidence. The first rebuilt bundle
still could not drag. Follow-up inspection confirmed that Tauri's injected
script invokes `plugin:window|start_dragging`, while `core:window:default`
explicitly excludes that command. The narrow fix therefore combines Tauri
2.11.5's deep drag-region semantics with only
`core:window:allow-start-dragging`; no broader window permission was added.
After the project-tab regression described below was fixed, the maintainer
wrote `PHASE 30 APPROVED` on 2026-09-10.

Environment recorded before implementation: macOS 26.4.1 arm64, Tauri 2.11.5,
`tauri-runtime-wry` 2.11.4, `@tauri-apps/api` 2.11.1,
`@tauri-apps/cli` 2.11.4, and installed Logic Loop bundle 0.1.0.

Partial live evidence after rebuilding with the narrow permission: computer
control triggered native window movement from the dedicated titlebar, empty
tab-row space, and empty bookmark-bar space on their first attempts. Each move
invalidates the automation window handle, so the 20-consecutive-drag count and
the complete interaction-regression matrix remain human-verified gates below.

- [x] Drag the dedicated titlebar 20 consecutive times while Logic Loop remains
      focused. Every attempt moves the window without focusing another app.
- [x] Focus another app, then drag the titlebar once. Logic Loop activates and
      moves on that same gesture.
- [x] Repeat both tests from nested empty tab-strip padding, the outer tab-row
      gap, and empty bookmark-bar space.
- [x] Click, close, middle-click, and reorder tabs; click/reorder bookmarks;
      open bookmark context menus and add/edit forms. No interaction moves the
      window or remains armed after pointer release.
      *(2026-09-10 follow-up: FAILED before the explicit tab boundary. Dragging
      a project tab moved the whole window because tabs are interactive `div`s,
      which Tauri's deep-region clickable-element check does not block
      automatically. Added `data-tauri-drag-region="false"` to each tab;
      the subsequent live retest passed.)*
- [x] Double-click the dedicated titlebar. Native zoom/maximize toggles, and a
      following single drag works immediately.
- [-] Open Landing Note and another overlay/modal. The visible titlebar still
      drags repeatedly while modal content remains interactive.
      *(Not separately rerun after the tab-boundary follow-up; accepted by the
      maintainer with Phase 30 approval.)*
- [-] Drop a file into the active terminal, select terminal text, resize the
      side panel, and resize the native window edges. Existing gestures remain
      intact.
      *(Not separately rerun after the tab-boundary follow-up; accepted by the
      maintainer with Phase 30 approval.)*
- [x] Repeat the matrix in the bundled dogfood app, not only the Vite dev build.

Maintainer live result: PASS on the focused 20/20 count, inactive first drag,
nested empty chrome, project-tab reorder after the explicit boundary fix,
ordinary tab/bookmark controls, titlebar zoom, and the following single drag.
The maintainer accepted the two separately-unrerun expanded regression groups
and approved Phase 30.

Automated evidence (2026-09-10):

- [x] `rg -n 'data-tauri-drag-region="(deep|false)"' src` — exactly three
      intended chrome owners set to `="deep"`, plus the explicit `="false"`
      boundary on each project tab added after the reorder regression surfaced.
- [x] `npm run opencode:check`
- [x] `npm run check` — all 23 configured checks pass.
- [x] `npx tsc --noEmit` — strict TypeScript clean.
- [x] `npm run build` — production frontend build clean; existing chunk-size
      advisory only.
- [x] `cd src-tauri && cargo test --lib` — 57/57 pass.
- [x] `cd src-tauri && cargo clippy --all-targets -- -D warnings` — clean.
- [x] `git diff --check` — clean.

Follow-up automated evidence after the project-tab boundary fix (2026-09-10):
`npm run panel-layout:check`, `npx tsc --noEmit`, all 23 `npm run check`
scripts, `npm run build`, `cargo test --lib` (57/57), and clippy all pass. The
tab-reorder checkbox above passed in the rebuilt app before approval.

## 26. Diff pop-out from Accomplished rows (issue #10)

Written on Windows, where the app can't run — every box below was
unverified for over eight months (PR #20, 2026-09-06) until this Mac pass.

- [x] Have an agent edit a tracked file in the tab's repo, then `git add` that
      file (the pop-out reads `git diff --cached` only). The Accomplished row
      "Edited `<file>`" underlines on hover; clicking it opens the pop-out with
      that file's unified diff, monospace, and **only** that file's section —
      no other staged file bleeds in.
- [x] Esc closes it; so does clicking the dimmed overlay and the Close button.
      Clicking inside the diff (e.g. selecting text) does not close it.
- [x] Stage a second file too → each row opens its own section, not the other's.
- [x] Unstaged edit: agent edits a file, nothing staged → row still clicks,
      pop-out shows the "No staged diff for this file" empty state, no crash
      and no blank panel behind it.
- [x] Row for a file outside the tab's repo (e.g. agent edits a file in another
      checkout): staged there → its diff shows; unstaged → empty state. Either
      way the tab's own panel is unchanged after closing.
- [x] Non-file rows ("Ran …", Read/Grep rows) are **not** clickable — plain
      text, no hover underline.
- [x] Delete the file's directory (or prune the worktree) with the row still on
      screen → clicking it falls back to the tab's repo and either shows the
      diff or the empty state; never an unhandled error.
- [x] Terminals: open/close the pop-out repeatedly while an agent is streaming
      output — typing latency and PTY output unaffected, no input is ever sent
      to the session.

Live evidence (2026-09-14), disposable scratch repos (`~/dt-scratch-
diffpopout-outside` plus the maintainer's own pre-existing `~/Desktop/dev/
dt-scratch-diffpopout`), Plan 024 Step C item 11:

- Basic pop-out, dismiss paths, second-file isolation, and non-clickable
  rows verified live in-app (screenshot evidence) and cross-checked against
  the scratch repos' actual `git status`/file content, which matched the
  agent's instructed edits exactly.
- Outside-repo case verified both staged (diff shown, screenshot evidence)
  and the deleted-directory fallback (moved the outside repo to Trash,
  re-clicked the row, got the "No staged diff for this file" empty state
  cleanly — screenshot evidence, no crash).
- Streaming test carried over from an interrupted first attempt (the app
  was restarted mid-stream for an unrelated fix, see below) — accepted on
  the maintainer's report from that partial run rather than a clean full
  redo.
- One real methodology snag, not an app bug: the maintainer's tab bound to
  a pre-existing `~/Desktop/dev/dt-scratch-diffpopout` instead of the
  freshly-created `~/dt-scratch-diffpopout`, which had no `.git` of its
  own — every `git` command there silently resolved up to a stray `~/.git`
  (see the landmine below). Confirmed via `session_bindings` in
  `context-terminal.db` before it caused any real harm; the stray repo has
  since been deleted.
- Separately found and fixed mid-session: the dev server had been launched
  from inside a Claude Code CLI shell that itself carried
  `CLAUDE_CODE_CHILD_SESSION=1`, which every spawned tab's PTY inherited —
  disabling transcript saving for 2 live sessions ("no transcript for 2
  sessions" warning strip, screenshot evidence) and explaining a previously
  unresolved mystery from Plan 017's addendum. Fixed by relaunching with
  `env -u CLAUDE_CODE_CHILD_SESSION`; see the landmine below. Unrelated to
  the diff pop-out feature itself — the Accomplished rows it reads come
  from `PostToolUse` hook events, not the transcript, so this did not
  invalidate any of the above.

## 43. First-run agent activation (Phase 31)

Use a clean Logic Loop profile while keeping backups of any real agent config
files. The checklist must validate the path without requiring this README.

- [ ] Launch with no `onboarding_version` setting. The setup checklist opens
      once, all four agents appear in the documented order, installed CLIs are
      detected, and missing CLIs say **Not detected** with a disabled action.
      The top bar shows the Logic Loop logo/name and subtle Super Logic AI
      attribution; the footer CTA opens `https://superlogicai.com` externally.
- [ ] Confirm Claude and Codex advertise activity, decisions, and re-entry;
      OpenCode and Antigravity advertise activity but explicitly say decisions
      and re-entry are not supported.
- [ ] Close with Escape, the × button, backdrop click, and **Skip for now** on
      separate clean runs. Each path persists version 2, changes no adapter,
      and does not auto-open on the next launch. The header **Setup** button
      always reopens it.
- [ ] For one detected but disabled agent, click **Enable**. It progresses
      through Enabling to **Waiting for first event**. Merely waiting or typing
      unrelated terminal text never changes it to Connected.
- [ ] Start that agent in a Logic Loop tab. Its first tethered structured event
      changes only its row to **Connected — first event received**, while the
      normal tab state and panels activate.
- [ ] Generate an event for the same adapter from an outside terminal (no Logic
      Loop tab tether). It may ingest normally, but it must not satisfy the
      onboarding Connected state.
- [ ] Back up an adapter config, replace it temporarily with invalid JSON, and
      click Enable. The modal stays usable, shows **Setup failed**, the bounded
      plain-text error and config location, and offers **Retry**. Existing
      terminals continue accepting input and streaming output. Restore the
      config and retry successfully.
- [ ] Toggle an adapter from the header with the checklist closed. The header
      and checklist reflect the same state. A forced write failure opens the
      checklist on the visible error rather than only logging to the console.
- [ ] On a profile without notification permission, verify startup shows no OS
      prompt. Open Setup, read the nudge explanation, then click **Enable
      notifications**: only that click prompts. Both Allow and Don't Allow are
      nonblocking; denial leaves setup finishable and terminals unaffected.
- [ ] While an agent streams output, repeatedly open, keyboard-navigate, and
      close the checklist. No keystroke reaches the terminal and no terminal,
      hook, panel, or ingest activity pauses.

Automated evidence (2026-09-10):

- [x] `npm run onboarding:check`
- [x] `npm run opencode:check`
- [x] `npm run check` — all 24 configured checks pass.
- [x] `npx tsc --noEmit`
- [x] `npm run build` — existing chunk-size advisory only.
- [x] `cd src-tauri && cargo test --lib` — 58/58 pass.
- [x] `cd src-tauri && cargo clippy --all-targets -- -D warnings`
- [x] `git diff --check`

`npm run golden` was not run; Phase 31 changes no extraction prompt.

Maintainer disposition (2026-09-10): the Phase 31 clean-profile matrix above
is intentionally deferred so Phase 32 can ship tonight. No unchecked item is
claimed as passing; the maintainer explicitly authorized the bypass with
`PHASE 32 ACCEPTED` and plans to return to this matrix soon.

Close-out disposition (2026-09-13): this matrix is historical and pending
supersession by Plan 021, whose first-run project-or-home choice replaces the
default-home-PTY premise tested here. Do not mark these boxes passed. Once
Plan 021's replacement clean-profile live matrix is accepted, classify Phase
31 as **SUPERSEDED by Plan 021** and link its accepted evidence here.

## 44. Two-terminal split view (Phase 32)

Implementation authorized with `PHASE 32 ACCEPTED` on 2026-09-10. Phase 31's
live checks remain open by explicit maintainer exception rather than being
silently inherited or marked complete.

- [x] With one terminal focused, click the header **Split** pill. Confirm a
      second ordinary terminal opens in the same project cwd, the supplied
      split-screen icon is visible, and the two panes divide the available
      terminal area evenly.
- [x] Type different commands in both panes while output streams concurrently.
      Input reaches only the focused pane; each pane keeps independent output,
      process lifetime, PTY size, and structured-hook tab tether.
- [x] Click between panes. Confirm the focus outline, active top tab, Idea
      Board, and project side panel all follow the focused pane without opening
      a Landing Note merely because the other pane remains visible. The focused
      pane and matching top tab use a restrained 1.5px white outline; the secondary pane/tab uses the
      slightly softer blue. On both top tabs, the project/bookmark color remains
      fully visible above the side-and-bottom selection outline.
- [x] Select a third top tab. It replaces only the focused pane. Selecting
      either already-visible top tab focuses it without swapping pane position.
- [x] Reorder top tabs while split. Pane membership remains attached to tab
      identity, and no tab drag moves the native window.
- [x] Finish an agent in the unfocused visible pane. It does not produce an
      unseen-result flag, OS notification, or dock badge while Logic Loop is
      focused; a genuinely hidden tab still does.
- [x] Close each side in separate runs, including Cmd/Ctrl+W on the focused
      pane. The survivor becomes full width and its PTY remains live. A process
      exit stays in its pane with the established Restart/Re-enter UI.
- [x] Toggle Split off. The focused terminal remains visible and the other tab
      continues running normally in the background.
- [x] Exercise expanded, compact, and hidden project panels plus indefinite and
      timed Lock-in. Split state and terminal input remain independent.
- [x] Paste multiline text, select terminal text, open links, and drop a file
      into each pane. Resize the app repeatedly; both xterms refit without
      clipping, stale columns, or input crossing panes.
- [x] Quit and relaunch. Split composition is not restored; resumable sessions
      return through the existing ordinary-tab re-entry behavior.
- [ ] Click each split icon in the shared header pill. The left icon opens an
      even left/right split and the right icon opens an even top/bottom split.
      While split, click the other icon to change orientation without spawning
      another terminal; click the active icon to return to one pane. Resize in
      both orientations and confirm each xterm refits without clipping.

Automated evidence (2026-09-10):

- [x] `npm run split-view:check`
- [x] `npm run opencode:check`
- [x] `npm run check` — all 25 configured checks pass.
- [x] `npx tsc --noEmit`
- [x] `npm run build` — existing chunk-size advisory only.
- [x] `cd src-tauri && cargo test --lib` — 58/58 pass.
- [x] `cd src-tauri && cargo clippy --all-targets -- -D warnings`
- [x] `git diff --check`

`npm run golden` was not run because Phase 32 changes no extraction prompt.

Live acceptance evidence (2026-09-11–2026-09-13, current development profile):

- [x] Split activation opened a second ordinary shell in the active
      `context_terminal` project, displayed the supplied icon, and rendered an
      even two-pane layout.
- [x] A marker command submitted in the new right pane produced output only in
      that pane while the existing Codex pane continued streaming.
- [x] Clicking between panes moved the active-tab treatment and the restrained
      white/blue pane outlines without opening a Landing Note.
- [x] Selecting a third top tab replaced only the focused pane; selecting the
      already-visible secondary tab focused it without swapping pane position.
- [x] Turning Split off kept the focused shell visible and live.
- [x] Expanded, compact, and hidden panel modes remained independent of the
      split. Entering and exiting indefinite Lock-in preserved both panes.
- [x] Multiline paste executed only in the focused disposable shell. Maximizing
      the window kept both panes fitted without visible clipping or stale
      columns.
- [x] Exiting the disposable shell left **Process exited** and **Restart** in
      its pane while the other pane remained live.
- [x] Drag-reordering a top tab moved the tab but preserved both visible pane
      identities. The original tab and bookmark order was restored afterward.
- [x] After the intervening app relaunch needed to recover macOS Desktop-folder
      access, Split was off and surviving sessions appeared as ordinary tabs;
      the prior split composition was not restored.
- [x] Independent typed input in both panes, structured-hook tether identity,
      close/Cmd-W survivor behavior, background-result notification
      suppression, timed Lock-in, file drop/link/selection in both panes, and
      repeated manual edge-drag resize passed. One initial apparent tab-loss
      report during Cmd/Ctrl+W testing could not be reproduced in two exact
      repeats and was attributed to an accidental terminal command.

Maintainer disposition (2026-09-13): `PHASE 32 APPROVED`.

`PHASE 32 APPROVED`. The maintainer approved on the evidence above; the last
bullet's remaining items were not separately retested before approval —
same precedent as Phase 30's residual §42 regression groups.

Phase 31 partial evidence from the same existing profile: Setup reopened the
modal; all four agents appeared in the documented order; Claude/Codex showed
activity, decisions, and re-entry while OpenCode/Antigravity explicitly showed
those latter capabilities unsupported; keyboard Tab order stayed inside the
modal; Escape closed it. This does not prove the clean-profile, adapter-config,
outside-terminal, failure, or notification-consent paths in §43.

An isolated clean-profile attempt used the disposable application identifier
`com.vandershark.context-terminal.phase31-test` and successfully created a
separate empty database without touching the production profile. With the
production Logic Loop process still running, however, macOS accessibility
exposed only the production window; reaching the disposable onboarding window
would have required quitting the real app and risking its live terminal
sessions. The disposable development process was stopped. Complete the §43
clean-profile matrix in a maintenance window after all real sessions are
closed; adapter enable/error cases still require backed-up real config files,
and OS notification Allow/Don't Allow paths require human approval at the
system prompt.

Automated gates rerun 2026-09-11 against the current staged Phase 32 outline
polish: `onboarding:check`, `split-view:check`, `opencode:check`, all 26
aggregate frontend checks, strict TypeScript, production build, 58/58 Rust
library tests, and clippy with warnings denied pass. The build emitted only the
existing Vite chunk-size advisory. `npm run golden` was not run because these
Phase 32 changes do not touch extraction prompts.

## 45. Decision Tracker reconciliation and truthful answer state (Phase 33)

Implementation authorized with `PHASE 32 ACCEPTED` on 2026-09-11. Phase 32's
remaining manual checks stay open by explicit maintainer disposition.

**Superseded by Plan 016 (2026-09-12):** the two items below exercised
guessed natural-language reconciliation, which no longer exists — `reconcile()`
now only checks the deterministic Answer-now match. Left as historical record
of the removed behavior, not re-tested.

- [x] ~~Complete another turn, then naturally answer the old question. Confirm
      the old card becomes answered...~~ *(passed 2026-09-11 under the
      now-removed guessed-reconciliation path)*
- [x] ~~Submit an unrelated reply and an ambiguous bare affirmation. Old cards
      remain open.~~ *(passed 2026-09-11 under the now-removed skip-gate path)*

- [x] Ask two genuine questions, answer only one, and confirm the unanswered
      card remains open. *(passed 2026-09-11, disposable `dt-scratch` repo)*
- [x] In two same-project sessions, submit a reply in session B and confirm it
      cannot clear a similar open decision from session A. *(passed)*
- [x] Click **Answer now**. Confirm the correct live tab focuses and receives
      only the draft prefix while the card and badge remain open. *(passed —
      verified together with the next Enter-triggered check in one live run)*
- [x] Clear or cancel that draft, switch tabs, and wait through a refresh. The
      decision remains open. *(passed)*
- [x] Click **Answer now**, complete the draft, and press Enter manually. Only
      the resulting structured user transcript event can close the card.
      *(passed)*
- [x] Explicitly answer two old questions in one submitted message. Exactly
      those two close and other open cards remain. *(passed under the
      now-removed guessed-reconciliation path — superseded, see note above;
      Answer-now can still only close one card per click)*
- [x] Disable transcript delivery in a disposable setup. Answering does not
      optimistically clear the card, terminal operation stays normal, and the
      existing blind-session warning is visible. *(passed, on a fresh tab
      spawned after toggling `claude on` off — an already-running session
      keeps its existing hook, so blindness must be induced before spawn)*
- [x] Quit/relaunch after a reconciled answer and after a cancelled draft.
      Answered/open state survives accurately. *(passed on the surviving tab
      — see tab-restore bug noted below, found during this check)*
- [x] Repeat with Claude and Codex transcript-backed sessions. OpenCode and
      Antigravity remain honestly labelled unsupported. *(passed)*

Findings surfaced during this pass, both out of Phase 33's scope and not
blocking its own done criteria:

- **Decision dedup gap**: when the agent restates a still-open question in
  its own reply (e.g. after a partial answer, or a rejected bare
  affirmation), turn-pair extraction mints a second open card for the same
  underlying question rather than recognizing the existing open one.
  Reconciliation itself behaved correctly in every case (no false
  positive/negative), but duplicate cards accumulated repeatedly
  (`Logging: stdout, or file?` ×2, `Default port…`/`Port…` ×2, `Pin exact
  versions…`/`Version pinning strategy…` ×2). No semantic dedup against
  already-open candidates exists in the extraction path; only exact-ID
  reconciliation does. Worth a follow-up plan, not a Phase 33 regression —
  Plan 012 scoped no extraction-prompt dedup work.
- **Tab-restore bug**: quit with one Logic Loop tab + two `dt-scratch` Test
  tabs open; relaunch restored only one of the two `dt-scratch` tabs. The
  surviving tab's decision state (open card) was accurate, so this looks
  like a tab/session_bindings restore gap, not a data-loss issue — but
  needs its own repro and fix outside this plan.

Automated evidence (2026-09-11):

- [x] `npm run decision-integrity:check`
- [x] `npx tsc --noEmit`
- [ ] `npm run golden` — attempt 1: all 14 existing extraction cases passed;
      reconciliation passed 6/7 and exposed the bare-affirmation weakness.
      After one prompt correction, attempt 2 passed all 7 reconciliation cases
      but the unchanged legacy `08-delegation-answer` extraction fixture was
      missed (it passed attempt 1), leaving the full gate at 20/21. Paused per
      the plan's two-failure STOP condition. An authorized additional retry
      then passed the legacy fixture and all other cases, but the prompt-
      injection case returned explanatory prose before otherwise-correct JSON;
      strict parsing correctly rejected it. No further retry was made.
- [x] `npm run opencode:check` — included in the aggregate pass.
- [x] `npm run check` — all 27 configured checks pass.
- [ ] `npm run build`
- [ ] `cd src-tauri && cargo test --lib`
- [ ] `cd src-tauri && cargo clippy --all-targets -- -D warnings`
- [ ] `git diff --check`

## 46. Extractor spend emergency sprint (Phase 33.1)

Implementation authorized with `PHASE 33.1 ACCEPTED` on 2026-09-12, following
`plans/013-extractor-spend-emergency-sprint.md`. (PLAN.md's own manual-test
header names §45 — that number was already claimed by Phase 33's own live
matrix above by the time this landed; §46 is the correct, current section.)

Root cause confirmed by direct CLI measurement, `--output-format json`,
before any code change:

| call | before (fixed overhead) | after (Phase 33.1 spawn) | cut |
|---|---|---|---|
| extraction | 57,293 input-side tokens (2 input + 40,604 cache-creation + 16,687 cache-read) | 1,402 (2 + 1,400 + 0) | 41x |
| reconciliation | 57,015 (2 + 34,960 + 22,053) | 1,124 (2 + 1,122 + 0) | 51x |

`--strict-mcp-config --tools "" --setting-sources "" --no-session-persistence
--system-prompt "<...>"` added to the `claude -p` child in
`src-tauri/src/extractor.rs`'s `claude_args()` (mirrored in
`scripts/golden.ts`'s `runClaude()`). `--bare` was not used — it forces
API-key auth and breaks OAuth/Max-subscription logins. `--setting-sources ""`
was accepted by the installed CLI without error; the plan's documented
fallback (omit the flag) was not needed.

Haiku was tried on the reconciliation call and reverted within this same
sprint: it wraps its JSON reply in ` ```json ` fences that
`parseReconciliation`'s strict contract rejects (measured live: 5 of 6
non-gated reconciliation golden cases failed). Reconciliation stays on
sonnet; the prompt-size caps (20 candidates, 400-char question/assumption)
and the skip gates below still apply regardless of model.

- [ ] Fresh session, ask the agent a question that makes it ask you one back.
      Card appears. Reply "ok". Confirm the log shows **no** `extractor:
      claude usage` line (reconcile skipped by the bare-affirmation gate).
- [ ] Click **Answer now**, submit the prefilled line unedited. Card closes;
      log shows no `extractor: claude usage` line (Answer-now exact match,
      zero model calls).
- [ ] Ask the agent to restate the same still-open question in a later turn.
      Confirm no second card is created (insert-time dedup on the normalized
      question).
- [ ] Answer an older card in natural language that names it specifically.
      Card closes via one real reconciliation call; log shows
      `cache_creation_input_tokens` in the low thousands, not tens of
      thousands.
- [ ] Repeat Phase 33's own 11-step matrix (§45) once more and note
      session-limit consumption next to that pass's ~60% figure.

Automated evidence (2026-09-12):

- [x] `npm run decision-integrity:check`
- [x] `npx tsc --noEmit`
- [x] `npm run golden` — 21/21 (claude), 19 spawns (was 21 before the skip
      gates — fixtures 18/19 now gate at zero spawns).
- [x] `npm run check` — all 26 configured checks pass.
- [x] `npm run build`
- [x] `cd src-tauri && cargo test` — 60/60 (2 new: `claude_args_are_stripped_
      to_a_bare_json_completion`, `claude_result_extracts_result_field_and_
      tolerates_missing_usage`).
- [x] `cd src-tauri && cargo clippy --all-targets -- -D warnings`
- [x] `git diff --check`

## 47. Reconciliation defaults to haiku (Phase 33.1 sidequest)

Directed live by the maintainer on `feat/phase33.1-haiku-default`, following
`plans/014-reconciliation-haiku-default.md`. Not a formally gated numbered
phase (sidequest precedent).

`parseReconciliation` gained fence tolerance (it rejected haiku's
` ```json `-wrapped replies; `parseExtraction` already tolerated this).
`EXTRACTOR_MODEL=haiku npm run golden` then run **3 full times**: extraction
2/3 clean (one run false-positived on `09-question-in-code`, the exact
over-extraction case this project already treats as worse than
under-extraction — confirmed a real ~1-in-7 rate across 7 total attempts,
not a fluke), reconciliation 3/3 clean. Per plan: reconciliation now
defaults to haiku; extraction stays sonnet.

**Superseded by Plan 016 (2026-09-12):** the "Reconciliation model" control
and the guessed-reconciliation call it configured were both removed. These
three items describe a feature that no longer exists; not re-tested.

- [ ] ~~Open ⚙ Sidebar LM with backend = claude. Confirm a "Reconciliation
      model" control appears, defaults to haiku, and toggling to sonnet
      persists across a reload.~~
- [ ] ~~With the default (haiku), answer an old open card in natural language.
      Confirm it still closes correctly (no regression from the model
      switch in real use, not just golden fixtures).~~
- [ ] ~~Switch to sonnet, repeat the same check, confirm it still works, then
      switch back to haiku.~~

Automated evidence (2026-09-12):

- [x] `npx tsc --noEmit`
- [x] `npm run decision-integrity:check`
- [x] `npm run golden` — 21/21 (claude) with the shipped default mix
      (sonnet extraction, haiku reconciliation), 19 spawns.
- [x] `EXTRACTOR_MODEL=haiku npm run golden` — run 3x for flakiness: 1/3 at
      20/21 (fixture 09), 2/3 at 21/21. Reconciliation alone: 3/3 clean.
- [x] `npm run check` — all 26 configured checks pass.
- [x] `npm run build`
- [x] `cd src-tauri && cargo test` — 60/60, no Rust changes this sidequest.
- [x] `cd src-tauri && cargo clippy --all-targets -- -D warnings`
- [x] `git diff --check`

## 48. Descope automatic reconciliation (Plan 016)

Not a numbered phase — a partial rollback of Phase 33's guessed-reconciliation
call, directed live by the maintainer following `plans/015-decision-panel-
freeze-investigation.md`'s finding that it isn't load-bearing (Answer-Now +
manual dismiss + notifications already cover staying aware of open
decisions) and is the trigger for the duplicate-card and card-not-closing
bugs. See `plans/016-descope-auto-reconciliation.md`.

- [x] Open ⚙ Sidebar LM: confirm the "Reconciliation model" control is gone,
      other controls (backend, extraction model info, lmstudio/codex)
      unaffected.
- [x] Create an open decision card, answer it in plain natural language
      (not Answer-Now, not the exact question text). Confirm it does
      **not** auto-close, and no `extractor: claude usage` log line
      appears for that reply. Verified live: the log line fired only at
      card creation (extraction), not on the plain-text reply —
      reconciliation confirmed gone from the reply path.
- [x] Click Answer-Now on an open card, submit the prefilled line
      unedited. Confirm it still closes deterministically.
- [x] Manually dismiss (×) an open card. Confirm it closes.
- [x] Ask the agent to restate an already-open question. Confirm no
      duplicate card (insert-time dedup still holds).

Live matrix result (2026-09-12): all 5 manual steps pass. Tab-switch lag
(~20-30s) observed during steps 1 and 4 reproduces the pre-existing,
already-tracked freeze bug (see landmine "Extractor calls can freeze the
whole app" in CLAUDE.md) — unrelated to this descope, not a new regression.

Automated evidence (2026-09-12):

- [x] `npx tsc --noEmit`
- [x] `npm run decision-integrity:check` — updated contract-lock assertion
      pins `reconcile()` contains `matchAnswerNowReply(` and does **not**
      contain `run_extractor`.
- [x] `npm run golden` — 14/14 (claude), extraction-only now (7 reconciliation
      fixtures deleted).
- [x] `npm run check` — all 26 configured checks pass.
- [x] `npm run build`
- [x] `cd src-tauri && cargo test` — 60/60, no Rust changes (plan scope).
- [x] `cd src-tauri && cargo clippy --all-targets -- -D warnings`
- [x] `git diff --check`

## 49. Transcript schema-drift tripwire (Plan 018)

Not a numbered phase — directed live by the maintainer 2026-09-12 after
Plan 017's live testing found Claude Code CLI v2.1.270 adds several new
preamble/metadata line types to its local transcript. **Correction, same
day:** the first read only sampled a file's first 5 lines and wrongly
concluded the whole format changed incompatibly; a later live test proved
extraction still works fine (see below) — this ships as preemptive
insurance, not a fix for an active break. See
`plans/018-schema-drift-tripwire.md`.

- [x] Real 3-turn Terminal.app session on v2.1.270 (mixed preamble + real
      `assistant`/`user` lines): decision card extracted correctly, matched
      the actual conversation, and the warning strip stayed silent — the
      threshold correctly does not false-fire on this real-world shape.
      *(passed 2026-09-12 — this doubles as the "healthy session" checklist
      item below, done against a real case rather than a synthetic one)*
- [x] Manually append at least 20 lines whose `type` is something this
      module has never recognized (a purely synthetic case now, since no
      real Claude/Codex build currently produces one) to a session's
      transcript file, and confirm the adapter-warning strip appears with a
      message naming the agent and mentioning the transcript format — the
      same strip used for the existing foreign-PostToolUse warning.
- [x] Confirm the warning fires once per session, not once per line (no
      strip spam as more unrecognized lines keep arriving after the first
      20).

Live evidence (2026-09-14), Plan 024 Step C item 10, on a fresh session
(`~/.claude/projects/-Users-vandershark-Desktop-dev-dt-scratch-diffpopout/
cafb3397-...jsonl`) started after the `CLAUDE_CODE_CHILD_SESSION` fix above
— confirmed healthy first (real `user`/`assistant` lines present, one
stretch already at 18 consecutive unrecognized preamble lines without
firing, just under threshold):

- Appended 20 synthetic `{"type":"synthetic-drift-test"}` lines (36 → 56
  total). Warning strip appeared: "claude: transcript format doesn't match
  what this build expects (a CLI update likely changed it) — decision
  tracking may be broken until Logic Loop is updated" (screenshot
  evidence) — names the agent, mentions the transcript format, matches
  spec exactly.
- Appended 10 more (56 → 66) and sent one more real turn ("Thanks").
  Screenshot confirms exactly one warning line, no duplicate/stacked
  entries — fires-once behavior holds. The strip has no dismiss control by
  design (`driftWarned` never clears for the session), so it correctly
  stayed visible through the extra turn rather than auto-clearing — this
  is intended persistence, not a bug.
- Appending directly from a Bash tool call was blocked twice by Claude
  Code's own "Session Transcript Tampering" classifier — fired for both
  this session and a separate one the maintainer tried it from. Worked
  around by having the maintainer type the append command directly into a
  plain terminal prompt (no AI tool-call involved). Worth knowing for any
  future manual transcript-editing test: it needs a human's own hands, not
  an agent, even for a disposable scratch file.

Automated evidence (2026-09-12):

- [x] `npx tsc --noEmit`
- [x] `npm run decision-integrity:check` — `transcriptEnvelopeType` tested
      against real old-format Claude/Codex lines (recognized), the actual
      v2.1.270 preamble line types found live (unrecognized in isolation),
      and malformed JSON (unparseable, not drift); source-shape assertion
      pins `onTranscript` calling the tracker before text extraction.
- [x] `npm run check` — all 26 configured checks pass.
- [x] `npm run build`
- No Rust changes (no `cargo test`/clippy rerun needed).
- No extraction-prompt changes (no `npm run golden` rerun needed).

## 50. Codex extractor spend and transcript audit (Phase 34)

Phase 34 was authorized with `PHASE 34 ACCEPTED` on 2026-09-12; see
`plans/020-codex-extractor-spend-and-drift-audit.md` for the sanitized
two-call usage table. On Codex CLI 0.154.0, the exact app arguments produced
one valid, no-tool completed extraction turn in 5.36s with 16,756 input / 5,888
cached-input / 52 output / 0 reasoning-output tokens. The paired
`--ignore-user-config` run preserved `gpt-5.6-terra` and high reasoning
explicitly, stayed valid/no-tool, and used 15,139 / 9,984 / 52 / 0 in 4.36s.
Cached input is included in the input total, not added to it. No dollar or
subscription-limit claim follows from these usage counts.

- [x] `npm run codex-transcript:check` — old redacted rollout fixture still
      parses correctly on the installed CLI baseline.
- [x] One exact-argument and one paired-isolation extraction call each had one
      completed turn, a nonempty final message, and strict-valid extraction.
- [x] The output has no tool or MCP item in either measured run.
- [x] Usage logging tolerates missing usage; failed/incomplete Codex turns
      cannot return a prior agent message.
- [x] Fresh `npm run tauri dev` Codex session: a real assistant choice prompt
      created its card consistently, at about four seconds. Answering normally
      left the card open as designed; Answer-Now closed its card immediately,
      and manually dismissing another card worked. The card establishes that a
      live Codex rollout reached the transcript/tailer/extraction path.
- [x] The terminal and app stayed responsive throughout the interactive test.
      The dev log printed exactly three Codex usage lines for the observed
      extraction calls: `16744/5888/108/70`, `19262/5888/14/0`, and
      `16741/5888/35/0` (input/cached-input/output/reasoning-output). No
      recursive extractor behavior was observed. The warning strip was not
      separately inspected during this pass.

Automated evidence (2026-09-12):

- [x] `cargo test --lib extractor::tests` — 7/7.
- [x] `npm run opencode:check` and `npm run check` — all configured checks.
- [x] `npx tsc --noEmit` and `npm run build`.
- [x] `cd src-tauri && cargo test --lib` — 63/63. (The sandbox-only run
      denied an existing home-path temporary-directory test; the required
      permitted rerun passed.)
- [x] `cd src-tauri && cargo clippy --all-targets -- -D warnings`.
- [x] `git diff --check`.
- [x] `npm run golden` deliberately not run: no extraction prompt changed.

## 51. Antigravity session re-entry sprint (Plan 025)

**Status: PASS — Plan 025 sprint approved by the maintainer.** The maintainer
explicitly authorized a 2026-09-16 sprint bypass of the normal phase and
pre-code live-continuity gates while Antigravity quota may be unavailable.
The approval wording was `CURRENT PHASE APPROVED`; Plan 025 has no assigned
phase number, so this does not assert a literal `PHASE N ACCEPTED` for another
phase. The sprint branch is
`feat/antigravity-session-reentry`, based on `d95a7c7`. Installed `agy`
1.2.4 exposes `--conversation <id>` in `--help`. On 2026-09-16 a disposable
print-mode process was asked to remember a harmless three-word phrase,
then exited. A second process using `agy --conversation <id>` returned the
exact phrase and reported the same conversation ID with two turns. This
proves CLI continuity. The maintainer subsequently verified the Logic Loop
ghost-tab and Re-enter path in the dev app. During the original build an
installed Logic Loop instance was already running with active tabs, so that
build did not start a competing dev instance. The maintainer subsequently
reported that the remaining manual matrix passed as expected. The individual
prompt replies and probe console output were not supplied, so those rows are
identified below as maintainer-reported rather than independently captured.

| Check | Status / evidence |
|---|---|
| A new `agy --conversation <id>` process recalls a distinctive fact from a prior process | PASS — agy 1.2.4, 2026-09-16; second process returned the exact phrase and same ID, with `num_turns: 2` |
| First tethered turn creates a binding with `agent = antigravity`, exact tether, and project key | PASS — maintainer's dev-app SQLite read on 2026-09-16 found one active row for tether `d97aebfa…`: agent `antigravity`, session `5d8cfdd7…`, project key and cwd both `/Users/vandershark/Desktop/dev/context_terminal`, title `Agy reentry test`, color `#56b6c2` |
| Second turn refreshes that binding and returns the tab to working without an extra counted turn | PASS — read-only SQLite on 2026-09-16 found one binding for the tether and, after re-entry, 3 `hook:SessionStart`, 3 `hook:UserPromptSubmit`, and 3 `hook:Stop` rows for the same session. Running `summarizeDelta` over all 27 real session events returned `turns: 3`, so synthetic starts did not inflate the digest. The maintainer also confirmed the tab visibly changed to working during an Agy turn and resolved green afterward. |
| Empty `workspacePaths` uses only the exact live tab's project; stale/untethered events write no binding | PASS — maintainer reports the disposable live-app native-shaped payload probe passed, including exact live-tether binding. `bind-check` covers native cwd priority and rejection of missing, mismatched, or dead tethers; `antigravity::tests` covers absent/empty workspace paths. This was an injected native-shaped payload, not an observed CLI-generated projectless event. |
| Rename/recolor, quit, relaunch: one ghost tab retains project, title, color, and Re-enter | PASS — maintainer reported the dev-app ghost tab retained its `Agy reentry test` title and `#56b6c2` color, with Re-enter available after quit/relaunch (2026-09-16) |
| Re-enter launches the verified CLI command and retains prior conversation context | PASS — maintainer used Re-enter and reported that Agy recalled the pre-quit codeword `opal falcon 731` (2026-09-16) |
| Outside-terminal Antigravity session creates no tethered binding or ghost | PASS — maintainer reports the no-tether live-app native-shaped payload probe passed with no session binding. `sessionBindingLocation` also rejects a missing `tab_id`. This was an injected payload rather than a separate interactive Agy process. |
| Dead ingest still yields hook stdout `{}`, exit 0, and usable terminal; record elapsed time for two posts | PASS — 2026-09-16, with the app's saved ingest port confirmed closed, a valid turn-0 `PreInvocation` payload to the dev binary returned stdout `{}`, empty stderr, exit 0 in 0.028 s. The maintainer subsequently reports that Agy answered both prompts in the same outside-terminal session while Logic Loop was closed. The earlier shell attempt with a missing input file was not counted as a valid-payload test. |
| Claude/Codex resume and OpenCode's unsupported label remain correct | PASS — maintainer reports fresh Claude and Codex ghost-tab Re-enter tests recalled their distinct pre-quit codewords and Setup showed OpenCode `Re-entry not supported`. All 8 `pty::tests` passed, including Claude fallback, Codex command, Antigravity command, and unsafe-ID rejection. |

Live setup: macOS 26.4.1, `agy` 1.2.4, app branch commit `01f82a6`,
sanitized conversation ID `5d8cfdd7…`. Keep private transcripts and account
details out of git.

Automated evidence (2026-09-16, sprint branch):

- [x] `cargo test --lib antigravity::tests` — 28/28; ordered synthetic
      SessionStart and turn-open payloads, absent cwd/transcript, and
      no synthetic start for mid-turn calls or missing IDs.
- [x] `cargo test --lib resume_command_selects_antigravity_syntax` — 1/1;
      the unchanged ID validator is covered in the full Rust suite.
- [x] `npm run check` — all 27 configured frontend checks, including new
      binding fallback and Antigravity re-entry row assertions.
- [x] `npx tsc --noEmit`, `npm run build`,
      `cd src-tauri && cargo test --lib` (67/67),
      `cd src-tauri && cargo clippy --all-targets -- -D warnings`, and
      `git diff --check` passed.
- [x] App quit/relaunch, visible turn state, and dead-ingest hook timing were
      observed as above. The maintainer reported that the remaining
      projectless/outside-terminal probes, terminal-usability check, and
      other-adapter live regression passed; raw outputs were not supplied.
- [x] 2026-09-16 rerun: focused `bind:check`, `reentry:check`, `epoch:check`,
      `delta:check`, `onboarding:check`, 28 Antigravity Rust tests, and 8 PTY
      Rust tests; then `npm run opencode:check`, all 27 `npm run check`
      scripts, `npx tsc --noEmit`, `npm run build`, `cargo test --lib`
      (67/67), and clippy with warnings denied all passed.
- [x] After the approved `reentry: true` onboarding change, Step 7 was rerun
      in order: `onboarding:check`, 28 Antigravity Rust tests, 8 PTY Rust
      tests, `reentry:check`, `opencode:check`, all 27 frontend checks,
      `tsc --noEmit`, production build, 67 Rust tests, and clippy with
      warnings denied all passed. `git diff --check` passed.
- [x] `npm run golden` intentionally not run; no extraction prompt changed.

## 52. Antigravity `ask_question` waiting indicator (Agy Plan 004)

**Status: PASS.** Agy 004 is limited to surfacing Antigravity's
interactive `ask_question` pause as Logic Loop's existing waiting state.
The maintainer-provided review for `agy` 1.2.4 verified the hook contract:
register `PreToolUse` only for matcher `ask_question`, translate it to the
canonical `PermissionRequest` event, and answer the blocking hook with
`{"decision":"allow"}` so Antigravity proceeds to its own prompt.

- [x] Adapter setup includes a grouped `PreToolUse` hook with matcher
      `ask_question`, while `PostToolUse` remains matcher `*`.
- [x] `PreToolUse` translation emits `hook_event_name: "PermissionRequest"`
      and preserves `tool_name: "ask_question"` without ingesting prompt text.
- [x] `epoch:check` covers `UserPromptSubmit` → `PermissionRequest` →
      `PostToolUse` as working → waiting → working.
- [x] Stale pre-Plan-004 Antigravity setup no longer reports as enabled:
      `antigravity_hooks_status` now requires the `PreToolUse` registration
      and the `ask_question` matcher, so users are prompted to re-run setup.
- [x] Live Logic Loop tab manual check with `agy` 1.2.4: ask Antigravity a
      prompt that triggers `ask_question`; confirm the tab dot turns amber
      and pulses while the terminal waits for the answer, returns blue after
      the answer is submitted, and returns green on `Stop`. First attempt on
      2026-09-16 failed because `~/.gemini/config/hooks.json` still had the
      old four-event registration with no `PreToolUse`; rebuild/relaunch and
      run Antigravity setup again before repeating this check. Retest on
      2026-09-16 passed: Antigravity setup showed on, `ask_question` blocked
      in the terminal, and the active tab showed the amber waiting state.

## 53. Claude statusLine rate-limit meter (Plan 023)

Implementation authorized in-session by the maintainer (verbal "start the
coding sprint" while away from the machine, same precedent as Plans 025/026
bypassing the literal phase-token gate) against
`plans/023-claude-statusline-limits-meter.md`, CANDIDATE at the time. Built
on `feat/plan023-claude-statusline-meter` off `origin/main` post-PR #35/#36.
Wraps an existing `statusLine.command` only — never creates one from
scratch. New `src-tauri/src/statusline.rs` (singleton swap-and-restore,
base64-embedded original inside the generated wrapper script, `claude
--version` gate), a new `POST /statusline` ingest endpoint (`ingest.rs`,
never written to the `events` table), and a "Claude usage" sidebar block
(`src/components/ClaudeUsageBlock.tsx`) between the Sidebar LM row and the
adapter-warnings strip, matching all states in the plan's §3.

**Known deviation from the plan, flagged rather than silently resolved:**
§3.1 says the model name should render independently of the wrapper, "from
the existing transcript tailer." The plan's own §5 file-scope list does not
include `src/lib/decisions.ts`, and no `message.model` parser exists there
today. Rather than expand scope into the transcript tailer unbidden, the
model name here is sourced from the *same* `/statusline` mirror payload as
`rate_limits` (the real Claude statusLine JSON carries both) — so the model
label only appears once the wrapper is installed and has fired at least
once, not independently of it. Needs the maintainer's call: amend the plan
to match this, or file a follow-up to add the transcript-tailer path.

Automated evidence ([feat/plan023-claude-statusline-meter], 2026-09-17):

- [x] `cd src-tauri && cargo test --lib` — 80/80 (10 new `statusline.rs`
      tests: no-statusLine, setup+idempotent-second-call, remove-restores-
      exact-original, remove-on-foreign-is-noop, wrapper-path-repointed-is-
      noop, wrapper-file-missing/foreign-is-not-force-restored, byte-exact
      round-trip on arbitrary originals (quotes, pipes, embedded newlines,
      empty string), and the CLI version-gate parser). All against in-memory
      `serde_json::Value`/string fixtures — never a live `~/.claude/settings.json`.
- [x] `cd src-tauri && cargo clippy --all-targets -- -D warnings` clean.
- [x] `npm run statusline:check` — new script; state-derivation matrix (all
      7 states), bar-fill clamping (including the >100 spend_limit case,
      unclamped in the underlying number), reset-time formatting,
      staleness predicate, model-label parsing, and a source-grep guard
      that `App.tsx` registers `onStatusline` and `SidePanel` renders
      `ClaudeUsageBlock`.
- [x] `npm run check` — all 27 configured checks pass (26 prior + the new
      `statusline:check`).
- [x] `npx tsc --noEmit` clean.
- [x] `npm run build` clean.
- [x] `npm run golden` intentionally not run — no extraction-prompt changes.

Manual macOS matrix (the maintainer ran the core path; the cases below include
additional checks that remain open):

Maintainer live pass, 2026-09-17: an existing
`bash /Users/vandershark/.claude/statusline.sh` was detected. The maintainer
opted in, and the Claude 5h/weekly values matched Claude's own account usage
view. A short prompt moved 5h usage from 2% to 3%. Disabling restored the
visible Claude terminal status line. The no-statusLine, old-CLI/ineligible,
two-Claude-tab, and ingest-restart cases remain untested.

- [ ] No existing `statusLine` configured: block shows "No status line
      configured," no wrapper file is created, no `settings.json` write
      happens until/unless the user later adds their own statusLine and
      re-checks.
- [ ] Existing hand-written `statusLine.command` (the maintainer's own bar):
      enable the wrapper, confirm the visible terminal status line is
      byte-identical before and after, confirm a decision card / any other
      hook-driven feature still works unaffected, confirm the "Claude
      usage" block populates after the session's first response.
- [ ] Disable the wrapper: confirm `settings.json`'s `statusLine.command`
      is restored to the exact original string, confirm the wrapper script
      file is gone, confirm the visible status line is unaffected.
- [ ] Pre-v2.1.251 CLI (or a non-Pro/Max account) fixture: confirm the
      correct one of `unavailable-old-cli`/`unavailable-ineligible` shows,
      confirm no infinite retry/error loop.
- [ ] Two Claude tabs in the same project, one bound/active and one not:
      only the active bound tab's block populates; switching focus swaps
      which tab's data is shown, no stale carry-over.
- [ ] Kill/restart the ingest server while a session is running: statusLine
      mirror POSTs fail silently (fail-open), the visible terminal status
      line is never affected, the sidebar block degrades to `stale` rather
      than erroring.
- [ ] Compare displayed 5h/weekly percentages and reset times against the
      same account's own Claude Code terminal status line at the same
      moment.

## 54. Codex model and account meter (Plan 029)

Read-only source probe on 2026-09-17, `codex-cli 0.154.0`: a fresh app-server
connection returned `account.type=chatgpt`, matched an exact CLI rollout
session ID through `thread/read` and reported its `model`. The
`rateLimitsByLimitId` response contained `codex` (300-minute primary,
10080-minute secondary) and `base_model_inference` (10080-minute primary,
null secondary). No model request, login, thread resume, or account mutation
was made. Values are omitted here because they are live account data.

Automated checks:

- [x] `npm run codex-meter:check` — duration labels and staleness.
- [x] `cargo test --lib codex_meter` — named-bucket parsing, null window,
      malformed percent, wrong session ID (2/2 unit tests).
- [x] Ignored live production-reader test against an existing local Codex
      CLI session — exact model and account limits returned through the
      bounded Rust client. One initial failure exposed premature stdin close;
      fixed by waiting for all three responses before closing it.
- [x] `npm run opencode:check`, `npm run check` (28/28), `npx tsc --noEmit`,
      `npm run build`, `cargo test --lib`, `cargo clippy --all-targets --
      -D warnings`, and `git diff --check` (82 Rust tests pass, one live test
      ignored by default). The unprivileged Rust run hit an existing PTY
      fixture's filesystem sandbox restriction; the elevated rerun passed.

Manual macOS matrix:

Maintainer live pass, 2026-09-17: a Codex tab populated the meter after an
initial “Hi”, before a separate test prompt. Model and account windows matched
Codex `/status`. Switching to Claude hid the Codex meter. Returning to Codex
showed a roughly 1–2 second loading gap. An extra “GPT-reserve” named bucket
was visible; its applicability to the active model is unproven. Follow-up UI
change keeps the `codex` bucket visible, places extra named buckets behind an
“Other account limits” chevron, and caches the last snapshot by exact session
ID for immediate display on tab re-entry. Recheck those two UI changes live.
The focused Codex meter check, all 28 frontend checks, TypeScript production
build, and `git diff --check` passed after this UI change.
The two-Codex-tab, router, auth, and failure cases remain untested.

- [ ] Open a bound Codex tab and compare the displayed model and each account
      window's used percent and reset time with Codex's own UI at the same
      moment. Confirm the 300-minute and 10080-minute labels use their returned
      durations.
- [ ] Switch between two Codex tabs in one project, including a model switch
      and session resume. Each tab shows its own exact session model; old
      responses do not overwrite the newly active session.
- [ ] Check an unbound tab and a non-Codex tab: no Codex meter appears. Check
      collapsed/hidden panel: polling stops.
- [ ] Check with Safe Router off and on: account windows remain account-wide
      and never claim project attribution.
- [ ] Test API-key-only or logged-out auth, a null secondary window, a failed
      app-server read, and a hung reader. Terminals and hook ingestion continue;
      UI shows unavailable, missing, error, or stale state as appropriate.
## 55. Pi Agent Step 0 — local contract verification (Plan 026)

**Status: IN PROGRESS.** Maintainer authorized skipping the literal
`PHASE 26 ACCEPTED` token for this candidate (Plan 024's branch
reconciliation is moot — local `main` and `origin/main` both sit at
`d95a7c7` already). Step 0's live verification is explicitly NOT
skipped: Plan 026 requires it before any Build step lands.

- [x] Pi CLI installed: `npm install -g --ignore-scripts
      @earendil-works/pi-coding-agent` (recommended method, `--ignore-scripts`
      avoids install-time arbitrary code execution vs. the `curl | sh`
      alternative). Resolved to `/opt/homebrew/bin/pi`.
- [x] `pi --version`: `0.85.1`
- [x] `pi --help` captured — confirms `--session <path|id>` (explicit
      resume), `--session-id <id>` (create-if-missing), `--fork`, `--print/-p`
      (non-interactive), `--extension/-e <path>` (unpublished local load,
      matches Step 0's "do not edit global config" instruction), default
      `--provider` is **google**, not anthropic (plan's docs excerpt didn't
      state a default).
- [x] Extension module contract confirmed against upstream `extensions.md`:
      default factory `(pi: ExtensionAPI) => {...}`, `pi.on(eventName, async
      (event, ctx) => {...})`. `ctx.sessionManager.getSessionId()` /
      `getSessionFile()` and `ctx.cwd` exist as the plan assumed.
- [x] Disposable spike extension written (not installed):
      `logic-loop-pi-spike.ts`, logs redacted event shapes
      (`session_start`/`before_agent_start`/`tool_execution_start`/
      `tool_execution_end`/`agent_settled`/`session_shutdown`) to a local
      NDJSON file — no network, no prompt/tool-result text captured, only
      field names and lengths.
- [x] `pi auth check` — maintainer configured `anthropic` auth out-of-band
      (`pi auth check --provider anthropic --json` → `{"status":"ready",
      "authType":"api_key"}`); no key value was read, echoed, or set by
      this session.
- [x] Fresh session (`pi -p --session-id <id>`): `session_start` fires with
      `reason:"startup"`, correct `cwd`, `sessionFile` under
      `--session-dir`. `before_agent_start` fires with prompt length only.
- [x] Tool call, success case: `tool_execution_start`/`tool_execution_end`
      carry `toolCallId`/`toolName`/arg-keys/`isError:false`/result keys
      (`content`, `details`) — matches Build step 2's assumed shape.
- [x] Tool call, error case (nonexistent file read): `isError:true`, same
      shape otherwise. Confirms `tool_response: {is_error: boolean}` is a
      real, stable discriminator.
- [x] `agent_settled` fires exactly once, after the tool call completes,
      `isIdle` true — true idle boundary as the plan assumed.
- [x] `pi --session <full-uuid>` continuity: resumed a session created
      without an explicit `--session-id` (auto-generated UUID-v7-shaped ID,
      safe charset — hex + dashes, same class Claude/Codex/Antigravity IDs
      already pass through `valid_resume_id`); asked it to recall a value
      told to it in the prior process; got it back correctly. Context
      recall across process restart is real, not just same-process memory.
- [x] `getSessionId()` stability on re-entry: identical ID before and after
      resume.
- [~] **Deviation from upstream docs:** `session_start.reason` stayed
      `"startup"` on the resumed call too, not `"resume"` as
      `extensions.md`'s documented enum implies. Not a blocker — Build step
      2 maps `session_start` → `SessionStart` unconditionally, doesn't
      branch on `reason` — but flagging since the plan's Research section
      cited that doc as source of truth and it's measurably wrong here on
      `0.85.1`.
- [ ] `/new`, `/resume`, `/reload` (TUI-only slash commands) and
      same-process multi-turn: **not exercised.** `pi -p` is one-shot per
      process, so these can't be scripted non-interactively — each
      confirmed above used a fresh process per turn. These need a real
      interactive terminal pass; deferred to Step 5's live macOS matrix
      rather than blocking Build steps 1-4, since none of the four are
      load-bearing for what Build steps 1-4 actually implement (extension
      install/detect, event mapping, resume command construction).
- Gotcha for any future scripted `pi -p` spike (not a Pi bug): with no
  stdin redirect, `pi -p --session <id>` hangs indefinitely at 0% CPU with
  zero output, including no `session_start` from the extension — reads
  blocked on stdin with no TTY. Always redirect `< /dev/null` non-
  interactively. Real Logic Loop usage has a real PTY/TTY attached so this
  doesn't apply to the actual product, only to headless test scripts.

**Step 0 verdict:** the load-bearing contract (event shapes, tool
success/error discriminator, `agent_settled` ordering, `--session`
continuity, stable session ID) is proven on `0.85.1`. Slash-command and
same-process multi-turn behavior remains open, non-blocking per above.
Proceeding to Build steps 1-4 is warranted; Step 5's live matrix must still
cover `/new`/`/resume`/`/reload` before this plan can be called done.

**Build steps 1-2 live smoke test (2026-09-17):** beyond `cargo test`
coverage of the pure `plan_setup`/`plan_remove`/`extension_source` logic,
ran the actual generated extension (extracted verbatim from
`extension_source()`, not hand-transcribed) against a throwaway mock
ingest HTTP server on an isolated `$HOME` (real `~/.pi` symlinked in for
auth reuse, fake `.context-terminal/ingest.env` pointing at the mock) —
chosen specifically because the real Logic Loop dev app was live on its
real ingest port (`lsof` confirmed) and this had to not touch it. One real
Pi session with a `bash` tool call produced exactly four POSTs in order —
`SessionStart` → `UserPromptSubmit` → `PostToolUse` → `Stop` — each with
correct `Authorization`, `X-Logic-Loop-Tab` (from `LOGIC_LOOP_TAB_ID`),
`X-Logic-Loop-Hook: 1`, `X-Logic-Loop-Agent: pi`, and `PostToolUse` carried
`tool_use_id`, `tool_name: "bash"`, `tool_input: {command: "echo
pi-smoke-test"}`, `tool_response: {is_error: false}` — nothing else. Mock
server and isolated `$HOME` torn down after.

## 56. Pi Agent Step 5 — unattended groundwork (Plan 026)

**Status: PARTIAL, not a substitute for the live matrix.** Run
2026-09-17 while the maintainer was away from their computer, to push
whatever didn't require a human looking at the GUI or real provider
credentials. Tauri's window is a native WKWebView with no CDP bridge
(unlike Electron), so nothing in this section drove the actual Logic
Loop app UI — every GUI-level item below (toggle Pi on in Setup, spawn
a tab, tool detail/error rendering, disable-while-running, foreign-file
collision *error surfaced in the UI*, two tabs one cwd) is untouched and
still needs the maintainer.

What was exercised instead: the real generated extension (extracted
verbatim from `extension_source()` via a throwaway `#[cfg(test)]` probe,
run once, then reverted — `git diff --check` and `cargo test --lib`
82/82 confirm no residue) against a real `pi` 0.85.1 process, fully
isolated `$HOME` (`/tmp/pi-step5-probe/fakehome`), a disposable mock
ingest HTTP server, and `expect` (already on the box, nothing installed)
driving the interactive TUI — `tmux` isn't installed and wasn't added
per the toolchain-install rule.

- [x] `SessionStart` fires correctly on real interactive boot: correct
      `Authorization`, `X-Logic-Loop-Tab`, `X-Logic-Loop-Agent: pi`,
      `session_id`, `cwd`, all via a live process talking to a live
      (mock) ingest server — not a unit-test assertion on the string.
- [x] `/new` mid-process: fires a second `SessionStart` with a distinct
      `session_id` in the same `pi` process. Confirms the plan's
      per-`/new` re-open semantics and that `pendingTools.clear()` runs
      on the new `session_start`.
- [x] Absent ingest server: killed the mock server, booted `pi` fresh.
      `session_start` still attempts its POST, the extension's
      `.catch(() => {})` swallows the failure silently, no hang, no
      exception surfaced in the TUI, clean `/exit`. Fail-open confirmed
      at the extension level.
- [~] **Real finding, not yet explained:** the first boot in a given
      `--session-dir`, with no `--session`/`--session-id`/`--continue`
      flag at all, returned the *same* `session_id` as a previous run in
      that same directory (different `--name`). Pi may default to
      continuing the directory's most-recent session rather than always
      starting fresh — relevant to the "spawn a fresh Pi tab" matrix item
      if a stale `--session-dir` (or Pi's own default storage location)
      could hand a new tab someone else's prior context. Flagging for the
      live matrix to specifically check: a brand-new tab in a cwd with an
      existing Pi session history — does it start clean or silently
      resume?
- [ ] **Not exercised, correctly stopped rather than worked around:**
      any real turn (`before_agent_start` → tool call → `agent_settled`)
      needs provider auth. The isolated `$HOME` has none, and reaching
      into the real `~/.pi` for it (as Step 0's own live smoke test did
      via a symlink) is credential access this session's own permission
      guard correctly declined to do unattended. Consequence: tool
      detail/error, multiple turns, retry-before-idle, and quit/relaunch
      `--session` continuity are **not** covered by this pass — Pi does
      not persist a session file to disk at all until a turn actually
      completes, so there was nothing to resume in this isolated
      environment. These remain Step 5 live-matrix items exactly as
      before.
- Cleanup: all `pi`/mock-server processes killed, `/tmp/pi-step5-probe`
  is scratch-only, real `~/.context-terminal/ingest.env` and `~/.pi`
  were never written to (only listed by mtime to confirm, never read).

**Net effect:** confirms `/new` and absent-server fail-open live, ahead
of the maintainer's own pass, and surfaces one open question (session
reuse on fresh boot) worth specifically checking live. Everything
requiring the GUI or real model auth is unchanged from §53 — still
pending the maintainer's clean-profile macOS matrix.

### Maintainer live macOS pass (2026-09-17, partial)

- [x] Pi enabled in the real Logic Loop dev app; first tethered session and
      successful `echo PI-ALPHA-731` tool call appeared in Accomplished.
- [x] After a dev-app restart, Re-enter restored the Pi session and Pi
      accurately recalled `PI-ALPHA-731` from the prior process.
- [x] A missing-file `read` produced an ENOENT in Pi and an Accomplished
      activity row in Logic Loop. The Blockers panel stayed empty, as expected:
      Pi has activity support, not decision/blocker extraction.
- [x] A later `echo PI-SECOND-TURN` prompt passed, confirming continued
      multi-turn activity.
- [x] The maintainer reports `/new` began a clean session with a distinct
      session ID and no recall of the earlier marker. The Pi response also
      described separate per-directory session files; that explanation is
      agent-authored text, so the visible behavior is the evidence here.
- [x] The maintainer reports the app quit/relaunch re-entry check (Step 6)
      and disable-while-running check (Step 7) passed.
- [x] The second-tab `PI-BETA-924` prompt was canceled before completion;
      finish the two-tabs-one-cwd activity/binding check. The maintainer
      reported the rest of Step 4 passed, but did not supply separate
      Accomplished-row evidence for both tabs.
      *Reconciled 2026-10-08 from the explicit 2026-09-18 maintainer
      remaining-items pass below; not a new computer-use execution.*
- [x] Complete `/resume` and `/reload`, retry/follow-up-before-idle, foreign
      file collision UI error, and four-adapter regression checks before
      closing Plan 026. Record any additional Step 7 details if needed.
      *Reconciled 2026-10-08 from the explicit 2026-09-18 maintainer
      remaining-items pass below; not a new computer-use execution.*

### Maintainer live macOS pass, remaining items (2026-09-18) — Plan 026 closed

- [x] Two-tabs-one-cwd, retried: `echo PI-GAMMA-501` in tab A and
      `echo PI-GAMMA-502` in tab B both landed as separate Accomplished rows
      correctly bound to their own tabs. Non-blocking note: `PI-GAMMA-502`'s
      first send echoed back as plain text instead of an executed tool call
      (Pi's own model chose not to invoke the tool that turn); the identical
      resend executed normally. Not an ingestion bug — no tool call means
      nothing for the adapter to have dropped.
- [x] `/resume` and `/reload`: no crash, no duplicate `SessionStart`. After
      `/reload`, the tab was no longer bound to the original session — the
      Accomplished panel showed both `PI-GAMMA-501` and `PI-GAMMA-502` from
      that tab's full history rather than a single-session scope. Expected
      given `/reload`'s unbind-and-rebind semantics, not a bug.
- [x] Retry/follow-up before idle: `echo PI-EPSILON-503 && sleep 3 && echo
      PI-EPSILON-DONE` followed immediately by an unrelated follow-up
      prompt before the first settled — both landed as activity, no
      premature `agent_settled`, no dropped call.
- [x] Foreign file collision: with Pi disabled, planted a non-Logic-Loop
      `~/.pi/agent/extensions/logic-loop.ts` (no `MARKER` string), then
      toggled Pi on. Setup surfaced "Setup failed" with `logic-loop.ts
      isn't a Logic Loop file — leaving it untouched` and an enable button
      that flipped to "Retry" — `plan_remove`'s guard message
      (`pi.rs:227`), not `plan_setup`'s (`pi.rs:214`), meaning the toggle's
      enable path first attempted a remove/reset against stale frontend
      state rather than going straight to install. Whichever path fired,
      the core contract held: the foreign file was left untouched on disk
      and the error surfaced to the UI instead of silently overwriting.
      After `rm`-ing the foreign file and re-toggling, the real extension
      reinstalled cleanly.
- [x] Four-adapter regression: `echo REGRESSION-CHECK-$RANDOM` in one tab
      each of Claude, Codex, OpenCode, and Antigravity all ingested
      correctly — Pi's wiring introduced no regression.

All five outstanding Step 5 items now pass. Plan 026 (Pi Agent adapter) is
DONE — activity, decisions-not-supported, and re-entry are all live-verified.

**Homebrew detection regression (2026-09-18):** a Finder-launched release
build initially showed Pi Agent and DeepSeek Harness as "Not detected" even
though both CLIs were installed at `/opt/homebrew/bin`; both Enable buttons
were disabled. After `36a67b3` added Homebrew-prefix detection and the app was
rebuilt/relaunched, both adapters were detected and their hooks enabled
successfully. This is a GUI-PATH check, not evidence from shell PATH alone.

**Re-confirmed 2026-09-21** (independent of the Plan 026 close-out above,
run after CLAUDE.md's stale phase-status line was mistakenly read as "Step 5
still pending"): items 1-5 of the live GUI matrix (toggle, tab spawn, tool
detail/error rendering, disable-while-running, two-tabs-one-cwd) re-passed.
Item 6, foreign-file collision, re-run explicitly: planted a non-marker
`~/.pi/agent/extensions/logic-loop.ts`, clicked Enable — "Setup failed" /
`logic-loop.ts already exists and isn't a Logic Loop file — leaving it
untouched` surfaced correctly, file left untouched on disk, re-enable after
removing the foreign file worked cleanly. No regression since 2026-09-18.

## 57. Optional Safe Router model traffic view (Plan 022)

Plan 022 implementation was explicitly authorized while Phase 33 testing was
paused. This matrix is pending a release-build macOS pass; no box is claimed
as passed by automated tests. Do not change agent or router configuration to
run it. Use temporary fixture profiles for older/broken-log cases and preserve
the installed router log.

Automated evidence (2026-09-13): focused model-traffic check, all repository
checks, strict TypeScript, production UI build, 64 Rust library tests, clippy,
and `git diff --check` passed in the isolated implementation worktree. A
read-only probe of the installed router log found `user_version=2`, the v2
view, and a latest row with `usage_state=complete`; no model call was made.

- [ ] With no `~/.safe-router/log.db` in an isolated profile, open Traffic.
      It says the log is missing; no file is created. Terminals, hooks,
      Attention, and the project rail still work.
- [ ] Use fixture v1, empty v2, and populated v2 logs in turn. The older,
      empty, and populated states are distinct; the populated list shows the
      latest 100 by ID with time, key ID, requested/served model, backend,
      plane, disposition/status, counters, and usage state. NULL is “unknown”
      and a recorded 0 is 0.
- [ ] Use a malformed v2 view and an unreadable/locked fixture. The view
      shows a bounded error and Retry; terminals and ingestion remain usable.
      Restore a valid fixture, Retry, and confirm recovery.
- [ ] Open/close Traffic repeatedly, including during a slow read, then leave
      it open while the router writes to a WAL log. No duplicate refresh,
      frozen UI, or accumulating activity appears.
- [ ] In narrow/wide windows and with split terminals, compact/hidden project
      rail, and Lock-in, the global overlay remains legible; Escape/Close
      restore focus and normal work controls remain available.
- [ ] Confirm the Traffic trigger retains normal pill padding and shows its
      text beside the supplied bounce icon, then opens the existing traffic
      overlay.
- [ ] A fixture with an HTML-like `client_tag` renders it literally and leaves
      it unattributed. No project is inferred. Any future agent-specific tag
      experiment needs separate client-setup authorization and its own record.

## 58. Hook pill command labels hotfix

- [x] In a live app with Antigravity and DeepSeek Harness detected, confirm the
      header hook pills read `agy on/off` and `dsh on/off` respectively, while
      their tooltips retain the full agent names.
      *2026-09-20: agy passed clean.*
- [x] Toggle each pill and confirm setup/disable behavior and the Setup modal
      remain unchanged.
      *2026-09-20: agy passed clean. dsh toggle surfaced two real bugs, both
      fixed same session: `deepseek.rs::run()` and the `npm install` spawn
      (deepseek.rs:289) both used bare `Command::new(...)`, inheriting only
      the GUI-launched app's system PATH (no Homebrew/nvm dirs) — same root
      cause as the Codex meter GUI PATH bug (Plan 029). Both now go through
      `codex_meter::subprocess_path` (made `pub(crate)`), reusing the existing
      fix instead of duplicating it. Retested clean after rebuild.
      Also shipped while here: `dsh-terminal-app/src/index.js` was rendering
      user/assistant turns with no visual separation — added a blank line
      between turns and colored the `> ` prompt (and the terminal's echo of
      what you type after it) `#4d6afe` so the two are distinguishable.
      Confirmed live.*

## 59. Phase 35 — Agent identity icons in terminal tabs

Phase 35 was accepted on 2026-09-19. Automated evidence: `npm run check`
(32/32 scripts), `npx tsc --noEmit`, `npm run build`, and `git diff --check`
pass. The maintainer reviewed live screenshots with all six agent icons and
wrote `PHASE 35 APPROVED`; unrun regression cases remain unchecked below.

- [ ] Open one tab for each supported adapter: Claude, Codex, OpenCode,
      Antigravity, DeepSeek, and Pi. After its first structured event, confirm
      the matching icon appears beside the project name on the bottom row.
      Hovering the icon names the agent.
- [ ] Open a fresh shell tab without starting an agent. Confirm it has no agent
      icon. Start Claude and confirm the Claude icon appears only after
      structured activity arrives.
- [ ] Relaunch with a restored Claude session and at least one explicitly
      marked adapter session. Confirm both restored tabs show the right icon
      before new activity, with no broken-image placeholder.
- [ ] Check active, inactive, split-visible, narrow, long-title, waiting-age,
      auto-turn, blocker/decision-count, fan-out, and isolate-loop tabs. The
      top row keeps status/state/age/auto left and counts right; the bottom row
      keeps agent/project identity together; close remains visible on the top
      row with its hit area flush to the right edge. Ordinary project names
      remain readable, icons stay legible with compact spacing, notification
      badges do not touch or waste space, long titles truncate, and selection,
      close, reorder, scrolling, badges, and glows still work. The two rows
      read as a compact unit without crowding the top border or each other.

### Regression: foreign-session tab-identity hijack (found live 2026-09-22)

Found live: running `opencode run ...` as a one-off subprocess inside a
Claude-driven tab's shell flipped that tab's icon to OpenCode mid-session,
because the subprocess inherits `LOGIC_LOOP_TAB_ID` and its hook events
tethered to the same tab. Fixed by gating `App.tsx`'s tab-update reducer
(`mergeTabIdentity` in `src/lib/ingest.ts`) on session ownership
(`!t.sessionId || t.sessionId === p.session_id`), not just tether match.
Covered by `scripts/tab-identity-check.ts` (`npm run tab-identity:check`),
but the tether-inheritance mechanism itself is real-process behavior a unit
test can't exercise — confirm live:

- [x] Open a tab, start Claude, let it reach a real bound session (icon
      shows Claude). From that same tab's shell, run a one-off command with
      a different adapter CLI (or `curl` a synthetic hook payload at the
      ingest server using that tab's real `LOGIC_LOOP_TAB_ID` tether header
      but a different `session_id` and `X-Logic-Loop-Agent`). Confirm the
      icon does **not** move and the tab's bound session/resume identity is
      unaffected, while the foreign event still lands in `hook_events`.
      Confirmed live 2026-09-22: curl'd a synthetic `SessionStart` (session
      `foreign-synthetic-session-id`, `X-Logic-Loop-Agent: opencode`) at the
      tab's real tether. Event landed in `events` (id 188212, agent
      `opencode`); tab icon stayed Claude; the Claude usage bar (not called
      out in the original report) also stayed put — `mergeTabIdentity`
      (`src/lib/ingest.ts:241`) rejects the payload since `t.sessionId !==
      p.session_id`, so nothing downstream of that gate updates. Full pass.

## 60. Trust and responsiveness (Plan 032)

Maintainer authorized in-session 2026-09-19 ("Let's start 032"), same
precedent as Plans 016/017/025/026/029. Fixes three bounded reliability bugs
found by the 2026-09-19 codebase review, before further feature work: a lost
transcript record on file replacement/truncation, an LM Studio extraction
call with no total deadline (wedges the extractor queue forever on a stalled
local model), and a synchronous PTY write that could block the app's main
event-loop thread on a backpressured child. See
`plans/032-trust-and-responsiveness.md`.

Automated evidence (2026-09-19):

- [x] `cd src-tauri && cargo test --lib` — 122/122, including 7 new
      `ingest::tests` fixtures (split-write reassembly, multi-record +
      trailing partial, CRLF/blank-line trim, in-place truncation, new-inode
      replacement discarding a stale partial, oversized-unterminated-record
      cap, deleted-path `Gone` signal), 1 new `extractor::tests` fixture
      (LM Studio request against a TCP listener that accepts but never
      responds — call fails near its configured deadline, not indefinitely),
      and 3 new `pty::tests` fixtures against the extracted
      `spawn_ordered_writer` (send order matches chunk order; a send during
      an in-flight blocking write returns immediately; the drain thread
      exits and further sends error once a write fails).
- [x] `cd src-tauri && cargo clippy --all-targets -- -D warnings`
- [x] `npm run check` — 32/32 configured scripts pass.
- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `git diff --check`
- `npm run golden` not run — no extraction-prompt changes.

## 61. OpenCode session re-entry, resume-selector wiring (Plan 038 Part 2)

**Status: PASS — live-verified 2026-09-22.** The maintainer ran real
quit/relaunch/Re-enter against a live OpenCode tab in the built app
**twice back to back**: both times a ghost tab appeared and Re-enter
correctly resumed the TUI into the same prior conversation.
`capabilities.reentry` flipped to `true`; `README.md`'s OpenCode row
updated. Maintainer authorized
2026-09-21 ("Plan 038 APPROVED"), same in-session precedent as Plans
016/017/025/026/029/032. See `plans/038-opencode-adapter-expansion.md`
Part 2.

Live spike (2026-09-21, opencode 1.18.32, non-interactive `opencode run`,
not the TUI): `opencode run -s <session_id> "..."` in a fresh process
correctly recalled the prior turn's actual prompt, confirming resume
works. `session.created` did **not** re-fire on resume (once, total,
across both processes) — contradicts the upstream doc excerpt this plan
cited ("runs for both fresh creation and resume replay"); live behavior
trusted per this repo's standing doc-vs-live rule.

Found while implementing: `App.tsx`'s `SessionStart` binding-write path
was already fully agent-agnostic (`transcript_path` optional), and
OpenCode's plugin has emitted a `SessionStart`-mapped event since Phase 8
— so a ghost tab with "Re-enter" was very likely already appearing for
OpenCode sessions, but clicking it ran `resume_command`'s Claude fallback
and silently launched the wrong CLI. Fixed by adding an `"opencode"` arm
(`opencode -s <sid>; exec <shell> -l`, per `opencode --help`'s top-level
`-s`/`--session` flag) to `pty.rs`'s closed-set resume selector.

**Live pass, 2026-09-22**: quit/relaunch of the real built app with a live
OpenCode tab produced a ghost tab both times; Re-enter correctly resumed
the TUI into the same prior conversation both times, confirming the
non-interactive spike's finding held for the actual interactive path the
app launches. One real caveat surfaced during the same testing session
(not specific to re-entry, but discovered alongside it): a ghost tab that
re-enters a process which started **before** a plugin version bump keeps
running that process's already-loaded (stale) plugin code — Node doesn't
hot-reload an in-memory module, so only a genuinely new process picks up
a newly-deployed plugin file. Not a bug; document as an expected limit —
after toggling OpenCode off/on (or any future version bump), use a fresh
tab rather than a re-entered one to confirm the new behavior.

Automated evidence (2026-09-21):

- [x] `cd src-tauri && cargo test --lib` — 132/132, including new
      `resume_command_selects_opencode_syntax`.
- [x] `cd src-tauri && cargo clippy --all-targets -- -D warnings` clean.
- [x] `npx tsc --noEmit` clean.
- [x] `npm run check` — all configured scripts pass (exit 0).
- [x] `npm run build` clean.
- [x] `git diff --check` clean.
- `npm run golden` not run — no extraction-prompt changes.

Manual live pass — automated-gate pass above was run without GUI/built-app
access; the manual steps below were run live by the maintainer afterward,
on the `npm run tauri dev` build (`target/debug/app`, pid confirmed via
process tree, one clean `zsh -l` child):

- [x] Paste a large multi-KB block into one terminal tab while a second tab
      stays interactive. Passed — paste landed correctly, second tab stayed
      responsive.
- [x] Close/kill a tab immediately after a large paste. Passed — the tab's
      `zsh -l` process was confirmed gone from the process tree afterward
      (no orphan under launchd, no zombie); close was not observed to hang.
- [x] LM Studio down, connection-refused case: fully quit LM Studio (server
      process confirmed gone via `lsof -iTCP:1234` and a refused `curl`),
      configured Sidebar LM to `lmstudio`, asked a question in a terminal
      tab. Passed — no decision card appeared, and the app surfaced
      `lmstudio: decision extraction failed — check the ⚙ Sidebar LM
      backend/model settings` in the UI. Fails fast and fails open; no hang,
      no crash, no dangling extraction.
- [x] LM Studio down, **stalled-response** case (the actual 120s
      `timeout_global` code path — a refused connection above fails near-
      instantly at the OS level and never reaches it): point Sidebar LM's
      URL at a listener that accepts but never responds (e.g. `nc -l
      <port>`), ask a question, confirm the call fails at ~120s rather than
      hanging indefinitely. Covered by
      `extractor::tests::lmstudio_request_respects_a_total_deadline`
      (unit, fake TCP listener) and now observed live end-to-end.
      *2026-09-21: confirmed live. `nc -l 1234` was on the same port LM
      Studio's own background server already occupies by default — the
      first attempt silently hit the real LM Studio server instead of the
      stub (extraction pipeline worked fine, just not the intended test).
      After confirming LM Studio's server was stopped and `nc` actually held
      the port (`lsof -iTCP:1234`), the request landed at `nc` — full
      request headers/body, no response sent — and the app surfaced
      `lmstudio: decision extraction failed — check the ⚙ Sidebar LM
      backend/model settings` after the stall. Also confirmed live: the
      Decision extractor backend setting is global (one `extractor_config`
      row, no per-project scoping), so any tab's turns can trigger it.*
- [x] Recovery: confirmed 2026-09-19 — after switching Sidebar LM's backend
      back to `claude` post-test, a later extraction succeeded (which also
      cleared the stale `extraction_failed` banner, see addendum below).
      Queue was not left permanently wedged by the earlier failure.
- [x] Reproduce a transcript file replacement: copy the tailed session's
      `.jsonl` to a temp path and rename it over the original (new inode,
      identical content — same pattern editors use for a "safe write").
      Confirmed live 2026-09-19 on `dt-scratch-diffpopout`'s active session
      (`bfdb996c-c999-49bb-bac8-acdd7f6b1847.jsonl`, 37 lines before and
      after the swap). The session kept responding normally afterward (ran
      a Bash tool call, reached its permission prompt) — no data loss, no
      "tailer-failed" warning.

### Addendum: adapter-warning strip never clears (found live during the
    LM Studio down-test above, fixed same session)

Not part of Plan 032's original three fixes — a separate, real bug the
maintainer found live while testing step 4: `adapterWarnings` state
(`App.tsx`) was append-only. Every call site only ever added a warning
(deduped by agent+reason); nothing removed one, and `SidePanel.tsx` had no
dismiss control. Switching Sidebar LM's backend back to `claude` after
fixing an `extraction_failed` warning did nothing — the stale red banner
stayed until the app was restarted.

Fixed:

- `decisions.ts`'s `extract()` now takes an `onExtractionSucceeded?: (agent)
  => void` callback, threaded through `enqueue`/`onTranscript`/`onStop`
  alongside the existing `onExtractionFailed` one. It fires whenever
  `run_extractor` returns successfully (even if that turn's JSON is later
  rejected by `parseExtraction`) — connectivity/config is what
  `extraction_failed` was actually about, not any single turn's content.
- `App.tsx` wires this to `clearExtractionFailedWarning`, which filters any
  matching `{agent, reason: "extraction_failed"}` entry out of
  `adapterWarnings`. Structural warnings (`transcript_schema_unrecognized`,
  `foreign_post_tool_use`) are untouched — those don't self-heal on a
  successful extraction, so auto-clearing them would be wrong.
- `SidePanel.tsx` adds a manual `×` button on every warning-strip entry
  (`onDismissAdapterWarning` prop, generic — works for any reason, not just
  `extraction_failed`), for warnings the user wants to dismiss before the
  underlying condition resolves itself.

Automated evidence (2026-09-19): `npm run check` 32/32 (including
`decision-integrity:check`'s source-shape contract locks, which caught a
real mistake mid-fix — reformatting one `enqueue(...)` call onto multiple
lines broke its literal-substring ordering check; reverted to single-line),
`npx tsc --noEmit`, `npm run build`, `git diff --check`. No Rust changes.

- [x] Live, confirmed 2026-09-19 by the maintainer: the banner clears on its
      own after a later successful extraction, and the × button dismisses a
      warning immediately on click. Reported "tested and working."

## 62. OpenCode decision/blocker extraction (Plan 038 Part 1)

**Status: PASS — live-verified 2026-09-22.** A real plain-text question
("Do you want A or B?") produced a real Decisions card in the built app —
confirmed by screenshot: "NEXT" and "DECISIONS (1)" both showing "Do you
want A or B?" with answer/context/delegate actions, plus several earlier
dismissed cards from the same testing session ("Do you like green or
orange?", etc.), confirming this isn't a one-off. `capabilities.decisions`
flipped to `true`; `README.md`'s OpenCode row updated. Also fixed:
`decisionsEmptyReason`'s empty-state message was still hardcoded to
`agent !== "codex"` — would have kept claiming "not available for this
agent" for OpenCode forever even with extraction genuinely working.
Extracted a shared `adapterSupportsDecisions()` in `onboarding.ts`
(single source of truth off the `ADAPTERS` capabilities record) so this
can't drift out of sync with a future adapter's flip again.

The two earlier attempts that showed no card (a question-tool call before
v4 shipped, then a plain-text retry on an already-running re-entered tab)
are both explained, not unresolved — see the v4 and stale-file
sub-entries below, and Part 2's §61 caveat about re-entered tabs running
stale in-memory plugin code.

See `plans/038-opencode-adapter-expansion.md` Part 1.

OpenCode has no transcript file to tail. Its in-process plugin now buffers
`message.part.updated` text parts by part id and, once a message
completes, posts one synthetic `TranscriptLine` event
(`{type: "opencode_message", role, text}` as the `line`) through the
existing `/event` endpoint — scoped to the `opencode` agent marker,
re-emitted by `ingest.rs` as `ingest://transcript`, the exact shape the
real Claude/Codex file tailer already produces. `decisions.ts` gained one
more envelope case for it. Every downstream consumer (turn-pairing,
schema-drift tripwire, raw event log) is unchanged.

Two real bugs found and fixed before this shipped, neither assumed —
both caught by testing against real captured data:

1. **`message.updated`'s `info` object carries no text at all** — only
   `message.part.updated` does, and a part's *last* update (not first)
   carries the full accumulated text, with `reasoning`-type parts
   (internal chain-of-thought, never shown to the user) excluded by
   design.
2. **User messages never receive a `time.completed` timestamp**, ever —
   confirmed across two full turns of live capture. The first
   implementation gated every flush on that field, which would have
   silently dropped the user-prompt half of every pair forever (activity
   tracking would look fine; extraction would just quietly never fire).
   Fixed: only assistant messages gate on `time.completed` (they stream);
   user messages flush as soon as their single-shot text part has
   arrived.

Live verification (2026-09-21, opencode 1.18.32):

- [x] A hand-simulation of the buffering/flush rule, replayed against a
      real captured 2-turn event trace (`opencode run`, a real tool call,
      a real resume) — correct role-paired text for both turns, no
      duplicates, no `reasoning` leakage, before any Rust code was written
      against the assumption.
- [x] The **actual compiled `plugin_source()` output** (dumped via a
      throwaway test, not shipped), loaded into a real `opencode run`
      process behind a `fetch` wrapper that intercepted only the local
      ingest URL and passed every other call through unchanged (a first,
      blanket `fetch` override hung the whole process — it also broke
      OpenCode's own provider API calls). No real network call left the
      process. The real plugin posted exactly one correct `TranscriptLine`
      per role, correctly paired, with pre-existing lifecycle events
      unaffected.
- **Pending**: the real Logic Loop app, a live OpenCode tab, an actual
  open question in a real reply, confirming it surfaces in the Decisions
  panel. Update `README.md`'s OpenCode extraction column (`—` → `✅`) only
  after that passes.

Automated evidence (2026-09-21):

- [x] `cd src-tauri && cargo test --lib` — 133/133, including
      `plugin_source_buffers_text_parts_and_posts_transcript_lines`.
- [x] `cd src-tauri && cargo clippy --all-targets -- -D warnings` clean.
- [x] `npx tsc --noEmit` clean.
- [x] `npm run check` — 35/35 configured scripts, including new
      `opencode-transcript:check` (role/text round-trip, empty-text and
      unrecognized-role rejection, malformed-input handling, schema-drift
      tripwire recognizing the new envelope — mirrors
      `codex-transcript-check.ts`'s coverage shape).
- [x] `npm run build` clean.
- [x] `git diff --check` clean.
- `npm run golden` not run — no extraction-prompt changed, confirmed by
      reading `extractor.rs`/`decisions.ts` before this step, not assumed.

### §62 follow-up — real gap found by the live test, fixed as v4 (2026-09-22)

The maintainer's actual live test (a prompt designed to make OpenCode ask
a clarifying question) surfaced a real miss: it asked via
`→Asked 1 question` with multichoice options, not plain text, and no
Decisions card appeared. Root cause: OpenCode ships a real built-in
`question` tool (confirmed via upstream docs,
`packages/opencode/src/tool/question.txt`) — it arrives as a tool call,
never a text part, so v3's text-only buffering correctly never saw it.
Full derivation in `plans/038-opencode-adapter-expansion.md` Part 1's
"Step 3 live test" subsection.

Fixed (v4): `tool.execute.after` now special-cases `input.tool ===
"question"` and posts the formatted question (+ options) through the
same `TranscriptLine` path, reusing `onStop`'s existing assistant-only
extraction (no separate "user reply" line exists for a tool-answered
question). Answer-side content is explicitly not captured — the
`question` tool's `output` shape was never seen live; not guessed.

- [x] A live-schema-accurate synthetic `tool.execute.after` call, matching
      OpenCode's documented `QuestionV1.Prompt` shape exactly, fed
      directly to the real compiled `plugin_source()` output's actual
      handler — produced exactly one correctly-formatted `TranscriptLine`
      post (`"Which file should the sum helper go in? (utils.ts /
      math.ts)"`), silent for a non-question tool and a malformed
      `question` call.
- [x] `cd src-tauri && cargo test --lib` — 134/134, including new
      `plugin_source_extracts_the_question_tool_as_a_transcript_line`.
- [x] `cd src-tauri && cargo clippy --all-targets -- -D warnings` clean.
- [x] `npx tsc --noEmit` clean.
- [x] `npm run check` — 35/35, including a new `opencode-transcript-check.ts`
      fixture for the question-tool-formatted text.
- [x] `npm run build` clean.
- [x] `git diff --check` clean.
- **Resolved**: re-run against this fix initially still showed no card —
      root cause was a stale deployed plugin file, not this fix; see the
      follow-up entry below. Once redeployed, this fix's own logic
      (question-tool extraction) has not yet been independently re-proven
      live with a real `question`-tool call specifically (the live pass
      that finally succeeded used a plain-text question) — the direct-
      handler test remains this path's load-bearing verification.

### §62 second follow-up — real root cause was a stale deployed file, not code (2026-09-22)

The v4 re-test (and a plain-text retry that should have worked under v3
alone) both still failed live. Checked
`~/.context-terminal/logic-loop-opencode-plugin.mjs` directly:
**`version 2`** — deployed before any of today's work, no
`TranscriptLine` logic at all. `opencode_hooks_setup` only runs from the
Setup toggle's manual enable action, never automatically; and
`opencode_hooks_status` only checked that *a* plugin entry existed in
`opencode.json` (a stable path), never that the file's *content* matched
`OPENCODE_PLUGIN_VERSION` — so a stale file reported "enabled" forever.
Same bug class Agy 004 already fixed for Antigravity
(`antigravity_hooks_status`'s tightening); OpenCode never got it.

Fixed: `opencode_hooks_status` now reports `false` for a registered-but-
stale-or-missing deployed file, via a new pure `status_from(settings,
plugin_file_content)` (mirrors `antigravity.rs`'s `hooks_status_from`).
**Unblocking action**: toggle OpenCode off then on in Setup to force a
fresh write — that's the only thing that actually regenerates the file,
before or after this fix.

- [x] `cd src-tauri && cargo test --lib` — 136/136, including
      `status_is_false_when_registered_but_the_deployed_file_is_stale_or_missing`
      and `status_is_false_when_never_registered_even_with_a_current_file`.
- [x] `cd src-tauri && cargo clippy --all-targets -- -D warnings` clean.
- [x] `npx tsc --noEmit` clean.
- [x] `npm run check` — 35/35.
- [x] `npm run build` clean.
- [x] `git diff --check` clean.
- **Resolved, 2026-09-22**: toggled OpenCode off/on, re-ran Test 1 on a
      fresh tab — real Decisions card confirmed by screenshot. See §62's
      top-level PASS status.

## 63. Pi decision extraction (Plan 039 / Phase 39)

**Status: PASS — live-verified by the maintainer 2026-09-22.** Phase accepted
with literal `PHASE 39 ACCEPTED`.
Implementation branch `feat/pi-decision-extraction` starts from PR 51 merge
`13da7ff`.

### Step 0: redacted Pi 0.85.1 message contract

A disposable extension loaded with `pi -e <temporary path>` recorded only
event names, roles, content block types, text lengths, session ID, and tool
IDs — no prompt/reply text, reasoning, tool output, or credentials. Two real
processes used the same disposable session ID: a plain response, then
`pi -p --session <id>` with a harmless `pwd` tool call.

| Case | Redacted observed order | Result |
|---|---|---|
| Plain reply | `session_start` → `before_agent_start` → user `message_start` → user `message_end[text]` → assistant `message_start[]` → assistant `message_end[text]` → `agent_settled` → `session_shutdown` | PASS — finalized user/assistant text each appeared once |
| Tool + resumed process | `session_start` → user `message_end[text]` → assistant `message_end[toolCall]` → tool start/end → `message_end(toolResult[text])` → assistant `message_end[text]` → `agent_settled` | PASS — roles and block types safely distinguish visible conversation from tool traffic |

Findings:

- Both user and assistant finalized content are arrays of typed blocks.
- `message_start` assistant content is empty; it is not a valid extraction
  source. `message_end` carries the complete visible text.
- Tool-call rounds produce a finalized assistant message with only a
  `toolCall` block and a separate `toolResult` role. The shipped reducer accepts
  only `user`/`assistant` roles and `text` blocks, so both are excluded.
- No message ID exists on these live shapes. Neither run duplicated a
  finalized message, so no lossy time/content dedupe was added.
- Resume retained the exact session ID and the same ordering contract.
- Existing Plan 026 live evidence covers queued follow-up/retry lifecycle and
  `agent_settled` as the idle boundary. Phase 39 does not change those handlers.

### Automated implementation evidence

- [x] Pi generated extension version bumped to 2; v1 is stale until explicit
      re-enable.
- [x] Finalized message reducer posts `pi_message` synthetic transcript lines
      through the existing authenticated, tethered, fire-and-forget transport.
- [x] Rust ingest admits synthetic transcript lines only from OpenCode and Pi.
- [x] `decisions.ts` recognizes the explicit Pi envelope without changing
      pairing, reconciliation, queues, schema-drift thresholds, or prompts.
- [x] `npm run pi:check`, `npm run pi-transcript:check`, onboarding, OpenCode
      transcript regression, decisions, decision-integrity, and empty-state
      focused checks pass.
- [x] `cargo test --lib pi::tests` — 12/12 pass.
- [x] `cargo test --lib ingest::tests` — 17/17 pass.
- [x] Live dev-app pass: the rebuilt Phase 39 app correctly showed the installed
      v1 Pi extension as off/stale; re-enabling deployed v2, and a fresh Pi
      session produced the expected decision extraction. The maintainer reports
      the Phase 39 acceptance test passed. Existing Plan 026 live evidence and
      the full automated regression suite cover unchanged activity, same-cwd
      binding, retry, re-entry, dead-ingest, OpenCode, and Claude/Codex paths.
- [x] Full Phase 39 gates: `npm run check` (35/35 scripts),
      `npx tsc --noEmit`, `npm run build`, `cargo test --lib` (137 passed,
      one authenticated live Codex meter test ignored), Clippy with warnings
      denied, and `git diff --check` all clean. The first sandboxed Rust run
      denied the LM Studio deadline test's loopback bind; the required
      unsandboxed rerun passed.
- [x] `npm run golden` deliberately not run — no extractor prompt changed.

## Quality gates (machine-run, not manual)

- [x] `npx tsc --noEmit` clean. *(rerun 2026-08-18, Phase 9)*
- [x] `cargo clippy --all-targets -- -D warnings` clean (in `src-tauri/`).
      *(rerun 2026-08-18, Phase 9 — 10 new `pty.rs` git commands
      (`git_branches`, `git_worktree_add/remove`, `git_current_branch`,
      `git_has_changes`, `git_add_u`, `git_diff_cached`, `git_commit`,
      `git_create_branch`, `git_push`) clean, no new lint carve-outs needed)*
- [x] `cargo test` passes — 13/13, unchanged from Phase 8. *(rerun
      2026-08-18, Phase 9 — no new Rust unit tests this phase: the new git
      commands are thin subprocess wrappers in `git_log`'s own style, and
      the new pure JS logic (`sanitizeSlug`) has no natural Rust-side
      counterpart to test)*
- [x] `npm run golden` — 12/12 (claude). *(rerun 2026-08-18, Phase 9; no
      extraction-prompt changes — the Commit & Push footer reuses
      `run_extractor` via a new, separate prompt in `commitMessage.ts`, not
      `extractor.ts`)*
- [x] All nine check scripts pass: `npm run` `dedupe:check`, `reentry:check`,
      `unclaimed:check`, `notify:check`, `bind:check`, `epoch:check`,
      `landing:check`, `spawn:check`, `scope:check`. *(rerun 2026-08-18,
      Phase 9; no changes to any of these — Phase 9 touched no ingestion/
      binding/dedupe logic)*
- [x] `EXTRACTOR=lmstudio LMSTUDIO_MODEL=<id> npm run golden` — local backend.
      Measured 2026-07-19; **use `qwen3.6-35b-a3b`** for ⚙ Sidebar LM:

      | Model | Score | Failure mode |
      |---|---|---|
      | `qwen3.6-35b-a3b` | 12/12 | — |
      | `qwen3.5-27b-opus-distilled-mlx` | 11/12 | under-extracts: misses assumption-and-proceed |
      | `nvidia/nemotron-3-nano-omni` | 10/12 | over-extracts: invents decisions from rhetorical questions and questions inside code blocks |

      Over-extraction is the worse failure here — a Decisions panel full of
      non-decisions trains you to ignore it. Requalify any new model against
      the golden set before trusting the panel; small models pass the easy
      fixtures and fail exactly the ones the panel exists for.
      `LMSTUDIO_MODEL` is required when LM Studio has several models loaded
      (it 400s otherwise). Endpoint overrides go in `LMSTUDIO_URL` or the app's
      settings — never in a tracked file.
- [x] `npm run landing:check` — landing-draft parser assertions pass. *(new, Phase 4)*
- [x] `npm run epoch:check` — hook→state epoch guard assertions pass.
- [x] `npm run bind:check` — session→tab binding assertions pass. *(new, Phase 5)*
- [x] `npm run dedupe:check` — events dedupe key assertions pass. *(bugfix, pre-Phase 6)*
- [x] `npm run reentry:check` — one row per tether, latest wins on resume. *(new, Phase 6)*
- [x] `npm run unclaimed:check` — flag/claim predicate assertions pass. *(new, Phase 6)*
- [x] `npm run notify:check` — nudge fire predicate assertions pass. *(new, Phase 6)*
- [x] `npm run decisions:check` — session-grouping/sort assertions pass. *(new, Phase 17)*
- [x] `npm run board:check` — parse/splice/append round-trip assertions pass. *(new, Phase 18)*
- [x] `cargo test` — `board::tests` read/write/round-trip/error-path assertions pass. *(new, Phase 18)*
- [x] `npm run empty-state:check` — decisions-empty-reason priority-order assertions pass. *(new, Phase 19)*
- [x] `npm run board:check` — extended with Now-set round-trip/cap assertions. *(Phase 20)*
- [x] `npm run codex-transcript:check` — redacted real-shape Codex JSONL
      parser, ignored event types, and transcript-as-data assertions pass.
- [x] `npm run blockers:check` — project-scoped bulk-resolve SQL and Blockers
      clear-all UI wiring assertions pass. *(new, Phase 24)*
- [x] `npm run panel-layout:check` — panel mode transitions, invalid persisted
      values, and width fallback/clamping assertions pass. *(new, Phase 25)*
- [x] `npm run diff:check` — per-file diff slicing assertions pass, including
      the same-basename-in-a-sibling-directory case that must NOT match.
      *(new, issue #10; run 2026-09-06 on Windows via `npm run check`)*

## README badge hotfix — 2026-09-18

- [x] Inspected README markup: “Agents” appears above the five agent badges,
      matching the existing “Features” heading pattern.
- [x] Inspected all five agent SVGs: each has a `#1A1A1A` background and only
      its agent name in the visible pill.
- [x] Inspected all ten feature SVGs: each already has a `#1A1A1A` background.

## Codex meter GUI PATH hotfix — 2026-09-19 (Plan 029)

- [x] Reproduced installed npm Codex startup failure with system-only PATH:
      `env: node: No such file or directory`; normal shell reports 0.155.1.
- [x] Rust regression executes an env-node launcher against an isolated PATH
      without Node, then verifies the meter's augmented PATH finds its runtime.
      Inherited runtime precedence and fallback deduplication are also covered.
- [x] `npm run check` (including OpenCode and Codex meter), `npx tsc --noEmit`,
      `npm run build`, Clippy, and `npm run tauri build` passed.
- [x] Rust suite excluding `has_own_repo_refuses_a_home_directory_git_it_did_not_create`:
      110 passed, one authenticated live test ignored. The full suite hit a
      sandbox denial when that existing test tried to create `~/.git`, followed
      by a poisoned-lock failure in another test. The latter passes when the
      home-mutating test is excluded; no home-directory permissions were expanded.
- [x] Fully quit the old app when running sessions can be closed safely. Open
      the newly built app from Finder (or replace the installed copy first),
      start/re-enter a Codex session, and expand its sidebar. Confirm model and
      account windows load and refresh.
      *2026-09-21: confirmed live, in ongoing daily use.*

### Rust test-isolation follow-up — 2026-09-19

- [x] `cargo test --lib` — 111 passed, one authenticated live Codex meter test
      ignored. The home-directory repo regression now uses a temporary `HOME`;
      environment restoration and poisoned-lock recovery prevent it from
      affecting the rest of the suite.

## 64. DeepSeek decision extraction (Plan 040 / Phase 40)

### Live session-event contract — 2026-09-22

Tested with an isolated copy of `~/.dsh` under `/private/tmp`, Harness and core
packages `0.1.5-rc.2`, and redacted metadata logging only. No production or
installed-profile source was edited.

| Case | Redacted event order | Result |
| --- | --- | --- |
| Plain reply | direct `user/message` append → `assistant/message` append with `[reasoning,text]` → `turn/end completed` | Visible text was complete once, with a stable message ID. |
| Tool turn | direct user append → assistant `[reasoning,tool-call]` → `tool/call` → `tool/result` → assistant `[reasoning,text]` → completed | Text-only reduction omitted reasoning, tool traffic, and the empty tool-call-only assistant message. |
| Two turns / one process | second turn began at the next seq and committed its own user and assistant rows | `[firstSeq, session.seq)` was deterministic; no duplicate delivery observed. |
| Cross-process resume | `--resume` reused the exact session ID and recalled the first reply | The new turn appended after existing history and scanned only its own seq window. |

- [x] The trimmed readline value matched the direct human message. The same
      `user/message` type also carried injected `agent-instructions`, `plugin`,
      and `skill-catalog` sources, proving extraction must use the controlled
      readline string rather than scan user events.
- [x] A committed assistant event was `assistant/message`, `surfaceOp: append`,
      with `data.message.role: assistant` and a content array of typed blocks.
      Joining only string `text` blocks reproduced the visible prose.
- [x] `agent.whenIdle()` returned after `turn/end`; the post-idle scan therefore
      saw finalized messages before Logic Loop emitted `Stop` and flushed.
- [x] No replacements, compaction, duplicate events, or interrupted committed
      messages appeared in the live matrix. The reducer rejects replacements
      and interrupted messages explicitly. Failed/retried traffic was not
      induced against the funded provider; installed package types/source show
      noncommitted attempts as `assistant/attempt`, which the reducer rejects.
- [x] Step 0 gate passed. No PTY/stdout/session-file semantics are used.

### Automated and rebuilt-app matrix

- [x] `npm run deepseek-transcript:check` — reducer/envelope/order fixtures pass.
- [x] `npm run deepseek:check` — adapter v3, complete resource manifest, and
      installer characterization pass.
- [x] `cargo test --lib deepseek::tests` — 7/7 pass, including v2 stale/v3 current.
- [x] Full gates: `npm run check` (36 scripts), `npx tsc --noEmit`, production
      build, `cargo test --lib` (137 passed, one authenticated live test
      ignored), Clippy with warnings denied, and `git diff --check`. The first
      sandboxed Rust run denied the existing LM Studio deadline test's loopback
      bind; the unsandboxed rerun passed.
- [ ] Rebuild/relaunch, explicitly Enable incomplete v2 → v3, then run the Plan 040
      Step 6 live extraction, isolation, failure, re-entry, fail-open, collision,
      and existing-adapter regression matrix.
- [x] `npm run golden` deliberately not run; no extractor prompt changed.

### First rebuilt-app live result — 2026-09-22

- [x] Rebuilt v3 installed successfully after the incomplete v2 packaging
      failure; `dsh --profile logic-loop` booted the custom terminal runner.
- [x] A real DeepSeek turn produced a correctly bound Decision card in the
      sidebar (maintainer screenshot evidence).
- [x] Cross-process re-entry retained conversation context: when asked for a
      previously supplied number, the resumed model returned `1818` correctly.
- [x] Known UX limitation recorded: DeepSeek Harness restores model context but
      the Logic Loop-owned terminal runner does not replay historical chat text
      into the terminal. The user can continue the conversation, but cannot
      visually inspect earlier turns after re-entry. Other supported adapters
      currently restore visible history, so DeepSeek is the exception.
- [ ] Remaining Plan 040 live rows: reply reconciliation/cancel behavior, tool
      turn filtering, two-tab isolation, provider failure/retry, dead-ingest
      fail-open, foreign-directory protection, and existing-adapter smoke tests.

## Ingest endpoint recovery regression — 2026-09-22

After the OpenCode, Pi, and DeepSeek work, newly opened Claude, Codex,
OpenCode, Pi, and DeepSeek tabs all showed grey status and stopped feeding
notifications and sidebar cards. Read-only live diagnosis found the running
app listening on port 55883, while `~/.context-terminal/ingest.env` still
pointed to port 56669, which had no listener. Hook registrations for Claude
and Codex were present, but the latest persisted hook was at 08:43; later
tab activity was persisted. The surviving app process started at 08:19 and
the endpoint file was overwritten at 08:33, consistent with a second app
instance taking ownership of the shared endpoint and later exiting.

The code now checks whether another instance's advertised endpoint is alive
and reclaims the shared endpoint after two failed checks. The check uses an
authenticated `/health` request; a live newer instance keeps ownership.

- [x] Focused Rust tests: dead endpoint is reclaimed after two checks; live
      endpoint remains untouched.
- [ ] After installing the rebuilt app and relaunching it, start Claude and
      Codex sessions in fresh tabs. Confirm their status bulbs, notifications,
      decisions, blockers, and “Since you left” cards update.
- [ ] With one app instance still open, launch a second instance and close it.
      After a few seconds, confirm the first instance's newly started agent
      sessions still update the tabs and sidebar.

## Supra isolated trial — Plan 030 Claude extractor schema (2026-09-22)

This is a separate, unmerged worktree based on `main` at `b6beb1d`. The
maintainer explicitly bypassed the ordinary phase sequence for this Supra
trial. It does not change the current Logic Loop phase acceptance status.

- [x] Rust focused extractor tests: 8 passed, including unchanged no-schema
      Claude arguments, appended schema arguments, and structured-output
      precedence/fallback.
- [x] `npm run check`: 33 scripts passed on this branch's baseline.
- [x] `npx tsc --noEmit`, `npm run build`,
      `cargo clippy --all-targets -- -D warnings`, and `git diff --check` pass.
- [x] `cargo test --lib`: 136 passed; one pre-existing authenticated live
      meter test ignored.
- [x] One real Claude golden run with the new `--json-schema` path: 14/14
      pass. This confirms current CLI 2.1.280 accepts the schema and returns
      outputs that pass `parseExtraction`; it does not measure cost savings.
- [x] Launched an approved, separately bundled trial app with a distinct
      bundle ID. In a disposable Supra folder, Claude Code v2.1.280 produced
      a Decisions card asking whether to use `--dry-run` or `--simulate`.
      Codex v0.156.1 produced a second card asking whether to use
      `logic-loop.config.json` or `loop-logic.config.json`. Both exact
      questions were visible in the app's Decisions panel. No app install or
      hook toggles were made.
- [x] Restore the original app's shared hook ingest endpoint. After closing
      the trial app, foregrounding the original app rewrote
      `~/.context-terminal/ingest.env` to its original listener. A harmless
      authenticated request to `/statusline` returned HTTP 204; no relaunch
      was needed.

### Follow-up: forced schema-rejection path, live (2026-09-22)

The review that led to merging this branch asked for one more thing before
shipping: proof the fail-open path for an invalid `--json-schema` is real,
not just theoretical.

- [x] Ran the real Claude CLI (v2.1.280) directly with a deliberately
      malformed schema (`{"type":"object","properties":{"x":"not-a-valid-type"}}`).
      Result: `Error: --json-schema is not a valid JSON Schema: ...` and
      `exit 1`, rejected client-side **before any API call** — confirmed no
      cost was incurred for the invalid attempt (compared directly against a
      valid-schema call in the same session, which did bill for tokens).
- [x] Traced the failure through the app: `extractor.rs`'s claude arm checks
      `!out.status.success()` and returns `Err(...)` (`extractor.rs:315`);
      `decisions.ts`'s `extract()` catches the rejected `invoke()` and calls
      `onExtractionFailed(backend, "extraction_failed")` (already wired,
      pre-existing path shared with other extractor failures); this reaches
      `App.tsx`'s `adapterWarnings` state and renders in the `SidePanel.tsx`
      warning strip. No new plumbing needed — the fail-open contract already
      covered this failure shape.
- [x] Found the one real gap: `adapterWarningMessage`'s `extraction_failed`
      text pointed only at "check the ⚙ Sidebar LM backend/model settings,"
      which is wrong for a schema rejection (a Logic Loop bug, not a user
      settings problem). Reworded to also name that possibility. `tsc
      --noEmit` and `npm run build` both clean after the change; no test
      pins the old wording.

## Phase 41 — Antigravity decision extraction

`PHASE 41 ACCEPTED` 2026-09-22. Plan 037 Part C's live transcript-shape
gate passed before implementation. This build adds the scoped Antigravity
transcript path, parser, and the matching Setup/empty-state capability flag (a necessary
plan-scope addition so the UI does not claim extraction is unavailable).

Step 1 evidence, agy 1.2.8 on 2026-09-22: a fresh `agy --print` turn and a
second turn through `agy --conversation <id>` appended to the same
`~/.gemini/antigravity-cli/brain/<id>/.system_generated/logs/
transcript_full.jsonl`. The file grew from two to five lines; the original
lines remained byte-identical. It contained two `USER_INPUT` records with
visible prompt text inside `<USER_REQUEST>`, two `PLANNER_RESPONSE` records
with visible reply `content` and `status: DONE`, plus a `SYSTEM_MESSAGE`.
No duplicate `step_index` or planner `RUNNING` rewrite was observed.

- [x] Scoped path test accepts the verified `brain/<conversationId>/
      .system_generated/logs/transcript_full.jsonl` shape and rejects other
      agents, roots, parents, and filenames.
- [x] Parser checks extract only completed `<USER_REQUEST>` and visible
      `PLANNER_RESPONSE.content`; metadata wrappers, thinking, tools, and
      non-completed lines are excluded.
- [x] Read-only replay of the Step 1 real transcript through the new parser:
      5/5 envelopes recognized, 2 user requests and 2 visible planner replies
      extracted, 1 system line ignored. No transcript text was printed.
- [x] `npm run check`, `npx tsc --noEmit`, `npm run build`,
      `cargo test --lib` (140 passed, 1 ignored), and
      `cargo clippy --all-targets -- -D warnings` pass.
- [x] Confirm a real Antigravity open question becomes a Decisions card in the
      correct project. PASS 2026-09-24 (maintainer-reported): dev build of
      this branch via `npm run tauri dev`, agy 1.2.9, a real Antigravity
      question surfaced as a Decisions card in the correct project. Earlier
      attempt: on 2026-09-22, the rebuilt `/Applications/Logic Loop.app`
      was launched and a fresh Antigravity tab opened via Setup in an isolated
      `/private/tmp` project. The folder trust prompt was cleared and agy 1.2.8
      reached its prompt, but the requested turn returned “Individual quota
      reached” (about 20 hours until reset). No planner question or completed
      reply was produced, so that attempt was quota-blocked. The three PR CI
      jobs passed.

## 65. Momentum "↳ Ask" action (Plan 043, deterministic tier only)

Phase accepted in-session 2026-09-23. Step 0 found no uniform turn-end error
signal exists for hook-based adapters (`src/lib/ingest.ts:389` only
distinguishes `Stop`/`Interrupt`, no reason) and that the DeepSeek Harness's
own error signal is adapter-owned and out of scope — error-retry and the
LLM-riding toggle (tier 2) were dropped from this sprint per the plan's own
fallback, not built blind. Only the deterministic momentum action shipped.

### What shipped

- `src/lib/momentum.ts` (new): `computeMomentum` extracts
  `SidePanel.tsx`'s prior inline "Next" cascade (landing note → oldest open
  decision → oldest open blocker → planned board card) into a pure function,
  behavior unchanged.
- `SidePanel.tsx`: Next card gets a second action, "↳ Ask", beside the
  existing "✓ Done". Seeds the active tab's terminal input with
  `momentum.text` via the new `onSeedInput` prop; does not resolve/advance
  anything, unlike "✓ Done".
- `App.tsx`: new `prefillActiveTab` callback, same `ptyWrite`-only prefill
  discipline as the existing `answerNow` (Decision cards' "Answer Now"),
  simpler since `SidePanel` already only ever describes the active tab (no
  session→tab binding lookup needed).

### Automated evidence

- [x] `npm run momentum:check` (new): characterization fixtures prove
      `computeMomentum` picks the same item the old inline logic would for
      each source alone and combined (including tie-breaking by oldest
      `ts`, not array order), that answered decisions/resolved blockers
      never win, and that `done()` resolves the exact winning row.
- [x] `npx tsc --noEmit` clean.
- [x] Full `npm run check` (37 scripts, momentum:check added alongside
      board:check) — all pass.
- [x] `npm run build` clean, 95 modules (was 94 before `momentum.ts`).
- [x] `git status --short` / `git diff --stat` match the plan's Scope:
      `src/lib/momentum.ts` (new), `scripts/momentum-check.ts` (new),
      `SidePanel.tsx`, `App.tsx`, `package.json`.
- Rust side untouched — no `cargo` gates re-run for this change.

### Manual acceptance — passed 2026-09-23

Human pass confirmed: "↳ Ask" on a Next card seeds the terminal input
without sending, and "✓ Done" still resolves the item exactly as before.

### Fix: decision text was speaker-inverted (found in manual pass)

`momentum.text` for the decision case was `oldestOpenDecision.question`
verbatim — the agent's own question to the user. Sending it back verbatim
reads as the user asking the agent that question, not answering it.
Fixed in `src/lib/momentum.ts` to wrap it the same way `answerNow`
(App.tsx) already does: `Re: "<question>" — `. Landing/blocker/planned-card
text left verbatim — those aren't agent-posed questions.
`momentum-check.ts` assertion updated to match. `momentum:check`,
`tsc --noEmit`, and full `npm run check` (37 scripts) all clean after.

## 66. Codex tab identity with a shared daemon (Phase 44, 2026-09-26)

Live diagnosis on the installed app: Codex hooks arrived at the correct Logic
Loop ingest server, but their tab header came from an older tab's shared Codex
daemon, while the current interactive CLI had the new tab's environment. The
fresh tab stayed grey with no Codex icon, usage meter, or active Attention
route. Antigravity recovered after the maintainer enabled its hooks toggle.

The Phase 44 implementation changes Logic Loop's Setup command and Codex
re-entry command to `codex --no-daemon`, which keeps each interactive client's
backend and hook environment local to its terminal. Tethered binding and
SessionStart persistence now require a live tab that owns the session;
untethered Codex hooks are not assigned by cwd. A bare `codex` typed into a
shell can still attach to the shared daemon and has no exact hook identity.
Existing shared-daemon sessions need to be restarted with `--no-daemon`.

Automated checks passed: focused binding, tab identity, onboarding, and
Attention-state checks; `npm run opencode:check`, full `npm run check`,
`npx tsc --noEmit`, `npm run build`, `cargo test --lib` (140 passed, 1
ignored), `cargo clippy --all-targets -- -D warnings`, and `git diff --check`.
The sandbox initially denied tsx IPC pipes and two Rust localhost socket
fixtures; the named npm and Rust gates passed when rerun with those sandbox
restrictions lifted. No live Codex turn was run by this check.

Manual rebuilt-app matrix pending:

Later maintainer confirmation, 2026-09-26: **Setup → Codex → Start session**
works in the rebuilt app and the session is tethered. This supersedes the
earlier uncertainty about that launch path. Blue/green status, icon, usage
meter, and the rest of the rebuilt-app matrix were not separately reported,
so the checkbox below remains open. Ordinary `codex` typed in a +/⌘T shell
or a bookmarked-folder shell still takes the shared-daemon path and is not
fixed by Setup's launch command. Phase 44 needs a revised shell-launch plan
before those paths can be accepted.

Maintainer follow-up, 2026-09-26: launching `codex --no-daemon` manually in
the **old** build had already fixed the observed tab behavior before the 03:01
rebuild. This is a live confirmation of the launch-command remedy, separate
from the later rebuilt-app Setup attempt. The maintainer does not need an
immediate repeat test. Keep the rebuilt-app matrix below unchecked until its
specific Setup, binding, status, and meter observations are verified.
Setup's Codex help text was also corrected to direct users to the Codex Start
session choice and show `codex --no-daemon` for plain shell tabs. This copy
change is source-only until a later rebuild; no immediate rebuild or retest was
requested.

### 03:11–03:13 rebuilt-app attempt — failed, 2026-09-26

The installed `/Applications/Logic Loop.app/Contents/MacOS/app` is byte-for-byte
the 03:01 release binary (`fd22c71e…` SHA-256); its embedded frontend asset is
`index-DLNL4ETh.js`, whose Setup Codex choice is `codex --no-daemon`. The
Setup handler passes that choice as `launchCmd` to `pty_spawn`, which writes it
to the new PTY. This proves the installed Setup **code path**, but no surviving
process record proves which choice was selected or which command the 03:11 and
03:13 shells actually executed.

Read-only database metadata confirms two Codex sessions started at 03:11:18
and 03:13:32 HST. Every hook, including both SessionStart events, carried
`4f97374a-e024-4262-b818-15cd02d59c82`; neither session has a
`session_bindings` row. The still-running shared app-server daemon (PID 73993,
started 00:16) and its manager (PID 72707) have that exact
`LOGIC_LOOP_TAB_ID` in their environments. The hook command sends its own
`$LOGIC_LOOP_TAB_ID` as the tab header, so the old tether is consistent with
hooks launched by that shared server. The 03:11–03:13 CLI and hook processes
have exited; their argv, inherited environments, and server connections were
not captured. Consequently this evidence does **not** establish that
`--no-daemon` failed in a Setup client, or that the test actually launched it.

Endpoint ownership for those two events is also unproven. All instances use
the same database, while each app process emits hooks only to its own window.
The current `~/.context-terminal/ingest.env` was last written at 03:14:54
and advertises port 53655, which has no listener now; it cannot identify the
03:11–03:13 endpoint owner. No Logic Loop process was running during this
diagnostic inspection. A database row alone cannot prove the rebuilt window
received an event.

The smallest Phase 44 implementation remains the in-tree Setup/re-entry
`--no-daemon` launch and strict tether binding; the failed attempt does not
yet justify another source change. When live acceptance testing resumes, run
with exactly one default-profile Logic Loop instance and capture, without
tokens or content:
the app PID and ingest listener owner, Setup's selected command, the spawned
Codex client PID/argv and `LOGIC_LOOP_TAB_ID`, its embedded or shared server
connection, the hook process's `LOGIC_LOOP_TAB_ID`, and the new session ID and
exact binding. Submit one short turn and watch blue working, then green idle,
Codex icon, and usage meter. Continue the matrix below only after that check
passes. Automatic approval review rejected an attempted UI open of Logic Loop
because that action can launch a default-profile instance; no app was opened
or connection stopped during this inspection.

Post-diagnosis gates: focused binding, onboarding, tab-identity, and
Attention-state checks passed; `npm run opencode:check`, full `npm run check`,
`npx tsc --noEmit`, `npm run build`, `cargo test --lib` (140 passed, 1 ignored),
and `cargo clippy --all-targets -- -D warnings` passed. The first sandboxed
focused check could not create tsx's IPC pipe; it and the remaining npm checks
passed outside that restriction. No live manual item is marked passed.

### Revision: bare `codex` in zsh tabs (built 2026-09-26)

Plan 044's approved revision. zsh tabs spawn with `ZDOTDIR` pointed at
app-written `~/.context-terminal/zsh/` files that source the user's own
startup files, hand `ZDOTDIR` back, and define `codex` to add `--no-daemon`
once (a user's own `codex` alias/function wins). Same-tab session takeover was
built, found unsafe in review (Codex from Claude's Codex plugin would flip a
Claude tab), and reverted before release; first-session-wins is unchanged.

Automated evidence: `pty::tests::zsh_integration_wraps_codex_once_and_keeps_user_startup`
runs a real interactive zsh: bare `codex` gains the flag, `codex --no-daemon
resume 'a b'` arrives as exactly `[--no-daemon][resume][a b]`, and a user
`.zshenv`-moved `ZDOTDIR`, `.zshrc` alias, and `HISTFILE` survive.
`bind:check` and `tab-identity:check` assert a Codex SessionStart cannot take
over a bound tab, including a Claude tab. Gate results are recorded in the
phase report. No live item below is marked passed yet.

Live matrix (one Logic Loop instance, rebuilt app; leave the shared daemon
running and note its PID/start time before and after):

- [x] **First, alone:** + tab → type bare `codex` → prompt. Codex icon, blue
      then green, usage meter, exact binding. Stop here if it fails.
      **Pass 2026-09-26 05:04** (tether `f7a777d7`, own session; retested
      05:35 as `9ded0328`). No post-install hook carried the stale daemon
      tether `4f97374a`.
- [x] Second + tab in the same directory, bare `codex`; alternate prompts.
      Each tab keeps its own session, dot, and meter.
      **Pass 05:06** (`a55550d4`, distinct session; decisions tagged to each
      tab). The shared side panel is by design: panels are project-scoped
      SQL views, so two tabs in one folder show one project's panel (retest
      tab in `~` got its own panel because it was a different folder).
- [x] Bookmark tab → bare `codex` → binds. **Pass 05:09** (`deaff55e`).
- [x] Setup → Codex → Start session, and Re-enter a Codex session: no
      "cannot be used multiple times" error. **Pass 05:13/05:14** (Setup
      `2d2afb47`; Re-enter resumed the same session into `7244a147`).
- [x] In a Claude tab, run something that uses the Codex plugin; the tab stays
      Claude. **Pass 05:21:** the plugin's Codex session (`01a0de4e`) carried
      the Claude tab's tether `4eb21f63`, was refused, and its blocker
      ("command not found: python" from Codex's own `zsh -c` tool call, not
      the Logic Loop startup files, which contain no `python`) stayed unrouted.
- [ ] Exit Codex and re-run it in the same tab: stays on the first session
      (known limit, same as before 0.157). Note it; don't fail on it.
      **Observed 05:23:** exit + `resume` of the same session in `7244a147`
      re-bound normally (same session keeps ownership). Two bare relaunches
      that exited before a prompt emitted SessionEnd-only sessions and were
      correctly ignored. Maintainer later placed the side-panel card issue at
      test 4's second half (close a Codex tab → Re-enter). Unconfirmed and
      not investigated in Phase 44; carried as an open follow-up.

**Phase 44 accepted 2026-09-26** (literal `PHASE 44 ACCEPTED`).
- [x] Your zsh prompt, aliases, and history (↑) look normal in a new tab.
      **Pass 2026-09-26:** prompt, ↑ history, `$ZDOTDIR` (user's), `$HISTFILE`,
      `type codex` (shell function), and alias count match Terminal.app.
- [x] Daemon PID/start time unchanged. **Pass:** shared daemon PID 73993
      (started 00:16:57) and its supervisor PID 72707 (00:11:51) are the same
      processes seen before the rebuild; Logic Loop never touched them.

- [ ] In a fresh Setup Codex tab, submit a prompt; confirm the Codex icon and
      blue working dot appear, then the green idle dot and usage meter. Check
      that a new Attention item routes to this tab when one is produced.
- [ ] Start two Setup Codex tabs in the same project and alternate prompts;
      each must keep its own session, dot, and meter.
- [ ] Run `codex --no-daemon` from a plain Logic Loop shell, then re-enter its
      session after relaunch; confirm the exact tab is restored.
- [ ] Start Codex outside Logic Loop; it must not claim a Logic Loop tab.
- [ ] Close a Codex tab; late hooks must not create an active re-entry row.
- [ ] Start a new Antigravity process with hooks enabled and verify its icon
      and blue/green activity state still work.

## 67. Codex launch registry and in-tab session replacement (Phase 45, 2026-09-26)

Plan 045. Each managed Codex run registers a launch for its tab's PTY and
carries it as `LOGIC_LOOP_TAB_ID=<tab>:<launch>`. A registered launch's
first `SessionStart` replaces the tab's session. Within one launch, only
`/clear`, in-TUI `/resume`, and `/fork` replace. `/new` does not (Step 0:
it sends the same `startup` source as a child `codex exec`). Launch-less
Codex events still bind an unbound tab (Decision A).

Automated evidence: `launch::tests` (registry, verdicts, PTY death),
`ingest::tests::{tether_split_and_launch_verdicts,launch_endpoint_registers_retires_and_rejects}`,
`pty::tests::{codex_launch_prefix_registers_for_live_tethered_pty_only,zsh_wrapper_registers_passes_through_and_fails_open}`
(a real interactive zsh against a local listener: one `/launch` + one
`/launch/end`, passthrough makes no request, the id never leaks into the
shell, and an unreachable app launches untracked). `bind:check` covers every
row of Plan 045's Step 3 table plus stale daemon, plugin, two-tab,
heal-path, and other-adapter cases. `tab-identity:check` covers state
clearing on replacement and the new session's first prompt. Gates: full
`npm run check`, `npx tsc --noEmit`, `npm run build`, `cargo test --lib`
(151 passed, 1 ignored), `cargo clippy --all-targets -- -D warnings`,
`git diff --check`.

Live matrix items 1-10 below: **passed 2026-09-27**. Finding from the run:
tab A's dot stayed green after `/quit` in test 6, before any stale-daemon
fake was sent — the idle state doesn't reset on quit. Separate from the
stale-daemon binding logic under test (that part passed: both synthetic
`204`s landed correctly, B picked up the Codex icon per Decision A, and B's
real `codex` prompt then bound it). Not yet root-caused; carry as an open
follow-up.

### Quick run guide (≈20 min, rebuilt app)

Before rebuilding, note the daemon: `ps -o pid,lstart -p 73993`.

**Setup, once per tab you check from.** Paste these two helpers. They are
read-only, except `llstale`, which posts one fake hook:

```sh
# Last N Codex session starts: time, tab (8 chars), launch verdict, source, session tail
llcx() { sqlite3 -readonly -column -header ~/Library/Application\ Support/com.vandershark.context-terminal/context-terminal.db "SELECT datetime(ts/1000,'unixepoch','localtime') at, substr(json_extract(payload_json,'\$.tab_id'),1,8) tab, json_extract(payload_json,'\$.launch') launch, json_extract(payload_json,'\$.source') source, substr(session_id,-6) sid FROM events WHERE type='hook:SessionStart' AND json_extract(payload_json,'\$.agent')='codex' ORDER BY id DESC LIMIT ${1:-5};"; }
# Fake a stale-daemon SessionStart (plain tether) for tab id $1
llstale() { ( . ~/.context-terminal/ingest.env; curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $CT_TOKEN" -H "X-Logic-Loop-Tab: $1" -H "X-Logic-Loop-Agent: codex" --data-binary "{\"hook_event_name\":\"SessionStart\",\"session_id\":\"stale-test-$RANDOM\",\"source\":\"startup\",\"cwd\":\"$PWD\"}" "http://127.0.0.1:$CT_PORT/event" ) }
```

A tab's id: `echo $LOGIC_LOOP_TAB_ID` in its shell. "Tab follows" means its
dot goes blue, then green, on the new session's prompts. Any `codex` prompt
can be "reply ok".

1. **Relaunch replaces.** Open a + tab, run `codex` → prompt → `/quit` →
   `codex` → prompt. The tab follows. `llcx 2` shows two rows for this tab,
   both `launch=current`, with different `sid`.
2. **In-TUI switches** (same Codex):
   - `/clear` → prompt: follows (`source=clear`).
   - `/resume` → pick an older session → prompt: follows (`resume`).
   - `/fork` → prompt: follows (`fork`).
   - `/new` → pick **Current checkout** → prompt: the dot does **not**
     react. That is expected: `/new` is unsupported.
   - `/compact`: nothing changes.
3. **Child exec.** Ask Codex to run `codex exec "echo hi"` (approve it). The
   tab keeps its session: `llcx 1` shows the child as a `startup` row, and
   your next prompt still drives the dot.
4. **Plugin in Claude.** In a Claude tab, run `/codex:review` or anything
   that uses the Codex plugin. The tab stays Claude (icon unchanged).
5. **Setup + Re-enter.** Setup → Codex → Start → prompt: binds, and
   `llcx 1` shows `launch=current` (not `unknown`, so no double wrap).
   `/quit` → `codex` → prompt: follows. Close the tab → Re-enter it →
   prompt: binds (`source=resume`, `launch=current`).
6. **Stale daemon.**
   - Tab A: `codex` → prompt → `/quit`. It is now bound. Note its id.
   - Tab B: a fresh + tab. Note its id.
   - From either tab: `llstale <A-id>` then `llstale <B-id>`. Each prints
     `204`.
   - Expected: A is unchanged. B shows the Codex icon (Decision A).
   - In B: `codex` → prompt. B follows the real session.
   - Also: in Terminal.app, run bare `codex` → prompt. No Logic Loop tab
     changes. (The one exception is tab `4f97374a`, the daemon's baked-in
     tether: if that tab is live and unbound, it may bind by design.)
7. **Two tabs, one folder.** Two + tabs in the same repo. In each: `codex`
   → prompt → `/quit` → `codex` → prompt. Alternate prompts: each dot
   reacts only to its own tab.
8. **Registration failure.** In a fresh tab, run
   `LOGIC_LOOP_PTY_GEN=999999 codex` → prompt. Codex works normally, and
   `llcx 1` shows `launch=none` (untracked; it still binds per Decision A).
9. **Nothing else disturbed.** `ps -o pid,lstart -p 73993` matches your
   pre-rebuild note. The zsh prompt, ↑ history, and aliases look normal.
10. **bash (plain tether).** In a fresh + tab, type `bash`, then
    `codex --no-daemon` → prompt. The tab binds, and `llcx 1` shows
    `launch=none`. Inside `bash` there is no wrapper, so this is the same
    case as a bash tab.

Live matrix (rebuilt app, one default-profile instance). Leave the shared
daemon running, and note its PID and start time before and after. In
`/new`'s "Where should the new conversation run?" dialog, pick **Current
checkout**; "New worktree" creates `~/.codex/worktrees/…`.

- [x] 1. + tab → `codex` → prompt → exit → `codex` → prompt: the tab follows
      the new session (dot, meter); Re-enter lists only the new one.
      **Pass 2026-09-27:** `llcx 2` showed tab `e468f9eb` twice, both
      `launch=current`, sids `101b5e`→`708ea1`.
- [x] 2. In one launch: `/clear` → prompt: follows. In-TUI `/resume` of an
      older session → prompt: follows. `/fork` → prompt: follows. `/new` →
      prompt: **stays** on the current session (expected). `/compact`: no
      change. **Pass 2026-09-27.**
- [x] 3. Inside Codex, have the agent run `codex exec "echo hi"`: the tab
      does not switch. **Pass 2026-09-27:** `llcx 1` showed the child as a
      `source=startup` row (tab `f53e7172`, sid `f41a6d`).
- [x] 4. Claude tab → run something that uses the Codex plugin: stays Claude.
      **Pass 2026-09-27.**
- [x] 5. Setup → Codex (zsh tab), and Re-enter: both bind; exit + re-run
      replaces. Setup's first hook shows `launch: "current"` (no double
      wrap). **Pass 2026-09-27:** post-close-reenter row showed
      `source=resume`, `launch=current`, sid unchanged (`ddb03b`). Note: the
      tab id changed across the re-enter (`88ceb50f`→`e99c8b6b`) while the
      session id stayed the same — confirm this is intended (fresh tab id
      per Re-enter, continuity tracked via session id) rather than a miss.
- [x] 6. Outside terminal, bare `codex` through the shared daemon: claims
      nothing. Synthetic stale-daemon event (plain tether) to a live bound
      tab and a live unbound tab: the bound tab is unchanged; the unbound tab
      binds (Decision A). Then bare `codex` + prompt in that tab: it switches
      to the new session. **Pass 2026-09-27:** both fakes returned `204`;
      bound tab A unaffected; unbound tab B picked up the Codex icon, then
      bound to its real session (`llcx 1`: tab `aa7192da`, `current`,
      `startup`, sid `01dd6b`). **Finding:** tab A's dot stayed green after
      `/quit`, before either fake was sent — idle state not resetting on
      quit. Unrelated to the stale-daemon logic itself; open follow-up.
- [x] 7. Two tabs in one folder, each re-run twice: no cross-talk.
      **Pass 2026-09-27.** Note: decision cards appeared shared between the
      two tabs — confirm whether that's expected.
- [x] 8. Registration failure: in a zsh tab run `LOGIC_LOOP_PTY_GEN=999999
      codex` (`/launch` answers 409). Codex still launches, untracked. (The
      wrapper re-reads `ingest.env`, so overriding `CT_PORT` in the shell
      does nothing; the Rust test covers an unreachable port.) **Pass
      2026-09-27:** `llcx 1` showed `launch=none`.
- [x] 9. Daemon PID and start time unchanged; zsh prompt, history, and
      aliases intact. **Pass 2026-09-27:** PID 73993, `Sat Sep 26 00:16:57
      2026` — matches pre-rebuild note exactly.
- [x] 10. bash: fresh tab → `bash` → `codex --no-daemon` → prompt: the tab
      binds (`launch=none`). **Pass 2026-09-27:** `llcx 1` showed tab
      `d5e9e251`, `launch=none`, `source=startup`.

## 68. Codex cleanup: decision ownership and re-entry (Phase 46, 2026-09-27)

**Code and data inspection (completed):** The prior Decisions section read
every row for a project, by design since Phase 17. Stored rows carry
`session_id` and, where available, `tab_id`: read-only inspection of the
active profile found 685 historical decisions in this project across 168
sessions and 65 tab IDs (363 older rows lack a tab ID). The new side-panel
query, tab badge, and bulk dismiss select the active tab's tether or its
bound session. That session clause includes older untagged rows and a
conversation resumed in a new tab. The global Attention inbox stays
project-wide. A keyed panel result prevents the previous tab's cards from
appearing while a new tab's query loads. Answer Now now accepts the active
live tab's exact persisted session ID when the in-memory binding cache has
not yet been filled by Codex's lazy first `SessionStart`.

The §67 re-entry session emitted `SessionStart` first under `88ceb50f`, then
under `e99c8b6b`; the active binding moved to the second tether. Code paths
for same-tab Restart/Re-enter and app-relaunch ghost tabs preserve the
original tether, while opening a fresh tab creates a UUID. The observed ID
change is consistent with closing the old tab and resuming in a new one.

The §67 `/quit` session emitted `SessionEnd` before the stale-daemon test.
`stateForHook` maps it to `idle`, rendered green; earlier §16 coverage
defines green as idle/done on exit. No state fix was made without evidence
of a missing hook or an agreed change to that display contract.

**Automated checks (completed):** `decisions-check` covers two tabs in one
folder, same-tab prior sessions, a resumed session, legacy untagged rows,
an unbound new tab, and safe Answer Now routing before a resumed session's
first hook. All 39 TypeScript check scripts passed via
`node --import tsx` (`tsx`'s CLI socket was denied in the sandbox), as did
`npx tsc --noEmit`, `npm run build`, Rust tests (151 passed, 1 ignored on
the unsandboxed rerun after loopback bind denial), Clippy, and
`git diff --check`. No extraction prompt changed; `golden` was not run.

**Installed-app manual run (2026-09-27):** Used computer control in the
installed Logic Loop app with Codex 0.157.1 and disposable tabs in
`/private/tmp/logic-loop-phase46-scratch`. Existing work tabs were untouched.
Read-only inspection of the local SQLite profile corroborated the UI; no
transcript content was logged.

- [x] Made distinct decisions in two Codex tabs in the same folder. Each
      Decisions section and badge showed only its own card (one each), while
      Attention showed both. Switching tabs showed a brief empty state while
      the new query loaded, with no sibling card flash. Answer Now prefilled
      the owning live terminal in each tab; drafts were cleared unsent.
- [x] Created a second card in tab A, then used its `dismiss all`. Both A
      rows became `dismissed`; tab B's row stayed `open` and visible with
      badge 1. Read-only SQLite rows were 1932 and 1934 for A, 1933 for B.
- [x] Ran `/quit` in bound tab A. `hook:SessionEnd` was stored and the dot
      stayed green `idle` at the shell. Re-entered the same tab and submitted
      a prompt; the dot went blue `working`, then green `idle`.
- [x] Same-tab process exit and Re-enter kept tether `02172db0` and session
      `01a0e373` (prefixes). SQLite shows `SessionStart` sources `startup`,
      `resume`, `resume`, all under that tether. Explicitly closing tab B and
      opening a fresh tab changed tether `988bb937` to `e97a8006`; resuming
      Codex kept session `01a0e379`. After the first prompt, B's open card
      followed the session and Answer Now prefilled the fresh tab.
- [x] Exited tab A's shell and used its dead-tab Re-enter control. The card
      remained visible and Answer Now prefilled tab A before the next lazy
      `SessionStart`; the draft was cleared unsent. This did not reproduce
      the §66 failure for a restored live tab.
- [x] App quit/relaunch and ghost-tab Re-enter: the maintainer quit and
      reopened Logic Loop after the work session finished. Tab A's ghost
      Re-enter resumed session `01a0e373`; the next `SessionStart` retained
      tether `02172db0`. The other scratch ghost retained tether `e97a8006`
      (checked with `printenv LOGIC_LOOP_TAB_ID`) and its open card remained
      visible. Re-enter resumed Codex session `01a0e379`; Answer Now
      prefilled that restored terminal before its first new hook. The draft
      was cleared unsent.
- [x] Dead-tab Answer Now: after `/quit` and shell `exit` in the fresh tab,
      the card stayed visible; clicking Answer Now left the `Process exited`
      overlay in place and sent no input.
- [x] Active-tab session mismatch: the focused routing check covers this
      rejection path. The Decisions section hides cards from other sessions,
      so there is no normal live panel click path for the mismatch.

The maintainer approved Phase 46 on 2026-09-27 after reviewing this run.

## 69. First-run guided feature tour (Phase 47, 2026-09-28)

**Automated checks (completed):** `npx tsc --noEmit`, `cd src-tauri && cargo
clippy --all-targets -- -D warnings && cargo test --lib` (151 passed, 1
ignored), `npm run check` (all 38 scripts), `npm run build`, and
`git diff --check` all pass. No extraction prompt changed; `golden` was not
run, per plan.

No fake data is seeded into any panel — the tour spotlights the real
`data-tour-target` DOM regions in `SidePanel.tsx`, `IdeaBoard.tsx`, and
`AgentStatusBar.tsx` and layers static explanatory copy over them. Steps
whose target isn't mounted (Since You Left / Next only render once there's
something to show) are dropped from the active step list at tour-open time,
never shown broken. `tour_version` (`src/lib/repo.ts`) is independent of
`onboarding_version`, mirroring the existing pattern.

**Installed-app manual runs: partial, 2026-09-28.** Computer control of the
rebuilt macOS app exercised the existing populated profile. The three initial
failures passed on the rebuilt version; fresh-profile and digest cases remain.

- [ ] Fresh profile (empty `~/.context-terminal/` DB): Setup closes → tour
      auto-starts on card 1/N, panel forced to expanded if it wasn't.
- [x] Click `›` through every card; counter and card content update; last
      card reads "Done" instead of `›`.
- [x] `‹` disabled on card 1, enabled after advancing; steps back correctly.
- [x] "Skip tour" and `×` both close immediately from a later/first card.
- [x] `Esc` closes; `→` advances and `←` goes back with any tour control
      focused. `Enter` activates a focused button or advances from elsewhere.
- [x] Reopen via the header "Tour" button (next to "Setup") restarts at card
      1 regardless of `tour_version` state when the panel is already expanded.
- [x] Resize to a narrow window mid-tour: no crash; the tour still closes
      cleanly with Esc.
- [ ] A profile with real activity (open decisions, an unresolved blocker,
      a recent since-you-left digest) reopening the tour manually sees the
      conditional cards (Since You Left, Next) included.
- [x] Quit and relaunch after completing the tour once: it does not
      auto-start again.

**Observed passes:** With the context_terminal project open, the tour showed
7 cards; Since You Left was absent because no digest was mounted. The counter,
titles, and explanatory copy changed through all 7 cards; the final button
read "Done" and closed the overlay. Previous, Right Arrow, Left Arrow, Enter,
Skip tour, Close tour, and Esc worked. Next and Blockers were included with
real project activity; empty Decisions stayed an honest empty state. The
window narrowed from about 1190px to 780px during the tour without a crash,
and Esc closed it. The window was restored to its original width.

**Failures in the first installed build (resolved in the rebuild):**

- Starting Tour from compact mode expanded the panel but showed only 2 cards
  (Idea Board and Header controls). The expanded panel's other targets became
  visible immediately afterward, yet the step list stayed at 2 until the
  tour was closed and reopened. `FeatureTour` snapshots targets during its
  initial render, before the panel expansion mounts them.
- The Blockers card was entirely offscreen above the window in both the
  1190px and 780px layouts when the Blockers section was taller than the
  viewport. Its spotlight and accessibility content appeared, and keyboard
  Right Arrow advanced, but the card and its buttons were not visible.
- Keyboard focus escaped the open tour: after reopening it, Tab from the
  header Tour button focused the underlying "agy on" toggle. Arrow keys still
  advanced the tour because the handler listens on `window`, but the overlay
  did not keep focus within its controls.

**Rebuilt-app pass:** The maintainer rebuilt and relaunched the app after the
first run completed a tour; no tour auto-started. Closing Setup on this saved
profile also left the tour closed. Starting Tour from compact mode expanded
the panel and opened on Decisions with 7 cards. Tab cycled only among Skip,
Close, and Next; Right Arrow worked while Skip had focus and Left Arrow while
Close had focus. On the context_terminal
project with 8 real blockers, the Blockers card stayed visible at both
about 1190px and 780px window widths. Clicking through all 7 available cards
updated the counter and content; Done closed the overlay. The window was
restored to its original width.

**Still untested:** A disposable fresh profile and its Setup-close
auto-start; the Since You Left card with a real digest. The current profile
has existing data and no mounted digest. The first run cancelled Quit when
the app warned that it would terminate an active session; the maintainer
subsequently rebuilt and relaunched it before this second pass.

**Release follow-up, 2026-09-30 (Phase 48):** manually opened Tour in the
rebuilt release app. Home appeared first as card 1 of 8; all eight cards
advanced through Done. Next appeared, while Since You Left remained absent
because no digest was mounted. The fresh-profile auto-start, real-digest card,
and v1-to-v2 automatic re-show remain untested.

## 70. Home dashboard and Project Overview (Phase 48, 2026-09-30)

**Automated checks (completed):** `npx tsc --noEmit`, `cd src-tauri && cargo
clippy --all-targets -- -D warnings && cargo test --lib` (155 passed, 1
ignored — 4 new in `board.rs`), `npm run check` (39 scripts, incl. new
`dashboard:check`), `npm run build`, and `git diff --check` all pass after
every commit in this phase. No extraction prompt changed; `golden` not run.

Scope actually shipped vs. `plans/048-project-dashboard.md` §3 — read this
before the live pass, several things are simplified:

- Home: header line, a Continue callout for the current workspace pane
  (`activeId` itself), search, All/Working/Needs a choice/Archived filters,
  the 30-day older-projects fold (exempts pinned/bookmarked), one card
  action ("Open" → Project Overview, not a second "Continue" button).
- Project Overview: Needs a choice (routed via `resolveAttentionRoute`),
  Pick up here (`computeMomentum`, read-only), Work log (Today/7d/30d,
  per-session agent excerpt + file/turn counts + local commits), Plan
  (`peek_board`/`parseBoard`, Now card + status counts, "Example board"
  detection), Agent time (`observedAgentTime`, hidden with no observations),
  Workspaces (live tabs + closed-but-resumable sessions), Pin/Archive/edit
  purpose, Copy update.
- **Original build simplifications, dispositioned in the fix-it sprint:**
  per-card Continue and the full project Actions menu are explicitly deferred
  by the maintainer. Overview now has an explicit multiple-workspace chooser
  and Home has the startup selector (§71). The ⌘/Ctrl+K Activity relabel remains
  unapproved; Inbox archive-all-unavailable is not implemented.
- Inbox: `attention`-icon swap and `inbox_badge` setting are both live;
  `AttentionInbox` itself, its archive/backlog controls, and ⌘/Ctrl+K are
  unchanged per plan.
- Tour: new opening "Home" card targets the tab bar button; `TOUR_VERSION`
  bumped 1 → 2.

**Installed-app manual pass: partial, 2026-09-30**, using the rebuilt release
bundle `src-tauri/target/release/bundle/macos/Logic Loop.app` (not dev mode).

**Restarted release follow-up, 2026-09-30, from 22:48 HST:**
the requested raw bundle was absent on disk; `npm run tauri build` rebuilt
it successfully (TypeScript/frontend gate included, `index-D8uH9tDM.js`).
Quit the stale app; elevated `pgrep -fl "Logic Loop"` returned no processes.
Moved the complete real profile directory to `.bak`, never copied its 2.8 GB
database. The new process path was confirmed as the rebuilt raw bundle.

- **PASS:** true fresh profile showed Home selected, zero projects, no tabs,
  and visible Setup. Selected `/private/tmp/logic-loop-phase48-manual` through
  the folder picker; Start session launched a plain shell in that folder.
- **FINDING:** first-run Setup displayed `Setup preference could not be saved:
  error returned from database: (code: 5) database is locked`. It persisted
  through folder selection and session launch; Finish setup still closed it.
- **PASS:** closing Setup auto-started Home as tour card 1 of 8; advanced
  Home, Decisions, Accomplished, Blockers, Next, Idea Board, Attention Inbox,
  Header controls; Done closed it. Since You Left was absent (no agent
  session/activity); its real-digest target remains unverified. The Home
  card screenshot showed a centered card without a visible Home spotlight;
  target positioning needs further verification.
- **PASS:** explicitly selected Last workspace, hid unread count, quit and
  confirmed the live-shell warning. Relaunch had Home off and no auto-tour;
  reopening Home showed Last workspace and Show unread count. This verifies
  the selected setting and badge persistence, not v1→v2 migration.
- **PASS, profile safety:** quit again and verified no process. Preserved the
  disposable profile at `/private/tmp/logic-loop-phase48-fresh-profile-20260930`
  and moved `.bak` back to the original path. Relaunched the rebuilt release;
  Home showed the real **65-project catalog** before continuing.
- **Automated follow-up:** dashboard, onboarding, and board assertions passed
  using `node --import tsx scripts/<name>-check.ts`; the normal npm runners
  were blocked by sandbox `tsx` IPC socket permissions. Diff check passed.

Combined checklist items below remain unchecked where any subcase is pending.

- [x] Fresh profile: starts on Home, Setup remains visible and can launch
      a selected folder; existing profiles default to Last workspace. Home's
      Start in selector persists the chosen surface. The original accessor-only
      gap was repaired in the authorized fix-it follow-up (§71). Passed with
      an isolated profile in this follow-up; Setup's database-lock warning is
      recorded separately above.
- [ ] Open Home mid-session with a live agent running in a background tab:
      let it finish while Home is open, then switch back to that tab — the
      result stays unclaimed until the tab is actually shown, no PTY input,
      process/output intact.
- [ ] Return from Home to a split workspace and to a single one (including
      returning to the same `activeId`): focus and xterm sizing recover, no
      respawn, no flash.
- [ ] Several projects with a mix of live tabs, closed-but-resumable
      sessions, and bookmark-only (no session) entries: card counts and the
      "N closed" Workspaces line match; close the last tab for a project —
      the project and its history remain in the catalog.
- [ ] A project with an open decision: Overview's "Go to workspace" routes
      to the exact owning tab when one exists; archiving the same decision's
      occurrence in the Attention Inbox does not remove it from Overview.
- [x] A project whose `.logic-loop/board.md` is missing, an untouched
      example board, and a real edited board: Plan section reads "No board
      yet", "Example board — not edited yet.", and real counts respectively
      — opening Home/Overview must never create a `.logic-loop/` directory
      that didn't already exist.
      **PASS:** GH-gem showed No board yet; `ls -ld` before/after confirmed
      its `.logic-loop` directory remained absent. The Phase 46 scratch board
      matched the literal example and showed Example board — not edited yet.
      Temporarily replaced that scratch board with four QA cards: Overview
      showed Now: Manual QA current card and Idea 1 / Planned 1 / Building 1 /
      Done 1. Restored the original scratch file; `cmp` exited 0. The real
      context_terminal board also matched disk counts (4/0/5/1, no Now card).
- [ ] Copy update on a real project: every line traceable to a decision,
      excerpt, or commit; no file paths/commands leak through; edit the
      textarea before clicking Copy and confirm the edited text (not the
      original draft) lands on the clipboard.
      **FAIL, export minimization; PASS, edited clipboard:** real decisions,
      excerpts and 22 local commits populated the draft. After adding
      `phase48-edited-clipboard-check`, Copy showed Copied! and pasting into
      an unsaved TextEdit scratch document contained the edited marker. No
      permission prompt appeared. The draft leaked the command/path line
      `ls: src-tauri/migrations: No such file or directory` under Blockers;
      also retained a relative Markdown plan link. Only first-line excerpts
      were exported, but first-line filtering is insufficient. Clipboard
      denial and recovery remain untested; source catch has no explicit error.
- [ ] Trigger a render error in Home/Overview (e.g. a temporarily broken
      prop) and confirm `DashboardErrorBoundary`'s "Return to workspace"
      recovers without affecting any running terminal.
- [ ] Keyboard-only pass: Tab reaches every control in Home and Overview;
      focus is visible; no control is nested inside another interactive
      element; typing in Home's search box or Overview's purpose editor is
      never intercepted by the app's global ⌘-shortcut handler.
      **FAIL:** while each editable field had focus, ⌘K opened Attention
      Inbox from both Home search and Overview purpose editor. Cancelled
      purpose editing without saving. Home header/search/filter/card action
      traversal and all enabled controls of the scratch Overview were
      reachable in order; sampled screenshots showed visible orange focus
      rings. Full per-stop visual and VoiceOver coverage remains pending.
- [ ] Tour: fresh walkthrough shows the new "Home" card first, pointing at
      the tab bar button; a profile that completed tour v1 sees the tour
      once more (version bump), not every launch after.
      **PARTIAL / target failure:** fresh Setup-close walkthrough and v2
      no-repeat passed above; v1→v2 remains untested. Both fresh walkthrough
      and later Home Tour screenshots showed a centered Home card without a
      visible spotlight around the tab-bar Home control. Tour from Home had
      1 of 1 (hidden workspace targets excluded); workspace walkthrough had
      1 of 8. No full Home-target pass is claimed.

**Additional A–D cases in the same release pass:**

- [x] Real Since You Left card, before relaunch: maintainer supplied a
  screenshot at 22:59 showing 1 command run, 1 turn, 0 stops and real agent
  text after the delayed read-only prompt and Home departure. This is
  populated real-profile evidence, not fresh-profile or restart evidence.
- [ ] **FAIL — digest after quit/relaunch:** automatic approval review initially rejected
  Quit pending confirmation of its two-session termination effect. Maintainer
  then manually quit and confirmed this testing agent lives outside Logic
  Loop. Relaunched the release bundle: Project 5 and Project 7 restored as
  dead tabs; selected Project 7 (the Codex digest test), whose panel showed
  no session/no events and no Since You Left card. Re-enter launched Codex,
  but stopped at Codex's update prompt. Requested that the maintainer press
  Esc to skip the update; no terminal input was sent by the testing agent.
  Maintainer skipped the prompt and reported ready. Screenshot confirmed
  the saved conversation loaded, including the delayed README prompt and its
  final three bullets, but the panel still showed no session/no events and
  no Since You Left card. Home → Continue returned focus to Terminal input
  without restoring the digest. This fails the requested restart scenario;
  it does not establish whether a subsequent new agent turn would rebind.
- [ ] Clipboard denial/failure state/retry: no prompt appeared; no privacy
  permissions or TCC state were changed to manufacture denial.
- [ ] 200% zoom on Home/Overview: four ⌘+ attempts on Home had no visible
  scale change. A verified 200% layout check remains pending.
- [ ] VoiceOver announcements: ⌘F5 produced no visible activation; no
  audible announcements were verified. AX showed named headings but generic
  repeated Open buttons, so this is not an announcements pass.
- [ ] Reduced-motion animation behavior: enabled Reduce motion via System
  Settings → Accessibility → Motion, opened Tour, then restored off (verified
  both states). Still screenshots cannot establish animation timing; source
  retains `transition-all duration-200` and smooth scrolling without a reduced
  motion branch. Animation-skip behavior remains unresolved.
- [x] Unread-badge preference persisted across the disposable-profile relaunch.

**Observed in this pass:** `npm run dashboard:check` and
`npm run onboarding:check` passed. Home opened and listed 65 projects; search,
All, Needs a choice, and Archived filters responded, and the unread-count
toggle hid and restored its label. Opened Tour manually: Home was card 1 of 8,
all eight cards advanced in order, Next and Attention Inbox appeared, and Done
closed the tour. Home → Continue returned to the current workspace.

**Overview data discrepancy — investigate before accepting Phase 48:** the
Home card for `/Users/vandershark/Desktop/dev/context_terminal` showed 33 open
decisions, while its Overview showed “Nothing open.” The same Overview showed
“No board yet” although that project has a `.logic-loop/board.md` on disk, and
its Work log stayed at “Loading…” for more than 12 seconds (including after
switching from 7 days to 30 days). Copy update remained disabled. No decision,
board, or terminal data was edited during this pass.

**User-reported desktop access prompts, 2026-09-30:** the maintainer reports
repeated requests for access to the Desktop folder, arriving about every
10–15 seconds and in pairs, during this Phase 48 computer-use session. I did
not see these prompts in the UI state I captured, so this is recorded as a
user observation pending reproduction. Screenshot referenced:
`/Users/vandershark/Desktop/Screenshot 2026-09-30 at 9.23.10 PM.png` (not
readable by the agent due to an OS permission error).

Still pending: the Phase 47 fresh-profile auto-start and real Since You Left
digest; and the remaining Phase 48 end-to-end cases in the checklist above,
including background-agent claim behavior, split return, decision routing and
Inbox archival, board variants/no-directory creation, Copy update clipboard,
error-boundary recovery, full keyboard/zoom/accessibility coverage, and
first-run/version-bump auto-tour behavior. All checklist items stay unchecked
until their complete scenarios are verified.


## 71. Phase 48 Overview fix-it sprint (2026-09-30)

**Status:** implementation authorized; Phase 48 NOT ACCEPTED. Maintainer
approved the startup selector and Overview workspace chooser, deferring
per-card Continue/full Actions, and approved a dashboard-only typed Git API.
No commits or PR were created. Preserve §69/70 historical results and remaining
unchecked scenarios; this section does not convert acceptance history into
fresh-profile/digest evidence.

**Environment:** macOS 26.4.1 (25E253), branch `phase-47-feature-tour`, baseline
`3fce610` plus the fix-it working tree. Real populated profile inspected via
SQLite `mode=ro`. No profile reset, credential logging, terminal input, global
hook/configuration change or TCC reset was performed. No new agent sessions
were launched for these checks.

**Measured diagnosis:** the source query returned 33 open decisions and 277
bound sessions for this project; `.logic-loop/board.md` exists. Source count
queries took 0.1–0.2ms, lifecycle count 98.9ms, and local Git 15ms. Running the
old JSON/tether predicate as 277 COUNT queries took 111.71s and produced
15,857 matches including duplicate attribution. A single session-owned COUNT
needed 0.011s (13,736 rows). The actual new production SELECT, limited to the
work-log event types in the 7-day window, fetched 11,375 rows in 0.168s with
zero duplicate IDs. These are read-only query timings, not equivalent UI
latencies; they demonstrate why the original 15s cancellation loop could
prevent the shared snapshot from publishing.

**Implemented repairs:** independently settling read states; 10s wait limits,
Retry, stale/unmount guards and in-flight coalescing; 30s board/Git caches;
no age-clock reads or unrelated bookmark resolution in Overview; source-open
decisions without a 50-row cap; authoritative session/day work-log grouping;
Git seconds normalization and dashboard-specific error-returning date-window
reads; draft first-line path/command omission; fresh/existing startup defaults
and persisted selector; explicit project workspace chooser; Setup portal for
Home and initial focus inside Copy update. Native board peek now preserves
permission/metadata failures as errors instead of converting them to missing.

**Automated evidence:** focused dashboard, onboarding, delta, scope and board
checks passed. New dashboard fixtures exercise independent settlement,
failures, timeout/late results, disposal, retry/coalescing/cache expiry, timestamp
edges, daily grouping/deduplication, export minimization, startup and chooser.
Rust executes the actual repo SQL against SQLite fixtures for shared-tether,
rebound/legacy events, foreign project exclusion, range edges, Inbox archival
and 33/61 decision counts. Native Git fixtures cover empty/missing/invalid
repositories, full 61-commit windows and range filtering.

`npm run opencode:check`, full `npm run check`, `npx tsc --noEmit`, frontend
build, full `cargo test` (159 passed, 1 intentional live Codex test ignored),
and Clippy passed before the final board/focus follow-up; final gate results
will be appended below. The sandbox initially denied tsx IPC sockets and three
Rust loopback fixtures; authorized reruns outside the sandbox passed. No
extraction prompts changed; `golden` was not run. Vite reports its existing
large-chunk advisory; builds succeed.

**Release verification provenance:** the initial UI connection selected an
older installed app without Home; its three visible tabs were exited. Closing
that process exposed a previously running Phase 48 process at the raw release
bundle path. Rebuilding replaces the binary on disk but not that running
process's embedded frontend. Its UI still showed the original Overview
loading/false-empty labels and no Retry, proving it was stale. A read-only
process-path check confirmed the raw bundle path. Restart approval was
requested because that process contains an idle live shell tab with no bound
agent session. That old-process observation is not a regression result for
the new build.

**Outstanding live scenarios:** true disposable fresh profile/Setup-close
auto-tour, real Since You Left digest tour card, v1→v2 once-only behavior,
background-agent completion and claim isolation, split/same-tab return,
closed-tab exact decision routing and Inbox archival, board variants/passive
no-creation, edited clipboard/denial, error-boundary recovery, keyboard/zoom/
VoiceOver/reduced-motion coverage, multi-project fan-out/worktree/history.
Record only scenarios actually exercised in the final rebuilt process; all
other §69/70 checklist items remain unchecked.

**Restarted-pass update, 2026-09-30:** §70 now records true fresh Home/Setup,
selected-folder shell launch, Setup-close automatic eight-card walkthrough,
completed-v2 no-repeat on relaunch, startup-selector and unread-badge
persistence, and restoration of the real 65-project catalog. These subcases
are no longer outstanding. Fresh Setup's database-lock warning is a new
finding requiring disposition. A completed-v1 upgrade, real digest (including
relaunch), Home spotlight positioning, full keyboard/zoom/VoiceOver/reduced
motion, clipboard success/denial, all board variants, and the broader terminal
and routing scenarios remain pending. Source inspection additionally found
that Copy update's rejection handler only resets `copied` without displaying
an error; this is not a live clipboard-denial test. No acceptance token is
issued from partial coverage.

**Later live findings, same rebuilt process:** board variants and passive
no-directory creation passed, including temporary Now/count fixture with
byte-identical restoration. Real Copy update populated and its edited marker
pasted into TextEdit, but export minimization **failed** on a raw relative
command/path line. Editable-field shortcut isolation **failed** on both Home
search and Overview purpose: ⌘K opened Inbox. Home Tour lacked a visible Home
spotlight. The maintainer's real Since You Left screenshot closes populated
card evidence before restart only. The maintainer manually quit; relaunch
restored a dead Codex tab without a digest. After the maintainer skipped the
update prompt, the saved conversation loaded but its panel remained unbound
(no session/no events), without the digest even after Home → Continue.
Restart persistence **failed**; no autonomous terminal input was sent.
Clipboard denial, verified 200% layout, audible
VoiceOver, reduced-motion timing, v1 upgrade and the broader terminal/routing
matrix remain unresolved. Reduce motion was restored off; no Full Disk Access
or other privacy permissions were changed. Source code was not edited during
this testing pass. Phase 48 remains NOT ACCEPTED.


**Final automated follow-up:** after the board metadata/error and modal-focus
repairs, full `cargo test` passed (160 passed, 1 intentional live test ignored),
Clippy exited 0, and the final focused dashboard/onboarding/board checks passed.
The Home tour now excludes mounted targets with no layout in the hidden
workspace; daily excerpt/file-count fixtures also passed. Final frontend/release
build and diff check are recorded below after completion. Live checks remain
pending restart of the old raw-bundle process; none are marked passed from
source inspection or synthetic fixtures.


**Final artifact:** `npm run tauri build` completed successfully after all code
changes, including its `npm run build`/TypeScript gate. Raw bundle:
`src-tauri/target/release/bundle/macos/Logic Loop.app`; final frontend asset
`index-D8uH9tDM.js`. `git diff --check` exited 0. No project-branch commit,
push, PR, reinstall or phase acceptance was performed. Remaining release
scenarios await the restart approval above and an isolated fresh-profile pass.


### 71.1 Release-test repair (revision 2, `plans/048-release-repair.md`, 2026-09-30)

**Status:** approved by the maintainer ("approved, defer zoom, clean the rows -
approved to proceed"); implementation built; **live UI re-test NOT performed**
— this Claude Code CLI session had no computer-use tools, so no release-UI
scenario below is marked passed. Phase 48 remains NOT ACCEPTED. No commit,
push, PR change, reinstall, terminal input, or global setting change.

**Diagnosis evidence (real profile, read-only `mode=ro`, structural columns
only — types, timestamps, truncated ids, key equality; no transcript or
decision text):** the Codex digest tab (`T`) and session (`S`) binding row
was correct and unchanged; Re-enter resumed `S`. Its final `Stop` (22:59:13)
preceded departure anchors at 22:59:25 and 22:59:50, so that run's empty
post-relaunch digest followed the anchor rule; Codex `resume` sent no hook
until a new turn. Two real defects: (1) the window-blur handler and tab-switch
effect wrote `tab_left` for tabs hidden behind Home, so an unseen result could
be anchored away; (2) after relaunch an unrelated untethered Claude Code
session (different project, no tether) fell through `bindSession`'s
active-tab rescue onto the re-entered tab — ghost tabs never seed the
in-memory binding map — and 75 `attention_state_observed` rows, 1
`result_landed` row and 1 auto-detected blocker were stamped with `T`.

**Repairs:** visibility-diff departure anchors (`departedTabIds` over the
effective visible set; blur anchors only visible panes, nothing on
Home/Overview); `bindSession` untethered owner recovery and no fallback onto a
tab owning another session (removes the old "reuse when all bound" rule);
restored-session panel label; editable-field shortcut isolation
(`src/lib/shortcuts.ts`); `exportSafeLine` export minimization (link targets
dropped, closed slash allowlist, code-file tokens, lowercase command shapes,
basename title fallback); tour `visibleRect` reads DOMRect fields explicitly
(spread had dropped `left`/`width`) and clips horizontally; reduced-motion
transition/scroll branch; Copy update `copied/failed` state with `role="alert"`
and Try again; project-named Home Open buttons and decision-described Go to
workspace; `getDb()` memoizes the load promise (concurrent first calls had
each opened a tauri-plugin-sql pool). Zoom deferred by the maintainer.

**Automated evidence (all exit 0, 2026-09-30):** focused `bind`, `clock`,
`split-view`, `dashboard`, `onboarding` checks with new fixtures (owner
recovery, ghost-tab hijack, all-owned same-cwd → unbound, resumed ghost binds;
anchor transitions incl. workspace A → Home → A Stop → Continue B → select A
digest; observed `ls:` leak and link through every exported section,
must-keep prose; clipboard failure; editable-target predicate; DOMRect-like
geometry, reduced motion, hidden-target exclusion; restored label; single
DB load). Then `npm run opencode:check`, `npm run check` (40 scripts),
`npx tsc --noEmit`, `npm run build`, `cargo test --lib` (160 passed, 1
ignored), `cargo clippy --all-targets -- -D warnings`, `git diff --check`.
`npm run tauri build` produced the raw bundle with frontend
`index-BCKZtXbx.js`. No extraction prompt changed; `golden` not run.

**Real-profile cleanup (authorized):** with no Logic Loop process running
(unsandboxed `pgrep`/`ps` empty; last event 23:45:21), saved a rollback file
of the 75 affected rows (ids + structural payloads) to the session scratchpad,
then in one `BEGIN IMMEDIATE` transaction removed only the `tab_id` key from
those `attention_state_observed` rows: targets 75, changed 75, remaining with
`T` 0. Observations kept. The 1 `result_landed` row and 1 blocker (`tab_id`
column) stamped by the same foreign session are **not yet changed** — the
plan required reporting them first.

**Live checks pending (maintainer or a computer-use agent, raw bundle):**

- [ ] Restart digest A1 (switch tab) and A2 (Home) before the turn ends, blur,
      quit without returning, relaunch, select tab → Since You Left shows the
      turn; structural query shows no `tab_left` after its `Stop`.
- [ ] Re-enter: panel reads "session restored · no new activity"; a new
      human turn updates state on the same tab.
- [ ] Foreign untethered session while a re-entered tab is active → no new
      rows stamped with that tab (structural query).
- [ ] ⌘K/⌘B/⌘T/⌘W in Home search, Overview purpose, Copy update textarea and
      Setup fields keep field behavior; same keys in a focused terminal still
      act.
- [ ] Copy update on the same real project: no `ls:` line, no link target;
      every line traced; edited text copied.
- [ ] Tour: Home spotlight around the tab-bar button (fresh auto-tour and
      Home-triggered 1 of 1); side-panel steps spotlight their sections.
- [ ] Reduce Motion on: no spotlight/card transition or smooth scroll.
- [ ] Fresh disposable profile: no `database is locked` Setup warning; Start
      in preference persists. Code-5 incident stays unresolved until then.
- [ ] Clipboard failure/retry live; VoiceOver announces project-named Open
      buttons; 200% zoom deferred (unchecked).

**Computer-use follow-up, 2026-10-01 (installed rebuilt release):** tested
`/Applications/Logic Loop.app`; the raw `.app` path above was absent. Its
`Contents/MacOS/app` matches `src-tauri/target/release/app` byte-for-byte by
SHA-256 (`ae109ec113fc80a6ce7e2b6415c07e1d6ce76cb514cc485e9f052a3759c3d10e`).
Local frontend output remains `index-BCKZtXbx.js`. The broad checklist above
stays unchecked where only part of a scenario was verified. No code changes,
commit, push, profile cleanup/reset, global settings changes, or terminal
text input in this pass. Phase 48 remains NOT ACCEPTED.

- [x] Home search: typed `context_terminal`, then ⌘K/⌘B/⌘T/⌘W and
      Ctrl+Tab; field stayed focused with its value, Home stayed open, no
      Attention overlay, panel action, or tab creation/closure.
- [x] Overview purpose editor (empty, unsaved): the same five shortcuts
      left the accessibility tree and field focus unchanged. No purpose saved.
- [x] Copy update textarea: the same five shortcuts left draft and focus
      unchanged. Edited draft to a disposable check string, clicked Copy,
      observed `Copied!`, replaced its text, then ⌘V restored the exact edited
      string. Modal closed without persisting edits. Clipboard now contains
      the disposable check string.
- [x] Real `dev/context_terminal` Copy update draft: inspected every exported
      line. No `ls:` line or Markdown link target; observed technical-details
      placeholders for the reported path/command blockers. Link text survived
      (`Created the full dashboard plan and added it to the plan index.` and
      `PR #65`). Ordinary prose remained. This validates filtering, not the
      truth or usefulness of historical extracted content.
- [x] Home-triggered Tour: `1 of 1`; screenshot showed spotlight enclosing
      the top-left tab-bar Home button and card below it. Hidden workspace
      targets were skipped.
- [x] Workspace Tour Decisions step: `2 of 8`; screenshot showed spotlight
      enclosing the actual Decisions section with card above, horizontally
      aligned. Other workspace steps and fresh auto-tour remain unverified:
      computer use reported an intervening app change and later state was
      `5 of 8`, then the tour was closed outside this agent's actions.
- [x] Restored workspace label: observed `session restored · no new activity`
      before re-entry. Re-enter/new-turn behavior remains unchecked.
- [x] Terminal-focused ⌘K opened Attention; Escape closed it. ⌘B collapsed
      the panel and a second ⌘B restored it. ⌘T created one disposable plain
      Terminal tab; ⌘W closed that tab, retaining both pre-existing restored
      tabs. No commands or prompts were entered.
- [ ] Terminal-focused Ctrl+Tab: two attempts produced no visible workspace
      switch, including with only the two restored tabs remaining. This is
      an unresolved observation, not a pass; distinguish native key delivery
      from an app-handler defect in a human repeat.
- [ ] Setup editable-field shortcuts: opened Setup; this build exposes
      Choose folder and agent radio buttons, no editable text field. No
      adapter, permission, or launch configuration changed.
- [ ] Restart digest A1/A2 and foreign-session attribution: no new human
      turns submitted, no structural database verification in this pass.
- [ ] Reduce Motion, fresh disposable profile, audible VoiceOver, and live
      clipboard failure/retry: not performed. The approved plan requires
      maintainer approval/hands for profile moves and global settings; no
      safe clipboard-denial method was available. Zoom remains deferred.
      *2026-10-07–08 repeat: terminal input focused, Ctrl+Tab produced no
      visible active-tab change. Native delivery vs handler remains unresolved.*

### Phase 48 project identity revision — 2026-10-02

Authorized bounded revision: bookmark Home borders/new-tab colors and project
nicknames. Automated: `dashboard:check` covers nickname/bookmark/folder
precedence, clearing fallback, unbookmarked nickname catalog membership,
metadata propagation and first matching canonical bookmark in saved order.
`npm run opencode:check`, `npm run check`, `npx tsc --noEmit`, `npm run build`,
`cargo test --lib` (160 passed, 1 intentionally ignored),
`cargo clippy --all-targets -- -D warnings`, and `git diff --check` passed.
The tsx IPC socket and three Rust local-socket tests required an unsandboxed
rerun. No extraction prompts changed; no golden run.

Live checks remain unperformed on this revision (installed app not replaced):
- [ ] Bookmark color appears on Home card border; Overview Start session
      creates a tab with that color/name. Bookmark of a repo subfolder matches
      the root card. Multiple matches use the first bookmark in saved order.
- [ ] Continue into an existing live/restorable workspace preserves its color
      and name and does not create an additional session.
- [ ] Overview Add project nickname works without a bookmark; Save updates
      Overview, Copy update and Home (including search); persists after restart.
- [ ] Clearing the nickname restores bookmark name, then folder fallback;
      Cancel/Escape discard edits; long names truncate with path available.
- [ ] Keyboard field shortcuts stay local; save failure reports an error and
      keeps the draft available for retry.

Prior Phase 48 live-check gaps remain unchanged. Phase 48 is NOT ACCEPTED.

**Project identity screenshot feedback (2026-10-03):** maintainer screenshots
show colored Home borders, bookmark names in Home/Overview and the matching
cyan tab stripe. These are visual evidence only, not nickname persistence or
fresh-launch attribution checks. Requested visible Home folder paths now render
as wrapping secondary text below each name; live layout check remains pending.
Overview currently offers Continue/chooser instead of Start when a workspace
exists; always offering a separate fresh-session action is proposed, not built.
Automated gates for the visible-path follow-up passed: opencode/check suite,
strict TypeScript, frontend build, Rust library tests (160 pass, 1 ignored),
Clippy and diff whitespace check.

### Phase 48 compact paths and fresh-session action — 2026-10-03

Maintainer confirmed bookmark clicks open the proper root folder with bookmark
color/name. Home and Overview now show parent/folder paths in zinc-400, retaining
the full path in title tooltips. Overview keeps Start session for zero workspaces;
with one/multiple workspaces, New session tab is below Continue/Continue in.
Start always creates a fresh plain PTY through openTab; Continue selects existing
workspaces. Pending launch disables repeated clicks; failures show retryable UI.
Automated: focused dashboard/spawn checks, opencode/check suite, strict TS,
frontend build, Rust library tests (160 passed, 1 ignored), Clippy and whitespace
check passed. No extraction prompt changes; no golden run.

Remaining live checks:
- [x] Home and Overview show dev/context_terminal (zinc-400), full path tooltip.
      *Computer-use pass 2026-10-07–08: compact path visible in both;
      accessibility Help/container carries the full canonical path.*
- [ ] Zero workspaces: Start session creates one correctly named/colored tab.
- [x] One/multiple live or restored workspaces: New session tab creates an
      additional fresh shell without resuming an agent or altering existing tabs.
- [ ] Continue/chooser selects the exact existing workspace; rapid double-click
      on the new-session action produces only one new tab; launch error is visible.

Phase 48 remains NOT ACCEPTED. Follow-up commits remain local pending explicit
remote-push authorization after automatic review rejected the previous push.

### Phase 48 acceptance — 2026-10-03

Maintainer wrote `PHASE 48 ACCEPTED` and requested return to main. This closes
Phase 48, including approved Overview repairs, bookmark/nickname identity,
compact path labels and fresh-session actions. Maintainer confirmed the final
UI was good. Previously unrun manual scenarios remain disclosed rather than
being marked tested. Phase 49 implementation is not approved by acceptance.

## Phase 49 — Sidebar header and dismiss spacing (2026-10-03)

Approved by the maintainer's Plan 049 sprint request, after Phase 48 acceptance.
Notify remains project-scoped. App controls use an aligned 40px header; narrow
expanded panels switch to accessible icon controls below 260px. Compact/hidden
workspace and Home/Overview retain access to Traffic and Sidebar LM; Inbox
keeps its existing Home entry and compact rail entry. Sidebar LM settings render
in a portal to avoid panel clipping. Home uses the supplied decorative artwork.
Scroll content reserves a stable scrollbar gutter plus 24px right padding;
card dismiss targets have additional inset and text clearance.

Automated checks **PASS**: panel-layout, model-traffic, attention-inbox,
dashboard, onboarding, split-view, lock-in, opencode, full `npm run check`,
`npx tsc --noEmit`, `npm run build`, `cargo test --lib` (160 passed, 1 ignored),
`cargo clippy --all-targets -- -D warnings`, and `git diff --check`.
Initial tsx IPC and Rust localhost-server failures were sandbox permission
errors; reruns with local access passed. Build retains its bundle-size warning.
No extraction prompts changed; golden was not run.

Visual evidence: computer-use Chrome screenshot inspected on an isolated
localhost fixture, using the actual SidebarControls, SidebarLmControl, project
container query, and Home asset, with representative scroll cards. At 192px,
288px and 512px, app controls fit and dismiss targets remain clearly inward;
compact access, attached-fold silhouette and Home icon were visible. Fixture
project text/cards/fold were illustrative, not the complete release UI. This
is a layout preview pass only. Screenshot was displayed in the tool session;
no screenshot artifact saved. Temporary fixture and preview server removed.
The running Logic Loop app and its terminals were not operated or restarted.

Release-app checks still pending (do not interpret preview as a live pass):
- [ ] Expanded/compact/hidden transitions and resizing follow the boundary;
      hover/focus outlines, single/split terminals and Lock-in remain usable.
- [ ] Notes, decision cards and resolved blockers: scroll while hovering each
      close target, dismiss the intended item, confirm no scrollbar overlap.
- [ ] Traffic modal refresh/Escape/focus return and Inbox navigation/counts/
      stale/loading/badge preference behavior on every app surface.
- [ ] Sidebar LM keyboard opening, settings editing, Escape/Close focus return,
      compact placement, and short-window scrolling of the popover.
- [ ] Minimum-width project text/Notify, narrow window and 200% zoom; Home
      inactive/hover/active states, tab reorder and window drag regions.
- [ ] Fold/resize/Home/Overview navigation preserve PTY mount, process,
      untouched input and terminal focus/sizing.
      *2026-10-07–08: Refresh and isolated Escape dismissal passed. AX
      focus after Traffic Escape/Close was HTML content, not its trigger;
      focus restoration remains unresolved. Full surface/error matrix unrun.*
      *2026-10-07–08: compact opening and Close-to-trigger focus passed.
      Escape from the Setup popover closed both popover and Setup and left
      HTML-content focus. Settings edits/short-window behavior remain open.*

Phase 49 implementation is ready for review; acceptance remains pending.

### Phase 49 live-review follow-up — 2026-10-03

Maintainer reported the rebuilt update was "pretty solid" and supplied screenshots
showing cleared blockers and unclaimed completions crowding out tool activity.
Implemented the requested UI revision: compact gear and Traffic art increased
to 24px; Home has a top/side zinc outline with brighter hover and no bottom gap;
Tour moved from the terminal toolbar to above Home. Cleared Blockers starts
collapsed behind a subtle red chevron button. Accomplished shows only the newest
unclaimed completion initially, sorted by timestamp, with a toggle/count for
older notices. Disclosure state resets on project changes; expanding either
list makes no database write. Existing dismiss/unresolve actions are retained.

Focused panel-layout/blockers/unclaimed/onboarding/dashboard/split-view checks,
opencode, full check suite, strict TypeScript, frontend build, Rust library
tests and Clippy passed. `git diff --check` passed. Existing build-size warning
remains. No golden run; no extraction changes.

Follow-up live checks pending:
- [x] Rebuild and check compact gear/Traffic sizing and hit targets.
      *Computer-use pass 2026-10-07–08: installed release, both compact
      controls opened their respective UI; visual sizing inspected.*
- [ ] Home top/side border joins the bar, hover brightens, navigation still
      works; Tour above Home launches normally, neither control drags the window.
- [ ] Cleared Blockers defaults closed, keyboard toggle opens/closes; expand
      and delete/unresolve one intended blocker, then switch projects.
- [ ] Only newest completion appears above tool activity; older count toggle
      reveals remaining notices; dismiss newest and confirm next appears.
- [ ] Short/narrow window, Home active/hover, split view and panel modes.

No rebuilt release-app pass was performed by the agent for this follow-up.
Phase 49 acceptance remains pending.

### Phase 49 Setup/hook cohesion — 2026-10-03

Maintainer authorized shared blue outlines. Setup (workspace and Home) and
all visible hook buttons now use muted sky borders with brighter hover/focus.
Enabled, disabled and checking hooks retain existing text/fills and actions.
Focused onboarding/opencode checks, full check suite, strict TypeScript,
production frontend build, Rust library tests and Clippy passed;
`git diff --check` passed. Existing bundle-size warning remains.
No live-app visual check performed for this styling follow-up; on next rebuild,
check blue-border cohesion in on/off/checking states, hover/keyboard focus,
and confirm Setup still opens the existing popup. Phase 49 not yet accepted.

### Phase 49 scrollbar refinement — 2026-10-03

Reviewed the maintainer's two rebuilt-app screenshots: excess space beside
Notes/Next and a wider native scrollbar in the hover image. Replaced the
stable gutter plus 24px right padding with a scoped custom 8px scroll lane
and 8px right padding. The lane is always reserved (`overflow-y-scroll`);
thumb hover changes color only, keeping width/border geometry fixed.
Inset dismiss controls remain. Compact rail and terminal scrollbars unchanged.

Focused panel-layout/opencode checks, full check suite, strict TypeScript,
frontend build, Rust library tests (160 passed, 1 ignored), Clippy and
`git diff --check` passed. Build's existing size warning remains. No golden.

Pending rebuilt-app visual check: move pointer onto/off the scrollbar while
scrolling Notes/cards/cleared blockers; confirm constant width, tighter spacing,
usable thumb dragging and accessible close targets at minimum/normal panel
width. This refinement has not been visually verified in the release app.
Phase 49 acceptance remains pending.

### Phase 49 Isolate Loop orange identity — 2026-10-03

Maintainer requested differentiation from blue Setup/hooks. Isolate Loop's
launcher inset outline, hover/focus accent, associated worktree-tab glow and
modal border/title/mode selection/branch selection/Launch accents now use
orange. Worktree creation and tab routing behavior are unchanged.

Focused spawn/panel-layout/opencode checks, full check suite, strict
TypeScript, frontend build, Rust library tests and Clippy passed;
`git diff --check` passed. Existing build-size warning remains; no golden.
Pending rebuilt-app visual check: launcher idle/hover/focus, isolated tab glow,
and both New branch/Existing branch modal modes including selected branch and
Launch states. No release-app visual pass performed for this change.
Phase 49 acceptance remains pending.

### Phase 49 acceptance — 2026-10-03

Maintainer wrote `PHASE 49 ACCEPTED` after rebuilt-app review: "Looks great".
Accepted sidebar/header hierarchy, attached fold, Home/Tour placement, fixed
scrollbar and dismiss spacing, collapsed cleared blockers, compact completion
notices, blue Setup/hooks and orange Isolate Loop identity. Automated gates
pass. Previously unrun manual scenarios remain disclosed rather than marked
tested. Maintainer authorized opening a PR for the complete UI overhaul.

PR preparation: full `cargo test` passed (160 library tests, 1 ignored;
main/doc-test targets also passed). Diff whitespace check passed. PR is based
on the current remote main, whose tree matched the local pre-squash main.

### Phase 49 post-acceptance density follow-up — 2026-10-03

Maintainer supplied rebuilt-app screenshots and authorized tightening the
project row and default Codex account header. Expanded project identity row is
now 36px (was 48px). Codex model heading and right-aligned "account" share one
line; redundant default Codex bucket label removed. Named additional buckets
and loading/error/stale indicators retained. Claude usage block unchanged.

Focused codex-meter/panel-layout/opencode, full check suite, strict TypeScript,
frontend build, full Cargo tests and Clippy passed; diff whitespace check
passed. Existing bundle-size warning remains. No golden run.
Pending rebuild: verify project identity/Notify at narrow/normal widths and
Codex model/account alignment, additional limits, unavailable/stale states.
This follow-up has not received a rebuilt-app visual pass by the agent.

## Phase 50 — Semantic color roles + hide unused sidebar controls (2026-10-06)

Automated (agent-run): `tsc --noEmit`, `vite build`, full `npm run check`
including new `color-tokens:check` (no raw hue classes; Lock-in greys all roles
via tokens) and `sidebar-controls:check` (visibility predicates). Built CSS
confirmed: role utilities compile to `var(--color-<role>-N)` and
`.lock-in-panel` overrides them. Rust untouched. **No rebuilt-app visual pass
has been done by the agent** — everything below is for the maintainer.

Manual, in the running app:
- [ ] **1.** **Colors, every state** — in expanded sidebar, compact rail, hidden sidebar,
   and minimum width: blocker (danger), waiting/stale Inbox and open decisions
   (attn), done (ok), running dot and Inbox count (info), tab/status dots.
   Compare against the pre-change app: orange and yellow now both render amber;
   purple (fan-out) and teal (re-entry) now render sky; blue running dot is sky.
- [ ] **2.** **Focus ring** — Tab through sidebar controls and modals; ring is blue and
   visibly distinct from the sky info accents.
- [x] **3.** **Setup accent** — Setup pill and Home "Setup" button are teal.
- [ ] **4.** **Isolate Loop** — modal, tab badge, tab glow and "+ Isolate" hover are
   neutral grey/white, no orange.
- [ ] **5.** **Lock-in** — turn on both indefinite and timed Lock-in: no hue anywhere in
   the side panel (danger/attn/ok/info all grey); tab strip unchanged.
- [ ] **6.** **Traffic hidden** — with no `~/.safe-router/log.db` and a fresh settings DB
   (no `traffic_seen`), header shows no Traffic (expanded and compact).
- [ ] **7.** **Traffic shown** — with a log present: Traffic appears, opens the modal.
   Remove the log afterwards: Traffic stays (seen).
- [ ] **8.** **Traffic unknown** — unreadable/corrupt log: Traffic visible.
- [ ] **9.** **Sidebar LM** — default settings: control hidden; Setup shows the Sidebar
   LM row with a working button; choosing LM Studio (or a Claude model) makes
   it appear in the sidebar header without restart; back to default Claude CLI
   with empty model: it disappears after next focus/refresh.
- [ ] **10.** **Setup rows** — "Safe Router traffic" row text matches the three states.
- [ ] **11.** **Min width** — header row still fits at 192px with all controls shown and
    with none.

### Phase 50 Part C — Since you left on dashboard cards

Automated: `delta:check` covers `hasDelta` / `describeDelta`; `tsc`, build and
full `npm run check` pass. **No rebuilt-app visual pass by the agent.**

Manual:
- [ ] **12.** Leave a live session (switch tab away), let the agent do work, return to
    Home: its project card shows `▸ Since you left · 1 session`; chevron
    expands a row with title, summary (files/turns/decisions/failed commands)
    and last words; clicking the row opens that tab.
- [ ] **13.** Two live sessions in one project, both with changes: line says `2 sessions`,
    both rows listed.
- [ ] **14.** Card with no live tab, a never-left tab, or nothing new: no line.
- [ ] **15.** A just-spawned tab with no bound session yet: skipped (fan-out isolation).
- [ ] **16.** Collapsed by default after every Home visit (not persisted); minimum width
    keeps the row readable; Lock-in does not matter on Home.

### Phase 50 follow-up — live-review fixes (commit d5acf61)

Found live 2026-10-06. Automated: `tsc`, full `npm run check` (incl.
`color-tokens:check`, `sidebar-controls:check`) pass. No layout test for the
popover clamp (pure geometry, needs a real window). **No rebuilt-app visual
pass by the agent.**

Manual (rebuilt app, not an older install):
- [ ] **17.** **Launcher rest rings** — Fan out has a sky ring and Isolate loop a grey
    ring at rest; neither is purple or orange. Fan out hover is sky, Isolate
    hover is light grey.
- [ ] **18.** **Fan-out glow** — a fan-out child tab glows sky and the origin tab's
    title glows sky; no purple anywhere. A fan-out child still stands out from
    a split pane's blue border; if not, raise the glow opacity (0.55) first.
    Isolate loop tab glow is unchanged (neutral).
- [ ] **19.** **Git log grey** — Git log heading, chevron and commit subjects are grey
    (hash dimmer), in normal and Lock-in. The Commit & Push footer, branch
    label and "PR opened" link stay blue. Since you left and Notes unchanged.
- [ ] **20.** **Sidebar LM popover** — open it from the Setup modal scrolled so the
    button is near the bottom: the popover stays fully on screen. Also check
    a short window, switching backends (popover grows, stays on screen), and
    scrolling the modal with it open (it follows the button).

Known gap, undecided: Sidebar LM stays hidden when a non-active backend has a
saved model (e.g. LM Studio model saved, backend still Claude CLI); it is
reachable from Setup. Maintainer to decide whether a saved model counts.
- [ ] **21.** **Home header copy** — header reads `N projects · T open decisions across P
    projects`; T equals the sum of the per-card "open decisions" counts shown
    for every card (scroll to check), P the number of cards with a count.
    With exactly one such project it reads "1 project".
- [ ] **22.** **Sidebar LM toggle** — Setup > Sidebar LM card shows the bordered
    "Sidebar LM" pill button with a "Show in sidebar" toggle switch stacked
    beneath it on the right; the pill reads as a button at rest. Default
    settings: toggle off, no control in the header. Turn it on:
    the Sidebar LM control appears in the header (expanded and compact rail)
    without a restart, and the popover changes the model from there. Turn it off:
    it disappears, including for a user with a configured extractor (explicit
    choice wins). The choice survives an app restart. Before any choice,
    visibility still follows the configured-extractor rule (item 9).

## Phase 51 — Stale decisions (2026-10-06)

Automated: `stale-decisions:check` (predicate against a real in-memory SQLite:
recent / old+active session / old+dormant / no events / non-open / 14-day
boundary / re-arms on new activity), `tsc`, `vite build`, full `npm run check`.
Read-only run against the real profile: 303 stale, 462 open non-stale (765 open
total at the time). Rust untouched; no extraction prompt changed (golden not
run). **No rebuilt-app pass by the agent.**

Manual, rebuilt app (real profile):
- [ ] **23.** **Counts drop** — Home header/cards and tab badges fall by roughly the stale
    count (about 303 total, fewer if some belong to projects without cards);
    the header total still equals the sum of the card counts.
- [ ] **24.** **Sidebar group** — a project with old decisions shows `Stale (N)` collapsed
    under Decisions; expand it; answer one and dismiss one (✕), both leave the
    group; recent decisions stay in the main list.
- [ ] **25.** **Dismiss stale** — "dismiss stale" clears stale decisions for that whole
    project (Overview's stale line also disappears, per the project-wide
    default) and leaves recent open decisions untouched.
- [ ] **26.** **"dismiss all" safety** — the Decisions header "dismiss all" no longer
    dismisses stale rows; they remain in `Stale (N)`.
- [ ] **27.** **Overview** — a project with stale decisions shows
    `N stale decisions (older than 14 days, session idle)` with Dismiss all
    stale; a project without any shows no line; Pick up here and Copy update
    ignore stale decisions.
- [ ] **28.** **Inbox** — stale decisions no longer appear; a recent decision still does.
- [ ] **29.** **Re-arm** — an old decision whose session just produced an event (resume
    that session and send one prompt) moves back to the normal list.
- [ ] **30.** **Lock-in / rail / min width** — unaffected; no new colors.

## Phase 52 — Next order, two-tier Blockers, working agreement (2026-10-07)

Automated: `momentum:check` (new cascade: landing note beats all; Now card
beats decisions; oldest decision beats an unstarred planned card; blockers are
not an input; done() resolves the winning row), `blockers:check` (TS/SQL tier
rule parity; tab-badge counts, project "clear all" and "clear detected" run as
the real repo.ts SQL against in-memory SQLite; source wiring for Inbox
exclusion, promote, and the all-rows-shown default), `tsc`, `vite build`, full
`npm run check`, `cargo test --lib`, clippy. No extraction prompt changed
(golden not run). **No rebuilt-app pass by the agent.**

Manual, rebuilt app (real profile):
- [ ] **31.** **Next order** — project with open decisions and a Now-starred card: Next
    shows the card. Unstar it: Next shows the oldest decision. Save a landing
    note: it wins and its label shows an age (`landing note · 2m`).
- [ ] **32.** **Start** — a planned/Now card in Next shows **▶ Start** (hover: "Moves
    this card to Building and frees its Now slot"); clicking moves it to
    Building and clears its star. Landing/decision picks still say ✓ Done.
- [ ] **33.** **No blocker in Next** — a project with only open blockers (no note,
    decision, or card) shows no Next card.
- [ ] **34.** **Two tiers** — a project with both kinds: red cards show only blockers
    you added; `Detected (M)` below lists open detector rows in the
    Accomplished row shape (age, label, one mono line, full text on hover),
    newest 5 first; `＋N` expands, `−` collapses. `Detected`, "clear
    detected" and the row labels carry a light red/pink tint that ties them
    to the Blockers header; age, mono text and ↑/✕ stay grey.
- [ ] **35.** **Counts** — tab badge, compact-rail Blockers count, Attention Inbox, and
    Overview "Needs a choice" / Copy update include only blockers you added.
    Overview shows `N detected tool errors (in the workspace Blockers panel)`.
- [ ] **36.** **Clear all vs clear detected** — header "clear all" leaves Detected rows;
    "clear detected" leaves red cards. Confirm with a counts-only query.
- [ ] **37.** **Promote** — ↑ on a detected row adds a red card laid out label first
    (pink label, white ＋), the matched text below in grey mono clamped to 2
    lines (＋ expands, − collapses), and removes the row; the tab badge goes
    up by one. In the Inbox and Overview the promoted blocker reads
    `<label>: <text>`.
- [ ] **38.** **Cleared Blockers** — lists only blockers you added; cleared detected rows
    don't appear.
- [ ] **39.** **Agent guide** — fresh `claude` session in this repo: `/context` lists
    AGENTS.md under memory files (imported from CLAUDE.md).
- [ ] **40.** **Lock-in / rail / min width** — unaffected; no new colors.

## Phase 53 — Detector precision: scan failed commands only (2026-10-07)

Automated: `detectors:check` (successful Bash whose stdout is `detectors.ts`
source → no text; Claude `PostToolUseFailure` `Exit code 1 … EADDRINUSE` →
"Port in use"; interrupt, non-Bash, Codex text, DeepSeek/Pi `{is_error}` →
none; OpenCode `metadata.exit` 0 → none, 1 → output scanned; Antigravity
`{is_error, error}` → scanned; "No such file or directory" alone no longer
matches), Rust `hooks_state` off/partial/on and update-on-partial exactly one
of ours per event, `failure_hook_registers_with_bash_matcher`, `tsc`, full
`npm run check`, `vite build`, `cargo test --lib`, clippy. No extraction
prompt changed (golden not run). **No rebuilt-app pass by the agent.**
**Unverified live:** a non-zero OpenCode bash `exit` (only exit 0 was in the
sample; the docs say non-zero is returned as `metadata.exit`, not thrown).

Manual, rebuilt app (real profile):
- [ ] **41.** **Update control** — Claude hooks control reads `claude update` (Setup
    modal button: **Update**). Click it; `~/.claude/settings.json` gains one
    `PostToolUseFailure` entry (matcher `Bash`) and nothing else changes
    (diff it against a copy taken first). The control then reads `claude on`.
- [ ] **42.** **Failure scanned** — Claude tab: `node -e "require('nope')"` → a
    `Missing file/module` row in Detected.
- [ ] **43.** **Reads not scanned** — `grep -n "rate limit" src/lib/detectors.ts` → no
    new Detected row.
- [ ] **44.** **Missing path** — `ls /definitely-missing` → no row (Decision 2).
- [ ] **45.** **Codex** — superseded by revision 2 / item 48: rollout completions
    provide a structured failure signal; hook text remains unscanned.
- [ ] **46.** **Hooks off / on** — off: settings.json byte-identical to before setup;
    on again: exactly one entry per event.
- [ ] **47.** **Rate** — Detected rows/day over the following week vs the ~7/day
    baseline (counts only).

- [ ] **48.** **Codex rollout failure / success (Plan 053 revision 2)** — rebuilt app,
    Codex tab with hooks enabled through the app: ask it to run
    `node -e "require('nope')"`. A structured `CommandExecution` completion
    with non-zero `exit_code` and `aggregated_output` should produce one
    `Missing file/module` Detected row in that project with Codex provenance.
    Then ask it to run `cat src/lib/detectors.ts` successfully: no new
    Detected rows despite the detector strings in the output. Confirm no
    terminal/state interruption and no hook update is needed. Only observe
    counts and field types if querying the DB; never dump transcript/output.
    Legacy rollout history without these completion fields stays invisible.

Revision 2 automated coverage: Codex completion failure → exact text and
"Port in use"; success reading detector source → null; invalid/missing exit
or output, wrong item/event, prose, malformed JSON and non-Codex session
context → null. Existing transcript listener wiring is checked. Counts-only
read-only DB inspection found 3,787 completion rows (3,532 zero / 255
non-zero), all integer exit / text output. Recent rollout files independently
confirmed the fields. **Item 48 is unverified live; no rebuilt-app pass by
this agent.**

Revision 2 gates passed: focused `detectors:check`, `opencode:check`, full
`npm run check`, `npx tsc --noEmit`, `npm run build`, `cargo test --lib`
(162 passed, 1 existing live-session test ignored),
`cargo clippy --all-targets -- -D warnings`, `git diff --check`.
Initial tsx IPC / Rust local-server sandbox errors passed on permitted
reruns. Build has the existing large-chunk warning; golden not run.

## Hotfix — re-entry resumes in the session's launch folder (2026-10-07)

Found live: two Claude sessions started in `<repo>/build` were re-entered in
`<repo>` (ghost tabs restore with `cwd = project_key`). Claude reported a
transcript path under the parent's project folder that doesn't exist, the
tailer emitted `tailer-failed`, and the app-wide strip read "no transcript
for 2 sessions". Fix: tabs carry `resumeCwd` (the SessionStart cwd, also the
binding's `cwd`); Re-enter spawns there. Tab identity (`cwd`) is unchanged.

- [ ] **49.** **Ghost re-entry from a subfolder** — rebuilt app: open a tab at a repo
    root, `cd` into a subfolder, run `claude`, send one prompt. Quit and
    relaunch the app, click Re-enter on the ghost tab. Expected: the agent's
    `! pwd` shows the subfolder; no "no transcript" strip; a decision-bearing
    reply still produces a card.
- [ ] **50.** **Mid-run death from a subfolder** — same setup without quitting the app:
    exit Claude so the tab goes dead, click Re-enter. Expected: resumes in the
    subfolder, no strip.
- [ ] **51.** **Root sessions unchanged** — a session started at the repo root re-enters
    at the root (regression).
- [ ] **52.** **Missing launch folder** — delete the subfolder before Re-enter. Expected:
    spawn falls back (shell opens, no crash); the strip may show for that
    session, which is accurate.

Automated: `reentry:check` covers resume vs plain restart vs legacy tab vs
`~`. Gates: `reentry:check`, `npx tsc --noEmit`, full `npm run check`,
`npm run build`, `git diff --check`. No Rust change, so cargo not rerun.
**Live (2026-10-07, maintainer): re-entry confirmed on Claude and a fresh
Codex instance after rebuild. Subfolder-specific items 49, 50 and 52 not
separately reported.**

## Phase 54 — Context meter in the Idea Board bar (2026-10-07)

Plan 054. A `ctx ▬▬▭ N%` meter sits right-aligned in the Idea Board's top
bar for the active tab. Claude: from the statusLine wrapper's
`context_window.used_percentage` (wrapper must be enabled). Codex: from the
rollout's `token_count` event (`last_token_usage.total_tokens /
model_context_window`). Rebuilt app required (Rust passthrough changed).

- [x] **53.** **Claude matches `/context`** — Claude tab with the usage-meter wrapper
    enabled; send a prompt. Expected: meter appears after the first response;
    run `/context` and compare. Within 1 point. Hover shows `Nk / Nk tokens`.
- [x] **54.** **Claude live update** — send two more prompts that read files. Expected:
    percent rises after each response without switching tabs.
- [x] **55.** **Claude `/compact`** — run `/compact`. Expected: meter hides, returns
    lower after the next response.
- [x] **56.** **Claude without wrapper** — disable the wrapper in the sidebar, start a
    new Claude session. Expected: no meter, no placeholder.
- [x] **57.** **Codex live update** — Codex tab, send two prompts. Expected: meter
    appears after the first turn and updates per turn. Note the Codex footer's
    context figure next to ours (Decision 2: switch formula only if the gap is
    visible).
- [x] **58.** **Placement** — meter is right-aligned in both the collapsed bar (with and
    without ★ Now cards) and the expanded board header; clicking it does not
    toggle the board; long ★ Now titles truncate rather than push it off.
- [x] **59.** **Tab switching** — switch between a Claude tab, a Codex tab and a plain
    shell tab. Expected: meter follows the active tab; shell shows none.
- [ ] **60.** **Thresholds** — (if reachable) bar turns amber at 70%, red at 90%.

Automated: `context-meter:check` (both parsers, malformed input, compact,
fill clamp, token formatting).

**Live (2026-10-07, maintainer, rebuilt app): items 53-59 passed; item 60
not reached (thresholds unverified live, covered by `context-meter:check`).**
Codex figure matched closely enough that Decision 2's formula stays.

## Phase 55 — Adoption blockers: multiple-choice cards, tab-only hooks (2026-10-07)

Rebuild and relaunch first. Claude is installed globally on this machine, so
Setup shows `claude update` (the new `PreToolUse` entry); click Update once.

- [x] **61.** **Multiple-choice card opens** — in a Claude tab, ask the agent to "use
    AskUserQuestion to ask me which of two options I prefer". Expected: while
    the picker is open, a Decision card shows the question with `○` option
    labels and "pick in terminal" (no ✎ answer / ⌕ context); the tab reads
    waiting.
- [x] **62.** **Card closes with the pick** — choose an option in the terminal.
    Expected: the card moves to answered with your label as the answer.
    Repeat with a multi-select question: answer lists every label picked.
- [x] **63.** **Escaped picker** — trigger another one and press Esc. Expected: the card
    is dismissed by your next prompt (or the turn's Stop), not left open.
- [x] **64.** **Switch to tab-only** — `shasum ~/.claude/settings.json` first. Setup →
    Claude → *Logic Loop tabs only*. Expected: Logic Loop's hook entries (and
    the status-line wrapper, if on) are gone from `~/.claude/settings.json`,
    the rest of it unchanged; `~/.context-terminal/claude-settings.json`
    holds them. Caveat: Claude sessions already running at Switch time go
    silent (Claude Code reloads the global file, the overlay only applies at
    spawn) until restarted — seen live 2026-10-07.
- [x] **65.** **Tab-only works** — new zsh tab, run `claude`, send a prompt. Expected:
    activity, decisions and the usage/context meters behave as before.
    `shasum ~/.claude/settings.json` unchanged across enable, use and disable
    (Disable/Enable while in tab-only mode).
- [x] **66.** **Tab-only status line** — the status line still renders your own line
    (the wrapper's `--settings` statusLine overrides the global one).
- [x] **67.** **Tab-only resume** — quit the app with a Claude tab open, relaunch.
    Expected: the resumed session still sends events.
- [x] **68.** **Outside terminal is silent** — in Terminal.app run `claude` in a project
    and send a prompt. Expected: nothing arrives in Logic Loop while tab-only
    is active.
- [x] **69.** **Back to Global** — Setup → Claude → *Global*. Expected:
    `~/.claude/settings.json` has Logic Loop's entries again (and the wrapper
    if it was on); `~/.context-terminal/claude-settings.json` is gone.

Automated: `ask-user-question:check` (Pre/Post parsers, malformed payloads,
multi-select answers, stored-context round trip, waiting state); Rust:
`PreToolUse` matcher and partial-install detection, `move_hooks` round trip
and untouched-source guard, `move_statusline` round trip and no-op, zsh
`claude` wrapper in interactive and `-c` resume shells, with and without the
tab file.

**Live (2026-10-07, maintainer, rebuilt app): items 61-69 passed.** Global →
tab-only → Global round trip left `~/.claude/settings.json` byte-identical to
the pre-switch copy; global hash unchanged across Disable/Enable, use, and
app relaunch; re-entry resume (`zsh -l -c`) spawned with `--settings`; an
outside Terminal.app session sent nothing; no duplicate hooks in a tab
launched under tab-only after switching back to Global.

<a id="computer-use-testing-audit"></a>

## Computer-use checklist review — 2026-10-07–08

Reviewed the 135 originally unchecked task rows, partial-result notes, and
the 69 numbered manual items in Phases 50–55/re-entry. `docs/TESTING.md` is
the only matching testing/test Markdown file found in the repository.
This is a verification/documentation pass, not implementation or phase
acceptance. Historical failures and superseded matrices are retained.

Environment: running Logic Loop macOS release, three original tabs (dead
Claude NSSA, live Claude Logic Loop, live Codex Logic Loop). Installed
`/Applications/Logic Loop.app/Contents/MacOS/app` and local
`src-tauri/target/release/app` had identical SHA-256:
`a582c7294c5a330615736331c38bca77e2f9b350c9ca12d357bccc411c2c4a0a`.
The sandbox denied process inventory, so running-process executable identity
was not independently proven. Visible current controls include Phase 55's
tab-only hook choice. No app rebuild/restart was performed for this UI pass.

All UI actions used computer use, with accessibility observations and visual
screenshots. No commands/prompts were typed into terminals, no hook/global
configuration was changed, and no existing cards were dismissed, promoted,
answered or edited. Overview created one disposable plain shell; split view
created its companion. Both were closed after checking. Original three tabs
remain, Codex active, expanded panel, single pane, Lock-in off. Disclosure
and scroll position changes are incidental. Agent activity continued during
the pass; this does not measure typing latency or prove PTY process identity.

### Verified live subcases

These boxes cover exactly the observed subcases. They do not close broader
combined rows elsewhere in this file.

- [x] §36: Attention opened via terminal-focused ⌘K, compact Inbox and
  expanded header. Original Codex input remained empty; no stray `k` visible.
- [x] §36: unmatched search showed empty-state copy; clearing it and pressing
  Down/Up selected different decisions without first clicking a result.
  Initial Escape returned to Terminal input; Escape after a header-triggered
  opening returned to HTML content. Exhaustive focus-trap/route tests unrun.
- [x] §38: gray Lock-in pill remained immediately after Fold/Expand in
  expanded, compact and hidden modes; adapter order remained agy, claude,
  codex, dsh, opencode, pi.
- [x] §38: indefinite and timed modes each collapsed to one Unlock button;
  timed accessible name said `Exit 60-minute Lock-in`; manual unlock restored
  both choices. Semantic panel accents/usage bars became gray in both modes.
- [x] §57 / Phase 49: real Traffic log populated, Refresh worked, Close
  worked, isolated Escape dismissed it (confirmed visually). Unknown usage
  was distinct from recorded numeric usage. Expanded/compact entry tested.
- [x] Phase 49: compact gear and Traffic art inspected; both hit targets
  opened their UI. Sidebar LM Close returned focus to the compact gear.
- [x] Phase 49: newest unclaimed completion initially visible, `12 older`
  expanded the other twelve, Hide restored the initial view. No dismissal.
- [x] §71: Home and Overview displayed `dev/context_terminal` in gray;
  accessibility Help/container retained the full canonical path.
- [x] §71: Overview New session tab with two existing workspaces created one
  named plain shell. No agent icon or context meter, no agent resume; original
  agent tabs stayed present. Both disposable shells were subsequently closed.
- [x] §44: split created a companion shell; switching left/right to top/bottom
  created no additional tab; active split toggle returned to one pane. Stacked
  layout visually inspected. Window/divider resize cases remain unrun.
- [x] §71: Home Continue returned to the same live Codex workspace with
  Terminal input focused; existing tab name/color retained, no new tab.
- [x] Phase 50 item 3: Setup workspace pill and Home button had teal outlines.
- [x] Phase 50 items 4/17, partial: Fan out rest ring sky; Isolate loop rest
  ring and modal neutral gray/white. Cancel closed the modal without launch.
- [x] Phase 50 item 21, plural case: scrolled Home and revealed older cards;
  the 19 card counts summed to 677, matching `677 open decisions across 19
  projects` in the header. Single-project grammar remains unverified.
- [x] Phase 52 items 34/35, partial: Detected had 46 rows, initially five;
  ＋41 expanded all, − restored five. Compact Blockers read `none open` despite
  those detected rows. Overview showed `46 detected tool errors (in the
  workspace Blockers panel)`. Mixed manual/detected tiers remain untested.

### Observations requiring review

- **Ctrl+Tab (§71):** focused Terminal input, one attempt produced no visible
  active-tab switch. Repeats the 2026-10-01 observation; distinguish native
  key delivery from the handler before calling it a confirmed app defect.
- **Focus restoration (Phase 49):** Traffic Escape/Close left AX focus on
  HTML content rather than its trigger. Sidebar LM Close from compact mode
  restored its trigger correctly, but Escape with Sidebar LM opened inside
  Setup closed both layers and left HTML-content focus. No extractor setting
  changed. These combined focus tests remain unchecked.
- **Lock-in (Phase 50 item 5):** observed semantic accents gray, but Set
  landing note retained its rainbow border. The literal “no hue anywhere in
  the side panel” expectation is not met; confirm whether that older border
  is an intended exception. OS notification/dock suppression was not induced.
- **Context threshold (Phase 54 item 60):** screenshots at displayed 71–73%
  showed a sky bar; a later screenshot at 75% showed amber. Record as a
  delayed/inconsistent transition observation, not a permanently missing
  amber state. 90% not reached. Source/automated coverage is not visual proof.
- **Popover (Phase 50 item 20), partial:** Setup scrolled to Sidebar LM near
  the bottom; its default Claude popover fitted on screen. Short-window,
  backend-growth and following-the-anchor-on-scroll cases remain unverified.
- **Isolate Escape:** Escape while its branch field was focused did not
  dismiss the visible modal; its Cancel control did. This is an observation,
  not a failed checklist requirement (the styling matrix specifies no Escape
  contract).

### Disposition of remaining open tests

Each originally open section is accounted for below. “Unrun” does not mean
failed. No old historical gate is marked passed using a current-source run.
The current gates below have their own dated evidence.

| Section / items | Remaining verification or disposition |
|---|---|
| v4 first-useful-session `[~]` | Existing trust-prompt/reset rough edge retained; no new agent launch. |
| §10 hook cycling | Unrun: would change global hook configuration and affect live sessions. |
| §13 residue quick-add/tab swap | Unrun: needs two distinct project workspaces and note lifecycle; no existing notes changed. |
| §20 historical quality-gate row | Already describes a 2026-08-27 pass; retained as historical evidence, not rerun against that revision. |
| §23 waiting age / terminal latency | Unrun: no induced waiting agent or terminal typing. Idle ages were visible, which is a different test. |
| §26 Antigravity commands/failure | Unrun: no fresh Antigravity session. Old no-failure-signal expectation must be compared with Phase 53's later structured-error support; do not infer current quota status from the old cooldown. |
| §32 Antigravity marker | Unrun: requires real Antigravity structured events. |
| §35 fan-out/warning artwork | Purple expectation superseded by Phase 50 sky; no fan-out group or warning fixture created. |
| §36 remaining Inbox cases | Search subcases above passed; Enter/Open tab, claim-once, ambiguous/dead/stale routes, quiet boundary, query failure, persisted width, notifications/dock and three-session dogfood remain unrun. |
| §38 keyboard/timers/relaunch | Mouse activation/labels checked; keyboard activation, stale developer timer, real 60-minute expiry and relaunch remain unrun. |
| §43 first-run activation | Historical matrix explicitly superseded by Plan 021/033 (section's own close-out). Six current Setup rows observed, all advertise decisions/re-entry; old four-adapter capability expectation no longer applies. No clean-profile/config-corruption/permission tests. |
| §44 split resize | Orientation/exit subcases passed above; no window/divider resizing or clipping-under-load check. |
| §§45–47 reconciliation/golden | Guessed reconciliation and its model selector removed by Plan 016 / §48. Preserve failed old golden history and struck-out tests; no live model run. Current deterministic answer/dedup needs an agent-driven pass where not already recorded. |
| §53 Claude usage meter | No wrapper/config/account changes, duplicate-Claude binding setup, statusline comparison or ingest-server termination. |
| §54 Codex usage meter | Current model/account block observed, additional-limit control present. Exact account-UI comparison, two Codex tabs/models/resume, polling shutdown, router off/on and unavailable/error/hung auth fixtures unrun. |
| §§55–56 Pi | Two stale duplicate rows reconciled from explicit 2026-09-18 maintainer evidence below them. Step 0 `/new` and isolated unauthenticated groundwork caveats retained; no new Pi turn. |
| §57 Traffic fixtures | Real populated view checked; missing/v1/empty/malformed/locked/HTML-tag fixtures, slow/WAL concurrent writes, narrow/split/Lock-in overlay and exhaustive focus cases remain unrun. Original log preserved. |
| §59 six-adapter/tab-icon matrix | Claude/Codex icons and icon-free plain shell observed; all-six launches, shell→agent transition, restore, long/narrow/fan-out/isolate/badge/reorder matrix unrun. |
| §64 DeepSeek | No new session, adapter reinstall, reconciliation/cancel, filtering, isolation, provider/ingest failure, collision or cross-adapter live matrix. |
| Ingest recovery regression | No restart or second app instance: current session is running inside Logic Loop. Live activity continued, but does not prove these restart cases. |
| §66 Codex daemon identity | First-session-only limitation superseded by Phase 45 launch registry/session replacement. Fresh Setup prompt, two-tab isolation, outside session, late hooks and Antigravity regressions remain unrun. |
| §69 guided tour | No clean-profile auto-start or real conditional-card walkthrough. |
| §70 Home/Overview | Live Home navigation observed; completion claim timing, split return, catalog retention, decision route/archive separation, full Copy update trace/edit, render-error recovery, exhaustive keyboard, versioned tour, restart digest, clipboard denial, 200% zoom, VoiceOver and Reduce Motion remain unverified in this pass. Older failed observations retained alongside later repair evidence. |
| §71 repair / identity / launches | Paths, fresh shell and live Continue subcases passed. Restart digest, re-enter/new human turn, foreign attribution, all field shortcuts, real export trace/copy, fresh/side-panel tour, disposable-profile locking, permissions/accessibility/zoom, nickname persistence/fallback/error, zero-workspace launch, exact chooser/double-click/error remain unrun. |
| Phase 49 | Compact controls/notice disclosure passed. Full resize/narrow/200%/hover matrix, dismiss/unresolve targets, loading/stale/error/badge settings, LM edits/short window, window dragging/reorder, scrollbar pointer/drag geometry, PTY identity and focus/sizing remain unverified. Blue Setup/hooks and orange Isolate styling notes superseded by Phase 50. |
| Phase 50 items 1–11 | Partial colors/Setup/Lock-in observations above. All-state focus/min-width checks and missing/seen/corrupt Traffic fixtures unrun. Setup detected-log text observed; other two states unrun. Default/backend-configured LM visibility and toggle persistence unrun. |
| Phase 50 items 12–22 | No controlled one/two-session dashboard delta matrix, fresh unbound skip or repeat-collapse check; no fan-out glow fixture, full Git log/footer color matrix, short/growing popover or LM visibility toggle/restart. Plural header parity passed; singular grammar unrun. |
| Phase 51 items 23–30 | No controlled before/after stale-count measurement, old-decision group lifecycle, bulk dismiss, export/Inbox exclusion, re-arm or minimum-width matrix. Existing decisions preserved. |
| Phase 52 items 31–40 | No board/note/decision priority mutations, Start/star clearing, blocker-only project, manual/detected clear/promote/reopen lifecycle or fresh Claude `/context`. Counts/display subcases above do not close the combined tests. |
| Phase 53 items 41–48 | No hook changes or terminal prompts. Existing detected history is not proof of current failure/success filtering. Real OpenCode non-zero exit and Codex completion failure/success remain unverified live. Week-long rate comparison cannot be completed in one pass. Item 45 is explicitly superseded by 48. |
| Re-entry items 49–52 | No quit/relaunch, agent exit or folder deletion. Maintainer's general re-entry report retained; subfolder/root/fallback scenarios not independently exercised. |
| Phase 54 items 53–60 | Boxes 53–59 reconciled from existing explicit maintainer pass. Item 60 remains open with the threshold observation above; 90% unrun. |
| Phase 55 items 61–69 | Boxes reconciled from existing explicit maintainer pass; no fresh picker/hooks/scope/resume/outside-terminal execution. Already-running-session switch caveat retained. |

### Current-source automated verification — 2026-10-08

- [x] `npm run opencode:check` and full `npm run check` (46 scripts).
- [x] `npx tsc --noEmit`.
- [x] `npm run build`; existing large-chunk advisory only.
- [x] `cargo test --lib`: 167 passed, 1 authenticated live-reader test ignored.
- [x] `cargo clippy --all-targets -- -D warnings`.
- [x] `git diff --check`.

Initial tsx IPC and three Rust localhost-socket failures were sandbox
`Operation not permitted`; permitted reruns passed. `golden` not run:
no extraction prompts changed. No source, plan, board, commit or push changes.
Unverified live scenarios and observation triage remain for human review;
this audit grants no new phase acceptance.

### Fix sprint from the computer-use observations — 2026-10-08

Source fixes for the review items above (uncommitted on
`feat/phase-55-adoption-blockers`). Gates: `npm run check`,
`npx tsc --noEmit`, `npm run build`, `git diff --check`. Rust untouched.
**No rebuilt-app pass by the agent.**

- Ctrl+Tab: xterm turned it into `\t` for the PTY and stopped propagation,
  so App's tab switch never ran. Terminal now hands Ctrl+Tab back.
- Focus restore: WebKit doesn't focus a button on click, so Traffic and
  Attention restored focus to `<body>`. Their header/rail/Home triggers now
  focus themselves first.
- Nested Escape: Setup listened in the capture phase and closed before the
  Sidebar LM popover could stop the event. Setup now listens in bubble phase.
- Lock-in: Set landing note button and capture input drop the rainbow border
  under Lock-in, same gate as the Next card.
- Isolate loop: Escape cancels (unless launching).
- Resize redraw residue: PTY resize was sent every animation frame, so a
  window drag or Lock-in/fold made Claude Code redraw dozens of times and
  xterm reflow left duplicate frames in the buffer (visible when copying).
  Now one trailing resize 120ms after the size settles. Reduces, can't fully
  remove: a single resize can still leave one stale frame.
- Tab-strip scrollbar: a mouse press on it hit Tauri's deep drag region
  (document mousedown, `preventDefault`) and started a window drag instead of
  a thumb drag. Presses below the strip's `clientHeight` now stop there.
- Context meter (item 60): not changed. Bar color and percent come from the
  same value with `>= 70` amber; 71–73% sky is not reachable from source.
  Treat as a screenshot-read on a 4px bar; recheck at ≥70%.

Manual, rebuilt app (F1–F2 passed, maintainer 2026-10-08):
- [x] **F1.** Terminal focused, Ctrl+Tab / Ctrl+Shift+Tab cycle tabs; no tab
      character reaches the agent prompt.
- [x] **F2.** Open Traffic and Attention by mouse (expanded header, compact
      rail, Home Inbox); Escape and Close return focus to the trigger.
- [x] **F3.** Setup → Sidebar LM popover → Escape closes only the popover;
      second Escape closes Setup. Also: Escape right after opening Setup
      (Close button focused) closes it. Failed 2026-10-08 (see below); fixed
      in #79 and passed on a rebuilt app (maintainer, 2026-10-08).
- [x] **F4.** Lock-in on: Set landing note button and capture input are grey.
- [x] **F5.** Isolate loop with branch field focused: Escape closes it.
- [x] **F6.** Context meter is amber at displayed 70–89% (maintainer saw
      amber in the 80s, 2026-10-08).
- [x] **F7.** Enough tabs to overflow: mouse click-drag on the tab-strip
      scrollbar thumb scrolls tabs (window does not move); click on the track
      pages; trackpad two-finger scroll still works; empty strip space above
      the tabs and right of the last one still drags the window. (Maintainer
      passed all subcases, 2026-10-08.)
- [x] **F8.** Claude tab with a long live screen: drag the window edge back
      and forth, toggle Lock-in and Fold a few times. Terminal snaps to the
      new width ~0.1s after you stop; select-all/copy shows at most one
      leftover duplicate frame per settled width change (not one per frame,
      as before #78); Codex shows none. Criterion reworded 2026-10-08: the
      per-change copy is Claude Code's own resize redraw, reproduced by the
      maintainer in a standard terminal, not a Logic Loop bug. Passed
      (maintainer rerun, below).

Computer-use follow-up — 2026-10-08, approximately 08:31–08:44 HST:

Tested the running `/Applications/Logic Loop.app/Contents/MacOS/app`
(binary modified 2026-10-08 08:26:13). No dev server or app restart was
used; the binary's source revision was not independently established.
Native accessibility observations sometimes lagged visible modal state;
screenshots were used to confirm outcomes.

- **F3 failed, twice:** first Escape closed Sidebar LM only and focused its
  trigger. Second Escape left Setup open. Clicking ordinary Setup text and
  pressing Escape then closed Setup. No model setting changed.
- **F4 passed:** Lock-in removed the rainbow from Set landing note and from
  the active capture input after clicking the button. Turning Lock-in off
  restored the button's rainbow. Capture and Lock-in were restored to off;
  no note was saved.
- **F5 passed:** clicked the Isolate loop branch input, pressed Escape,
  and confirmed the dialog disappeared without launching a worktree.
- **F6 failed observation:** during this Codex session the bottom `ctx`
  label displayed **88%**, while its fill was visibly blue with Lock-in
  off. Later **90%** displayed a red fill. The earlier Claude tab showed
  14%. This records visible behavior, not a diagnosed cause; source/build
  parity and the amber threshold still need investigation.
- **F7 partial, box stays open:** opened nine temporary plain-shell tabs.
  Thumb drag moved the strip from original agent tabs to later shell tabs;
  clicking the left track paged back. Horizontal Computer Use scroll calls
  in both directions produced no visible movement; this does not verify a
  physical two-finger trackpad gesture. Attempted an empty-space window
  drag, but app-cropped screenshots do not establish desktop position.
  Dragging to the right of the last tab remains unverified.
- **F8 failed observation:** on a resumed Claude Code v2.1.294 session,
  narrowed the window from 2400 to approximately 2000 screenshot pixels,
  widened it again, and repeatedly toggled Fold and Lock-in. Settled screens
  reflowed correctly. Select-all/copy into a new local TextEdit document
  showed multiple repeated PR-response blocks at different line widths,
  exceeding the “at most one” criterion. No pre-resize copy baseline was
  captured, so the amount introduced by this pass is not established.
  Exact ~0.1-second timing was not measurable with these observations.
  Scratch copy retained locally at `/private/tmp/logic-loop-f8-copy.rtf`;
  it contains session content and was not added to the repository.

Cleanup incident: closing temporary shells overshot and closed the idle
Claude tab. Its conversation was restored using a single Fan out launch
with `claude --resume` and its saved session ID; the final response and
prompt were verified visually. The replacement is named `context_terminal`
and has fan-out styling; sidebar binding awaits a new structured event.
The other original tabs remain. No agent prompt was submitted.

Documentation-only change; `git diff --check` passed. No source fixes,
plan/board changes, commit, push, or new phase acceptance. Human review of
F3/F6/F8 and the remaining F7 subcases is pending.

Maintainer triage, 2026-10-08:

- **F6 passed.** Color and label come from the same value in one render
  (`>= 70` amber, `>= 90` red); the 08:25 build's CSS defines
  `.bg-attn-400` as amber, and only Lock-in remaps it (to grey). The
  maintainer saw amber in the 80s directly. The 88%-blue report, like the
  earlier 71–73% "sky" one, reads as a screenshot color misjudgment of a
  4px-tall bar, not app behavior.
- **F3 root cause (regression from #78):** Setup's dialog
  `onKeyDownCapture` stops propagation of every key, so Escape with focus
  inside Setup never reached the bubble-phase window listener. Clicking
  plain text moved focus to `<body>`, which is why Escape then worked.
  Fix: the dialog's key handler closes Setup on Escape itself; Sidebar LM's
  window capture listener still stops Escape first while its popover is open.
- **F8 maintainer rerun (post-#78 app, quit/reopen between runs, same
  conversation).** Copies kept outside the repo; compared structurally
  (12-word shingles, punctuation/box-drawing stripped), no content read.
  Fold runs reuse the same agent's resize-run "before" copy as baseline.

  | Run | Duplicated blocks | Duplicated words | Baseline text repeated |
  |-----|-------------------|------------------|------------------------|
  | 1 Claude, resize | 1 | 160 | up to 2× |
  | 2 Claude, fold + resize | 4 | 648 | up to 4× |
  | 3 Codex, resize | 0 | 0 | 1× |
  | 4 Codex, fold + resize | 0 | 0 | 1× |

  Codex leaves no residue. Claude leaves about one copy per settled width
  change: resize alone meets "at most one"; fold + resize (several discrete
  width changes) does not. The 120ms debounce removed the per-frame copies
  but cannot merge separate settled changes, each of which is a real resize
  Claude Code redraws for. Maintainer reproduced the same per-resize copies
  with Claude Code in a standard terminal, so it is upstream behavior; F8
  criterion reworded and passed.

## Phase 56 — Haiku 5.5 default Sidebar LM (2026-10-08)

Rebuild and relaunch first. Leave Sidebar LM's Claude model field blank
unless an item says otherwise.

- [x] **70.** **Default is Haiku** — in a Claude tab, end a turn with the agent asking
    you a question. Expected: a Decision card appears; while the extractor
    runs, `ps -ax | grep "claude -p"` shows `--model claude-haiku-5-5`.
- [x] **71.** **Sonnet still selectable** — type `sonnet` in Sidebar LM. Expected: no
    warning; the next extraction spawns with `--model sonnet`. Type `opus`:
    the "Only claude-haiku-5-5 and claude-sonnet-5-5 are golden-set verified" warning
    shows. Clear the field afterwards.
- [x] **72.** **Landing note on Haiku** — switch away from a Claude tab that had
    agent activity. Expected: the landing-note draft is pre-filled and reads
    usable (Haiku has no golden coverage here).
- [x] **73.** **Commit message on Haiku** — stage a real diff and open the Commit & Push
    footer. Expected: the drafted message reads usable.

Automated: `npm run golden` (default Haiku) ×3 and
`EXTRACTOR_MODEL=sonnet npm run golden` ×1 clean, 2026-10-08; per-call
medians Haiku $0.00017–$0.00020 / 3.1 s, Sonnet $0.00181 / 3.3 s (cache hits).

## Phase 57 — Human time in projects (2026-10-08)

Run in the built app, not `npm run tauri dev` (LANDMINES: a dev reload kills
every tab). Use one project with an agent tab; check Project Overview → "Your
time" with range Today.

- [x] **74.** **Matches a stopwatch** — work in one project tab ~5 min (type,
    scroll). Expected: "Your time" today rose by the stopwatch time ±1 min.
- [x] **75.** **Time away doesn't count** — Cmd-Tab to another app for 10 min,
    come back. Expected: those 10 min are not added.
- [x] **76.** **Idle cap** — stay focused on the tab, touch nothing for 20 min.
    Expected: adds 15 min, not 20.
- [x] **77.** **Same-project split counts once** — split two tabs of the same
    project for 5 min. Expected: adds 5 min, not 10.
- [x] **78.** **Copy update has hours** — open Copy update. Expected: a
    **Time** section with today's line and a Total.
- [x] **79.** **Row rate is sane** — counts only:
    `sqlite3 <db> "SELECT type, count(*) FROM events WHERE type IN ('tab_entered','tab_active') GROUP BY type"`.
    Expected: `tab_active` grows ~1/min per visible tab while active, not per keystroke.

Automated: `npm run dashboard:check` covers enter→left, idle cap, time away,
same-project split, open interval to now (capped), range clipping, midnight
split, Copy update Time section.
