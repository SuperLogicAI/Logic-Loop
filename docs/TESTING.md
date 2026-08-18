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

## Quality gates (machine-run, not manual)

- [x] `npx tsc --noEmit` clean. *(rerun 2026-08-18, Phase 8)*
- [x] `cargo clippy --all-targets -- -D warnings` clean (in `src-tauri/`).
      *(rerun 2026-08-18, Phase 8 — new `opencode.rs` module clean, no new
      lint carve-outs needed)*
- [x] `cargo test` passes — 13/13, incl. `resume_id_rejects_shell_metacharacters`
      (Phase 6), the `SessionStart` hook-set assertions, and 5 new
      `opencode::tests` (setup/remove idempotency + byte-identical restore
      of foreign `"plugin"` entries, plugin-source contract assertions).
      *(rerun 2026-08-18, Phase 8)*
- [x] `npm run golden` — 12/12 (claude). *(rerun 2026-08-18, Phase 8; no
      extraction-prompt changes — decision extraction stays Claude-only this
      phase, see PLAN.md Phase 8 non-goals)*
- [x] All nine check scripts pass: `npm run` `dedupe:check`, `reentry:check`,
      `unclaimed:check`, `notify:check`, `bind:check`, `epoch:check`,
      `landing:check`, `spawn:check`, `scope:check`. *(rerun 2026-08-18,
      Phase 8; no changes to any of these — Phase 8 introduced no new
      frontend branching, confirming the pipeline was already agent-agnostic
      per PLAN.md's mechanism §5)*
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
