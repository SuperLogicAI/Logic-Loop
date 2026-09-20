# Plan 036: Prove faster project re-entry with existing evidence

## Status

CANDIDATE — not implemented or approved. P2 direction experiment; M (1–2 build days plus observed sessions); risk MED. Depends on accepted 035; pilot evidence from the beta decides final scope.

## Why and what to build

Make the app's interruption-recovery value clear in one compact view, using data already computed. This implements the bounded presentation idea at docs/IDEAS.md:751–768; it does not add an AI summary pipeline.

## Current state and scope

- `SidePanel.tsx:401–404`: `boardCards.find((c) => c.now) ?? topPlannedCard(boardCards)` already selects human priority.
- At 413–427, lastLeft → eventsSince/decisionsOpenedSince → summarizeDelta/groupIterations builds the existing Since-you-left data; scopeBySession prevents cross-session attribution.
- Landing notes and the Next card already exist. Re-entry is explicit user-triggered process spawn in App.tsx; Attention already routes users to relevant evidence.

Allowed: SidePanel.tsx, a small ReentryBrief.tsx/new pure lib/reentryBrief.ts if useful, existing delta/attention helpers only for presentation contracts, a narrow repo read helper only if current data is insufficient (no schema change), component/pure tests and package script wiring, docs/TESTING and local pilot notes under plans/. Out: new model calls, generated agent instruction files, new panels alongside duplicate summaries, new ingestion, auto-resume/input, cloud telemetry, broad navigation search.

## Steps and regression plan

1. Review consented pilot observations: where did people fail—installation, activation, keyboard use, or recovering context? If activation/reliability remains dominant, stop and propose a revised sprint; do not assume another surface fixes it. No invented user feedback. Without participants, prototype only and mark the adoption hypothesis unvalidated.
2. Render one compact replacement/extension of the existing Since-you-left area: project/agent/branch; “You left” from human landing note; “Changed” from bounded delta facts; “Needs you” from correctly scoped open items; “Next” from explicit Now card or existing deterministic priority. Mark unknown/empty distinctly; absence of transcript data is not “nothing happened.” Preserve activity-only adapter language. Verify new pure tests for empty/no anchor, same-cwd multiple sessions, unbound fan-out, missing transcript and stale/deleted source.
3. Provide links to existing underlying decision, tool/diff, note or board item routes. If there is no valid target, use disabled/explanatory text rather than guessed navigation. Avoid a generated prose summary and double-rendering the same information above and below. Verify `npm run test:ui`, `npm run delta:check`, `npm run attention-inbox:check`, and `npm run reentry:check`; assert tab switching invokes no run_extractor path introduced by this feature.
4. Observe 3–5 users leave a project and return. Time correct identification of changed work/next action, count wrong-project actions and assistance. Compare with the old presentation using a similar task and counterbalanced order when feasible. Proposed target: 4/5 identify next action within 30 seconds; small-sample results are directional. If there is no improvement, simplify/revert the presentation and document learning rather than asserting success.
5. Run gates, record evidence, and update next-cycle priorities from observed friction. Prepare any shareable demo locally; sending/publishing requires separate instruction.

## Maintenance

The brief is a deterministic view, not a new source of truth. Every displayed claim needs a bounded source and correct project/session scope. Do not introduce model calls on navigation or assume Markdown quoting makes agent-authored instructions safe.


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
