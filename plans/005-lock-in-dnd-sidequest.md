# Sidequest Plan 005 — Lock-in / Do Not Disturb

> **Build outcome (2026-09-09): DONE.** All automated gates and the live macOS
> manual matrix pass. Phase 26 remains unaccepted and its dogfood matrix is
> unchanged.

## Gate exception

The operator explicitly authorized this sidequest on 2026-09-09 while Phase
26 remains built but unaccepted because its dogfood requires more time. This
does not mark Phase 26 accepted, remove any Phase 26 manual checks, or permit
unrelated Phase 27 work.

Implementation begins only after the operator approves this plan with:

`LOCK-IN SIDEQUEST ACCEPTED`

## Outcome

Add an app-wide Lock-in mode that reduces side-panel visual noise and silences
operating-system interruptions without stopping agents, changing ingestion,
discarding evidence, or hiding live state from the top tabs.

Lock-in is independent from `PanelMode`. Folding, expanding, and hiding the
side panel while locked-in must not turn Lock-in off, and toggling Lock-in must
not overwrite the user's persisted panel mode or expanded width.

## Product contract

### Notification delivery

While Lock-in is active:

- suppress every OS notification emitted by Logic Loop, including waiting,
  finished, and stalled-agent nudges;
- clear/suppress the macOS dock badge;
- continue recording events, state transitions, decisions, blockers,
  unclaimed results, and Attention evidence exactly as before;
- continue showing tab state dots, ages, glows, and existing tab badges;
- preserve queued/unseen in-app state so it reappears normally after Lock-in
  is turned off.

No digest, delayed notification replay, timer, schedule, waiting-event
exception, or notification queue is added in this sidequest.

### Side-panel presentation

While Lock-in is active, both compact and expanded modes use a quiet zinc/gray
presentation:

- section icons, headings, card borders, card backgrounds, fan-out treatment,
  warning treatment, Attention control, and Git treatment lose category accent
  colors;
- compact-rail count badges are hidden, including Attention, notes, decisions,
  blockers, and accomplished counts;
- compact warning and Attention indicators remain available as neutral icons
  so information is not destroyed or misrepresented as absent;
- expanded warning rows and Attention counts remain readable but neutral, not
  urgent-colored;
- section content remains present and readable; Lock-in changes emphasis, not
  the SQL/read model or section eligibility;
- Notes and Reminders remains fully editable and clearable;
- Blockers remains fully addable, resolvable, reopenable, and clearable;
- all other existing section actions remain unchanged.

Turning Lock-in off restores the existing category colors and badges from the
unchanged underlying state.

### Controls and lifecycle

- Add the reserved `lock_in_DND.svg` and `unlock_DND_off.svg` shapes to
  `PanelIcon` with `currentColor`.
- Add an accessible Lock-in toggle to both compact and expanded side-panel
  utility areas. Use icon shape, `aria-pressed`, label, and title so state is
  not communicated by color alone.
- Keep Lock-in app-session-only for this bounded sprint. Relaunching starts
  unlocked so a stale persisted preference cannot silently suppress alerts.
- Do not add a keyboard shortcut in this sidequest.

## Implementation approach

1. Add App-owned `lockIn` state plus a ref for the ingestion notification hot
   path. Pass state and the toggle into `SidePanel`.
2. Extend the pure notification predicate so Lock-in suppresses every OS
   nudge without changing unclaimed-result rules. Use the same state when
   deriving the dock badge count.
3. Add the two reserved lock icons to `PanelIcon` and render the toggle in
   compact and expanded panel utility areas.
4. Centralize Lock-in-aware side-panel class selection enough to keep the
   compact and expanded presentations consistently neutral without changing
   queries or duplicating markup/read models.
5. Add a focused `lock-in:check` covering notification suppression,
   unclaimed-state independence, dock-badge derivation, control wiring,
   independent panel mode, neutral styling, hidden compact counts, and icon
   availability. Add it to `npm run check`.
6. Add an unchecked manual matrix to `docs/TESTING.md`, then run all gates.

## Expected implementation files

- `src/App.tsx`
- `src/lib/ingest.ts`
- `src/components/PanelIcon.tsx`
- `src/components/SidePanel.tsx`
- `src/index.css` — scoped neutral-color overrides for the locked-in panel
- new `src/lib/lockIn.ts` only if a small pure presentation/dock helper keeps
  policy testable without coupling it to React
- new `scripts/lock-in-check.ts`
- `package.json`
- `docs/TESTING.md`
- this plan and `plans/README.md`

No Rust, migration, repo query, database, adapter, transcript, extractor,
terminal, Attention ranking/routing, or generated file is in scope.

## Verification

Run in order:

```sh
npm run lock-in:check
npm run notify:check
npm run panel-layout:check
npm run attention-inbox:check
npm run check
npx tsc --noEmit
npm run build
cd src-tauri && cargo test --lib
cd src-tauri && cargo clippy --all-targets -- -D warnings
git diff --check
```

Do not run `npm run golden`; extraction prompts are unchanged.

## Manual matrix

1. Enable Lock-in from expanded mode. Confirm OS notifications and the dock
   badge stop while top-tab session state and badges continue updating.
2. Confirm expanded panel sections remain readable in monochrome, warning and
   Attention treatments are neutral, and Notes/Blockers retain every action.
3. Fold the panel while locked-in. Confirm all compact icons are gray, every
   compact count badge is hidden, and conditional icons retain their existing
   presence rules.
4. Expand, hide, and restore the panel. Confirm Lock-in stays active and the
   saved panel preference/width is unchanged.
5. Turn Lock-in off. Confirm current colors, warning treatments, counts, dock
   badge, and future OS notifications resume from live underlying state.
6. Relaunch after leaving Lock-in enabled. Confirm the app starts unlocked.

## STOP conditions

- Suppressing notifications would require dropping, delaying, or mutating an
  ingestion event rather than gating only delivery/presentation.
- Neutral styling would require duplicating a SidePanel read model or hiding
  data/actions rather than changing their presentation.
- The compact/expanded toggle would overwrite persisted `PanelMode` or width.
- Any implementation path would send terminal input or change tab/session
  state autonomously.
