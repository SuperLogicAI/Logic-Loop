# Plan 007: Make landing-note capture manual or automatic

> **Status**: DONE. Built after `PHASE 28 ACCEPTED`; automated gates and the
> live macOS matrix passed, and the maintainer wrote `PHASE 28 APPROVED` on
> 2026-09-10.
>
> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. Stop
> at any condition in "STOP conditions" rather than widening the sprint.
>
> **Drift check (run first)**:
> `git diff --stat 6a67c16..HEAD -- src/types.ts src/lib/landing.ts src/lib/repo.ts src/App.tsx src/components/LandingNoteModal.tsx src/components/SidePanel.tsx scripts/landing-check.ts docs/TESTING.md docs/IDEAS.md docs/ROADMAP.md CLAUDE.md plans/README.md`
> If an in-scope file changed, compare the current-state locations below with
> the live code and stop for plan revision if the product contract no longer
> fits.

## Status

- **Priority**: P1
- **Effort**: M (about 1 day plus live dogfood)
- **Risk**: MED — tab-switch behavior, persisted preference hydration, and the
  shared residue/landing inline input must keep distinct note kinds
- **Depends on**: none; Phase 27 is already accepted
- **Category**: direction / UX
- **Planned at**: commit `6a67c16`, 2026-09-10

## Why this matters

Landing-note capture currently runs as a mandatory automatic departure ritual:
after qualifying agent activity, switching or closing a tab opens a modal and
immediately starts an extractor-backed draft. That is valuable for people who
want structured departure capture, but it adds interruption and can contribute
to perceived switch lag for people who do not need a generated note.

This phase keeps the existing behavior available and adds a persistent global
choice. Automatic mode preserves the current ritual. Manual mode makes tab
switching and closing silent and performs no landing-draft extractor call; the
human can explicitly create a landing note for the current project from the
existing **Notes and reminders** section. Either path stores the same
`kind='landing'` note, so Momentum/Next behavior remains unchanged.

This implements the user-selected version of `docs/IDEAS.md` item E without
also taking on that item's separate inline-strip redesign.

## Product contract

### Preference semantics

- Add one global persisted landing-capture mode: `"auto" | "manual"`.
- Existing installs and absent/malformed settings default to `"auto"`,
  preserving current behavior.
- The setting is global because it describes how the operator uses the app
  shell, like panel mode/width; it is not project semantic state.
- Put a compact, keyboard-accessible **Auto / Manual** control beside or
  immediately beneath the **Notes and reminders** heading. Its accessible name
  must include “Landing notes”. Do not hide the preference in extractor
  settings or create a separate settings screen.
- A failed settings read falls back to Auto and never blocks terminal startup.
  A failed write leaves terminals and notes usable and restores the last
  persisted selection (or visibly reports failure); do not silently display a
  mode that was not saved.

### Automatic mode

- Preserve the current qualifying rules in `maybePromptLanding`: activity
  since the prior prompt, ten-minute debounce, no stacked modal, fan-out and
  isolate-loop suppression, close-tab behavior, 60-second auto-skip, and
  immediate optional pre-draft.
- Preserve skip metrics: only an actual automatic modal skip writes an empty
  `kind='landing', status='skipped'` row.

### Manual mode

- Switching or closing a tab must not open a landing modal and must not call
  `draftLandingNote` / `run_extractor`.
- A departure handled in Manual mode consumes that tab's current activity
  marker. Switching back to Auto must not produce a delayed prompt for work
  that was already left while Manual was selected; only later agent activity
  may qualify.
- The **Notes and reminders** section exposes **Set landing note** in both
  modes. The button uses the established landing-note rainbow border and
  toggles the existing Notes input into landing capture for the active project.
- While landing capture is active, the input uses the same rainbow border,
  changes its placeholder to identify a landing note, and shows “What's the
  next physical action here when you come back?” directly beneath it.
