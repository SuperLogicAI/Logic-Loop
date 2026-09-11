# Plan 010: Guide first-run users to one verified agent connection

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update this plan and its status row in
> `plans/README.md`.
>
> **Phase gate**: SATISFIED. Phase 30 was committed as `17d6a44`, and the
> maintainer wrote `PHASE 31 ACCEPTED` on 2026-09-10.
>
> **Drift check (run first)**:
> `git diff --stat 17d6a44..HEAD -- src/App.tsx src/components/AgentStatusBar.tsx src/components/OnboardingModal.tsx src/lib/ingest.ts src/lib/notify.ts src/lib/onboarding.ts src/lib/repo.ts src-tauri/src/ingest.rs src-tauri/src/lib.rs scripts/onboarding-check.ts package.json README.md docs/TESTING.md CLAUDE.md plans/README.md`
> Compare every match with the current-state excerpts below and stop on an
> incompatible mismatch.

## Status

- **Priority**: P1
- **Effort**: M (2–4 days plus a clean-profile macOS pass)
- **Risk**: MED — this changes first-launch behavior and controls writes to
  users' agent configuration files and the OS notification prompt
- **Depends on**: Plan 009 / Phase 30 committed and accepted
- **Category**: direction / release readiness
- **Planned at**: commit `b7144ea`, 2026-09-10, with the accepted Phase 30
  tab-boundary closeout later committed as `17d6a44`

## Why this matters

Logic Loop's differentiated panels are inert until at least one agent adapter
is enabled, but setup is currently represented by terse pills in the header.
An adapter write failure is logged only to the developer console, and macOS
notification permission is requested on startup before the user has seen why
nudges are useful. A new user must infer the activation sequence from tooltips
or the README.

This phase adds a first-run checklist whose outcome is concrete: detect an
installed agent, let the human explicitly enable its integration, wait for a
real tethered structured event, and show that the connection is live. It does
not introduce a new ingestion path, fabricate a health result, launch an agent
automatically, or broaden any adapter's capabilities.

## Product contract

### First-run and reopening

- `ONBOARDING_VERSION = 2`. With no stored version, the checklist opens once
  after startup state loads. It never blocks terminal creation or PTY input.
- **Finish setup** and **Skip for now** both store version 2 and close the
  checklist. Skip means "do not open automatically again," not "disable
  adapters."
- A persistent, keyboard-focusable **Setup** button in `AgentStatusBar`
  reopens the checklist without clearing its stored version.
- Upgrades from pre-Phase-31 builds see the checklist once because they have no
  version row. This is intentional and bounded; Skip is always available.
- Escape and the close button behave like Skip: persist the current version,
  close, and leave every adapter state unchanged.

### Adapter rows and truthful capability labels

List all four supported agents in a stable order, even when unavailable:

| Agent | Launch command | Activity/state | Decisions | Re-entry | Detection/setup surface |
|---|---|---|---|---|---|
| Claude Code | `claude` | Yes | Yes | Yes | `~/.claude/settings.json` hooks |
| Codex | `codex` | Yes | Yes | Yes | `~/.codex/hooks.json` hooks |
| OpenCode | `opencode` | Yes | No | No | global OpenCode plugin |
| Antigravity | `agy` | Yes | No | No | `~/.gemini/config/hooks.json` hooks |

- Do not label OpenCode or Antigravity decision extraction or re-entry as
  available. The README adapter matrix and accepted Phase 19/21 behavior are
  authoritative.
- An unavailable agent shows **Not detected** and its enable action is
  disabled. The checklist must not offer to download or install CLIs.
- Detection means an executable is found via the existing PATH plus known
  install-directory strategy. It does not run the CLI or inspect credentials.
- Every integration-changing operation requires a human click. Opening the
  checklist performs only detection/status reads.

### Setup lifecycle and errors

Each available row has one mutually exclusive setup state:

