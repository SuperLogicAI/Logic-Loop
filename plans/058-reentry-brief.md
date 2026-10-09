# Compact re-entry brief

Status: **APPROVED 2026-10-08 (`PHASE 58 APPROVED`, decisions 1-4 as
recommended). Branch `feat/phase-58-reentry-brief`. Built; gates green;
awaiting live checks (TESTING.md items 80-85) and acceptance.**

Source: `docs/IDEAS.md` "B. Compact re-entry brief — extends Phase 14's
delta, not a new panel", next in that file's suggested sequence (inbox,
shipped as Phase 26 → re-entry brief → focus mode → departure capture).
The ask is presentation, not new data.

## What exists

- **Since You Left** (Phase 14a, `SidePanel.tsx` ~1101) is already the top
  card of the side panel (info-tinted, collapsible, tour target
  `since-left`). It lists files changed, commands run (failed), turns ·
  stops, new decisions, and the agent's last words; a loop run (Phase 15)
  swaps in an iteration digest. Shown only when the tab has a `tab_left`
  anchor *and* the delta is non-empty.
- Everything else the brief needs is already loaded in `SidePanel.reload()`:
  `landing` (your open landing note), `plannedCard` (board Now card or top
  planned), `gitBranch`/`gitDirty`, open `decisions`, `agentState`, and
  `momentum` (the Next cascade, Plan 052).
- Section jumps exist (`RailSection` refs + `scrollIntoView`), and the diff
  pop-out exists for files.

So the brief is a re-layout of one card plus a pure function. No ingestion,
no migration, no Rust, no model call.

## Build

1. **`buildBrief()`** in `src/lib/delta.ts`, pure: inputs are the `Delta` (or
   loop iterations), `lastLeft` ts, `landing`, Now card, `gitBranch`/
   `gitDirty`, `agentState`, decisions opened since, `momentum` text, `now`.
   Returns `{ leftAgo, context, goal, youLeft, changed, needsYou, next }`,
   each field a short string (or null) plus what its evidence link targets.
   Deterministic, no prose generation.
2. **Card layout** (replaces the Since You Left body, keeps its card, title,
   collapse key and tour target):

   ```
   SINCE YOU LEFT · 23m ago
   Logic Loop · claude · feat/phase-58 ●          ← project · agent · branch (● = dirty)
   Goal: Compact re-entry brief                    ← Now card title; line hidden if none
   You left   "Write plan 058 and get approval"    ← your landing note; "no note" if none
   Changed    3 files · 5 commands (1 failed) · 4 turns
   Needs you  2 new decisions · agent waiting      ← "nothing" when empty
   Next       Answer: which goal source?           ← momentum text
   ▸ agent's last words                            ← existing text, now collapsed by default
   ```

   Labels are a fixed-width left column so the four fields scan as a list.
   *Revision (2026-10-08, build):* Next is hidden when it repeats You left —
   the Next cascade starts at the landing note, so with an open note both
   fields would show the same text. The compact rail's Since You Left icon
   follows the brief's visibility. Section links scroll even when the panel
   is already expanded (`openRailSection` now bumps a tick).
   *Revision 2 (live check 80):* failed commands were never counted —
   Claude Code reports them as `PostToolUseFailure`, which the Phase 14
   delta ignored; now counted (interrupts excluded, failed edits aren't
   changed files). The context line wraps instead of truncating, which hid
   the dirty ●.
   *Revision 3 (live check 81):* Changed is a toggle (with chevron) only
   when there are files or a loop digest to open; with commands only it was
   underlined but opened nothing.
   *Revision 4 (live check 81):* the opened file list / loop digest now
   sits inside the Changed row (it rendered below Next).
   *Revision 5 (live check 84):* Next is also hidden when it repeats the
   Goal (the cascade's second step is the Now card).
   *Revision 6 (maintainer, live check 84):* the card is titled **Progress**
   (no age) when everything it counts happened after you came back to the
   tab (Plan 057's `tab_entered`), i.e. you watched it live; otherwise
   **Since you left · Nm ago**. Contents and links are identical.
3. **Evidence one click away.** Changed → file names expand inline; each
   opens the existing diff pop-out. Needs you → jumps to Decisions. Next →
   jumps to the Next card. A loop run shows "N iterations" in Changed and
   expands to the existing iteration digest.
4. **When it shows.** A `tab_left` anchor exists *and* any field has
   content: agent activity, a landing note, or something that needs you
   (Decision 3). A tab you've never left still shows nothing.
5. **Check.** `scripts/delta-check.ts` cases for `buildBrief`: full brief;
   no Now card (goal hidden); no landing note; nothing needs you; loop run;
   dirty vs clean branch; empty everything → null (card hidden).
6. **Docs.** `docs/PROGRESS.md`; `docs/TESTING.md` Phase 58 items; IDEAS.md
   B marked shipped.

## Decisions (defaults marked; confirm or change at approval)

1. **Placement.** **Replace the Since You Left card's body** (default):
   one card, same spot, nothing new to learn; the brief is a superset.
   Alternative: add the brief above the existing card (more to scroll).
2. **Goal source.** **Board Now card only** (default): an explicit human
   pick. Alternative: fall back to the top planned card when there's no Now
   card (always a goal, but sometimes not the one you're on).
3. **Show without agent activity.** **Yes** (default): coming back to a tab
   where you left a note or a decision is waiting is still a re-entry.
   Alternative: keep today's rule (only when the agent did something).
4. **Agent's last words.** **Collapsed by default** (default): the brief
   should fit without scrolling; one click opens it. Alternative: always
   shown as today.

## Out of scope

- Home dashboard's "Since you left" card (unchanged).
- Any LLM summary (IDEAS B: "never a fresh LLM summary").
- Review queue / seen-vs-reviewed (IDEAS C), focus mode (D), lighter
  departure capture (E).

## Verify

- `npm run delta:check` (new `buildBrief` cases), `npm run check`,
  `npx tsc --noEmit`, `npm run build`, `cd src-tauri && cargo test --lib`,
  `cargo clippy --all-targets -- -D warnings`, `git diff --check`.
  No golden (no prompt change).

## Manual checks (docs/TESTING.md Phase 58)

Run in the built app.

- [ ] 80. Leave a Claude tab, let the agent edit files and run commands,
      come back: brief shows correct age, branch, Changed counts; Lock-in
      turns it grey.
- [ ] 81. Click a file in Changed: diff pop-out opens for that file.
- [ ] 82. With an open decision from while you were away: Needs you counts
      it; clicking jumps to Decisions.
- [ ] 83. Leave a landing note, come back with no agent activity: brief
      still shows You left + Next.
- [ ] 84. Set a board Now card: Goal line shows it; clear it: line hidden.
- [ ] 85. A tab never left: no brief.
