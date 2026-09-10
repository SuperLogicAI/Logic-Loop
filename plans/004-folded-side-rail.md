# Plan 004: Add a folded side rail without hiding project context

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer dispatched you and told you they maintain
> the index.
>
> **Phase gate**: This is a reference-ready candidate for Phase 25, not an
> amendment to the active Phase 24 plan. Do not promote it into `PLAN.md` or
> implement it until Phase 24 is accepted and the maintainer explicitly chooses
> this plan as the next phase.
>
> **Drift check (run first)**:
> `git diff --stat 8eb3a3e..HEAD -- src/App.tsx src/types.ts src/lib/repo.ts src/components/SidePanel.tsx src/index.css scripts package.json docs/TESTING.md "Side Panel Fold"`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding. Phase 24
> is expected to change `SidePanel.tsx`, `repo.ts`, `package.json`, and
> `docs/TESTING.md`; reconcile those accepted changes first and treat any
> incompatible mismatch as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M (1–2 engineering days plus a live visual pass)
- **Risk**: LOW–MED — presentation-only, but keyboard handling, persisted
  layout, and scroll targeting can regress terminal space or focus behavior
- **Depends on**: Phase 24 accepted and committed
- **Category**: direction
- **Planned at**: commit `8eb3a3e`, 2026-09-08

### Approved implementation revision — 2026-09-09

The first live visual review explicitly revised the layout after the compact
rail landed. The persistent fold/expand control moves from SidePanel into the
left edge of `AgentStatusBar`; Sidebar LM moves from that bar into a second
expanded-panel utility row beside Notify; hook pills are alphabetized and
vertically aligned; expanded section headings reuse the compact icons; and a
functional GitHub/Git-log icon remains pinned at the compact rail bottom.
This expands the implementation scope to `src/components/AgentStatusBar.tsx`
and `src/components/SidebarLmControl.tsx`, and supersedes the earlier rule that
compact mode contains no Git affordance. It does not change Git operations,
hook behavior, extractor settings behavior, or terminal input.

### Accepted-phase visual follow-up — 2026-09-09

At the operator's request, Fan-out is no longer excluded from the compact
rail. When the active tab owns at least one fan-out group, show the existing
fan-out logo in purple beside the expanded card heading and as a conditional
compact-rail destination. The compact button expands the panel, opens the
first visible fan-out group, and scrolls to it. Also render the shared warning
triangle as an orange/pink outline with no fill while retaining its white
exclamation mark. No fan-out, warning, ingestion, or terminal semantics change.

## Why this matters

Logic Loop's side panel now contains re-entry context, notes, fan-out state,
the Next card, decisions, blockers, accomplished work, Git history, warnings,
and the commit footer. Keeping all of it visible competes with the terminal
for horizontal space and attention; hiding it completely removes the signals
the product exists to preserve. A narrow folded rail gives the terminal room
while retaining calm, glanceable evidence that context or obligations exist.

This phase builds only the layout/navigation foundation shown by the supplied
proofs of concept. It does not claim to implement Lock-In, notification
batching, or the cross-project Attention Inbox. Those controls must not appear
as inactive or misleading affordances before their underlying behavior exists.

## Product contract

### Panel modes

Use three independent presentation modes:

```ts
export type PanelMode = "expanded" | "compact" | "hidden";
```

- `expanded`: today's full, resizable panel. Restore the last persisted width.
- `compact`: a 48px icon rail. This is the ordinary low-noise state.
- `hidden`: no panel surface. Retain this only as an explicit secondary escape
  hatch for users who want every pixel; `Cmd/Ctrl+B` restores the previous
  non-hidden mode.

Panel mode is layout state, not notification state. Do not introduce a
`locked` boolean or couple compact mode to mute behavior. A later Lock-In
phase will derive its own independent focus state and may temporarily request
compact presentation without overwriting the user's preferred panel mode.

### Controls and shortcuts

- Change `Cmd/Ctrl+B` from expanded/hidden to expanded/compact.
- Add an accessible fold button to the expanded panel's pinned header.
- Add an accessible expand button to the compact rail.
- Preserve full hiding behind `Cmd/Ctrl+Shift+B`. When hidden, that shortcut
  or ordinary `Cmd/Ctrl+B` restores the last non-hidden mode.