1. **Checking** — detection/status reads are pending.
2. **Not enabled** — agent exists; integration is absent.
3. **Enabling…** — setup write is pending; disable repeat clicks.
4. **Waiting for first event** — integration status is on, but this app run has
   not observed a tethered event for the adapter.
5. **Connected** — `App` received a real structured hook/plugin event carrying
   a Logic Loop tab tether for that adapter during this app run.
6. **Setup failed** — show the returned error plus the adapter's config
   location and a Retry button. Do not claim the integration is enabled.

Header pills and checklist rows must use the same runtime state and the same
toggle function. Do not create a second copy of adapter state that can drift.
If a header-pill write fails while the checklist is closed, open the checklist
on that adapter's visible error instead of logging only to the console.

Configuration error text is untrusted display data. Render it as plain React
text, cap it to 400 characters, and never use `dangerouslySetInnerHTML`.
Setup failure must leave terminals, hooks from other adapters, and the ingest
server operating normally.

### First-event confirmation

- Add one in-memory `Set<AdapterId>` in `App`; do not add a table or derived
  event write.
- Update it at the beginning of the existing `onHookEvent` callback only when
  `p.tab_id` is present. This proves the event can drive a Logic Loop tab;
  outside-terminal events without a tether do not complete onboarding.
- Map the trusted ingestion marker `codex`, `opencode`, or `antigravity`
  directly. The accepted Claude hook path has no adapter marker, so an absent
  marker maps to `claude` for this closed four-adapter UI only. Unknown future
  markers return `null` and do not confirm another row.
- Never infer success from PTY output, terminal text, elapsed time, a config
  file write alone, or an adapter process merely existing.
- Do not auto-close the checklist when an event arrives. Change the row to
  **Connected** so the user sees the successful round trip, then let the human
  close it.

### Notification permission

- Startup checks existing notification permission and warms the module's
  fail-open cache, but must not call the OS permission request.
- The checklist explains that notifications are for background finished,
  waiting, and stalled-agent nudges. Only its explicit **Enable notifications**
  button may request permission.
- Granted becomes **Notifications enabled**. Denied or errored becomes a
  visible, non-blocking message explaining that Logic Loop still works and the
  user can change notification access in System Settings.
- Skipping notifications does not prevent finishing onboarding. Existing
  users who already granted permission keep receiving notifications.

## Current state

- `src/components/AgentStatusBar.tsx:43-72` owns four separate adapter status
  states. Claude is always rendered, while only the other three have detection
  calls.
- `src/components/AgentStatusBar.tsx:74-127` has four repeated toggle handlers.
  Every catch branch only runs `console.error(...)`, so a normal user gets no
  recovery path.
- `src/components/AgentStatusBar.tsx:197-232` renders the adapter pills. This
  remains the compact always-available control surface; the new Setup button
  belongs beside this group, not in the side panel.
- `src/App.tsx:358-364` currently calls `initNotifications()` on every startup.
  `src/lib/notify.ts:7-12` both checks permission and immediately requests it:

  ```ts
  permissionGranted = await isPermissionGranted();
  if (!permissionGranted) {
    permissionGranted = (await requestPermission()) === "granted";
  }
  ```

- `src/App.tsx:806-978` is the single structured-hook listener. It already
  binds, persists, drives tab state, and fails open. First-event UI state must
  be a small side effect at the top of this callback; do not add another
  listener or event insert.
- `src/lib/ingest.ts:5-63` exposes setup/remove/status for all adapters and
  detection for OpenCode, Codex, and Antigravity. It lacks `claudeDetect()`.
- `src-tauri/src/codex.rs:100-127`, `opencode.rs:211-238`, and
  `antigravity.rs:112-141` are the executable-detection exemplars: executable
  PATH scan plus agent-specific fallback directories for GUI-launched apps.
- `src-tauri/src/ingest.rs:376-400` owns Claude setup/remove/status. Add Claude
  detection here beside those commands; do not move or rewrite hook setup.
