# Session routing repair

Status: approved by maintainer 2026-10-12; implementation and PR authorized.
Phase 63 acceptance already recorded. No installed-app rebuild/relaunch; the
maintainer will rebuild, perform live checks, and review before squash/merge.

1. Allow exact-tether parent Claude `/clear` SessionStart to replace a
   Claude-owned session through the shared binding/identity/persistence rule.
   Retire prior re-entry bindings. Preserve other adapters' ownership guards.
2. Forward capitalized `Codex` through the managed zsh `codex` wrapper,
   keeping existing user functions/aliases and launch registration semantics.
3. Add focused ownership and fake-CLI shell regressions; run all repository
   gates except golden (no extraction prompt changes). Record investigation
   evidence and pending live indicator/meter checks in docs/TESTING.md.
4. Commit only repair files; leave the user's staged board change untouched.
   Open a PR after green checks. Do not install or restart the running app.