- A click on a compact section icon expands the panel, expands that section if
  it is collapsible, and scrolls its heading into view after the expanded DOM
  has mounted. It must not change decision/blocker/note/result state.
- A click must not send bytes to xterm. The app-level shortcuts must call
  `preventDefault()` and remain intercepted by the existing global handler.

### Compact rail information architecture

Render top to bottom:

1. Project/session state dot and accessible label.
2. Adapter/transcript warning indicator, only when warnings exist.
3. Divider.
4. Since You Left, only when a delta exists.
5. Notes and Reminders.
6. Next, only when a momentum candidate exists.
7. Decisions, always; show the open count when nonzero.
8. Blockers, always; show the open count when nonzero.
9. Accomplished, always; show the unclaimed-result count when nonzero.
10. Divider.
11. Expand panel.

Do not put Global Attention mail, Lock-In, timed Lock-In, Git log, commit/push,
or fan-out controls in this first compact rail. Attention and Lock-In are not
built yet. Git and commit/push remain available by expanding the panel. Fan-out
continues to signal through the existing tab treatment and expanded panel; add
a compact fan-out affordance later only if dogfood shows it is missed.

### Visual behavior

- Rail width: exactly 48px, including its right border.
- Button hit targets: at least 40×40px; icon art: 20–22px.
- Use zinc-gray for inactive/empty icons. Apply the existing section accent
  only when that section has meaningful content:
  - Since You Left: teal when present.
  - Notes: zinc by default, brighter when open notes exist.
  - Next: yellow when a candidate exists.
  - Decisions: orange when open decisions exist.
  - Blockers: red when open blockers exist.
  - Accomplished: emerald only for unclaimed results; historical tool rows
    alone do not create an attention color.
- Counts use small neutral badges. Color must not be the only state signal.
- Use one divider between functional groups, not a border around every icon.
- Hover/focus uses a restrained zinc background. Visible keyboard focus must
  be distinct from category color.
- Every icon button has `aria-label`, `title`, and a stable `data-rail-section`
  value for manual inspection and future UI automation.
- The compact rail scrolls internally on short windows. Keep project state and
  expand controls pinned if the viewport cannot fit all section buttons.

## Current state

### Application ownership

`src/App.tsx:51-65` owns tabs, the active tab, and the current binary rail
visibility:

```ts
const [tabs, setTabs] = useState<Tab[]>([]);
const [activeId, setActiveId] = useState<string | null>(null);
// ...
const [railOpen, setRailOpen] = useState(true);
```

`src/App.tsx:884-891` maps `Cmd/Ctrl+B` directly to that boolean:

```ts
const mod = e.metaKey || e.ctrlKey;
if (mod && e.key === "b") {
  e.preventDefault();
  setRailOpen((o) => !o);
}
```

`src/App.tsx:1042-1065` mounts `SidePanel` only while `railOpen` is true. The
new mode remains App-owned; pass mode/change callbacks into `SidePanel` rather
than letting two components maintain competing layout state.

### Side panel ownership

`src/components/SidePanel.tsx:136-173` already owns all data needed by the
compact rail: decisions, blockers, notes, delta, momentum inputs, unclaimed
results, width, and warnings from props. Do not issue a second set of repo
queries from a sibling compact component.

`src/components/SidePanel.tsx:541-570` clamps live resizing to 192–512px but
does not persist the width:

```ts
const next = resizeStart.current.width + (ev.clientX - resizeStart.current.x);
setWidth(Math.min(512, Math.max(192, next)));
```

`src/components/SidePanel.tsx:562-614` renders a pinned header followed by
warnings and the scrollable body. Compact mode should be a render branch
inside this same mounted component so it can reuse the loaded read model.

`src/components/SidePanel.tsx:660-1225` renders the scrollable sections.
Section identities already exist in `toggleSection` as `since-left`,
`decisions`, `blockers`, `accomplished`, and `gitlog`. Add stable identities
for Notes and Next rather than identifying DOM nodes from visible text.

### Persistence convention