- The button, active input, and popup Save button use the same 0.6-opacity
  gradient. The popup card uses a quieter 0.3-opacity version so Save remains
  prominent. Keep the stronger gradient on the existing Next card unchanged.
- The automatic popup heading is the normal solid `Landing note` title. It has
  no per-letter rainbow and no project-directory suffix.
- Enter preserves the Notes input's existing save convention. Empty Enter does
  nothing. Clicking **Set landing note** again exits landing capture without
  writing a row and without clearing text already typed in the shared input.
- Manual capture never opens `LandingNoteModal`, starts a draft, installs a
  countdown, auto-skips, or writes a skipped metric.
- Saving uses the existing `repo.addNote(cwd, "landing", body, sessionId)`
  path, refreshes the side panel, and makes the note eligible for the existing
  highest-priority Momentum/Next slot.

### Explicit non-goals

- Replacing the automatic departure modal with an inline departure strip.
- Preserving half-written drafts across tab switches or relaunches.
- Adding a user-triggered “Draft for me” action to manual capture.
- Per-project capture preferences.
- Changing note schema, Momentum priority, skip-rate history, the extractor
  queue, extraction prompts, notifications, Attention Inbox, PTY behavior, or
  agent adapters.
- Treating ordinary residue notes as landing notes or merging the two kinds.

## Current state

- `src/App.tsx:221-238` owns activity/prompt refs and the single
  `landingPrompt` modal state.
- `src/App.tsx:291-309` implements `maybePromptLanding`; it currently has no
  preference gate and consumes activity only when it opens the modal.
- `src/App.tsx:585-611` invokes that coordinator on tab close.
- `src/App.tsx:1136-1163` invokes it when the active tab changes, after the
  fan-out/isolate suppression check.
- `src/App.tsx:1297-1315` persists automatic Save or Skip through
  `repo.addNote`.
- `src/components/LandingNoteModal.tsx:24-82` always starts a pre-draft when a
  session exists and always installs the 60-second timer.
- `src/components/SidePanel.tsx:1089-1115` renders **Notes and reminders** and
  a quick residue-note input for the active project.
- `src/components/SidePanel.tsx:342-372` reloads both the latest landing note
  and open residue notes. `src/components/SidePanel.tsx:569-600` already gives
  the landing note first priority in Momentum.
- `src/lib/repo.ts:692-738` is the exemplar for global presentation settings:
  typed getters/setters over the existing `settings` table with parsing at the
  boundary.
- `src/lib/repo.ts:811-847` is the only note data-access path required. The
  existing schema already supports manual landing notes; no migration is
  needed.
- `scripts/landing-check.ts` currently checks draft-response parsing only and
  is already the focused `npm run landing:check` gate.
- `docs/IDEAS.md:472-479` records the product direction: demote the modal to an
  opt-in preference and provide explicit, correctly targeted quick capture.

## Architecture constraints

- Keep all SQL in `src/lib/repo.ts`; `SidePanel` and `App` receive typed values
  and callbacks only.
- The preference affects UI coordination only. It must not modify ingestion,
  transcript handling, or PTY bytes.
- All preference and note failures fail open: they may affect the panel, never
  the terminal session or tab change.
- Transcript/agent text stays untrusted data. The automatic draft prompt and
  parser are unchanged.
- Do not add autonomous terminal input.
- Preserve existing untracked user directories (`Side Panel Fold/` and
  `graphify-out/`) and unrelated worktree changes.

## Scope

**Expected implementation files**:

- `src/types.ts`
- `src/lib/landing.ts`
- `src/lib/landingMode.ts`
- `src/lib/landingMode.ts` (implementation correction: isolates pure policy
  and avoids a `repo -> landing -> repo` import cycle)
- `src/lib/repo.ts`
- `src/App.tsx`
- `src/components/LandingNoteModal.tsx`
- `src/components/SidePanel.tsx`
- `scripts/landing-check.ts`
- `docs/TESTING.md`
- `docs/IDEAS.md`
- `docs/ROADMAP.md`
- `CLAUDE.md`
- `plans/README.md`

