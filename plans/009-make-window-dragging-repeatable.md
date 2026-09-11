# Plan 009: Make window dragging repeatable from the app chrome

> **Status**: DONE. The maintainer wrote `PHASE 30 APPROVED` on 2026-09-10
> after the deep chrome regions restored repeatable window movement and the
> explicit non-drag boundary restored project-tab pointer reordering. All
> automated gates pass; see `docs/TESTING.md` §42 for the live evidence and
> accepted residual manual coverage.

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. Stop
> at any condition in "STOP conditions" rather than substituting a broader
> titlebar redesign.
>
> **Phase gate**: This is the second item in the shell-papercuts sprint and a
> candidate for Phase 30. Do not promote it into `PLAN.md` or implement it until
> Plan 008/Phase 29 is accepted and committed, and the maintainer writes the
> literal token `PHASE 30 ACCEPTED`.
>
> **Drift check (run first)**:
> `git diff --stat a719acd..HEAD -- src/App.tsx src/components/TabBar.tsx src/components/BookmarksBar.tsx src/index.css src-tauri/tauri.conf.json src-tauri/capabilities/default.json package-lock.json src-tauri/Cargo.lock docs/TESTING.md plans/README.md`
> If any in-scope file changed, compare the current-state locations below with
> the live code before proceeding. Treat an incompatible mismatch as a STOP
> condition.

## Status

- **Priority**: P1
- **Effort**: S-M (targeted markup/config change plus mandatory live macOS
  verification)
- **Risk**: MED — drag regions share chrome with tab/bookmark reorder and rely
  on Tauri/macOS window behavior that automated DOM checks cannot prove
- **Depends on**: Plan 008 accepted and committed, only because repository
  phase boundaries serialize implementation; the code changes are independent
- **Category**: bug
- **Planned at**: commit `a719acd`, 2026-09-10

## Why this matters

The custom macOS chrome is intermittently immovable while Logic Loop is the
active app. The operator can reliably move it only after first clicking the
desktop or another app. This was already captured as a partial/failing result
in `docs/TESTING.md:309-317`, so the original custom-titlebar phase never met
its own usability contract.

The current markup uses bare `data-tauri-drag-region` attributes. In the
locked Tauri 2.11.5 implementation, a bare value recognizes only a click whose
direct event target is the marked element; the nested tab-strip and other
chrome descendants are not drag targets. Tauri 2.11.5 also supports
`data-tauri-drag-region="deep"`, which walks the composed path while
automatically stopping at buttons, inputs, links, interactive roles, or an
explicit `"false"` boundary. Use that supported behavior to make all
noninteractive chrome pixels consistent without stealing tab/bookmark actions.

Because Tauri documents additional macOS caveats for `titleBarStyle: Overlay`,
this plan is live-gated. If deep regions do not eliminate the repeated-active-
drag failure, stop with evidence rather than changing titlebar style, adding
private macOS APIs, or shipping a cosmetic pass that does not fix the report.

## Product contract

- While Logic Loop is already focused, the operator can move the window on the
  first attempt and repeat that gesture at least 20 times without focusing
  another app between attempts.
- The same drag begins on the first attempt while Logic Loop is unfocused; the
  first click is not consumed only to activate the app.
- The dedicated 28px titlebar and every noninteractive/empty pixel in the tab
  and bookmark bars are valid window drag targets, including nested layout
  containers.
- Tabs, bookmark chips, New, Fan out, Isolate loop, close buttons, menus, and
  form fields remain interactive and never move the window on an ordinary
  click or their established drag/reorder gesture.
- Tab and bookmark pointer reorder stays human-triggered and behaves exactly as
  before. Do not replace it with HTML5 drag/drop; the native webview file-drop
  handler still consumes DOM drop events.
- Double-clicking the dedicated titlebar retains native zoom/maximize behavior.
- File drag/drop into the terminal, terminal mouse selection, side-panel resize,
  and modal titlebar access remain unchanged.

## Current state