- `src-tauri/src/lib.rs:273-287` registers every adapter command. A new Claude
  detect command must be registered in the same list.
- `src/lib/repo.ts:698-751` has private `getSetting`/`setSetting` helpers and
  global preference accessors. Reuse them for `onboarding_version`; the
  existing `settings` table means no migration is needed.
- Existing modal presentation is fixed below the 28px native titlebar; see
  `FanOutModal.tsx:61-66` and `LandingNoteModal.tsx:90-98`. Match this visual
  convention, but add dialog semantics, Escape handling, and initial focus.
- Check scripts combine pure assertions with narrow source-contract checks;
  `scripts/lock-in-check.ts` is the closest pattern. Add a dedicated script
  instead of overloading an unrelated phase check.

## Architecture constraints

1. Never inspect ANSI or PTY output for connection status. Only the existing
   structured `onHookEvent` path may confirm an adapter.
2. Fail open: detection, setup, persistence, or notification failure cannot
   block tab creation, terminals, or ingestion from other adapters.
3. Adapter configuration writes stay in the existing Rust setup functions.
   React does not read or edit agent config files directly.
4. Do not automatically enable hooks, launch an agent, type a command, or send
   terminal input. Displaying `claude`, `codex`, `opencode`, or `agy` as a
   suggested command is allowed; executing it is not.
5. All database access goes through `src/lib/repo.ts`. Use the existing
   settings table; add no migration and no inline component SQL.
6. Treat error strings as untrusted text. No HTML injection or prompt use.
7. Keep React StrictMode cleanup safe: async initialization must use a
   cancelled flag so an unmounted first pass cannot update state or reopen the
   checklist.
8. Do not change adapter event mappings, hook payloads, extraction behavior,
   resume commands, or notification delivery rules.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused frontend check | `npm run onboarding:check` | onboarding assertions pass |
| Existing adapter baseline | `npm run opencode:check` | all assertions pass |
| Aggregate frontend | `npm run check` | every configured check passes |
| TypeScript | `npx tsc --noEmit` | exit 0, no errors |
| Production build | `npm run build` | exit 0; existing chunk-size advisory is allowed |
| Rust unit tests | `cd src-tauri && cargo test --lib` | all tests pass |
| Rust lint | `cd src-tauri && cargo clippy --all-targets -- -D warnings` | exit 0, no warnings |
| Scope/whitespace | `git diff --check` | no output |

Do not run `npm run golden`; this phase changes no extraction prompt.

## Scope

**In scope — the only implementation and phase-record files to modify:**

- `src/lib/onboarding.ts` — create the pure adapter metadata and state helpers.
- `src/components/OnboardingModal.tsx` — create the controlled checklist UI.
- `src/components/AgentStatusBar.tsx` — own the shared adapter runtime state,
  Setup button, first-run persistence, and modal wiring.
- `src/App.tsx` — track tethered adapters observed this run; own notification
  permission state/callbacks and pass both into `AgentStatusBar`.
- `src/lib/ingest.ts` — add the typed `claudeDetect()` command wrapper.
- `src/lib/notify.ts` — separate permission checking from explicit requesting.
- `src/lib/repo.ts` — add versioned onboarding preference accessors.
- `src-tauri/src/ingest.rs` — add Claude executable detection and unit-testable
  path logic without changing hook registration.
- `src-tauri/src/lib.rs` — register `ingest::claude_detect`.
- `scripts/onboarding-check.ts` — add pure and source-contract assertions.
- `package.json` — add `onboarding:check` and include it in `npm run check`.
- `README.md` — describe guided setup and move onboarding to shipped only
  after acceptance.
- `docs/TESTING.md` — add the Phase 31 clean-profile/live matrix.
- `CLAUDE.md` — add the Phase 31 status and any verified landmine.
- `plans/010-first-run-agent-activation.md` and `plans/README.md` — update
  execution status after implementation/acceptance.

