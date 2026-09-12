# Plan 014 — Reconciliation defaults to haiku

## Phase gate

Sidequest, directed live by the maintainer on `feat/phase33.1-haiku-default`
(branched from the committed Phase 33.1 work on
`feat/phase33-decision-integrity`), not a formally gated numbered phase —
same precedent as prior sidequests (Codex adapter ahead of Phase 9, Lock-in
DnD ahead of Phase 26). No separate `PHASE ... ACCEPTED` token was required;
the instruction to commit 33.1, branch, and implement this was itself the
authorization.

Trigger: an outside model's tip, relayed by the maintainer, that
extraction/reconciliation are "classification + short JSON extraction —
haiku-class" work, that the 21-case golden set should judge it rather than
intuition, and that Plan 013's haiku attempt only covered the reconciliation
path.

## What was actually found (diverges from the tip in one place)

1. Added `EXTRACTOR_MODEL` env var to `scripts/golden.ts` — forces one model
   across every fixture. `EXTRACTOR_MODEL=haiku npm run golden`:
   - Extraction (14 fixtures): 14/14 on two of three full runs; one run
     failed `09-question-in-code` (over-extracted a decision from a question
     embedded in a code comment — the exact case that fixture exists to
     catch). Four additional isolated re-runs of that fixture: 4/4 clean.
     Combined: **1 miss in 7 attempts (~14%)** on an adversarial case.
   - Reconciliation (7 fixtures, 2 gated at 0 spawns regardless of model):
     all 5 non-gated cases failed on attempt 1 — not an accuracy miss, a
     format one: haiku wraps `{"answered_ids":[...]}` in ` ```json ` fences,
     and `parseReconciliation` (unlike `parseExtraction`) had no fence
     tolerance.
2. Fixed `parseReconciliation` to strip ` ```json `/` ``` ` fences before
   parsing — identical treatment to `parseExtraction`, same schema
   validation underneath, so no loosening of the strict contract or the
   injection-resistance guarantee (`21-reconcile-prompt-injection` still
   passes). Updated the one test in `decision-integrity-check.ts` that had
   locked in the old "fences rejected" behavior as intentional.
3. Re-ran `EXTRACTOR_MODEL=haiku npm run golden` **3 full times** (not once —
   a single pass would have missed fixture 09's flakiness) after the fence
   fix: reconciliation clean 3/3; extraction 2/3, same `09` miss pattern.

Per the rule this experiment was explicitly run under ("any miss, that path
stays sonnet"): reconciliation defaults to haiku, extraction does not. This
is a narrower result than the tip's own "21/21 → default haiku everywhere"
framing — the golden set, run enough times to catch a ~14% flake rate,
disagreed with the intuition that one clean run would settle it.

## Changes

- `src/lib/decisionReconciliation.ts` — `parseReconciliation` fence
  tolerance.
- `src/types.ts` — `ExtractorSettings.reconcileModel: "haiku" | "sonnet"`.
- `src/lib/repo.ts` — `getExtractorSettings`/`setExtractorSettings` persist
  `reconcile_model` (existing settings k/v table, no migration).
- `src/lib/decisions.ts` — `reconcile()` passes `model: s.reconcileModel`
  instead of the hardcoded `"sonnet"`.
- `src/components/SidebarLmControl.tsx` — new "Reconciliation model"
  haiku/sonnet control, shown only for the claude backend.
- `scripts/golden.ts` — `EXTRACTOR_MODEL` env var (forces one model for
  every fixture); unset mirrors the shipped per-path defaults
  (sonnet extraction, haiku reconciliation).
- `scripts/decision-integrity-check.ts` — updated fence-tolerance assertion,
  added a "leading prose still rejected" case so the contract isn't silently
  weakened beyond fences.
- Extraction's model stays a hardcoded literal in `decisions.ts`'s `extract()`
  — deliberately not wired to a setting, since sonnet is the only golden-clean
  choice today.

## Measured

| path | model | golden result |
|---|---|---|
| extraction | sonnet | 21/21 baseline (unchanged, Phase 33.1) |
| extraction | haiku | 2/3 full runs clean; `09-question-in-code` false-positive ~1-in-7 across 7 attempts |
| reconciliation (pre fence-fix) | haiku | 0/5 non-gated cases (format rejection, not accuracy) |
| reconciliation (post fence-fix) | haiku | 3/3 full runs clean |
| shipped default mix (sonnet extraction, haiku reconciliation) | — | 21/21 |

## Not done

- No live UI test of the new `⚙ Sidebar LM` "Reconciliation model" control.
- No attempt to fix extraction's `09-question-in-code` flakiness (e.g. a
  stricter extraction system-prompt) — out of scope for a cost sidequest;
  extraction stays on sonnet, which has never shown this failure.
- No change to `landing.ts`/`commitMessage.ts` model defaults — those are
  freeform prose tasks with no golden coverage, out of scope here.

## Manual test (docs/TESTING.md §47)

Machine-verifiable via golden; the one thing that needs a live click:

- [ ] Open ⚙ Sidebar LM with backend = claude. Confirm the "Reconciliation
      model" control appears, defaults to haiku, and toggling to sonnet
      persists across a reload.
