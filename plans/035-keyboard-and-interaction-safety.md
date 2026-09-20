# Plan 035: Make everyday keyboard interaction predictable

## Status

CANDIDATE — not implemented or approved. P1 for modal safety, P2 accessibility; M (1–2 days plus webview test); risk MED. Depends on accepted 034 and the UI harness from 033.

## Why and what to build

Task dialogs must not route destructive shortcuts to terminals behind them, and tab selection must be discoverable without a pointer. Improve existing interaction boundaries without replacing terminal shortcut handling.

## Current state and scope

- `FanOutModal.tsx:61–66` has div overlay/content and click containment only.
- `App.tsx:1250–1256`: mod-T opens a tab and mod-W closes the active tab, with no modal guard. 1285–1293 cycles tabs.
- `OnboardingModal.tsx:64–81` is an existing focus-containment exemplar, but App.tsx:1257–1283 also supplies custom form paste. Copying stopPropagation indiscriminately can break paste: explicitly preserve it.
- `TabBar.tsx:129–149` uses pointer-driven divs with `data-tauri-drag-region="false"`; this boundary is intentional and must survive.

Allowed: App.tsx, FanOutModal.tsx, TabBar.tsx, BookmarksBar.tsx color controls, a small shared dialog helper, OnboardingModal.tsx only if adopting that helper, tests from 033 and relevant check scripts. Other modals may be audited, but changing them requires enumerating their files in PLAN.md first. Out: PTY decoding, terminal key remapping, visual redesign, new global command palette, wholesale component extraction.

## Steps and regression plan

1. Reproduce mod-W/mod-T/Ctrl-Tab from fan-out inputs in the rendered harness. Add initial focus, Escape, focus trap and restore with non-destructive behavior. Make app command routing explicitly aware of open dialogs. Preserve text editing, form paste, and terminal shortcuts when no dialog is active. Verify `npm run test:ui` for every command, no terminal mutation while modal is focused, Escape dismissal and focus restoration.
2. Give the tab strip tablist/tab semantics, aria-selected and roving focus. Arrow/Home/End navigation works only when focus is in the strip, not when typing in xterm. Decide activation behavior explicitly; follow existing focusTab so visible split panes and claims stay coherent. Close labels include project identity; preserve pointer reorder and the explicit native drag exclusion. Verify UI tests for selected state, single tab stop, navigation, close-neighbor focus and two visible split panes.
3. Label bookmark color options with meaningful names/selected state. Add a compact shortcut reference only if it fits an existing help surface; do not create a new settings system. Verify accessible role/name queries and existing split/onboarding checks.
4. Manual macOS keyboard/VoiceOver pass: open and cancel dialog, paste text, cycle tabs, reorder by pointer, repeat window drag, close/re-enter, and use horizontal/vertical splits. Verify actual focus and terminal input, not just DOM roles. Run frontend gates; document untested Windows shortcuts honestly.

## Maintenance

New dialogs must use the verified command/focus boundary. Do not block every key event and accidentally remove input editing or platform paste. Preserve drag-region behavior from the earlier window-drag fix.


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