`src/lib/repo.ts:501-569` stores UI preferences in the existing `settings`
key/value table. The Idea Board helpers are the exemplar: typed get/set
functions parse values, provide a safe default, and use upsert. Follow this
pattern for global panel mode and width; no migration is needed.

Use global keys, not per-project prefixes:

```text
panel_mode
panel_width
panel_last_visible_mode
```

Invalid/missing mode values default to `expanded`. Invalid/missing width
defaults to 288. Clamp loaded and newly resized widths to 192–512. Persist
width once on pointer-up, not on every pointer move.

### Icon convention and supplied candidates

The untracked `Side Panel Fold/` folder contains 24px SVG candidates with a
Material-style `viewBox="0 -960 960 960"`. Their paths currently hard-code
`fill="#e3e3e3"`, which prevents state coloring. Match the existing inline
SVG convention used by `Chevron` in `SidePanel.tsx:59-77` and
`IdeaBoard.tsx:20-37`: create a typed `PanelIcon` component whose root uses
`fill="currentColor"`, `aria-hidden="true"`, and accepts a class name.

Use these supplied path shapes in this phase:

- `since_you_left.svg`
- `notes_reminders.svg`
- `next.svg`
- `decisions.svg`
- `blockers.svg`
- `accomplished.svg`

Keep these reserved and unused until their features ship:

- `global_mail_read.svg`
- `global_mail_unread.svg`
- `lock_in_DND.svg`
- `timed_lock.svg`
- `unlock_DND_off.svg`

Do not add an icon package or SVG loader. Do not edit or delete the user's
candidate folder. The runtime component owns normalized path data; the folder
remains design-source material.

### Verification conventions

Fast checks are plain `tsx` scripts using `node:assert/strict`; model the new
check after `scripts/board-check.ts`. Add the new check to `package.json`'s
aggregate `check` chain. There is no separate lint command. Do not run
`npm run golden` because no extraction prompt changes.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused check | `npm run panel-layout:check` | Prints `panel-layout-check: all assertions passed`; exit 0 |
| Aggregate checks | `npm run check` | Every configured check exits 0 |
| Typecheck | `npx tsc --noEmit` | Exit 0, no TypeScript errors |
| Frontend build | `npm run build` | Exit 0 |
| Rust tests | `cd src-tauri && cargo test --lib` | All tests pass |
| Rust lint | `cd src-tauri && cargo clippy --all-targets -- -D warnings` | Exit 0, no warnings |
| Whitespace | `git diff --check` | No output; exit 0 |

## Scope

**In scope — the only implementation files to modify:**

- `src/types.ts` — add `PanelMode` if the type must cross App/component/repo.
- `src/lib/panelLayout.ts` — create pure mode/width transition helpers.
- `src/lib/repo.ts` — global panel-mode/last-visible-mode/width persistence.
- `src/App.tsx` — load layout, own transitions, update keyboard behavior, pass
  the mode to `SidePanel`.
- `src/components/PanelIcon.tsx` — create the typed current-color icon set.
- `src/components/SidePanel.tsx` — compact render branch, controls, counts,
  section refs/scroll targeting, and width persistence on resize completion.
- `src/index.css` — only if a small scrollbar or focus treatment cannot be
  expressed consistently with existing Tailwind utilities.
- `scripts/panel-layout-check.ts` — pure layout-state regression coverage.
- `package.json` — add the focused check to scripts and aggregate `check`.
- `docs/TESTING.md` — record the new manual phase section and results.
- `README.md` — add one concise shipped-feature bullet only after acceptance.
- `plans/README.md` — update this plan's status after execution.

**Design inputs, read-only during implementation:**

- `Side Panel Fold/*.svg`
- `/Users/vandershark/Desktop/Locked-in DND.png`
- `/Users/vandershark/Desktop/unlocked.png`

**Out of scope — do not touch even if adjacent:**

- `src/lib/notify.ts` and all notification delivery behavior.
- Attention Inbox query/ranking/UI from
  `plans/001-cross-project-attention-inbox.md`.
- Lock-In, timed Lock-In, notification batching, focus-session persistence, or
  “let questions through.”
- Per-project mute behavior and its existing header control.
- Agent ingestion, adapters, transcripts, extractors, Rust migrations, PTY
  commands, or terminal input.
