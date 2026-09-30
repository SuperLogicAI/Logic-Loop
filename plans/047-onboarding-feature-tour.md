# Phase 47: Guided feature tour for first-run onboarding

## Gate and status

Drafted and accepted with the literal `PHASE 47 ACCEPTED` on 2026-09-28.
Planned against `main` at `6568600`. Origin: the maintainer's own rough design (glowing
cursor, spotlight cards, `n of N` progress, `>` next / `X` skip), refined
below against the existing codebase and architecture invariants.

## Problem

`OnboardingModal.tsx` (444 lines) is 100% agent-CLI detection: pick a folder,
toggle adapter hooks, launch a tab. It never explains what the side panel
does. A visitor arriving from a public/launch post opens the app, sees mostly
empty panels (Decisions, Since You Left, Momentum, Idea Board, Attention
Inbox), and has no agent running yet to populate them. Nothing on screen
tells them why any of it matters. That first 60-90 seconds is the actual
conversion moment for a cold visitor, and today it's unaddressed.

## Goal

A short, skippable, spotlight-style tour that walks a first-run profile
through each side-panel section and the header controls that matter, then
never runs again unless its version is bumped or the user reopens it from the
header. Purely additive UI overlay — no seeded/fake rows in the DB, no change
to ingestion, panels, or any existing check.

## Explicit non-goals

- No fake decision cards, since-you-left digests, or idea-board cards written
  into the real panels. Panels are dumb SQL views over real event data
  (architecture invariant 3, CLAUDE.md) — seeding demo rows through the UI
  layer breaks that, and risks a real user mistaking a demo card for a real
  one. The tour's own popup cards carry illustrative copy instead.
- No idea-board mode toggles (kanban/agile/brainstorm) — separate ask,
  deferred, out of scope here.
- No change to Setup/`OnboardingModal.tsx`'s own flow beyond chaining the
  tour after it closes.

## Design

**Trigger.** Reuses the pattern already in `AgentStatusBar.tsx` for Setup
(`repo.getOnboardingVersion()` / `setOnboardingVersion()`, gated by a bumpable
`ONBOARDING_VERSION` const). Add a parallel, independently-versioned pair:
`getTourVersion()` / `setTourVersion()` in `src/lib/repo.ts`, keyed
`tour_version` in the existing `settings` table — separate key from
`onboarding_version` on purpose, same reasoning already documented at
`repo.ts:860` for `HAS_LAUNCHED_SESSION_KEY` vs `ONBOARDING_VERSION_KEY`
(dismissing Setup and having seen the tour are different facts; a future
tour redesign should be able to re-show itself without re-forcing Setup).
Auto-start fires once, from `closeSetup()` in `AgentStatusBar.tsx`, only when
`tour_version` is stale — so it appears right after a fresh profile finishes
Setup, not mid-session for an existing user. Also reachable any time via a
new "Tour" button next to the existing "Setup" button in the header (same
row, same style, `AgentStatusBar.tsx:263`).

**Overlay mechanics.** New component `src/components/FeatureTour.tsx`,
sibling to `OnboardingModal.tsx`, reusing its dialog/focus-trap pattern
(`dialogRef`, `closeRef`, Escape-to-close). Each step names a
`data-tour-target="<id>"` attribute added to the relevant existing DOM node
(no visual change on its own). The tour reads that node's
`getBoundingClientRect()` on mount and on resize/scroll, draws a dimmed
full-screen overlay with a CSS `clip-path` cutout around the target (glow
ring via `box-shadow`, no new dependency — stdlib CSS covers this per
ponytail), and anchors a popup card next to the cutout, flipping side if it
would overflow the viewport.

**Card content.** Top row: `{step} of {total}` counter + `Skip tour` text
link. Body: one-line title + one-to-two sentence explanation of that
section, matching the language already in the README's panel table (Decision
Tracker / Accomplished / Since You Left / Blockers / Landing Note / Momentum
/ Idea Board / Attention Inbox) so the copy is consistent everywhere.
Bottom row: `X` (close tour entirely) and `>` (next card) per the maintainer's
draft, plus `<` (back) since it's a one-line addition once the step index is
already tracked. Keyboard: `Esc` = close, `→`/`Enter` = next, `←` = back —
matches the existing keyboard-safety conventions from Plan 035.

