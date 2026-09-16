# Plan 021: Make first-run project access contextual

> **Status**: CANDIDATE, planning only. This plan targets accepted `main` at
> `2a4c481`, after Phase 32. The current `fix/descope-auto-reconciliation`
> checkout contains unaccepted Phase 33 work; do not build this sprint on it or
> import its changes by implication. The literal `PHASE 32 ACCEPTED` is
> already recorded and satisfies the phase boundary for Phase 33, but approval
> of the abandoned Phase 33 plan does not approve this replacement scope. The
> maintainer must explicitly approve this specific plan before implementation.
>
> **Executor instructions**: Start from accepted `main`, read this entire plan,
> run the drift check, and keep each step within the listed scope. Stop at a
> STOP condition rather than inventing a permission mechanism.
>
> **Drift check**: `git diff --stat 2a4c481..HEAD -- src/App.tsx src/components/AgentStatusBar.tsx src/components/OnboardingModal.tsx src/lib/onboarding.ts src/lib/pty.ts src-tauri/src/pty.rs src-tauri/src/lib.rs scripts/onboarding-check.ts src-tauri/capabilities/default.json docs/TESTING.md plans/README.md`
> Compare changed paths with the current-state facts below before editing.

## Status

- **Priority**: P1 (first-run reliability and consent clarity)
- **Effort**: M (1-2 build days plus a clean-profile macOS pass)
- **Risk**: MED (startup/tab creation order and native folder selection)
- **Depends on**: accepted Phase 31 onboarding and Phase 32 split view; no
  dependency on the abandoned Phase 33 branch
- **Category**: direction / first-run UX
- **Planned at**: accepted `main` commit `2a4c481`, 2026-09-12
- **Gate**: `PHASE 32 ACCEPTED` is recorded; explicit approval of this
  replacement Phase 33 scope is still required

## Why this matters

On a fresh Mac mini, the maintainer enabled Claude hooks but saw no bound
session or decision transcript at first. Later, macOS asked about files in
Desktop, Documents, Downloads, a network volume, data from other apps, Apple
Music, and Photos; after granting some requests, the Claude connection worked.
The exact prompt wording and requester were not captured, so the causal link
for each request is **unproven**. Photos and Music were denied without blocking
the successful session. Today the app spawns a home-directory PTY while Setup
opens, before the person has chosen a project. A first-run path that lets them
choose their working folder makes any relevant access request attributable to
that action and avoids presenting unrelated permissions as prerequisites.

## Product contract

1. On a profile with `onboarding_version < 2` and no resumable ghost tabs,
   show Setup before creating the default home PTY. This is a first-run-only
   change; existing profiles and ghost-tab restoration keep their current path.
2. Setup offers **Open project folder** (native directory picker) and **Open
   home terminal**. Choosing a folder opens exactly one ordinary terminal tab
   in that directory through `App.openTab`. Opening home creates exactly one
   ordinary home tab. Neither action launches an agent or enables hooks.
3. Canceling the picker leaves Setup and the tab list unchanged. A denied,
   unavailable, or non-directory selection shows a bounded, plain-text error
   in Setup and leaves both actions available. Never silently open home while
   labeling the tab as the selected project.
4. **Skip for now** or **Finish setup** with no tab open creates one home tab.
   With a tab already open, they create none. The checklist remains reopenable
   from the header. The existing `Connected` rule remains a tethered structured
   event, never the folder selection or a PTY's text output.
5. The Setup copy explains that macOS may ask for access to a folder the person
   chooses. It does not present Full Disk Access, Apple Music, Photos, or
   access to all folders/volumes as required. It does not cause an OS prompt
   merely by opening Setup.
6. The existing **Enable notifications** button remains the only notification
   request path. Denying any optional permission never blocks ordinary
   terminal use.

## Platform facts and limits

- macOS decides when to show Files & Folders prompts on access to protected
  locations. A native Open panel provides user-selected access to the chosen
  path; it is not a blanket grant to Desktop, Documents, Downloads, or network
  volumes. Do not attempt to batch-trigger TCC prompts by probing locations.
  See Apple: https://developer.apple.com/documentation/bundleresources/information-property-list/nsdesktopfolderusagedescription
  and https://developer.apple.com/documentation/appkit/nsopenpanel.
- Full Disk Access cannot be silently granted by app code. It is not a setup
  requirement in this plan. Do not request it or instruct users to enable it
  as a generic fix. See Apple: https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox.
- `@tauri-apps/plugin-dialog` already exists in `package.json`, is initialized
  in `src-tauri/src/lib.rs`, and `dialog:default` already allows `open` in
  `src-tauri/capabilities/default.json`. The documented `open({ directory:
  true, multiple: false })` returns a selected path or `null` on cancel:
  https://v2.tauri.app/plugin/dialog/. No new dependency or broad capability
  is needed.