- `src-tauri/tauri.conf.json:13-20` uses `titleBarStyle: "Overlay"` plus
  `hiddenTitle: true`, so the webview owns the visible chrome and must define
  drag regions.
- `src/App.tsx:1247-1256` renders the dedicated 28px titlebar with a bare
  `data-tauri-drag-region`; its image and text are pointer-transparent.
- `src/components/TabBar.tsx:76-92` marks only the outer row with a bare drag
  attribute. The inner `.tab-strip` occupies the main tab-strip area, so clicks
  on its empty padding target an unmarked descendant under bare semantics.
- `src/components/TabBar.tsx:96-175` implements pointer-based tab reorder.
  Interactive tab elements must continue to block ancestor window dragging.
- `src/components/BookmarksBar.tsx:38-75` uses the same bare outer-region plus
  pointer-based bookmark reorder.
- The installed Rust dependency source for `tauri-2.11.5` documents the exact
  semantics in `src/window/scripts/drag.js`: bare/`true` means direct target,
  `deep` includes descendants, and clickable elements block a deep ancestor.
- `src-tauri/capabilities/default.json` grants `core:default`; its
  `core:window:default` set does not include `allow-start-dragging`. The current
  attribute path nevertheless invokes `plugin:window|start_dragging`. Confirm
  the generated/runtime permission behavior during the baseline rather than
  assuming a silent denial from source alone.
- `docs/TESTING.md:311-317` records the original failure: a drag may work once,
  then remain blocked until another app is focused; empty strip/bookmark-area
  dragging also failed.
