# Sidequest Plan 006 — Lock-in Header + 60-minute Timer Polish

> **Status (2026-09-09): BUILT — automated gates clean; live manual matrix
> pending.** This is a bounded follow-up to completed Sidequest 005. It does
> not accept Phase 26, alter its dogfood matrix, or authorize unrelated Phase
> 27 work.

## Gate exception

Phase 26 remains built but unaccepted. The operator requested this contained
Lock-in adjustment while that dogfood continues. Implementation begins only
after the operator approves this plan with:

`LOCK-IN POLISH ADJUSTMENT ACCEPTED`

## Outcome

Move the app-wide Lock-in control out of the compact/expanded side-panel
utilities and place one consistent text-pill-shaped control immediately to the
right of the persistent Fold/Expand project-panel button in the agent status
bar. Add a 60-minute timed Lock-in choice without changing the notification,
dock-badge, ingestion, evidence, or neutral-panel contracts delivered by
Sidequest 005.

## Product contract

### Header control

- When unlocked, show a compact pill with a neutral gray border containing two
  adjacent icon buttons: indefinite Lock-in, then timed Lock-in, separated by a
  small divider (`lock-in icon | timed lock-in icon`).
- Place the pill immediately to the right of the Fold/Expand project-panel
  button, before the flexible space and adapter-hook pills.
- Give each unlocked action its own button, label, title, and keyboard focus so
  the two choices are not one ambiguous click target.
- When either Lock-in mode is active, replace both choices and the divider with
  one Unlock icon button in the same bordered pill. The active duration is
  conveyed in its accessible label/title, not by color alone.
- Remove the duplicate Lock-in controls from both compact and expanded
  SidePanel utility areas. Lock-in state and neutral styling remain independent
  of whether the side panel is expanded, compact, or hidden.

### Timed Lock-in

- Indefinite Lock-in remains active until manually unlocked or the app
  relaunches.
- Timed Lock-in uses a fixed 60-minute duration beginning when its button is
  activated.
- At the deadline, it automatically returns to unlocked behavior: future OS
  notifications resume, the current dock badge count becomes visible, and
  category color/count emphasis returns from unchanged live state.
- Manual Unlock cancels any pending timed unlock. Switching modes is done by
  unlocking and choosing again; the collapsed active pill deliberately exposes
  only Unlock.
- Keep the mode and deadline app-session-only. Relaunching starts unlocked and
  does not restore or restart a timer.
- Timer setup and cleanup must be safe under React StrictMode and must not leave
  a stale callback able to unlock a newer Lock-in session.
- No countdown text, progress ring, custom duration, persistence, schedule,
  notification replay, or keyboard shortcut is added in this adjustment.

### Existing Lock-in behavior

All Sidequest 005 behavior remains unchanged while either mode is active:

- suppress OS notifications and clear the dock badge without dropping or
  delaying ingestion/evidence;
- retain top-tab state, badges, ages, glows, and all panel data/actions;
- neutralize side-panel emphasis and hide compact count badges;
- restore presentation and future delivery from current underlying state when
  unlocked.

## Implementation approach

1. Replace App's boolean-only toggle lifecycle with a small app-owned Lock-in
   mode (`off`, `indefinite`, or `timed`) while continuing to derive the boolean
   used by notification, dock-badge, and SidePanel presentation paths.
2. Add a single guarded 60-minute timeout for timed mode. Clear it on manual
   unlock, mode replacement, effect cleanup, and unmount; verify a stale
   callback cannot unlock a newer session.
3. Pass Lock-in mode plus explicit indefinite/timed/unlock callbacks into
   `AgentStatusBar`; render the bordered pill beside Fold/Expand.
4. Add the reserved `timed_lock.svg` shape to `PanelIcon` using
   `currentColor`, and reuse the existing Lock-in and Unlock shapes.
5. Remove SidePanel's Lock-in action props and its compact/expanded duplicate
   controls while retaining its read-only `lockIn` presentation prop.
6. Extend `lock-in:check` with pure timer/mode policy coverage and source-level
   wiring assertions for header placement, accessible actions, collapsed
   active state, SidePanel de-duplication, and timed-icon availability.
7. Add an unchecked manual matrix to `docs/TESTING.md`, then run the focused
   checks and applicable gates.

## Expected implementation files

- `src/App.tsx`
- `src/components/AgentStatusBar.tsx`
- `src/components/PanelIcon.tsx`
- `src/components/SidePanel.tsx`
- `src/lib/lockIn.ts`
- `scripts/lock-in-check.ts`
- `docs/TESTING.md`
- this plan and `plans/README.md`

No Rust, migration, repo query, database, adapter, transcript, extractor,
terminal, Attention ranking/routing, notification queue, or generated file is
in scope.

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

1. In expanded, compact, and hidden panel modes, confirm the gray bordered
   Lock-in pill stays immediately right of Fold/Expand and does not shift the
   adapter pills out of their established order.
2. While unlocked, keyboard-focus and activate each icon independently.
   Confirm labels/tooltips distinguish indefinite Lock-in from 60-minute
   Lock-in.
3. Activate indefinite Lock-in. Confirm the pill collapses to Unlock only,
   existing suppression/neutral presentation works, and manual Unlock restores
   live state.
4. Activate timed Lock-in. Confirm the pill collapses to Unlock only and the
   accessible copy identifies the 60-minute mode. Confirm manual Unlock before
   expiry prevents a later stale timer from changing a newer Lock-in session.
5. Run a shortened developer-timer probe and then the real-duration boundary:
   confirm timed mode automatically unlocks once at 60 minutes and restores
   future notification/dock/panel presentation behavior from live state.
6. Relaunch during either Lock-in mode. Confirm the app starts unlocked and no
   previous timer resumes.

## STOP conditions

- Timed expiry would require dropping, delaying, replaying, or mutating an
  ingestion event instead of changing only Lock-in delivery/presentation state.
- Moving the control would couple Lock-in state to `PanelMode` or prevent use
  while the side panel is hidden.
- Timer handling cannot prove cleanup against StrictMode or stale callbacks.
- Any implementation path would send terminal input or autonomously change a
  tab/session state.
