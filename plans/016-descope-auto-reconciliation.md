# Plan 016 — Descope automatic reconciliation

## Phase gate

Not a new numbered phase — a partial rollback of Phase 33's core feature.
Directed live by the maintainer 2026-09-12 after `plans/015-decision-panel-
freeze-investigation.md`'s live-test findings: automatic (LLM-guessed)
reconciliation isn't load-bearing, and it's the trigger for both the known
duplicate-card artifact and a card-not-closing bug found this session.
Awaiting explicit maintainer go-ahead in chat before implementation, same
as any other build — this doc is the spec for that approval, not
authorization to start.

## What stays

- **Extraction** (Phase 3) — surfacing cards when the assistant asks a
  question or states an assumption. Unchanged.
- **Answer-Now** — deterministic, zero-latency, zero-model-call card close
  via exact string match (`matchAnswerNowReply`). Unchanged.
- **Manual dismiss** (the × on a card). Unchanged.
- **Insert-time dedup** (`insertDecision` collapsing a restated open
  question into its existing card). Unchanged — deterministic, cheap,
  exactly the "sharp takeaway" behavior worth keeping.
- **Notifications / Attention Inbox** — the actual mechanism for staying
  aware of open decisions across sessions/projects, already excludes stale
  sessions from the count. Unchanged.

## What goes

The LLM-guessed natural-language reconciliation call: on every user
message, re-running `run_extractor` to guess whether the reply answers any
currently-open decision elsewhere in the session. This is the entire
`reconcile()` branch below the Answer-Now check in `src/lib/decisions.ts`.

## Changes

- `src/lib/decisions.ts` — `reconcile()` simplifies to: load candidates,
  check `matchAnswerNowReply`, close on match, otherwise return `false`.
  Drop the `shouldSkipReconciliation` gate and the `run_extractor` call
  entirely — there's no guess left to gate. Remove now-unused imports
  (`buildReconciliationPrompt`, `parseReconciliation`,
  `shouldSkipReconciliation`).
- `src/lib/decisionReconciliation.ts` — remove `buildReconciliationPrompt`,
  `parseReconciliation`, `shouldSkipReconciliation`, `isBareAffirmation`,
  `hasContentWordOverlap` (dead once `decisions.ts` stops calling them).
  Keep `matchAnswerNowReply`, `boundedSubmittedReply` (also used by
  `repo.ts`'s `answerOpenDecisions` for the stored-reply bound, independent
  of the guess path), and the `ReconciliationCandidate` type.
- `src/types.ts` — remove `ExtractorSettings.reconcileModel`.
- `src/lib/repo.ts` — stop reading/writing the `reconcile_model` settings
  key in `getExtractorSettings`/`setExtractorSettings`. No migration: it's
  a key-value settings table, an orphaned existing row is harmless and
  never read again.
- `src/components/SidebarLmControl.tsx` — remove the "Reconciliation
  model" haiku/sonnet toggle. Leave the backend/model controls for
  extraction, lmstudio, and codex untouched.
- `scripts/golden.ts` — remove the `kind === "reconciliation"` fixture
  handling (lines ~150-220 per the current file); golden becomes
  extraction-only.
- `tests/golden/15-*.json` through `21-*.json` (7 reconciliation fixtures)
  — delete. They test a code path that no longer exists.
- `scripts/decision-integrity-check.ts` — remove assertions for the five
  deleted functions. Replace the existing "`reconcile()` calls
  `matchAnswerNowReply`, `shouldSkipReconciliation`, and `run_extractor`"
  source-shape assertion with the opposite contract lock: `reconcile()`'s
  source contains `matchAnswerNowReply(` and does **not** contain
  `run_extractor` — pins "no model call in this function, ever" the same
  way the codebase already pins other behavioral contracts by source
  inspection.
- `docs/TESTING.md` — mark §45/§47's reconciliation-model-control checklist
  items as superseded (feature removed, not re-tested), add a new manual
  section for this change (see below).
- No Rust changes. `run_extractor` itself is untouched — extraction still
  calls it with a hardcoded `"sonnet"`, `landing.ts`/`commitMessage.ts` are
  unaffected.

## Explicitly out of scope

- The freeze bug (`plans/015`) — still open, still needed post-descope
  since extraction remains.
- The card-not-closing-on-clear-answer bug found this session — moot once
  the guessed-match path it lived in is gone.
- Any settings migration for the orphaned `reconcile_model` row.

## Risk

Low. Answer-Now and extraction are untouched; this only removes a code
path. Straightforward single-commit revert if the maintainer wants
automatic reconciliation back.

## Verification

- `npm run golden` — extraction-only now (14 fixtures, down from 21).
- `npm run decision-integrity:check` — updated contract-lock assertions.
- `tsc --noEmit`, `npm run check`, production build.
- `cargo test`/clippy unaffected (no Rust changes) — still run as a merge
  gate per house convention.
- `git diff --check`.

## Manual test (new docs/TESTING.md section)

- [ ] Open ⚙ Sidebar LM: confirm the "Reconciliation model" control is gone,
      other controls (backend, extraction model info, lmstudio/codex)
      unaffected.
- [ ] Create an open decision card, answer it in plain natural language
      (not Answer-Now, not the exact question text). Confirm it does
      **not** auto-close, and no `extractor: claude usage` log line
      appears for that reply.
- [ ] Click Answer-Now on an open card, submit the prefilled line
      unedited. Confirm it still closes deterministically.
- [ ] Manually dismiss (×) an open card. Confirm it closes.
- [ ] Ask the agent to restate an already-open question. Confirm no
      duplicate card (insert-time dedup still holds).