- Decision/blocker/result semantics, claim behavior, Momentum ordering, or
  Idea Board behavior.
- Git/commit footer behavior.
- New dependencies or a component/icon framework.
- Editing, deleting, or relocating the supplied proof assets.

## Git workflow

- Begin only after Phase 24 is accepted and committed with a clean
  understanding of its changes.
- Suggested branch: `feat/phase25-folded-side-rail`.
- Use small conventional commits matching repository history, for example:
  `feat(phase25): add persisted folded side rail` and
  `docs(phase25): record folded rail verification`.
- Do not push or open a PR unless the operator explicitly requests it.
- Preserve every unrelated staged or unstaged user change. Never reformat
  adjacent code as part of this phase.

## Steps

### Step 1: Establish pure panel-layout transitions

Create `src/lib/panelLayout.ts` with named constants and pure helpers:

```ts
export const PANEL_DEFAULT_WIDTH = 288;
export const PANEL_MIN_WIDTH = 192;
export const PANEL_MAX_WIDTH = 512;
export const PANEL_COMPACT_WIDTH = 48;

export function parsePanelMode(value: string | null): PanelMode;
export function clampPanelWidth(value: number): number;
export function togglePanelMode(
  current: PanelMode,
  lastVisible: Exclude<PanelMode, "hidden">
): { mode: PanelMode; lastVisible: Exclude<PanelMode, "hidden"> };
export function togglePanelHidden(
  current: PanelMode,
  lastVisible: Exclude<PanelMode, "hidden">
): { mode: PanelMode; lastVisible: Exclude<PanelMode, "hidden"> };
```

Required semantics:

- Ordinary toggle: expanded ↔ compact; hidden → last visible mode.
- Hidden toggle: visible → hidden while remembering it; hidden → remembered
  visible mode.
- Invalid stored modes parse as expanded.
- Width parsing/clamping never produces `NaN` or an out-of-range value.

Add `scripts/panel-layout-check.ts` covering every transition, invalid mode,
`NaN`, below-minimum, above-maximum, and boundary widths. Add
`panel-layout:check` to `package.json` and its aggregate `check` chain.

**Verify**: `npm run panel-layout:check` → all named assertions pass and the
script prints its success line.

### Step 2: Persist and restore global layout preferences

In `src/lib/repo.ts`, add typed helpers following the Idea Board settings
pattern:

```ts
getPanelMode(): Promise<PanelMode>
setPanelMode(mode: PanelMode): Promise<void>
getPanelLastVisibleMode(): Promise<"expanded" | "compact">
setPanelLastVisibleMode(mode: "expanded" | "compact"): Promise<void>
getPanelWidth(): Promise<number>
setPanelWidth(width: number): Promise<void>
```

Parsing and clamping must delegate to `panelLayout.ts`; do not duplicate
fallback rules. Repo errors remain fail-open in the caller. Do not add a
migration because the existing `settings` table is sufficient.

In `App.tsx`, replace `railOpen` with App-owned `panelMode` and
`lastVisiblePanelMode`. Load both once after database initialization, retaining
safe expanded defaults if the read fails. Persist only completed user
transitions. Avoid a startup flash that writes defaults over an existing
setting before the async read returns.

Keep `SidePanel` mounted in expanded and compact modes. Do not mount it while
hidden. Pass the current mode and callbacks rather than allowing
`SidePanel` to write App layout state independently.

**Verify**: `npx tsc --noEmit && npm run panel-layout:check` → both exit 0.

### Step 3: Build the reusable icon component

Create `src/components/PanelIcon.tsx` with an explicit icon-name union and a
path map for the six in-scope candidate SVGs plus simple fold/unfold controls.
The component must:

- render one `<svg>` with a consistent 24×24 CSS box;
- preserve each source viewBox;
- use `fill="currentColor"` for supplied filled icons;
- use `aria-hidden="true"` and `focusable="false"` because the surrounding
  button owns the accessible name;
- accept `className` without accepting arbitrary raw SVG/HTML.

Do not render external SVGs through `<img>` and do not use CSS filters to
approximate category colors.

**Verify**: `npx tsc --noEmit && npm run build` → both exit 0.

