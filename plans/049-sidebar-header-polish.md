# Sidebar header hierarchy, attached fold control, and Home icon

Status: **Phase 49 ACCEPTED — maintainer wrote `PHASE 49 ACCEPTED` 2026-10-03.**

Maintainer requested this sprint after Phase 48 acceptance. Use the recommended
project-scoped Notify baseline. Approved addition: reserve scrollbar space and
inset sidebar content/actions so notes, cards and resolved-blocker dismiss
buttons remain clear of the scrollbar. Shared app controls and a portaled
Sidebar LM popover are in scope; no notification-policy changes.
Created 2026-10-02 from the maintainer's layout discussion and reference image.
Assigned Phase 49 after recorded `PHASE 48 ACCEPTED`. Phase 49 acceptance
remains pending; honor the literal `PHASE N ACCEPTED` boundary.

Estimated effort: one focused UI sprint (roughly 0.5–1 day plus live checks).

## Problem and intended result

Traffic currently sits alongside terminal Lock-in and split controls despite
being a secondary, router-wide inspection view. The sidebar's model settings
and global Inbox appear beneath/alongside project context, blurring scope.
The fold button floats in the terminal toolbar rather than visibly belonging
to the panel it folds. Header spacing is uneven. Home already has a text
button beside terminal tabs and should gain the supplied icon.

Create a sidebar header aligned in height and vertical center with the terminal
toolbar, put broader-scope controls above project context, connect the fold
control to the sidebar boundary, and add the Home icon. Preserve all existing
navigation, terminal, traffic, Inbox, and project mute behavior.

## Design direction and one decision to resolve

The initial proposal was `Sidebar LM · Traffic · notify` in the sidebar.
The discussion evolved toward a top row aligned with the terminal toolbar,
potentially `Sidebar LM · Traffic · Notify · Global Inbox`.

Approved baseline for this sprint:

```text
Sidebar LM · Traffic       Inbox [3]  │ attached fold · Lock-in · split …
─────────────────────────────────────┼─────────────────────────────────
project: context_terminal     notify  │ terminal
session status                       │
─────────────────────────────────────│
project panel content                │
```

- Match the existing terminal toolbar height (currently `h-10`), rather than
  making the sidebar controls larger merely to signal broader scope.
- Keep Sidebar LM and Traffic adjacent; place Inbox at the right of the sidebar
  header. Use the short visible label `Inbox` if space permits, with its existing
  count/stale/loading/badge-preference semantics and a global-scope tooltip.
- Traffic uses the quiet styling and button height of its neighbors, rather than
  inheriting unnecessary prominence from terminal controls. Tooltip:
  `View Safe Router traffic across all projects`. Do not imply project filtering:
  the existing modal displays the latest 100 routed requests globally.
- Retain project name and session/quiet status below the header. Keep project
  `notify`/`muted` right-aligned in that project row.
- **Resolved product decision (2026-10-03):** Keep project mute as below.
  Original discussion: the maintainer floated Notify in the global
  row; the scope-preserving baseline above was recommended but not explicitly
  selected. Current Notify mutes the selected project. Do not silently make it
  global or present it as global. At sprint planning, select the baseline or
  explicitly approve an app-wide notification control and define its interaction
  with project mute, OS permission, and Lock-in. That behavioral expansion is
  outside this baseline estimate.
- Provide access to Traffic, Sidebar LM, and Inbox with the sidebar collapsed
  or hidden. Prefer compact rail access when folded; retain a shell-level entry
  when hidden. Resolve exact placement during the initial layout pass, avoiding
  duplicate prominent expanded-state buttons. Check Home/Overview availability
  too, since the current workspace header is hidden on those surfaces.

## Attached fold control and spacing

Durable visual reference: [current (top) and concept (bottom)](assets/sidebar-header-polish/fold-reference.png).