- Official references for the executor:
  [Tauri titlebar customization](https://v2.tauri.app/learn/window-customization/)
  and [Tauri `Overlay` drag caveat](https://docs.rs/tauri-utils/latest/tauri_utils/enum.TitleBarStyle.html).

## Architecture constraints

- Keep the fixed Tauri v2/React stack. Do not adopt Electron CSS conventions,
  a third-party titlebar package, or an AppKit private-API workaround.
- Do not add window movement to terminal, panel, modal body, tab buttons, or
  bookmark buttons. The drag surface is noninteractive app chrome only.
- Preserve the native webview drag-drop listener and pointer-based reorder
  implementation.
- No autonomous PTY input, ANSI parsing, database change, ingestion change, or
  agent-adapter change belongs in this phase.
- A live macOS result is required. TypeScript/build success cannot prove native
  window movement.
- Preserve the unrelated untracked `Side Panel Fold/` and `graphify-out/`
  directories.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Version baseline | `npm run tauri info` | Reports Tauri 2.11.x packages and macOS; exit 0 |
| Markup audit | `rg -n 'data-tauri-drag-region="(deep|false)"' src` | Three intended chrome owners use `deep`; each interactive non-native tab uses `false` |
| Typecheck | `npx tsc --noEmit` | Exit 0, no TypeScript errors |
| Frontend build | `npm run build` | Exit 0 |
| Aggregate checks | `npm run check` | Every configured check exits 0 |
| Rust tests | `cd src-tauri && cargo test --lib` | All library tests pass |
| Rust lint | `cd src-tauri && cargo clippy --all-targets -- -D warnings` | Exit 0, no warnings |
| Whitespace | `git diff --check` | No output; exit 0 |

## Scope

**In scope — the only implementation files to modify:**

- `src/App.tsx` — deepen the dedicated titlebar drag region if baseline confirms
  the locked runtime supports it.
- `src/components/TabBar.tsx` — deepen the outer chrome region while preserving
  interactive descendants and pointer reorder.
- `src/components/BookmarksBar.tsx` — deepen the outer chrome region while
  preserving chips, add/edit/delete UI, and pointer reorder.
- `src-tauri/capabilities/default.json` — only if the baseline shows an ACL
  denial for `start_dragging`; add the narrow
  `core:window:allow-start-dragging` permission, not broader window access.
- `docs/TESTING.md` — add the Phase 30 live matrix and replace the old failure
  note only after the new matrix passes.
- `plans/README.md` — update Plan 009's status after execution.

**Out of scope:**

- `titleBarStyle` changes, removing the custom header, changing traffic-light
  layout, frameless windows, `macOSPrivateApi`, or direct AppKit calls.
- Dependency upgrades or lockfile edits. Tauri 2.11.5 already contains deep
  drag-region semantics; upgrading would confound the regression test.
- Replacing pointer reorder with HTML5 drag/drop or adding drag handles to tabs
  and bookmarks.
- Window position/size persistence, resizing behavior, terminal file-drop
  behavior, or general visual redesign.
- Source-shape tests that claim to prove native dragging. The live matrix is the
  acceptance test.

## Git workflow

- Use a focused branch such as `fix/window-drag-regions`.
- Keep this concern in one conventional commit, for example:
  `fix(window): make chrome drag regions repeatable`.
- Do not push or open a PR unless the operator explicitly requests it.

## Implementation sequence

### Step 1: Capture a reproducible baseline on the locked build

Run `npm run tauri info` and record the OS/Tauri versions in the Phase 30 test
section. Launch the development build and also test the currently installed
bundle if it differs. On the dedicated titlebar, inner tab-strip padding, outer
tab-row gap, and bookmark-bar empty space, record:

1. first drag while focused;
2. 20 consecutive focused drags;
3. first drag after focusing another app;
4. click/reorder behavior on interactive children;
5. any devtools console ACL rejection mentioning `start_dragging`.

Do not modify code before this baseline. The user's current report counts as
product evidence, but the executor needs exact hit-target and runtime evidence
to verify the fix.

**Verify**: the Phase 30 section records a failing baseline with OS, app mode
(dev or bundled), target region, and reproduction count. If the bug cannot be
reproduced on either build after 20 attempts per region, STOP and report rather
than making speculative markup changes.

### Step 2: Use Tauri's deep drag semantics on chrome containers

Change each of the three intentional bare drag attributes to the explicit value
`data-tauri-drag-region="deep"`:

- the dedicated titlebar in `src/App.tsx`;
- the outer tab bar in `src/components/TabBar.tsx`;
- the outer bookmark bar in `src/components/BookmarksBar.tsx`.

Do not add the attribute to individual buttons. Tauri 2.11.5's composed-path
logic blocks `BUTTON`, `INPUT`, links, editable elements, and interactive roles
before honoring a deep ancestor. Preserve existing pointer handlers and
`pointer-events-none` titlebar children unless live evidence proves one of them
is the direct failing target.

If the baseline logged an ACL denial, add only
`core:window:allow-start-dragging` to the main-window capability. If there was no
denial and dragging already works at least once, do not churn capabilities.

**Verify**: `rg -n 'data-tauri-drag-region="deep"' src` returns exactly three
chrome-owner matches; any interactive non-native descendant uses an explicit
`="false"` boundary. `npx tsc --noEmit` and `npm run build` exit 0.

### Step 3: Run the interaction matrix before accepting the approach

Repeat the same matrix on the modified development build. Pay special attention
to 20 consecutive drags while the app remains focused, because a one-time
success does not resolve the reported bug. Exercise tab reorder and bookmark
reorder immediately after window moves to catch pointer-state interference.

If every target meets the product contract, proceed. If nested empty areas now
work but a second focused drag still fails, revert the uncommitted experiment
or leave it clearly identified for review and STOP. The remaining issue is the
documented `Overlay`/native-drag behavior and needs an explicit product choice
between native/transparent titlebar tradeoffs; do not silently widen this phase.

**Verify**: the recorded matrix has 20/20 focused drags, first-attempt inactive
drag, working double-click zoom, tab/bookmark interactions, modal coverage, and
file-drop coverage.

### Step 4: Document the verified fix without erasing history

Keep the original July failure note in `docs/TESTING.md` as historical evidence.
Add the Phase 30 matrix and cross-reference it from the old section. Record the
exact build type and Tauri/macOS versions that passed. Do not mark Windows as
verified from a macOS run; the roadmap already treats Windows custom chrome as
an early-testing concern.

**Verify**: `rg -n "Phase 30|20/20|Window drag" docs/TESTING.md` finds both the
new matrix and historical section; `git diff --check` exits 0.

## Automated verification

After the live gate passes, run:

```sh
npm run opencode:check
npm run check
npx tsc --noEmit
npm run build
cd src-tauri && cargo test --lib
cd src-tauri && cargo clippy --all-targets -- -D warnings
git diff --check
```

Expected result: every command exits 0. Do not run `npm run golden`; no
extraction prompt changes.

## Manual verification

Record results in `docs/TESTING.md`:

1. Drag the dedicated titlebar 20 consecutive times while Logic Loop remains
   focused. Every attempt moves the window without an intervening desktop/app
   click.
2. Focus another app, then drag Logic Loop's titlebar once. It activates and
   moves on that same gesture.
3. Repeat the two tests from nested empty padding in the tab strip and empty
   bookmark-bar space.
4. Click, close, middle-click, and reorder tabs; click/reorder bookmarks; open
   bookmark context menus and add/edit forms. None accidentally moves the
   window or remains armed after pointer release.
5. Double-click the dedicated titlebar. Native zoom/maximize toggles normally,
   and a following single drag works immediately.
6. Open Landing Note and another overlay/modal. The visible dedicated titlebar
   still drags repeatedly while modal content remains interactive.
7. Drop a file into the active terminal, select terminal text, resize the side
   panel, and resize the native window edges. All established gestures remain
   intact.
8. Run the same matrix in the bundled app used for dogfooding, not only Vite
   dev mode. Record macOS and Tauri versions.
## Done criteria

- [ ] A failing pre-change baseline is recorded on the locked build.
- [ ] Only the three intended chrome containers are deep drag regions.
- [ ] Interactive descendants continue to block ancestor window dragging;
      non-native interactive containers such as project-tab `div`s use an
      explicit `data-tauri-drag-region="false"` boundary.
- [ ] Focused consecutive dragging passes 20/20 without leaving the app.
- [ ] Unfocused first-attempt drag, double-click zoom, modal access, pointer
      reorder, file drop, terminal selection, and resize all pass.
- [ ] No dependency/titlebar-style/private-API scope expansion occurred.
- [ ] Aggregate automated gates pass.
- [ ] Live results are recorded without rewriting the original failure as if it
      never occurred.
- [ ] No unrelated tracked or untracked user work is modified.

## STOP conditions

Stop and request a plan revision if:

- The baseline cannot reproduce the bug in dev or bundled mode.
- Deep regions fix nested hit targets but do not fix repeated dragging while
  focused; that points to the documented `Overlay` caveat rather than markup.
- Any tab, bookmark, button, input, or terminal interaction becomes a window
  drag target.
- Fixing the behavior requires changing `titleBarStyle`, removing custom chrome,
  enabling `macOSPrivateApi`, calling AppKit directly, or upgrading Tauri.
- Correct behavior differs materially between the development and bundled app.
- A verification command fails twice after a reasonable correction.

## Maintenance notes

- Bare and deep drag-region attributes have materially different semantics in
  Tauri 2.11.5. Any future nested chrome should live under one of these deep
  owners and use a native interactive element/role (or explicit
  `data-tauri-drag-region="false"`) when it must block dragging.
- Tauri's clickable-element guard is semantic, not based on React handlers. A
  `div` with `onClick`/pointer handlers is not automatically interactive to
  the injected script; mark it with `role="tab"` or an explicit `false`
  boundary before relying on pointer gestures beneath a deep region.
- Keep the 20-consecutive-drag acceptance case. A single successful movement is
  insufficient and was the reason the July manual check understated the bug.
- If the phase stops on the `Overlay` caveat, the follow-up should present the
  visual/accessibility tradeoff of `Transparent` or native `Visible` titlebars
  to the maintainer before implementation.