### Step 4: Add the compact rail without duplicating data loading

Extend `SidePanel` props with `mode`, `onModeChange`, and a width-persistence
callback or keep width persistence encapsulated through the typed repo helper.
Prefer the smallest interface that leaves App authoritative for mode.

Inside the existing `SidePanel` component, derive compact signals from data
already loaded by `reload()`:

- `openDecisions.length`
- `open.length` for blockers
- `unclaimed.length`
- `notes.length`
- `delta !== null`
- `momentum !== null`
- warnings from `adapterWarnings`, `blindPaths`, and `sessionBlind`

Return a compact branch when `mode === "compact"`. Do not introduce a sibling
component that calls repo functions independently. The compact branch must
retain the same outer right border and full available height, use one internal
scroll area, and expose the ordered controls in the Product contract.

Add a small reusable `RailButton` local to `SidePanel.tsx` or a separate
component only if it remains presentation-only. It takes an accessible label,
icon, optional count, accent/active state, section key, and click handler.
Counts greater than 99 render as `99+`.

Do not show the global-mail or lock icons yet. Do not make empty sections look
urgent. Warning indicators must distinguish warning presence through shape or
label as well as color.

**Verify**: `npx tsc --noEmit && npm run build` → both exit 0.

### Step 5: Connect section navigation and resize persistence

Give each expanded destination a stable ref keyed by:

```text
since-left
notes
next
decisions
blockers
accomplished
```

When a rail control is clicked:

1. Remember the target key in a ref or state owned by `SidePanel`.
2. Remove that key from `collapsed` where applicable.
3. Request expanded mode through the App callback.
4. In an effect that runs after expanded mode mounts, call
   `scrollIntoView({ block: "start" })`, then clear the pending target.

Do not use arbitrary timeouts. Do not query headings by their visible copy.
Notes and Next need refs even though they do not currently participate in the
`collapsed` set.

Update horizontal resizing to track `liveWidth`, exactly as Idea Board tracks
`liveHeight`, and persist the clamped width once on pointer-up. Loading compact
mode must not overwrite the stored expanded width with 48.

Add the fold button to the expanded header and expand control to the compact
rail. Keep the existing project mute button unchanged.

**Verify**: `npm run panel-layout:check && npx tsc --noEmit && npm run build` →
all exit 0.

### Step 6: Wire keyboard behavior without leaking keystrokes

In the existing `App.tsx` keyboard effect:

- `Cmd/Ctrl+B`: call the pure ordinary toggle, update App state, persist mode
  and last-visible mode, and `preventDefault()`.
- `Cmd/Ctrl+Shift+B`: call the pure hidden toggle with the same persistence
  behavior and `preventDefault()`.

Match keys case-insensitively so Shift does not cause a missed branch. Keep
the handler before unrelated shortcuts. Do not add terminal-specific parsing
or writes.

If xterm still receives either shortcut during the live manual test, add the
narrow key interception needed to `Terminal.tsx` and explicitly expand this
plan's scope before editing it. Do not silently edit `Terminal.tsx` because
the current global handler may already be sufficient.

**Verify**: `npm run check && npx tsc --noEmit && npm run build` → all exit 0.

### Step 7: Record live visual and interaction evidence

Add a numbered section to `docs/TESTING.md` for the promoted phase number.
Run the manual matrix below on macOS at both a wide window and the narrowest
practical window. Record date, build/commit, pass/fail, and concrete observed
results. Do not mark the phase accepted yourself.

Only after the implementation has passed all gates and the phase is accepted,
add a concise README shipped-feature bullet and update the plan status.

**Verify**: `git diff --check` → no output; inspect `git status --short` and
confirm every changed file is in scope or is a pre-existing user change.

## Test plan

### Automated

`scripts/panel-layout-check.ts` must cover at least:

1. Missing/invalid persisted mode defaults to expanded.
2. Expanded ordinary toggle becomes compact.
3. Compact ordinary toggle becomes expanded.
4. Hidden ordinary toggle restores the remembered visible mode.
5. Expanded hidden toggle remembers expanded and becomes hidden.
6. Compact hidden toggle remembers compact and becomes hidden.
7. Hidden hidden-toggle restores the remembered mode.
8. Width clamps below 192 to 192 and above 512 to 512.
9. Width keeps exact values at 192, 288, and 512.
10. Non-finite width falls back to 288.