**Out of scope:**

- New adapters or additional capabilities for existing adapters.
- OpenCode/Antigravity decision extraction or re-entry.
- Adapter protocol, hook-event mapping, transcript, extraction, and ingest
  server changes.
- Automatically installing agent CLIs or enabling integrations.
- Sending any input to terminals, including a suggested launch command.
- Side-panel structure, Attention Inbox, Momentum, Idea Board, or Lock-in
  redesign.
- Background daemons, PTY survival across quit, crash recovery, or persistent
  agent processes.
- A general settings window, telemetry, analytics, account/auth checks, or an
  internet connection.
- Schema migrations, CSS-framework changes, dependency upgrades, or new npm
  packages.

## Git workflow

- Begin only after Phase 30 is committed and the working tree is clean.
- Suggested branch: `feat/phase31-first-run-activation`.
- One conventional commit: `feat(onboarding): guide first agent activation`.
- Do not push or open a PR unless the maintainer explicitly requests it.
- Preserve any unrelated user-authored work; stop if an in-scope file is dirty
  for a reason not described in this plan.

## Implementation sequence

### Step 1: Add the pure onboarding contract and focused check

Create `src/lib/onboarding.ts` with:

- `AdapterId = "claude" | "codex" | "opencode" | "antigravity"`;
- `ONBOARDING_VERSION = 2`;
- immutable metadata for label, launch command, config-location label, and the
  three capability booleans in the Product contract;
- `adapterIdForHook(agent: string | undefined): AdapterId | null`, with absent
  → Claude, the three trusted markers → themselves, and unknown → null;
- a pure progress derivation whose priority is error, checking/enabling,
  unavailable, connected, waiting-for-event, then not-enabled;
- a plain-text error formatter capped at 400 characters.

Create `scripts/onboarding-check.ts` following `lock-in-check.ts`. Assert the
full metadata matrix, hook-marker mapping including unknown markers, progress
priority, version, and error truncation. Add `onboarding:check` to
`package.json` and the aggregate `check` chain.

**Verify**: `npm run onboarding:check` passes, then `npm run check` still
passes. At this step, source-contract assertions for not-yet-created wiring
may be added later; pure assertions must already pass.

### Step 2: Persist only the versioned presentation state

In `src/lib/repo.ts`, add `ONBOARDING_VERSION_KEY = "onboarding_version"`
beside the other global shell settings and export:

```ts
getOnboardingVersion(): Promise<number>
setOnboardingVersion(version: number): Promise<void>
```

The getter uses `getSetting`, returns 0 for missing, malformed, negative, or
non-integer values, and otherwise returns the stored integer. The setter stores
a non-negative integer string through `setSetting`; callers only write the
current constant. Do not expose the generic setting helpers or add SQL in a
component.

Extend `onboarding-check.ts` with source-contract assertions that the named
accessors exist and that no migration is added for onboarding.

**Verify**: `npm run onboarding:check` and `npx tsc --noEmit` pass.

### Step 3: Separate notification inspection from consent

Refactor `src/lib/notify.ts` without changing `notify()` delivery:

- `initNotifications(): Promise<boolean>` calls only
  `isPermissionGranted()`, updates the module cache, and returns the result.
- `requestNotifications(): Promise<boolean>` is the only function that calls
  `requestPermission()`, updates the same cache, and returns whether permission
  is granted.
- Both catch errors, set the cache false, and return false.

In `App.tsx`, store the result of `initNotifications()` in a boolean state and
pass it plus an explicit request callback to `AgentStatusBar`. The request
callback awaits `requestNotifications()` and updates state. Do not request
permission from an effect.

Add source assertions proving `requestPermission()` is absent from the body of
`initNotifications()` and present in `requestNotifications()`.

**Verify**: `npm run onboarding:check`, `npm run notify:check`, and
`npx tsc --noEmit` pass.

### Step 4: Detect Claude without executing it

