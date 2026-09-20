# Plan 033: Complete the first useful session

## Status

CANDIDATE — not implemented or approved. P1; M–L (2–3 days plus fresh-profile test); risk MED. Depends on accepted sprint 032 for sequencing.

## Why and what to build

Extend existing Setup so a newcomer can select a project and start one agent without guessing how to leave the checklist. Save failures must not erase their project setup. This refreshes and extends Plan 021; its obsolete Phase 33 gate and version-2 assumptions are not operative.

## Current state and scope

- `src/App.tsx:398`: `openTab(opts?: { name?: string; cwd?: string; color?: string; cmd?: string })` already supports spawn configuration. At 800–803 startup calls openTab when there are no ghost tabs.
- `src/components/OnboardingModal.tsx:20–29` already has honest waiting/connected states. At 64–81 it contains focus. Reuse these; do not replace setup with a competing wizard.
- `src/lib/onboarding.ts:35`: `ONBOARDING_VERSION = 3`; ADAPTERS contains actual commands and capabilities. DeepSeek command includes its required profile.
- `BookmarksBar.tsx:30–35`: invokes onAdd/onUpdate and immediately `setForm(null)`; App callbacks at 1438–1445 return void.

Allowed: App.tsx, OnboardingModal.tsx, AgentStatusBar.tsx, BookmarksBar.tsx, lib/onboarding.ts, lib/repo.ts settings helpers if needed, lib/pty.ts and src-tauri/src/pty.rs for strict selected-folder validation only, scripts/onboarding-check.ts, a narrow new component interaction test file/config, package.json and lockfile for that harness. Existing dialog plugin/capabilities already suffice. Out: hook installer rewrites, new adapters, automatic terminal typing, blanket OS permission probes, full onboarding redesign. Plan 021 is background to reconcile, not a second work order.

## Steps and regression plan

1. Specify an explicit launch state machine: choose folder, choose installed agent or plain shell, Start session, waiting, first event. Skip remains possible. Separate dismissed setup from activated session; never set connected on elapsed time. First-run no-project path should not spawn a home PTY behind Setup. Preserve returning users and ghost restoration. Verify pure cases in `npm run onboarding:check` for no tabs, ghost tabs, canceled picker, skip and repeated clicks.
2. Use the native directory picker; cancel is no-op, invalid/missing/denied selected paths show an error rather than silent home fallback. Start uses the selected adapter's existing fixed command as spawn configuration, never PTY writes. Do not automatically enable hooks or notifications. Test double-click creates exactly one tab, failed spawn retains selection, and activity-only adapters never promise decisions. Verify onboarding check and TypeScript.
3. Change bookmark add/update/delete callback contracts to await actual persistence. Pending prevents duplicates; failure preserves fields and shows a retryable error; success closes the editor. Keep DB logic in repo. Avoid claiming a saved bookmark failed merely because an unrelated refresh failed: distinguish mutation success from list refresh. Verify a rejected mutation and successful retry with actual rendered interactions.
4. Add the smallest React component test harness needed (proposed Vitest + jsdom + Testing Library; approve exact dependency scope in PLAN.md). Stub Tauri boundary calls, not the component behavior. Add `test:ui` to package scripts and the aggregate/CI path. Verify `npm run test:ui` exits 0 for picker cancel, one launch, spawn rejection, bookmark rejected save, retry and setup skip; assert visible states and call counts, not screenshots/source strings.
5. Observe a fresh profile on macOS with Claude or Codex and one activity-only adapter. Target first event within five minutes excluding external CLI installation/auth. Record interventions, not just pass/fail. Run applicable full gates.

## Maintenance

Use ADAPTERS as the capability/command source; never duplicate guessed launch strings. Do not increment onboarding version just to force all existing users through setup again without approving that migration behavior. Preserve cancellation cleanup and safe focus restoration.


## Execution contract

This is a candidate draft, not authorization. Planned at `a87bafd` on 2026-09-19. First read AGENTS.md, CLAUDE.md, CONTRIBUTING.md, PLAN.md, and this file. Confirm the current phase and its literal acceptance; write a PLAN.md for this sprint only and obtain approval before code changes. No implied phase-number assignment. Never start the next phase without `PHASE N ACCEPTED`.

Run `git status --short` and `git diff --stat a87bafd..HEAD -- <in-scope paths below>`. Compare live code to the excerpts. Expected predecessor edits are normal: reconcile them explicitly. If a behavior no longer exists, revise the candidate before implementation instead of reintroducing it. Preserve user changes. Use an isolated `feat/<sprint-slug>` branch/worktree if needed; do not commit, push, publish, or message people without the operator's instruction. Match existing conventional commit style, e.g. `fix(pty): ...`.

Keep Tauri v2/Rust/portable-pty/React/strict TypeScript/Tailwind/xterm/SQLite. All DB access through src/lib/repo.ts, migrations new and numbered, structured semantics only, PTY bytes untouched, no autonomous terminal input. Agent/transcript text is untrusted. Hooks/panels fail open. Launch commands are explicit user-triggered spawn configuration only. Preserve generated adapters and regeneration markers. Tauri listeners need the existing cancelled-flag cleanup under StrictMode. Never change global configuration merely to test a feature.

Run the focused checks named in the steps first, then applicable gates:

```sh
npm run opencode:check
npm run check
npx tsc --noEmit
npm run build
(cd src-tauri && cargo test --lib)
(cd src-tauri && cargo clippy --all-targets -- -D warnings)
git diff --check
```

Every applicable command must exit 0. Rust tests/clippy may be marked not applicable only for exclusively frontend/docs changes, with an explanation. Never run `npm run golden` unless extraction prompts changed; these drafts do not require prompt changes. No dependency installation is part of kickoff inspection; use the existing lockfile/environment. If adding the specifically scoped test dependencies, update manifest/lock together after plan approval.

## Final acceptance and stop rules

- All focused regression cases below pass, not merely source-string assertions.
- Applicable gates pass; `git diff --name-only` stays within scope plus PLAN.md, this candidate, plans/README.md, and docs/TESTING.md.
- Record actual manual results in docs/TESTING.md with build SHA/platform; unrun is unrun.
- Report behavior, evidence, remaining risks and exact acceptance token required. Mark BUILT pending manual acceptance rather than DONE when appropriate.
- Stop and report for missing phase approval, unexpected baseline drift, required scope expansion, absent platform credentials, global configuration changes, unsupported adapter contracts, or failing unrelated gates. Do unaffected preparatory work, but do not invent passing evidence or bypass a release requirement.