The script should import the production helpers, not reimplement them.

### Manual

1. Start expanded at a custom width, compact, expand, and confirm the custom
   width returns. Relaunch and confirm the chosen mode and width restore.
2. Exercise `Cmd+B` from expanded, compact, and hidden. Exercise
   `Cmd+Shift+B` from each visible mode and restore. Confirm no characters
   appear in the active terminal.
3. Populate decisions, blockers, notes, a Next candidate, a Since You Left
   delta, and an unclaimed result. Confirm presence/count/accent rules exactly
   match the Product contract.
4. Click each compact icon. Confirm the panel expands, the correct destination
   is visible, collapsed sections open, and no decision/blocker/result is
   changed or claimed merely by the click.
5. With adapter and transcript warnings present, compact the panel and confirm
   a visible warning indicator remains with explanatory tooltip/accessible
   copy.
6. Shrink the window vertically. Confirm rail content remains reachable,
   project state and expand controls stay available, and no icon overlaps the
   terminal or Idea Board.
7. Confirm the expanded panel's mute, resize, section collapse, commit footer,
   context modal, and blocker/decision actions behave as before.
8. Confirm the compact rail contains no nonfunctional Inbox or Lock-In icons.

## Done criteria

- [x] `npm run panel-layout:check` exits 0 and prints its success line.
- [x] `npm run check` exits 0 with the new check in the aggregate chain.
- [x] `npx tsc --noEmit` exits 0.
- [x] `npm run build` exits 0.
- [x] `cd src-tauri && cargo test --lib` passes.
- [x] `cd src-tauri && cargo clippy --all-targets -- -D warnings` exits 0.
- [x] `git diff --check` produces no output.
- [x] The compact rail is exactly 48px and all controls have at least 40px hit
  targets plus `aria-label` and `title`.
- [x] Ordinary compact mode, explicit hidden mode, section routing, warning
  visibility, persisted width, and relaunch restoration pass the manual matrix.
- [x] No Inbox, Lock-In, notification, ingestion, claim, or PTY semantic was
  added or changed.
- [x] No dependency or database migration was added.
- [x] `docs/TESTING.md` contains dated manual evidence.
- [x] No unrelated user change was overwritten.
- [x] `plans/README.md` reflects the actual execution status.

## STOP conditions

Stop and report; do not improvise if:

- Phase 24 is not accepted and committed before implementation begins.
- Drift in `App.tsx`, `SidePanel.tsx`, `repo.ts`, or `package.json` invalidates
  a current-state excerpt or creates overlapping layout work.
- The supplied `Side Panel Fold/` icon candidates are missing or their paths no
  longer match the named concepts.
- Correct section routing appears to require remounting terminals, changing
  active tabs, claiming results, or sending PTY input.
- A reliable compact rail appears to require duplicating repo queries or
  moving the entire SidePanel read model into App; report the discovered
  constraint before widening architecture.
- Persisting UI settings requires a migration or new dependency.
- The global shortcut still reaches xterm and fixing it requires changes beyond
  a narrow documented key interception.
- Any verification command fails twice after a reasonable correction.
- Work would require editing an out-of-scope file without explicit maintainer
  approval.

## Maintenance notes

- The later Attention Inbox should occupy a new top-level rail slot below the
  project state and above project-local section icons. Its badge must come from
  one App-owned Attention snapshot, not from a second compact-rail query.
- The later Lock-In phase must introduce independent `FocusMode` state. It may
  derive an effective compact presentation while active, but it must preserve
  and restore the `PanelMode` preference built here.
- Keep reserved mail/lock icons unused until their controls are real. A disabled
  future-feature affordance would misrepresent product capability.
- Reviewers should scrutinize shortcut propagation, async startup persistence,
  scroll-to-section timing, width restoration, and whether compact mode hides
  adapter/transcript warnings.
- If dogfood shows complete hiding is unused or confusing, remove it in a
  separately approved cleanup; do not broaden this first phase during build.