Add `ingest::claude_detect()` beside Claude setup/status. Match the established
detectors: scan executable `claude` entries on PATH, then known GUI-launch
fallbacks `~/.local/bin/claude`, `~/homebrew/bin/claude`,
`/opt/homebrew/bin/claude`, and `/usr/local/bin/claude`. Use the repository's
`home_or_tmp()` helper and the same Unix executable-bit/non-Unix file checks as
the existing adapters. Do not invoke `claude --version` or read credentials.

Register it in `src-tauri/src/lib.rs` and add `claudeDetect()` to
`src/lib/ingest.ts`. Add Rust tests for the extracted candidate/path predicate
where it can be tested without depending on the machine's installed CLIs; do
not write into real home directories in a unit test.

**Verify**: `cargo test --lib`, clippy, `npm run onboarding:check`, and
`npx tsc --noEmit` pass.

### Step 5: Observe connection success in the existing hook listener

Add `observedAdapters: Set<AdapterId>` to `App`. At the beginning of the
existing `onHookEvent` callback, when `p.tab_id` exists, call
`adapterIdForHook(p.agent)` and immutably add a recognized id. Return the
previous Set when already present to avoid rerendering on every tool event.

Pass `observedAdapters`, notification permission state, and the explicit
notification request callback into `AgentStatusBar`. Do not persist this Set,
query terminal content, add an event, or add another Tauri listener.

Add source-contract checks for the `p.tab_id` gate and for the new props. They
supplement rather than replace the live event test.

**Verify**: `npm run onboarding:check`, `npm run bind:check`,
`npm run opencode:check`, and `npx tsc --noEmit` pass.

### Step 6: Share adapter runtime state between header and checklist

Replace the four repeated status/toggle paths inside `AgentStatusBar` with one
typed record keyed by `AdapterId`. Keep the existing Rust wrappers as the only
side-effect functions. A local action map may bind each id to detect, status,
setup, and remove functions; it must not contain shell commands or config-file
logic.

Initialization requirements:

- run all four detection calls;
- call status only for detected agents;
- use a cancelled flag in the effect cleanup;
- detection/status failure becomes row error/unavailable without throwing;
- never call setup during initialization.

One `toggleAdapter(id)` function serves both the existing header pill and the
new modal. It disables that row while pending, clears its old error, calls
setup/remove based on the current state, and updates enabled state only after
success. On failure, preserve the prior enabled state, store a capped error,
open the checklist, and keep the console log only as supplemental developer
evidence.

Preserve current header behavior: unavailable optional adapters remain absent
from the pill row; Claude remains visible and says **claude not detected** when
unavailable rather than implying panels can work.

**Verify**: `npm run onboarding:check`, `npm run opencode:check`, and
`npx tsc --noEmit` pass. Source assertions must find one common toggle path,
not four independent setup handlers.

### Step 7: Build the controlled first-run checklist

Create `OnboardingModal.tsx` as a presentation component. It receives adapter
runtime rows, observed ids, toggle/retry callback, notification state/request,
and Finish/Skip/Close callbacks. It performs no Tauri invoke, SQL, agent-file
write, or hook listening.

Match existing modal geometry (`fixed inset-x-0 top-7 bottom-0 z-40`) so the
native titlebar remains usable. Add `role="dialog"`, `aria-modal="true"`, an
accessible name, initial focus, Escape handling, visible focus styles, and
plain-text errors. Show the exact capability matrix and lifecycle wording from
the Product contract. Suggested commands are text only, with wording such as
"Open a terminal tab and run `codex`"; they are not buttons that write to a
terminal.

In `AgentStatusBar`, load `repo.getOnboardingVersion()` after mount. Auto-open
when it is below `ONBOARDING_VERSION`. Finish, Skip, Escape, backdrop, and close
all persist the current version before closing; if persistence fails, close
anyway and show a non-blocking error the next time Setup is opened. Add the
persistent Setup button to the header. Do not conflate onboarding completion
with adapter enabled/connected state.

