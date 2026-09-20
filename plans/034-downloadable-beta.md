# Plan 034: Prepare a reproducible downloadable beta

## Status

CANDIDATE — not implemented or approved. P1; L (2–3 days plus signing/clean-machine dependency); risk MED. Depends on accepted 033; release readiness includes 032 outcomes.

## Why and what to build

The primary Mac installation path currently requires Rust/Node, and GitHub has no published releases. Build a trustworthy artifact and a truthful entry point. This is release engineering and documentation, not a new feature sprint.

## Current state and scope

- `.github/workflows/ci.yml:25–29`: npm ci, tsc, checks; no production build. Rust jobs at 49–56 write a placeholder dist.
- `.github/workflows/windows-build.yml`: manual/tag build uploads unsigned NSIS artifacts; it does not publish a release.
- `src-tauri/tauri.conf.json`: version 0.1.0 and `bundle.targets: ["app"]`. Keep this local bundle default; read the documented DMG landmine before choosing packaging.
- README.md:182–209 gives source build for Mac, Actions artifacts for Windows, and an unresolved Windows add-tab report. README/CONTRIBUTING say Node 18+; installed Vite engines are `^20.19.0 || >=22.12.0`.

Allowed: CI and one new Mac release workflow, version fields in package.json/package-lock.json/Cargo.toml/Cargo.lock/tauri.conf.json as needed, compatible build-dependency lockfile updates, README, CONTRIBUTING, docs/ROADMAP, docs/HANDOFF, docs/RELEASING.md (new), demo assets explicitly prepared with sanitized disposable content. Out: Windows/Linux feature work, auto-updater, crash reporter, cloud analytics, provider login changes, new website, automatic publication or global credential installation.

## Steps and regression plan

1. Reconcile main with plan statuses and open issue #9. Distinguish merged, automated-pass, live-pass and maintainer-accepted. Preserve historical evidence; mark old branches superseded rather than deleting history. Verify links/file references using `rg` and `git diff --check`; review every changed status against commit/test evidence.
2. Add npm run build to frontend CI and align documented Node prerequisite with the lockfile's actual engine requirements (prefer Node 22.12+ for a single simple floor). Triage npm audit results in the build toolchain; compatible fixes only, no force upgrade. Verify npm check, tsc, build, and document remaining advisories with reachability limitations.
3. Add a manually dispatched Apple Silicon build workflow producing a versioned zipped .app (or independently verified packaging choice), checksum and commit identifier as CI artifacts. Preserve the local app-only target. Use existing secret references for Developer ID signing/notarization if available; do not print credentials or create global keys. If missing, finish workflow/docs and clearly mark public release blocked. Consult current official Tauri signing instructions: https://v2.tauri.app/distribute/sign/macos/ . Workflow validation and local production build must pass; workflow execution is only performed when authorized.
4. Test the actual artifact on a clean Mac profile without Node/Rust: download/quarantine/open, project selection, agent detection via GUI PATH, first event, leave/return, quit/re-enter, and hook install/remove through the explicit app toggle. Record exact artifact SHA/version and results. Check expected signature/notarization with `codesign --verify --deep --strict` and `spctl --assess --type execute` on the artifact when signed; failed/unavailable signing is not a passing result. Keep Windows experimental, Linux unverified.
5. Prepare a release draft locally: download-first README copy, capability matrix, known limitations, Sidebar LM cost/privacy explanation, and a 60–90-second workflow demo using disposable content. The download link must not imply an unpublished artifact already exists. Explain manual update and retained app data. Publish only after maintainer instruction and release acceptance; no outreach is part of this prompt.

## Maintenance

Every release must identify the source commit and actual platform verification. CI success and merged PRs do not replace clean-machine testing. Recheck signing requirements at execution time. If serious PTY or modal failures are reproduced, hold broader release and explicitly re-sequence the fix.


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