- Follow the lower concept: a flush left edge attached to the sidebar/terminal
  boundary and a rounded right end projecting into the terminal toolbar.
  This unique silhouette belongs to folding, distinct from the freestanding
  Lock-in and split pills.
- Align its vertical center and visible height with neighboring controls;
  preserve a generous whole-shape hit target and consistent gaps to Lock-in
  and split. Use one explicit gap convention, not compounded wrapper padding.
- Keep the control anchored to the panel's moving boundary during resize and
  in expanded, folded-rail, and hidden states. Use the existing mode transitions;
  arrow/icon reverses for expansion. Do not introduce a new panel mode.
- Avoid doubled seams where the button meets the panel border. Verify both
  hover and keyboard focus outlines remain visible through overflow containers.
- Entire shape is clickable, with accessible name and tooltip switching between
  `Collapse project panel` and `Expand project panel` as appropriate to the
  actual next action. Preserve visible focus and current keyboard access.

## Home icon

The supplied asset is at `Side Panel Fold/home.svg`; a durable copy is preserved
as [home.svg](assets/sidebar-header-polish/home.svg). Its artwork is a stacked
folder/settings motif; use the supplied artwork, not a substitute house icon.

At implementation, copy it to `public/home.svg` and render it before the existing
`Home` label in `TabBar.tsx`, matching neighboring tab-action icon sizing
(start at 16px). Keep the text, existing active styling, tour target, accessible
name, and click behavior. Use decorative `alt=""` so the icon does not duplicate
the accessible label. Check the supplied fixed light fill against normal,
hovered, and active backgrounds. Adding the icon must not make Home draggable
or change the window's drag regions.

## Implementation map and suggested sequence

