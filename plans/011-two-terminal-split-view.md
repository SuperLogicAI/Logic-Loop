# Plan 011: Two-terminal split view

> **Status**: BUILT for Phase 32; automated gates pass and the live matrix is
> pending. The maintainer explicitly bypassed the
> still-unrun Phase 31 live matrix and wrote `PHASE 32 ACCEPTED` on 2026-09-10.
> Phase 31 checks remain unmarked and must not be represented as passing.

## Outcome

Show two existing terminal tabs side by side so parallel agent sessions can be
observed without switching tabs. The control is a labeled **Split** pill beside
Lock-in and uses the maintainer-supplied `split_screen.svg` geometry.

## Product contract

- Split is an in-memory view over ordinary tabs, never a second terminal type.
- Activating Split creates one ordinary terminal through `openTab` in the
  focused tab's project cwd and shows the original and new tabs 50/50.
- At most two panes are visible. Both retain independent PTYs and tab tethers.
- The focused pane and matching top tab use a white 2px outline. The secondary
  pane/tab uses a softer blue 2px outline. Tab selection outlines omit the top
  edge so the project/bookmark color remains unobstructed above them. The side
  panel follows the focused pane.
- Selecting a visible tab focuses its pane. Selecting another tab replaces the
  focused pane without disturbing the other pane.
- Both visible panes count as viewed for unclaimed-result and notification
  suppression. Switching focus between them must not create a landing note.
- Closing either pane leaves the survivor full width. Turning Split off keeps
  the focused terminal visible.
- Split layout is not persisted. Relaunch restores sessions as ordinary tabs.
- No nested/horizontal splits, draggable divider, pane reordering, detached
  window, schema change, dependency, autonomous command, or terminal input.

## Scope

- `src/App.tsx`
- `src/components/AgentStatusBar.tsx`
- `src/components/PanelIcon.tsx`
- `src/components/TabBar.tsx`
- `src/components/Terminal.tsx`
- `src/lib/splitView.ts`
- `scripts/split-view-check.ts`
- `scripts/attention-inbox-check.ts` — keep its navigation contract aligned
  with the shared split-aware focus path
- `package.json`
- `README.md`
- `docs/ROADMAP.md`
- `docs/TESTING.md`
- `CLAUDE.md`
- `plans/README.md`
- this plan

## Verification

Run the focused split-view check first, then the repository gates from
`AGENTS.md`. Do not run `npm run golden`; extraction prompts are unchanged.

Manual acceptance covers independent input/output, pane focus and side-panel
routing, tab selection/reorder/close/exit, Lock-in and panel modes, terminal
paste/drop/selection, resize fitting, and safe non-persistence across relaunch.

Automated result (2026-09-10): focused check, all 25 aggregate frontend
checks, strict TypeScript, production build, Rust tests 58/58, clippy with
warnings denied, and diff whitespace validation pass. The existing Vite chunk
advisory is unchanged. The live matrix is `docs/TESTING.md` §44.