Notification denial must stay visible but not disable Finish. A newly observed
adapter updates to Connected without closing the modal.

**Verify**: `npm run onboarding:check`, `npx tsc --noEmit`, and
`npm run build` pass.

### Step 8: Document and dogfood Phase 31

Add `docs/TESTING.md` §43 with the matrix below. Update README setup/status
only after implementation exists. Add Phase 31 to `CLAUDE.md` as BUILT until
the maintainer accepts the live matrix. Update the Plan 010 row to IN PROGRESS
or BUILT, not DONE, until acceptance.

Use a disposable macOS user account for the true clean-profile test. Do not
delete or rename the maintainer's real app database or agent configs. Record OS,
bundle type, detected CLI versions (versions only; no credentials), and whether
each adapter was already configured in that disposable profile.

**Verify**: `rg -n "Phase 31|first-run|onboarding" README.md docs/TESTING.md CLAUDE.md plans` finds the phase record, and `git diff --check` passes.

## Test plan

### Automated

`scripts/onboarding-check.ts` must cover:

1. All four adapters and the exact supported-depth matrix.
2. Missing marker → Claude; three known markers → matching ids; unknown marker
   → null.
3. Progress priority for checking, unavailable, enabling, error, waiting, and
   connected.
4. Error strings remain plain text and are capped at 400 characters.
5. Invalid onboarding-setting values fall back to version 0.
6. `initNotifications` does not request permission; only the explicit request
   function does.
7. `App` requires `p.tab_id` before recording observed adapter state and uses
   the existing listener.
8. AgentStatusBar exposes one shared toggle path and a Setup reopen control.
9. OnboardingModal contains dialog semantics and no `invoke`, repo SQL,
   `ptyWrite`, or terminal-launch call.
10. `package.json` includes the focused check in the aggregate chain.

Rust tests must cover Claude candidate resolution without relying on or
modifying the user's actual installation.

### Manual — clean/disposable macOS profile

1. Launch the bundled release build with no `onboarding_version` row. A live
   terminal appears and accepts input even while the checklist is open.
2. Confirm all four agents appear; installed ones say Not enabled/enabled and
   missing ones say Not detected. Capability labels match the product contract.
3. Click Skip, relaunch, and confirm the checklist stays closed. Click Setup and
   confirm it reopens with current detection/status.
4. For one installed but disabled agent, click Enable. Verify the expected
   config file changes only after the click and preserves unrelated user
   entries. Row becomes Waiting for first event.
5. Close/reopen the checklist before running the agent; it remains enabled but
   not falsely Connected in this app run.
6. In a Logic Loop terminal tab, manually run that agent and submit a harmless
   prompt. On its first tethered structured event, the row becomes Connected,
   the tab state dot changes, and applicable panels begin populating.
7. Start the same agent outside Logic Loop. Its untethered event may ingest but
   must not mark the onboarding row Connected.
8. Put malformed JSON in a disposable copy of one adapter config, click Enable,
   and confirm the row shows a capped actionable error and Retry while every
   terminal remains usable. Restore the disposable config afterward.
9. Trigger a header-pill setup failure with the checklist closed; the checklist
   opens to the visible error instead of failing only in the console.
10. On a profile where notifications are undecided, confirm launch causes no OS
    prompt. Read the nudge explanation, click Enable notifications, and confirm
    that click causes the prompt. Test both grant and denial paths if the
    disposable environment permits resetting permission.
11. Relaunch with notification permission already granted; notifications remain
    enabled without another prompt.
12. Enable/disable each installed adapter from the header and checklist. Status
    stays synchronized, config edits remain idempotent/reversible, and no other
    adapter changes.
13. Exercise Escape, backdrop, close, Finish, keyboard Tab order, and narrow
    window scrolling. The titlebar remains draggable and no keystroke reaches
    the active terminal while the modal owns focus.