Re-read `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, Plans 004/022/048 and the
current phase status before starting. Recheck these touchpoints against the
current branch; the UI may have moved since this capture.

1. `src/App.tsx`: owns panel mode, Traffic modal and Inbox state; currently
   renders SidePanel next to a workspace column containing AgentStatusBar.
   Plan the shared header/boundary geometry here without remounting terminals.
   Pass callbacks/state to their new owners; preserve shell modal ownership.
2. `src/components/SidePanel.tsx`: currently has project/session + Inbox header,
   then SidebarLmControl + project mute row, plus a separate folded rail branch.
   Add aligned broader-scope header and relocate project mute; preserve resize,
   rail navigation, counts, Lock-in styling and project scoping.
3. `src/components/AgentStatusBar.tsx`: currently owns the standalone fold and
   Traffic buttons. Remove expanded-state Traffic after its replacement exists;
   attach fold to the boundary and normalize spacing. Preserve Setup/Tour,
   split, Lock-in, adapters, overflow and drag boundaries.
4. `src/components/SidebarLmControl.tsx`: keep settings behavior; ensure its
   dropdown remains visible and usable after relocation, including narrow rail
   access. Use a portal only if required by clipping; do not change extraction.
5. `src/components/TabBar.tsx` and `public/home.svg`: add supplied icon to Home.
6. Check `PanelIcon.tsx` and existing rail patterns for icon reuse before adding
   icons. Update tour target wiring only where relocation requires it.

Suggested scope: React layout/styles/prop wiring and static asset only. No SQL,
migration, Rust, router, ingestion, adapter, extraction-prompt, or notification
policy changes. State any plan revision before implementation.

## Acceptance and verification

- Expanded sidebar header and terminal toolbar align; app controls precede
  project context. Project mute still affects only the selected project.
- Traffic opens the existing global modal from the new location; refresh,
  Escape, focus containment and return focus work. Inbox retains global items,
  navigation, stale/loading states and badge preference behavior.
- Fold control looks attached in expanded and rail states, remains reachable
  when hidden, changes icon appropriately, and follows resizing without jumps
  or doubled borders. No clipped hover/focus outlines or uneven toolbar gaps.
- Check minimum sidebar width, normal width, narrow window, 200% zoom, expanded/
  rail/hidden modes, single/split terminals, Lock-in, Home and Project Overview.
  Header controls must not collide with project text or resize targets.
- Keyboard-only operation and tooltips correctly describe scope and action.
  Home icon is visible beside its label in inactive/active/hover states; Home
  navigation, return-to-workspace, tab reorder and window dragging still work.
- Folding/resizing/navigation does not respawn, remount, or send input to any
  running terminal. Terminal focus and sizing recover normally.

Run focused checks first: `npm run panel-layout:check`, `npm run model-traffic:check`,
`npm run attention-inbox:check`, `npm run dashboard:check`, `npm run onboarding:check`,
`npm run split-view:check`, and `npm run lock-in:check`. These check behavior;
live visual verification is still required for the CSS/layout changes.

Then run the applicable repo gates: `npm run opencode:check`, `npm run check`,
`npx tsc --noEmit`, `npm run build`, and from `src-tauri`, `cargo test --lib`
and `cargo clippy --all-targets -- -D warnings`; finish with `git diff --check`.
Run full `cargo test` before a PR per CONTRIBUTING. Do not run golden because
no extraction prompts change. Avoid tests that only mirror CSS implementation.

Record actual manual results and screenshots in a new sprint section of
`docs/TESTING.md` when implemented; this idea capture claims no live passes.
Deliver the final layout for review before marking its eventual phase accepted.

## Implementation outcome — 2026-10-03

Baseline and scrollbar addition implemented. Shared SidebarControls provides
expanded/compact/hidden and dashboard entries; at minimum panel width labels
become icons with accessible names. Home retains its existing Inbox entry.
Sidebar LM uses a portal with Escape/Close focus return. Existing split-view
source assertion was updated to follow Traffic artwork to its new owner.
Automated gates pass; isolated browser visual preview passed. Release-app
checks remain pending in docs/TESTING.md. Phase 49 is not accepted.

## Approved live-review follow-up — 2026-10-03

Maintainer requested larger compact Sidebar LM/Traffic art; a connected Home
tab with top/side zinc outline and brighter hover border; Tour above Home
instead of the terminal toolbar; resolved blockers behind a default-collapsed
Cleared Blockers control; and only the newest unclaimed completion initially
above Accomplished tool activity. Older completion notices remain accessible
behind a count toggle; no source rows are hidden permanently or claimed.
This is a Phase 49 UI revision, no database or notification changes.

Follow-up implementation complete; automated gates pass. See docs/TESTING.md
for remaining rebuild/live checks. Maintainer acceptance is still pending.

## Approved Setup/hook cohesion follow-up — 2026-10-03

Maintainer authorized a shared muted sky-blue outline for Setup and adapter
hook buttons in every enabled/disabled/checking state, brighter on hover/focus.
Retain status text, existing state fills, actions and popup behavior. Apply the
same outline to Home's Setup entry for consistent navigation. UI styling only.

## Approved scrollbar refinement — 2026-10-03

Maintainer's rebuilt screenshots show excess right whitespace and native
scrollbar hover expansion. Replace the stacked stable gutter/24px padding
with a scoped fixed 8px custom scrollbar and 8px right content padding.
Reserve the scroll lane consistently; hover changes thumb color only.
Retain inset dismiss targets; do not alter compact rail or terminal scrollbars.

## Approved Isolate Loop color follow-up — 2026-10-03

Maintainer authorized orange for the Isolate Loop launcher outline, isolated
worktree tab glow and its settings modal accents, distinguishing this action
from blue Setup/hooks. Preserve launch/worktree behavior and other tab colors.

## Phase 49 acceptance — 2026-10-03

Maintainer reviewed the rebuilt UI and wrote `PHASE 49 ACCEPTED`, then requested
a PR for the complete UI overhaul. This closes all approved follow-ups. Prior
unrun manual scenarios remain disclosed in docs/TESTING.md, not marked passed.