`package.json` is in scope only if the existing `landing:check` wiring needs a
non-semantic adjustment; it should not need one.

**Out of scope**:

- `src-tauri/**` and all migrations
- `src/lib/extractor.ts`, `src/lib/extractorQueue.ts`, and extraction prompt
  changes
- adapters, ingestion, notifications, Attention Inbox, Idea Board, PTY, and
  terminal components
- dependency or generated-file changes

## Implementation sequence

### Step 1: Add and persist the typed preference

Define `LandingNoteMode = "auto" | "manual"` in `src/types.ts`. Add a pure
parser in `src/lib/landingMode.ts` that returns Manual only for the exact stored
value and otherwise returns Auto. Add `getLandingNoteMode()` and
`setLandingNoteMode()` in `src/lib/repo.ts`, using a single global setting key
such as `landing_note_mode` and the existing private `getSetting` /
`setSetting` helpers. Do not add a migration.

**Verify**: `npm run landing:check` exits 0 with parser cases for `auto`,
`manual`, missing, and malformed values.

### Step 2: Make the App coordinator mode-aware

`App` owns the loaded mode because it owns departure detection. Add state plus
a ref used by `maybePromptLanding`; use the same touched-ref hydration pattern
as panel layout so a slow initial read cannot overwrite a human selection.
Load the setting during the existing initialization effect and fail open to
Auto.

In `maybePromptLanding`, preserve all current eligibility checks. When the
current mode is Manual, consume the activity marker and return before setting
`tabPromptRef`, opening modal state, or launching any draft. Pass mode and the
mode-change callback into `SidePanel`; manual note persistence stays in the
panel's existing Notes path.

On mode-change persistence failure, restore the prior mode in state/ref (or
surface a concise inline failure state). Never let a rejected settings promise
become unhandled.

**Verify**: `npm run landing:check` exits 0 with pure policy cases showing Auto
eligible departures prompt, Manual departures do not prompt and consume
activity, and returning to Auto requires new activity.

### Step 3: Put inline capture and the controls in Notes and reminders

Add typed props to `SidePanel` for the mode and async/on-change handler. Render
the Auto/Manual control in the expanded **Notes and reminders** section and a
rainbow-bordered **Set landing note** button near the existing residue input.
The button toggles local landing-capture state. Reuse the existing input and
Enter handler, selecting `"landing"` versus `"residue"` only at the existing
`repo.addNote` call. Reset capture mode after a successful landing save.

When capture is active, give the input a rainbow border and render the return-
action prompt directly below it. Preserve ordinary residue input/list behavior
when capture is inactive. Do not add a second text field or manual modal path.

The compact rail stays an icon and count only; clicking it already expands and
scrolls to Notes, where the controls become available. Do not crowd the compact
rail with a second landing-specific control.

The selection must expose pressed/selected state (`aria-pressed`, radios, or an
equivalent native pattern), have visible keyboard focus, and avoid a tiny
gear-only affordance.

**Verify**: `npm run landing:check`, `npm run panel-layout:check`, and
`npx tsc --noEmit` all exit 0.

### Step 4: Document and dogfood Phase 28

Add a Phase 28 manual matrix to `docs/TESTING.md`. Mark IDEAS item E as partly
delivered, explicitly leaving the inline-strip prototype deferred. Add the
scheduled/completed phase to `docs/ROADMAP.md`, and update `CLAUDE.md` and the
plan index only with outcomes actually observed; do not pre-mark manual checks.

Because no extraction prompt changes, do not run `npm run golden`.

**Verify**: `git diff --check` exits 0 and the manual matrix exists under a
unique Phase 28 heading.

## Automated verification

Run the focused check first, then the applicable repository gates:

```sh
npm run landing:check
npm run panel-layout:check
npm run opencode:check
npm run check
npx tsc --noEmit
npm run build
cd src-tauri && cargo test --lib
cd src-tauri && cargo clippy --all-targets -- -D warnings
git diff --check
```

