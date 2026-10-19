# Drag and reorder Idea Board cards

Status: **Approved 2026-10-19 (`PHASE 67 APPROVED`) with one revision: cards
also reorder within a column. Accepted 2026-10-19 (`PHASE 67 ACCEPTED`).**

Source: maintainer request 2026-10-19 ("I hate the current dropdown menu to
move them").

Estimated effort: under half a day. UI-only, one component. No SQL, no
migration, no Rust, no new dependency.

## Problem

Each card carries a full-width status `<select>` (`IdeaBoard.tsx`). It is the
only way to change a card's column, and it adds a row of chrome to every card.

## Scope

Done = dragging a card's header drops it at the pointed slot: another
column changes its status, the same column reorders it, List view reorders
only; the per-card dropdown is no longer visible.

Revision at approval: within-column reorder added. Card order is file order,
so reordering Planned changes Momentum's "top planned card"; that is intended.

Revision 2026-10-19 (maintainer request after first installed-app pass): the
board-view `<select>` in the expanded header becomes List / Kanban / Workflow
text pills, same markup as SidePanel's landing-notes mode toggle. Folded bar
unchanged (no view control there). Also fixed: WebKit text selection mid-drag
(see docs/TESTING.md).

Out of scope: auto-scroll near a scrolled column's edge, touch-specific
gestures.

## Approach

- **Pointer events, not HTML5 `draggable`.** The webview's native drag-drop
  handler (`App.tsx` `onDragDropEvent`, needed for file drops) swallows DOM
  drop events; `TabBar.tsx` hit the same wall and uses pointer events.
- Card header row is the drag handle (`cursor-grab`, `select-none`). A drag
  starts after ~4px of movement, so clicks on title/star/color/delete still
  work. Column under the pointer is found with
  `document.elementFromPoint(...).closest("[data-board-col]")`; the slot is
  before the first card whose midpoint is below the pointer, else the end.
- Write = `dropCard` (`boardModes.ts`): move the card's block verbatim to the
  slot (`placeCard` in `board.ts`), then splice the new status if it changed.
  A drop into the card's current visible slot writes nothing, even when the
  file has other columns' cards in between.
- Feedback: source card dims, target column gets a ring, a small title pill
  follows the cursor, insertion bar marks the slot. Pointer up over a column
  writes through the existing read-before-write path; anywhere else,
  `pointercancel`, or a missed pointerup (buttons released) does nothing.
- Listeners are window-level and torn down on drop and on unmount, same
  pattern as the existing dock resize.
- **Keyboard fallback kept:** the select stays in the DOM as
  `sr-only focus:not-sr-only` — invisible until tabbed to, so keyboard and
  screen-reader users can still move cards. In List view it is the only way
  to change status.
- Pointer capture once a drag starts, so releasing outside the window still
  ends it.
- Disabled while the board is busy/loading (same guard as other mutations).

## Steps (each with its check)

1. Drag wiring + visuals in `IdeaBoard.tsx`. *Check:* preview harness
   (vite + mockIPC + playwright-cli) drags a card Idea → Building in Workflow
   and To do → Done in Kanban; board file content shows the new status.
2. Hide select behind focus. *Check:* Playwright focus reveals it and
   changing it still moves the card; List view drag reorders only.
   `board:check` covers `placeCard`/`dropCard` (verbatim blocks, no-op slots,
   unterminated last card, kanban/list status rules).
3. Gates: `npm run check`, `npx tsc --noEmit`, `npm run build`,
   `git diff --check`. Rust untouched.
4. Manual installed-app pass recorded in `docs/TESTING.md`: drag in the real
   Tauri webview (pointer capture / drag-region behavior can differ from the
   harness), click-without-drag still expands, external edit during drag
   surfaces the existing "card removed or renamed" error.