- The existing repo landmine in `CLAUDE.md` notes unexplained Music/Photos
  prompts on fresh ad-hoc development builds. Their origin was not established.
  Do not add media usage-description keys or a media permission button to
  make those requests look normal.

## Current state on accepted main

- `src/App.tsx` startup effect: after `ptyKillAll()` and
  `repo.reentryCandidates()`, `candidates.length === 0` directly calls
  `void openTab()`. Onboarding visibility is loaded independently by
  `AgentStatusBar`, so the home PTY can start before Setup appears.
- `src/App.tsx` `openTab(opts)` canonicalizes `opts?.cwd ?? "~"`, resolves a
  project key, invokes `ptySpawn`, then appends and focuses a `Tab`. Reuse it;
  no second PTY path or autonomous input is allowed.
- `src/components/AgentStatusBar.tsx` owns `setupOpen`, loads
  `repo.getOnboardingVersion()` on mount, and writes version 2 when Setup
  closes. `OnboardingModal` receives controlled callbacks; keep one owner for
  setup state when coordinating first-run tab creation.
- `src/components/OnboardingModal.tsx` already has dialog focus/Escape logic,
  an adapter checklist, an explicit notification action, and Skip/Finish.
  Put the two tab-opening actions in this existing dialog, not a new landing
  page or separate permission wizard.
- `src-tauri/src/pty.rs` `canon()` falls back to the provided path if
  canonicalization fails. `pty_spawn` ignores an invalid cwd and may spawn in
  its default directory. That behavior is acceptable for old bookmarks but
  must not make an explicitly selected folder appear to have opened when it
  did not. Add a narrow preflight command for the picker path; do not silently
  change all legacy `pty_spawn` callers.
- `src/lib/pty.ts` holds typed `invoke` wrappers; use it for the preflight.
  `scripts/onboarding-check.ts` is the focused contract check.
- On accepted main, `git_untracked_files()` in `src-tauri/src/pty.rs` runs
  `git -C <cwd> status --porcelain --untracked-files=all`. If a home-level
  `.git` exists, this can traverse unrelated home folders. A guard was built
  on the unaccepted branch, but is **not** accepted baseline behavior. Treat
  a reproduced home traversal as a separate root-cause finding, not proof
  that a permission picker fixes it.

## Scope

**In scope for implementation**:

- `src/App.tsx` - coordinate first-run startup, restore, and the two actions.
- `src/components/AgentStatusBar.tsx` - pass controlled setup actions/state.
- `src/components/OnboardingModal.tsx` - project/home actions and bounded
  cancellation/error presentation.
- `src/lib/onboarding.ts` - pure first-run decision helper if needed.
- `src/lib/pty.ts`, `src-tauri/src/pty.rs`, `src-tauri/src/lib.rs` - narrow
  selected-directory preflight and typed command wrapper.
- `scripts/onboarding-check.ts` - focused checks for first-run decisions,
  cancel/error paths, and preserved connection/notification contracts.
- `docs/TESTING.md`, this plan, `plans/README.md` - manual evidence/status.

**Out of scope**:

- Global macOS configuration changes, Full Disk Access, TCC resets, or
  automatic reads of Desktop/Documents/Downloads/network volumes.
- Apple Music/Photos APIs, permission requests, or usage-description keys.
- Changes to Claude hooks, transcript ingestion, extractor behavior, adapter
  mapping, or the localhost ingest server.
- Inherited `CLAUDE_CODE_CHILD_SESSION` handling. The screenshot showed it
  suppressing transcripts in a Claude-launched development app; launch a
  release app from Finder for this sprint's manual test and file a separate
  issue if the marker appears there.
- Re-entry data migrations, tab-restore fixes, Windows PTY-shell fixes,
  project bookmarks, analytics, or new packages.
- Any files from the unaccepted Phase 33 branch unless independently reviewed
  and explicitly added to a revised plan.

## Steps

### 1. Establish prompt provenance before changing startup

On a disposable macOS app identity/profile or a fresh test machine, run the
accepted `main` release build from Finder, not from a Claude-owned shell.
Record the app identity/build, first-launch path, whether a home tab appears,
and the exact requester/resource/action for each OS prompt that actually
appears. If Music or Photos are requested, deny them and check that a plain
terminal still works.
Do not reset an existing user's TCC grants to manufacture a prompt. Check
whether `git -C "$HOME" rev-parse --show-toplevel` resolves to a home-level
repository; record only the path category, no home-file inventory. If this
reveals home traversal or a reproducible unrelated media request before user
action, STOP and split out the underlying access bug before claiming this
onboarding sprint resolves it. If no prompt reproduces, mark its origin
unknown and continue with the contextual folder flow.

**Verify**: a dated, sanitized entry in `docs/TESTING.md` records the build,
trigger, exact observed prompt categories, denials, and unresolved categories;
it contains no transcript content, tokens, or private directory listings.

