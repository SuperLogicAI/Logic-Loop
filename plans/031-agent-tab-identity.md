# Phase 35 Plan — Agent identity icons in terminal tabs

## Phase gate

Accepted 2026-09-19 with the literal token `PHASE 35 ACCEPTED`.

Implemented and approved 2026-09-19. The maintainer wrote the literal token
`PHASE 35 APPROVED` after reviewing the live tab layout and all six agent
icons. The broader regression matrix in `docs/TESTING.md` §59 remains
recorded without claiming unrun cases.

**Accepted layout revision, 2026-09-19:** after the first live screenshot, the
maintainer requested a two-row tab. The top row groups the status bulb,
state/quiet age, auto-turn indicator, and right-aligned blocker/decision
counts. The bottom row groups the agent icon and project name. The close button
stays visible on the bottom row instead of appearing only on hover.

**Live refinement:** the first two-row screenshot showed the bottom-row close
button truncating ordinary project names. The close button moves to the top
row after the counts, tab side padding tightens, and the agent icon drops from
16 px to 14 px. The bottom row is reserved for agent/project identity.

**Second live refinement:** agent/title spacing is 4 px, blocker/decision
badges are separated by 2 px, and the close control sits flush against the
tab's right edge.

**Third live refinement:** vertical row spacing drops from 4 px to 2 px and
top padding drops from 6 px to 4 px; bottom padding stays unchanged so tabs
remain visually joined to the terminal pane.

**Fourth live refinement:** top padding drops to 2 px and bottom padding to
4 px, retaining the 2 px gap between rows.

**Final live refinement:** bottom padding returns to 4 px after a 5 px trial.

Planned 2026-09-19 against clean `main` at `f021068`. The only working-tree
content is the maintainer-supplied, untracked `agents/` asset folder.

## Goal

Show the active agent's icon directly after the tab status bulb and before all
other tab content, so activity state and agent identity can be read together.

## Current contract

- `TabBar.tsx` already renders the status bulb first and the project title
  later in the same flex row.
- `Tab.agent` is populated from structured hook identity and restored session
  bindings. It must remain the source of adapter identity; terminal output is
  never inspected.
- Claude is the one legacy adapter whose trusted hooks omit an explicit agent
  marker. Existing code treats an absent adapter on an observed/restored
  session as Claude. A brand-new shell tab has neither a session nor agent
  state and must not be labeled prematurely.
- Supplied assets:
  - `agents/claude.svg` → Claude
  - `agents/codex.svg` → Codex
  - `agents/agy.svg` → Antigravity
  - `agents/dsh.svg` → DeepSeek
  - `agents/opencode.svg` → OpenCode
  - `agents/pi.svg` → Pi

## Implementation

1. Add a small typed mapping beside the tab presentation code from adapter ID
   to imported SVG URL and human-readable agent name.
2. Resolve the tab icon as follows:
   - use `tab.agent` when it matches a supplied adapter;
   - treat an absent adapter as Claude only when the tab already has a
     `sessionId` or `agentState`;
   - render no icon for a fresh shell or an unknown adapter.
3. Render a compact two-row tab. Put status, state/age, auto-turn, and counts on
   top, including the always-visible close button after the counts; reserve the
   bottom for the fixed 14 px agent image and project name. Give the icon and
   close button useful accessible names. Preserve reorder behavior and tab
   width limits.
4. Keep the maintainer-supplied SVG files in `agents/` and import them through
   Vite so production builds fingerprint and package the assets. Do not edit or
   regenerate the artwork.
5. Add a focused manual coverage entry to `docs/TESTING.md` for icon order,
   mapping, fresh-shell behavior, restored Claude behavior, truncation, and
   active/inactive tab readability.

## Expected file scope

- `agents/*.svg` — add the supplied assets to version control unchanged
- `src/components/TabBar.tsx` — asset mapping, trusted identity resolution,
  and icon rendering
- `docs/TESTING.md` — manual visual coverage
- `PLAN.md` and `plans/031-agent-tab-identity.md` — phase record

No database, migration, Rust, hook command, ingestion, or terminal behavior
changes are planned.

## Verification after implementation

Run the frontend gates because the change is React and asset-only:

```bash
npm run check
npx tsc --noEmit
npm run build
git diff --check
```

Then run the documented app check with at least Claude and one explicitly
marked adapter. Confirm the two-row hierarchy stays legible on active and
inactive tabs and no agent icon appears on a fresh shell.

`cargo test`, clippy, and `npm run golden` are not applicable because this
phase changes no Rust or extraction prompt.

## Acceptance criteria

- Known agent identity is visible beside the status bulb without parsing PTY
  output or guessing from command text.
- A fresh shell is not mislabeled as Claude.
- Claude is shown after structured activity and on a restored Claude session.
- Codex, OpenCode, Antigravity, DeepSeek, and Pi use the supplied matching
  artwork.
- Unknown adapters fail open with no broken image.
- Existing tab selection, close, reorder, overflow, badges, glows, and
  truncation still work.
- Required frontend gates pass and manual results are recorded.