**Step list** (order matches on-screen top-to-bottom layout in
`SidePanel.tsx`, ~8 cards, target ~8-10s/card for the 60-90s budget):
1. Decisions — the fork-tracking panel (ties to README's "Decision debt"
   pitch, the strongest hook — lead with this one, not last).
2. Since You Left — the re-entry digest.
3. Accomplished — unclaimed results.
4. Blockers.
5. Momentum — next-action suggestion.
6. Idea Board dock.
7. Attention Inbox (`Cmd/Ctrl+K`) — cross-project rollup.
8. Header controls — Lock-in, Split, Setup/Tour buttons as one combined card.

**Fail open.** If a target's `data-tour-target` node isn't mounted (panel
folded, window too narrow, section conditionally hidden), skip that step
silently rather than erroring — the tour must never block or crash the
terminal underneath it (architecture invariant 2 applies to this overlay too,
even though it's UI-only: a broken tour must never take the app down with
it).

## Required sequence after acceptance

1. Add `data-tour-target` attributes to the eight target regions in
   `SidePanel.tsx` and the header controls in `AgentStatusBar.tsx`. Additive
   only — no other changes to those files' existing logic.
2. Add `tour_version` get/set to `src/lib/repo.ts`, mirroring the
   `onboarding_version` pattern exactly (same `settings` table, same
   `INSERT ... ON CONFLICT` upsert already in `setSetting`).
3. Build `src/components/FeatureTour.tsx`: overlay, spotlight cutout, card,
   step list, keyboard handling, focus trap. No new npm dependency.
4. Wire trigger + reopen button into `AgentStatusBar.tsx`: auto-start after
   `closeSetup()` when `tour_version` is stale; header "Tour" button next to
   "Setup" for manual reopen at any time.
5. Record a manual test entry in `docs/TESTING.md`: fresh profile → Setup
   close → tour auto-starts on card 1/8 → click through all 8 → Skip on card
   3 dismisses fully → reopen via header "Tour" button restarts from card 1
   → Esc closes → resize to a narrow window mid-tour doesn't crash (targets
   that go missing are skipped, not fatal).
6. Update `docs/PROGRESS.md` and this repo's root `PLAN.md` per the existing
   phase-close convention.

## Scope and checks

Expected files: `src/components/FeatureTour.tsx` (new),
`src/components/AgentStatusBar.tsx`, `src/components/SidePanel.tsx`,
`src/lib/repo.ts`, `docs/TESTING.md`, `docs/PROGRESS.md`, `PLAN.md`. No
migration (reuses the existing `settings` table). No Rust changes expected.

Run `npx tsc --noEmit`, `cd src-tauri && cargo clippy --all-targets -- -D
warnings && cargo test --lib`, `npm run check`, `npm run build`, and `git
diff --check`. Do not run `npm run golden` — no extraction prompt changes.
Live manual check per Step 5 above, macOS, before phase close.

## Implementation notes after acceptance

- The overlay uses a large box shadow around the target for the dimmed
  spotlight instead of the planned clip path. This keeps the cutout and glow
  in one element without a new dependency.
- `App.tsx` owns tour visibility and version writes because it also owns the
  panel mode. `AgentStatusBar.tsx` supplies the Setup-close and Tour-button
  callbacks.
- The step list refreshes while the tour is open so sections mounted by a
  compact-to-expanded transition can join the tour. Absent conditional
  sections remain skipped. The popup clamps to the viewport when a target is
  taller than the window, and Tab remains within the popup controls.
- Manual testing in `docs/TESTING.md` §69 passed the rebuilt-app regression
  cases. Fresh-profile auto-start and a real Since You Left digest are still
  pending, so the phase remains open.