### Full gates

Run in this order after the focused check and live pass:

```sh
npm run opencode:check
npm run check
npx tsc --noEmit
npm run build
cd src-tauri && cargo test --lib
cd src-tauri && cargo clippy --all-targets -- -D warnings
git diff --check
```

Expected: every command exits 0; Rust test count increases by any new detector
tests; the existing Vite chunk-size advisory is allowed.

## Done criteria

- [x] Phase 30 is committed and `PHASE 31 ACCEPTED` was recorded before code.
- [x] A missing onboarding version opens the checklist once; Finish/Skip/Close
      persists version 2; Setup always reopens it.
- [x] All four agents are detected without executing them and show the exact
      capability matrix.
- [x] No adapter setup occurs without an explicit click.
- [x] Header and checklist share one adapter state/toggle path.
- [x] Setup failures are visible, capped, actionable, retryable, and fail open.
- [x] Only a real tethered structured event marks an adapter Connected.
- [x] Startup never requests notification permission; the explained explicit
      action is the only request path.
- [x] Skipping notifications or onboarding never blocks terminal use.
- [x] `onboarding:check` is present and included in `npm run check`.
- [ ] The clean-profile §43 live matrix is recorded with no private config or
      transcript content.
- [x] All focused and full gates pass; `npm run golden` was not run.
- [x] No out-of-scope files or behaviors changed.
- [x] Plan 010/index and phase-status docs reflect BUILT or DONE truthfully.

Implementation completed 2026-09-10. Automated gates pass, including the new
`onboarding:check`, all aggregate frontend checks, strict TypeScript,
production build, 58 Rust unit tests, clippy with warnings denied, and diff
whitespace validation. `npm run golden` was not run because extraction prompts
did not change. The clean-profile macOS matrix in `docs/TESTING.md` §43 remains
the acceptance gate. Before live acceptance, the setup branding/layout revision
bumped the draft contract from version 1 to version 2 so profiles that dismissed
the earlier Phase 31 build see the revised checklist once; rebuilds after that
continue to respect the persisted version.

## STOP conditions

Stop and report instead of improvising if:

- Phase 30 is not committed or the maintainer has not written
  `PHASE 31 ACCEPTED`.
- An in-scope file has unrelated user changes or no longer matches the current
  architecture described above.
- Supporting first-run detection requires running a CLI, reading credentials,
  accessing the network, or editing shell configuration.
- Sharing adapter state appears to require a second hook listener, duplicate
  config writer, direct component SQL, or an adapter protocol change.
- A setup action cannot preserve and reversibly remove only Logic Loop's own
  config entries using the existing Rust functions.
- First-event confirmation cannot be implemented from the already-normalized
  `onHookEvent` payload and tab tether.
- macOS requests notification permission before the explicit checklist click.
- A modal interaction sends keystrokes or commands to a terminal.
- A verification command fails twice after one reasonable correction.
- Completing the phase would require any out-of-scope file or dependency.

## Maintenance notes

- Increment `ONBOARDING_VERSION` only when an existing user genuinely needs to
  see a materially changed setup contract again. Copy edits alone do not merit
  reopening onboarding for everyone.
- Keep adapter capabilities centralized in `onboarding.ts`; when an adapter
  gains decisions or re-entry, update metadata, tests, README, and live coverage
  together.
- Absence of an adapter marker maps to Claude only inside the current closed
  onboarding helper. Do not generalize that fallback into ingestion identity;
  `recognized_agent` deliberately leaves absent/unknown headers unstamped.
- Connected is evidence from the current app run, not a persisted guarantee.
  A future adapter-health feature may query durable evidence, but must preserve
  the tether and trusted-marker rules rather than inferring from terminal text.
- Keep OS consent separate from onboarding completion. A user may intentionally
  run Logic Loop without notifications.
- Future crash recovery, background sessions, adapters, analytics, and a full
  settings window remain separate product decisions.