Expected result: every command exits 0. Do not run `npm run golden` because
the extraction prompt must remain unchanged.

## Manual verification

Record results in `docs/TESTING.md`:

1. On an existing database with no preference key, Auto is selected and the
   current activity → switch → drafted 60-second modal flow still works.
2. Select Manual, relaunch, and confirm Manual persists.
3. In Manual, create agent activity and switch tabs repeatedly; no modal opens,
   no extractor process starts, tab switching remains responsive, and no
   skipped landing rows are written.
4. Switch back to Auto without new activity and leave the project; no stale
   prompt appears. Create new agent activity and leave again; one automatic
   prompt appears.
5. Click the rainbow-bordered **Set landing note**. Confirm the existing Notes
   input gains a rainbow border, receives focus, and shows the return-action
   prompt beneath it; no popup or draft starts. Both borders match the subtle
   opacity of the automatic popup's Save button rather than the brighter Next
   card treatment.
6. Click the button again. Confirm inline landing capture exits without writing
   a row and typed input remains available as an ordinary note draft.
7. Activate landing capture, type an action, and press Enter. Confirm it appears
   as the rainbow-labeled first Momentum/Next item and Done clears it through
   the existing path.
8. Repeat inline Save in Auto mode to prove explicit capture is always
   available and does not disturb the next automatic departure prompt.
9. Exercise tab close, fan-out, and isolate-loop switches in both modes.
   Existing suppression remains correct and no modal stacks.
10. Exercise expanded, compact, and hidden panel modes; the Notes rail route,
    counts, resize behavior, Lock-in presentation, terminal input, and keyboard
    shortcuts remain unchanged.
11. Simulate preference read/write failure. Terminals and tab switches keep
    working, and the control does not claim an unsaved selection succeeded.
12. Trigger the automatic popup. Confirm its 0.3-opacity card border is quieter
    than the 0.6-opacity Save button, and its solid heading reads only `Landing
    note`, with no project directory name or per-letter rainbow.

## Done criteria

- [x] Auto remains the compatibility default and preserves the existing ritual.
- [x] Manual mode persists across relaunch and produces no automatic modal or
      landing-draft extractor call.
- [x] Manual departures cannot trigger a stale prompt after Auto is re-enabled.
- [x] Notes and reminders owns an accessible Auto/Manual control and explicit
      Set landing note action.
- [x] Manual capture reuses the Notes input with rainbow styling, contextual
      prompt, Enter-to-save, and no popup/draft/countdown path.
- [x] Manual Save uses `kind='landing'` and the unchanged Momentum/Next path.
- [x] No migration, prompt, ingestion, adapter, PTY, or notification change.
- [x] Focused and aggregate automated gates pass.
- [x] Live manual evidence is recorded without marking unrun checks passed.
- [x] No unrelated tracked or untracked user work is modified.

## STOP conditions

Stop and request a plan revision if:

- The maintainer wants the preference per-project rather than global.
- “Manual” is intended to retain automatic prompting but only disable the LLM
  draft; that is a different mode contract.
- Manual capture must target the previously departed project rather than the
  active project represented by the Notes panel.
- Correct implementation requires a new table/migration, extractor prompt
  edits, autonomous terminal input, or any file under `src-tauri/`.
- The current code has moved landing coordination out of `App.tsx`, or the
  existing Notes/Momentum queries no longer share the `notes` table.
- A verification command fails twice after a reasonable correction.

## Maintenance notes

- Keep the preference check in the single App landing coordinator. Adding
  independent switch/close gates will let behavior drift.
- Manual and automatic capture intentionally converge only at
  `repo.addNote(..., "landing", ...)`; automatic capture drafts in a timed
  modal, while manual capture uses the shared inline Notes input.
- If the deferred inline-strip experiment is later scheduled, it should reuse
  this preference and manual-capture contract instead of adding a third mode.
- Review activity-marker consumption carefully: this is what prevents a stale
  automatic interruption after Manual is turned off.