### 2. Move the first-run decision to one owner

Coordinate `repo.getOnboardingVersion()` with the startup effect in
`src/App.tsx` so an empty re-entry candidate list does not spawn a home PTY
before a first-run Setup decision. Pass the first-run state and close callback
to `AgentStatusBar` instead of letting it race with a second independent
version read. Preserve the existing StrictMode cancellation/one-time startup
guard. An onboarding-version read failure must fail open to the ordinary home
tab and a visible, bounded Setup error; it must not leave an empty unusable
window. Existing profiles and restored ghost tabs must take their current
paths without waiting for Setup.

**Verify**: `npm run onboarding:check` passes added pure/source assertions for
fresh profile, existing profile, ghost restore, failed version read, and no
duplicate tab under StrictMode; `npx tsc --noEmit` exits 0.

### 3. Add explicit folder and home actions

Use the installed Tauri dialog `open({ directory: true, multiple: false })`
only on the **Open project folder** click. Before calling `openTab`, invoke a
new narrow Rust command that checks the selected path is a directory and can
be opened (`metadata`/`read_dir`, no traversal or file-content read). Return
a typed success/error result; cancellation is not an error. On success call
the established `openTab({ cwd: selectedPath })` once and keep Setup open so
agent activation can continue. **Open home terminal** calls `openTab()` once.
Guard repeat clicks while the picker/preflight/spawn is pending. If preflight
or spawn fails, show a bounded plain-text error and allow retry or home.
Skip/Finish opens home only if no tab exists, then persists the existing
onboarding version. Do not add a bookmark automatically.

**Verify**: `npm run onboarding:check` covers selected path, cancel, deny,
repeat-click, failed PTY spawn, and the existing notification/Connected
contracts; `cd src-tauri && cargo test --lib` includes directory-preflight
tests for a valid directory, missing path, and regular file. Tests use
temporary directories, never actual user folders.

### 4. Run the full gates and live matrix

Run focused check first, then `npm run opencode:check`, `npm run check`,
`npx tsc --noEmit`, `npm run build`, `cd src-tauri && cargo test --lib`,
`cd src-tauri && cargo clippy --all-targets -- -D warnings`, and
`git diff --check`. Do not run `npm run golden`; extraction prompts are
unchanged. In `docs/TESTING.md`, add a separate first-run follow-up matrix
for the product-contract cases, including macOS protected folder selection,
cancel/deny, Music/Photos denied, no Full Disk Access, existing profile,
ghost restore, and terminal/agent responsiveness. A checker cannot prove
macOS's TCC UI behavior; do not mark manual cases passed from unit tests.

**Verify**: every listed gate exits 0; live outcomes are recorded per case
without claiming an unobserved OS prompt was absent on all machines.

## Done criteria

- [ ] Fresh profile with no ghosts shows Setup before any default PTY is
      spawned; choosing a folder opens exactly that directory.
- [ ] Picker cancel/deny/failure leaves a usable home action and no false
      project tab; Skip/Finish creates one home tab only when needed.
- [ ] Existing profiles and re-entry restore behave as before; no duplicate
      tabs from StrictMode or repeated clicks.
- [ ] No code requests Full Disk Access, Music, Photos, or blanket folder
      access; notification permission stays click-triggered.
- [ ] `Connected` still requires a tethered structured hook event.
- [ ] Focused, aggregate, TypeScript, build, Rust, clippy, and diff checks pass.
- [ ] Clean-profile live evidence is recorded in `docs/TESTING.md`, including
      any prompts that remained unexplained.

## STOP conditions

- The maintainer has not approved this replacement plan's scope, or the work
  starts from the unaccepted Phase 33 branch. `PHASE 33 ACCEPTED` would be the
  boundary for Phase 34, not the authorization for this Phase 33 candidate.
- A clean accepted-main app requests Music/Photos or unrelated protected
  folders before the person acts, or home-level git traversal is confirmed.
  Diagnose that access path in a separate plan; do not normalize the prompt
  with onboarding copy.
- The native folder picker does not give the spawned PTY access to the chosen
  directory in a live test. Report the exact boundary before expanding scope.
- The implementation would require broad Tauri filesystem permissions,
  Full Disk Access, a new dependency, or modifications to agent config.
- Two reasonable attempts at a verification gate still fail, or a drift
  check shows incompatible code changes on accepted main.

## Maintenance notes

- First-run Setup and automatic home-tab creation become one startup contract.
  Any future re-entry or onboarding-version change must test both branches.
- A native picker grants a specific user-selected location; it is not a
  persistent app-level permission status. Never display “all file access
  enabled” based on a successful selection.
- Review the app's behavior under denied project access and a stale bookmark;
  do not confuse a fallback home PTY with the folder the user selected.
