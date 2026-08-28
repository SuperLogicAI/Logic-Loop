# Manual Test Script — v2

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
        *unable to test*
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
10. [x] (accept path only) Commit & Push footer on `main` → the "commit +
        push → main" button triggers the `ask()` confirm; accepting pushes
        straight to `main`. *(2026-08-27: confirmed live — user clicked
        through the confirm dialog on `main`, commit `fbd03a8` landed on
        `origin/main` via a plain push. Decline path (leaves everything
        uncommitted) not yet exercised.)*

        **Bug found during this check (not in the original plan):** the
        commit that landed added `mod codex;` and 4 `codex::*` command
        registrations to `lib.rs` but never staged the new `codex.rs` file
        itself — `git add -u` only stages tracked files, and `git_has_changes`
        (the footer's dirty gate) queries with `--untracked-files=no`, so a
        change consisting only of a new file is invisible to the footer at
        both the gate and the staging step. `origin/main` failed `cargo check`
        for a fresh clone as a result. Fixed same session (commit `fb79dea`):
        `git_untracked_files`/`git_add_all` new Tauri commands, a
        `hasStageable` footer gate that also counts untracked files, and an
        amber warning box in the footer listing untracked files with an
        opt-in checkbox — never silently included, never silently dropped.
        See CLAUDE.md's Known landmines for the full note.
11. [ ] Clicking the left button while on `main` creates and pushes a real
        `wip/<timestamp>` branch — `main` itself untouched locally and on
        the remote.
12. [ ] With nothing dirty, the footer shows "no changes" and no buttons.
13. [ ] The cached commit message survives a second click without a second
        LLM call (no observable delay/spinner), and differs (triggers one
        generation) after the diff actually changes.

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
