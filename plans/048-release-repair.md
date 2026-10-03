# Phase 48 release-test repair (revision 2 of the fix-it sprint)

## Status and execution contract

- **Status:** APPROVED 2026-09-30 by the maintainer ("approved, defer zoom,
  clean the rows - approved to proceed"). Zoom deferred; targeted cleanup of
  the mis-attributed real-profile rows authorized (see Decisions). Phase 48 remains **NOT ACCEPTED**; this is a
  same-phase repair, not Phase 49.
- **Parent:** `plans/048-project-dashboard.md` → `plans/048-dashboard-fixit-sprint.md`.
- **Planned at:** `ec8928a`, branch `phase-47-feature-tour`, with pre-existing
  staged + unstaged edits in `docs/TESTING.md` (preserve both).
- **Input:** verified release-test failures recorded in `docs/TESTING.md`
  §70–71 (2026-09-30), plus read-only, structural-only inspection of the real
  profile (`mode=ro`; event types, timestamps, truncated ids, project-key
  equality — no transcript/decision text read).
- No commit, push, PR status change, reinstall, profile reset, TCC/global
  setting change, or autonomous terminal input as part of execution.

## Plan revisions (stated explicitly)

1. **Failure 1 is re-diagnosed, not closed.** The recorded run's empty
   post-relaunch digest is consistent with anchor semantics (the final `Stop`
   landed while the tab was visible), but review found departure anchors are
   **not visibility-aware**: window blur and tab-switch write `tab_left` for a
   tab hidden behind Home, so a result that finished while Home was shown can
   be anchored away unseen. The repair covers that, plus (a) an unrelated
   untethered session bound to the re-entered tab, and (b) a restored tab
   labeled "no session · no events yet". Restart-digest acceptance stays
   unresolved until Manual step A passes live.
2. **New file** `src/lib/shortcuts.ts` (pure editable-target predicate) —
   App.tsx is not importable by check scripts.
3. **`src/lib/repo.ts` `getDb()`** changes (connection race), outside the
   fix-it sprint's listed repo reads.
4. **`src/lib/ingest.ts` `bindSession`** changes (the one binding function;
   untethered owner recovery; fallbacks never pick a tab owning a different
   session, removing the old "reuse when all bound" rule; tether path
   untouched).
   **`src/App.tsx`** gains visibility-aware departure anchors (blur and
   tab-switch), beyond the shortcut guard.
5. **⌘+ zoom is not implemented here.** It needs Tauri `zoomHotkeysEnabled`
   plus a webview-zoom permission/polyfill on macOS and changes xterm cell
   metrics — new capability, maintainer decision (see Decisions needed).
6. Accessibility-name fixes in `HomeDashboard.tsx`/`ProjectOverview.tsx`,
   reduced-motion in `FeatureTour.tsx`, clipboard failure state in
   `CopyUpdateModal.tsx`.

## Diagnosis and fixes

### 1. Digest persistence / session re-entry

**Evidence (HST, 2026-09-30; tab tether `T`, Codex session `S`, both truncated
ids verified in the profile):**

| Time | Rows on `T`/`S` |
|---|---|
| 22:55:45 | `SessionStart` (startup, launch `current`); binding row for `S`/`T` written, `active=1`, agent `codex` — still unchanged and correct now |
| 22:56:57 | `tab_left` (Home departure) |
| 22:58:45–22:59:13 | turn: `UserPromptSubmit`, `PostToolUse` ×2 (22:59:05, 22:59:09), `Stop` 22:59:13 |
| ~22:59 | maintainer screenshot: digest showed 1 command, 1 turn, 0 stops → captured mid-turn, tab visible |
| 22:59:25, 22:59:50 | `tab_left` (departure, then quit/blur) |
| after relaunch | **no hook rows for `S`** after Re-enter (Codex `resume` emitted no `SessionStart` before a new turn) |
| 23:06–23:20 | 7 more `tab_left` (Home ↔ Continue transitions) |
| 23:21:52 → | 27 `attention_state_observed` rows from an **unrelated untethered Claude Code session** (different project key, no `tab_id` in its hooks) stamped `tab_id = T` |

**Findings:**

- **(a) Persisted identity is correct.** Ghost tab = tether `T` + session `S`
  from `session_bindings`; Re-enter resumed `S` (transcript loaded). No change.
- **(b) This run's digest absence is explained, the mechanism is not
  sound.** `SidePanel` digest = events after `lastLeft(T)`. No anchor exists
  between 22:56:57 and 22:59:25, and the mid-turn screenshot shows the
  workspace was visible again before the final `Stop` (22:59:13), so this
  run's activity was on screen before quit. But `App.tsx`'s window-blur
  handler marks `activeId` left **whatever the surface**, and the tab-switch
  effect marks the previous tab left even while Home hides it. Workspace →
  Home → turn completes → blur/quit therefore writes an anchor after an
  unseen `Stop`, and the restart digest loses it. Defect.
- **(c) Defect — contamination.** `bindSession`'s active-tab rescue only skips
  tabs in `bindingsRef`; ghost tabs are never seeded there, so after relaunch
  a re-entered tab with a persisted `sessionId` looks "unbound". An outside
  untethered session in a different project fell through to "active tab" and
  its source context took `tab_id = T`. `mergeTabIdentity` protected the tab's
  displayed identity, but derived rows (attention observations; potentially
  decisions/blockers via `sourceContext`) are mis-attributed, and
  `eventsSince(T, …)` matches by `tab_id`, so they can enter `T`'s digest
  window.
- **(d) Defect — misleading label.** Compact and expanded panel status read
  `agentState ?? "no session"` / `"no events yet"` from in-memory state that
  ghost tabs never hydrate. A tab with a known session says "no session".

**Fixes:**

- **Visibility-aware departure anchors** (`App.tsx`): one effect owns
  visibility departures. It keeps the previous effective visible set
  (existing `effectiveVisibleTerminalIds(surface, activeId, splitPaneIds)`:
  both split panes on `workspace`, empty on Home/Project) and writes
  `tab_left` only for tabs that **leave** that set and still exist (the
  explicit close path keeps its own anchor). This replaces the `markTabLeft`
  calls in the tab-switch and surface effects; their landing-prompt and claim
  logic is unchanged. Blur anchors the current effective visible set (empty
  on Home/Project). Workspace A → Home → A `Stop` → Continue into B therefore
  anchors nothing for A (it left the set when Home opened, not again), and
  each departure is anchored once. Pure helper
  `departedTabIds(prevVisible, nextVisible)` (set difference). Anchor meaning
  ("last time the human stopped looking") is unchanged; only spurious
  anchors for unseen tabs stop.
- `bindSession` (`src/lib/ingest.ts`), **untethered** branch only, in order:
  1. **Owner recovery:** a live tab whose `sessionId === p.session_id` wins
     (even if `bindingsRef` is empty after relaunch, or the session's cwd
     changed). Untethered Codex still returns `null` before this step.
  2. Same-cwd match, **eligible tabs only**: not in `bindingsRef` and no
     `sessionId` (i.e. not owning a different session).
  3. Active-tab rescue, same eligibility.
  4. Otherwise `null` — the hook is still persisted unbound (existing
     `!tabId` path; cwd-keyed panels and decisions still see it).
  **Behavior change, stated explicitly:** the existing rule "all same-cwd
  candidates bound → reuse the match" (`bind-check.ts` ~70) is removed; an
  outside session in the same repo no longer stamps a tab that owns a
  different session. Tethered sessions (including a second CLI run inside a
  tab's shell) are unaffected.
  Tether path, Codex launch rules, root-cwd guard unchanged. No change to
  `bindingsRef` seeding, migrations, or stored rows.
- Panel label: tab has `sessionId` but no live state → "session restored" and
  "no new activity" (copy final at implementation), never "no session". Pure
  helper shared by both label sites.
- **Do not rewrite** the 27 contaminated real-profile rows (append-only,
  real profile untouched). Disclose; cleanup only with explicit approval.

**Regression checks:** `dashboard-check.ts` (existing visibility fixtures):
`departedTabIds` over transition sequences built with
`effectiveVisibleTerminalIds` — workspace A → B anchors A; split [A,B] → B
alone anchors A only; workspace A → Home anchors A; Home → Continue B
anchors nothing; Home → Continue A anchors nothing; Home → blur anchors
nothing; workspace split blur anchors both. The combined case workspace A →
Home → A `Stop` → Continue B → select A is modeled end to end as event rows:
no `tab_left` for A after its `Stop`, and `summarizeDelta` reports the turn.
`scripts/bind-check.ts`: untethered
foreign-project hook + active live tab owning another session (ghost
re-entered) → `null`; known owner A (`sessionId` S) + free same-cwd tab B,
empty `bound` → A; owner A after the session's cwd changed → A; untethered
same-cwd new session prefers a tab without `sessionId`; same-cwd new
session with every tab owning a different session → `null` (inverts the old
"reuse" fixture); untethered Codex owner match → still `null`;
tethered Codex `resume`
`SessionStart` for the tab's own `S` → `T`; tethered Codex with a new session
id under a current launch → replace (existing); `unknown`/`retired` launch →
`null`. Label helper fixture: `(undefined, "S")` → restored, `(undefined,
undefined)` → no session, `("idle", "S")` → idle.

**Live (release build):** see Manual steps A–C.

### 2. Editable-field shortcut isolation

Cause: the global `keydown` handler (`App.tsx` ~1375) applies ⌘/Ctrl K, B,
⇧B, T, W and Ctrl+Tab regardless of target; only ⌘V checks for fields.

Fix: `isEditableShortcutTarget(el)` in `src/lib/shortcuts.ts` — true for
`textarea` (except `.xterm-helper-textarea`), text-entry `input` types (text,
search, email, url, tel, password, number, date/time variants; not
checkbox/radio/button/submit/reset/range/color/file/hidden), and
`isContentEditable`. Handler: when the event target (fallback
`document.activeElement`) is editable, skip all app shortcuts except the
existing field ⌘V paste path. xterm's helper textarea keeps every shortcut.
Audit capture-phase handlers (`FeatureTour`, `OnboardingModal`) and
`LandingNoteModal`/`DiffModal` for interception inside their own fields;
change only if they swallow field keys.

Checks: `dashboard-check.ts` predicate fixtures over DOM-like objects (each
input type, textarea, xterm helper, contenteditable, button, null). Live:
⌘K, ⌘B, ⌘T, ⌘W in Home search, Overview purpose, Copy update textarea,
Setup fields → native field behavior, no Inbox/tab/panel action; same keys
in a focused terminal → app shortcuts still work.

### 3. Copy update export minimization

Cause: `oneLine` (`dashboard.ts:260`) path regex needs a file extension
(`src-tauri/migrations:` has none) or a leading `/`, `~/`, `./` preceded by
start/space (a `(` before a relative link target defeats it); `ls` is not in
the command list. Conversely `make\s+\w+` / `node\s+\w+` omit ordinary prose
("make sure the form works").

Fix: replace with an exported `exportSafeLine` applied (as now) to every
exported string — progress excerpts, commit subjects, decision + assumption,
blockers, Next, project name, range label:

1. First line only (kept).
2. Markdown links/images `[text](target)` → `text` (target dropped).
3. Omit the line ("Technical details omitted; review in the workspace.") if
   any whitespace token, stripped of surrounding punctuation, is path-like:
   - contains `/` or `\` — **except** a closed allowlist (`and/or`,
     `either/or`, `w/`, `w/o`, `I/O`, `N/A`, `TCP/IP`, `24/7`) and pure
     numeric fractions/dates (`33/61`, `9/30`). No general letters-only
     exemption: `src/components`, `config/secrets`, `Home/Overview` are all
     omitted (privacy over prose);
   - starts with `~`, or is a drive path or URL scheme;
   - is a filename with a code/config/script extension (`.sh .py .ts .tsx
     .js .mjs .json .toml .yaml .yml .md .rs .sql .env .lock`), except the
     capitalized product-name form `^[A-Z][A-Za-z]*\.js$` (`Node.js`).
4. Omit on shell shape: inline code backticks, `$ ` prompt; tool names
   (npm, npx, pnpm, yarn, cargo, git, sudo, curl, wget, brew, pip, pip3, rg,
   sed, awk, tsx, deno, python3) followed by any argument anywhere;
   English-ambiguous commands (ls, cd, rm, mkdir, cp, mv, cat, find, make,
   node, python, bash, sh, zsh, touch, kill, chmod) when the line starts with
   the **lowercase** word followed by any argument or `:`, or anywhere
   followed by a flag (`-x`, `--x`). Interpreter + script (`bash deploy.sh`,
   `python3 migrate.py`) is caught by both rules.

No evidence is fabricated: omission replaces the line with the existing
placeholder; empty sections still say "none recorded".

Checks (`dashboard-check.ts`): must-omit — the observed
`ls: src-tauri/migrations: No such file or directory`, `rm -rf build`,
`npm run build failed`, `src/lib/repo.ts`, `src/components`,
`config/secrets`, `~/x`, `../plans/x.md` bare, `https://…`, `` `cmd` ``,
`make build`, `bash deploy.sh`, `python3 migrate.py`, `Updated deploy.sh`;
link → text — `See [Plan 048](plans/048-x.md)` → `See Plan 048`; must-keep —
`Make sure the form works`, `we should make sure it works`, `and/or`,
`33/61 decisions`, `Find a booking provider`, `Use Stripe for now`,
`Upgrade to Node.js 22`. Each counterexample also through
`buildUpdateMarkdown` in every exported section (progress, commits,
decision, assumption, blocker, Next). Live: real-project draft re-traced
line by line.

### 4. Tour Home spotlight

Code-proven cause: `visibleRect` (`FeatureTour.tsx:101`) does
`{ ...rect, top, height }` on a `DOMRect`. `left`/`width` are prototype
accessors, so the spread drops them; spotlight `left`/`width` and card `left`
become `NaN` and React drops them. This affects every step, not only Home;
whether it fully explains the "centered card" screenshot is confirmed live
before claiming the fix.

Fix: build `Rect` from explicit `top/left/width/height`; clip horizontally as
well as vertically. Keep `getClientRects().length > 0` hidden-target
exclusion (Home-triggered Tour = 1 of 1 is expected). Export pure geometry
for checks. **Reduced motion:** `motion-reduce:transition-none` on spotlight
and card; `scrollIntoView` uses `behavior: "auto"` when
`prefers-reduced-motion: reduce` matches.

Checks (`onboarding-check.ts`): a DOMRect-like object with prototype getters
yields finite `left/width` and a non-null spotlight; card stays inside the
viewport for a top-left target; scroll-behavior helper; hidden-target
exclusion unchanged. Live: Home spotlight around the tab-bar button on fresh
auto-tour and Home-triggered Tour; side-panel steps spotlight their section.

### 5. Additional findings — dispositions

| Finding | Disposition |
|---|---|
| Fresh Setup `database is locked (code: 5)` | **Fix.** `getDb()` caches the resolved DB, not the promise; concurrent first calls each run `Database.load`, and tauri-plugin-sql 2.4.0 `load` builds a new pool per call (migrations run on only one). Memoize the load promise; clear it on rejection. This fixes a demonstrated race; the code-5 incident stays **unresolved** until a fresh disposable profile shows no warning and the preference persists. |
| Clipboard rejection only resets `copied` | **Fix.** `idle/copied/failed` state; failed shows `role="alert"` text ("Couldn't copy — select the text and press ⌘C, or try again"), button becomes "Try again"; editing resets. Pure `copyDraft(write, text)` fixture with a rejecting writer. Live denial stays unchecked (no TCC manipulation). |
| Tour transitions/smooth scroll ignore reduced motion | **Fix** (in 4). |
| ⌘+ no scale change; 200% unverified | **No code change** (revision 5). Record that zoom hotkeys are disabled by Tauri default. A narrow-window reflow check may be recorded as "reflow-equivalent", never as a 200% pass. |
| Repeated generic "Open" | **Fix.** Home card button accessible name "Open <project> overview"; Overview "Go to workspace" rows `aria-describedby` their decision text; section Retry buttons named per section. AX-tree uniqueness checked via computer use; audible VoiceOver needs the maintainer. |

## Files

`src/lib/ingest.ts`, `src/components/SidePanel.tsx` (+ label helper in an
existing lib), `src/App.tsx` (shortcut guard; blur/tab-switch anchor gating),
`src/lib/dashboard.ts` also hosts `departedTabIds`, new `src/lib/shortcuts.ts`,
`src/lib/dashboard.ts`, `src/components/CopyUpdateModal.tsx`,
`src/components/FeatureTour.tsx`, `src/components/HomeDashboard.tsx`,
`src/components/ProjectOverview.tsx` (aria only), `src/lib/repo.ts`
(`getDb` only), `scripts/bind-check.ts`, `scripts/dashboard-check.ts`,
`scripts/onboarding-check.ts`; docs: this plan, `PLAN.md` pointer,
`docs/TESTING.md` §70–71. No Rust, migration, adapter, generated-hook,
extraction-prompt, or dependency change.

## Verification

Focused first: `bind:check`, `dashboard:check`, `onboarding:check`. Then:

```sh
npm run opencode:check
npm run check
npx tsc --noEmit
npm run build
cd src-tauri && cargo test --lib
cd src-tauri && cargo clippy --all-targets -- -D warnings
git diff --check
```

No `golden` (no extraction-prompt change). Rebuild with `npm run tauri build`
(never `npm run reinstall`) and re-test the raw bundle with computer use.
Record actual pass/fail in `docs/TESTING.md` §70–71; untested cases stay
unchecked.

## Manual steps needing the maintainer

0. **Quit the running release app** (it hosts live terminals, including the
   re-entered Codex tab) so the rebuilt bundle can be launched.
A. **Restart digest:** start Codex in tab X and submit a prompt; run it
   twice — (A1) switch to another tab, (A2) open Home — before it finishes;
   wait for completion, blur the window (click another app), quit without
   returning to X; relaunch, select X → expect Since You Left with that turn
   in both variants, verified also by a structural `mode=ro` query that no
   `tab_left` for X postdates its `Stop`. (Human types prompts; the agent
   sends none.)
B. **Re-enter X:** label reads restored, not "no session". Answer any Codex
   update prompt, then submit one new turn → state/binding updates on `X`.
C. **Contamination:** with X re-entered and active, start an untethered
   agent session in a different project outside Logic Loop → X's panel
   unaffected; verified by structural `mode=ro` query (no new rows with
   `tab_id = X` from the foreign session).
D. **Fresh profile (DB lock):** approve moving the real profile directory
   aside (rename, never copy) and back again, or perform it yourself.
E. **Reduce Motion:** toggle System Settings → Accessibility → Motion on and
   back off (global setting — needs your approval or your hands).
F. **VoiceOver audible pass**, and clipboard-denial if you have a way to
   produce it without changing privacy grants.

## Decisions needed

1. Approve this revision, including the binding behavior change (outside
   same-repo sessions no longer reuse a tab owning another session).
2. ⌘+ zoom: defer (recommended) or approve `zoomHotkeysEnabled` + webview
   zoom permission as a scoped addition with its own terminal checks.
3. Leave the 27 mis-attributed real-profile rows in place (recommended), or
   authorize a targeted cleanup.

**Resolved 2026-09-30:** (1) approved; (2) zoom deferred — 200% stays
unchecked; (3) cleanup authorized. Cleanup method: with the app quit, strip
only the foreign `tab_id` key (`json_remove`) from `attention_state_observed`
rows whose `session_id` is the unrelated untethered session and whose
`tab_id` is `T` — observations themselves are real and kept. Affected row ids
and original payloads saved to a scratch rollback file first. No other
tables/rows touched unless a structural query shows mis-stamped derived
rows (decisions/blockers), which are then reported before any change.

## Stop conditions

Stop and report if the fix needs a migration, PTY/adapter change, weaker
tether/Codex guarantees, anchor-semantic change, or global setting change;
or if live checks show the tour cause is not the DOMRect spread.

## Implementation outcome (2026-09-30)

Built as planned, with two placement deviations: `departedTabIds` lives in
`src/lib/splitView.ts` beside `effectiveVisibleTerminalIds` (fixtures in
`scripts/split-view-check.ts`), and `sessionStatusLabel` lives in
`src/lib/ingest.ts` (fixture in `scripts/clock-check.ts`). All automated gates
and the release bundle passed; see `docs/TESTING.md` §71.1. Live UI re-test
was not run (no computer-use tools in the implementing session). Row cleanup:
75 attention rows de-stamped; 1 `result_landed` row and 1 blocker from the
same foreign session await the maintainer's go-ahead.
