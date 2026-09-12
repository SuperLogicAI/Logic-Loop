# Plan 012: Decision Tracker reconciliation and truthful answer state

> **Status**: APPROVED for Phase 33. The maintainer wrote the literal
> `PHASE 32 ACCEPTED` on 2026-09-11 and plans to return to Phase 32's remaining
> manual checks separately.

## Outcome

Finish the Decision Tracker lifecycle without adding a new product surface:

1. A later submitted user reply can resolve an older open decision from the
   same agent session.
2. **Answer now** only pre-fills the bound terminal. It does not mark a card
   answered until a structured transcript event proves that the user submitted
   an answer.

This restores the flagship contract in
`docs/context-terminal-concept-and-build-plan.md` §3.2: open decisions survive
until the user answers or explicitly dismisses/delegates them.

## Product contract

- `answered` means Logic Loop observed a submitted user message and the
  reconciliation extractor conservatively matched that message to the open
  decision.
- Clicking **Answer now** focuses the decision's live bound tab and writes the
  existing draft prefix, but performs no database mutation.
- Editing, clearing, or cancelling that draft leaves the decision open.
- Submitting a natural answer later can resolve one or several older open
  decisions, even when the immediately preceding assistant message did not ask
  them again.
- Reconciliation is session-scoped. A reply in one parallel agent terminal
  must not resolve another session's decision merely because both tabs share a
  project cwd.
- Only rows still `open` may be reconciled. `dismissed`, `delegated`, and
  already-`answered` history is immutable through this path.
- Store bounded text from the observed submitted reply as `user_answer`; do not
  invent answer prose from the model.
- Ambiguous replies such as a bare “yes”, “okay”, or “do it” do not reconcile
  an older card unless the submitted reply itself makes the target uniquely
  identifiable. False negatives fail open; false positives silently lose
  decision debt and are unacceptable.
- Reconciliation failure, invalid model output, missing transcript delivery,
  or a database error leaves cards open and never affects terminal input or
  agent execution.
- Transcript and decision text remain untrusted prompt data. The model may
  select only numeric IDs supplied in the candidate list; unknown, duplicate,
  or malformed IDs are rejected.
- No ANSI/PTY output parsing, autonomous terminal input, cross-session fuzzy
  matching, schema migration, dependency, or new panel is in scope.

## Current failure modes

`src/lib/decisions.ts` pairs only the buffered assistant message with the next
user transcript line. After a `Stop` clears that buffer, a later reply has no
path to revisit decisions already stored as `open`.

`src/App.tsx`'s `answerNow` callback currently writes the draft and immediately
sets the row to `answered`. Clearing the input without pressing Enter therefore
creates answer state with no submitted-message evidence.

## Design

### 1. Pure reconciliation contract

Add `src/lib/decisionReconciliation.ts` with:

- a small candidate type containing only `id`, `question`, `assumption`, and
  `ts`;
- a prompt builder that treats candidates and the submitted reply as delimited,
  untrusted data and asks for strict JSON shaped as
  `{"answered_ids":[number,...]}`;
- a strict parser that accepts no prose, validates integer IDs against the
  supplied allowlist, removes duplicates deterministically, and returns `null`
  on any contract violation;
- deterministic prompt bounds so pathological stored text cannot create an
  unbounded extractor call, while ordinary session history remains intact.

The model classifies only which existing questions the observed reply answers.
It does not generate status names or replacement answer text.

### 2. Typed repository operations

Extend `src/lib/repo.ts` with typed accessors only:

- `openDecisionsForSession(sessionId)` returns open candidates in a stable
  order;
- `answerOpenDecisions(sessionId, ids, submittedReply)` conditionally updates
  `status = 'answered'` and `user_answer` only where `session_id` matches and
  the current status is still `open`.

Keep all SQL in the repo layer. Existing columns are sufficient, so Phase 33
adds no migration and does not rewrite historical rows.

### 3. Ingestion-time reconciliation

In `src/lib/decisions.ts`, every parsed `user` transcript message schedules a
reconciliation task through the existing shared `serialize()` queue, whether
or not an assistant buffer exists.

When a user line also closes a fresh assistant/user pair, enqueue
reconciliation first and the existing turn-pair extraction second. The
reconciliation task loads candidate rows inside its serialized callback, so
all earlier Stop extraction work has settled, but decisions newly extracted
from this same assistant/user pair cannot be reconsidered by a second prompt
with conflicting semantics. It skips the extractor when no candidates are
open, validates the returned IDs, conditionally updates the rows, and invokes
the existing refresh callback only after a successful change.

This ordering preserves current extraction semantics while making retries and
duplicate transcript delivery harmless: the conditional `status = 'open'`
update is the idempotency boundary.

### 4. Truthful Answer-now behavior

In `src/App.tsx`, remove the `setDecisionStatus(..., "answered")` call from
`answerNow`. Keep only bound-tab lookup, focus, and the unsent `ptyWrite` draft.
Do not add timers, keystroke inference, optimistic UI, or a second input path.

The card stays open while the draft is visible. If the user submits it, the
adapter's structured transcript event drives reconciliation. If ingestion is
blind, the card truthfully remains open and the existing warning explains why
Decision Tracker evidence is incomplete.

## Scope

- `src/lib/decisionReconciliation.ts` — new pure prompt/validation contract.
- `src/lib/decisions.ts` — schedule same-session reconciliation on submitted
  user transcript messages.
- `src/lib/repo.ts` — typed candidate query and guarded answer update.
- `src/App.tsx` — make **Answer now** prefill-only.
- `scripts/decision-integrity-check.ts` — pure and source-contract assertions.
- `scripts/golden.ts` and `tests/golden/` — add reconciliation-quality fixtures
  to the live extractor gate without weakening the existing 12 cases.
- `package.json` — focused check and aggregate-chain entry.
- `docs/TESTING.md` — Phase 33 automated and live matrices.
- `README.md`, `docs/ROADMAP.md`, `CLAUDE.md`, `plans/README.md`, and this plan
  — truthful phase/product status.

No `src-tauri` change is expected. Stop and revise the plan before proceeding
if the implementation proves to require a schema migration, adapter protocol
change, or a second extractor queue.

## Implementation sequence

### Step 1: Pin the pure contract

Create the reconciliation module and focused check. Cover strict JSON parsing,
unknown IDs, duplicates, non-integer IDs, empty candidates, prompt-injection
text remaining inert data, deterministic ordering, and prompt bounds.

**Verify**: `npm run decision-integrity:check`.

### Step 2: Add guarded repository operations

Add the session-scoped query and conditional status update. Extend the focused
check with source-contract assertions that SQL remains in `repo.ts`, filters on
both `session_id` and `status = 'open'`, and stores the observed reply.

**Verify**: `npm run decision-integrity:check` and `npx tsc --noEmit`.

### Step 3: Reconcile submitted user messages

Add the serialized reconciliation task and call it for every parsed user line
before enqueuing that line's fresh turn-pair extraction. Preserve fail-open
behavior. Do not change `onStop` buffering or adapter eligibility.

**Verify**: focused check, `npm run extractor-queue:check`,
`npm run codex-transcript:check`, and `npm run decisions:check`.

### Step 4: Remove the premature state mutation

Make `answerNow` prefill-only and pin the absence of a status update in the
focused source contract. Preserve the rule that the app never presses Enter.

**Verify**: focused check, `npm run spawn:check`, and strict TypeScript.

### Step 5: Prove model quality and document the lifecycle

Add reconciliation fixtures covering an explicit later answer, multiple old
questions with one addressed, explicit delegation wording, an ambiguous bare
affirmation, an unrelated reply, multiple questions answered together, and a
prompt-injection attempt embedded in decision/reply text. Run the live golden
gate because Phase 33 adds an extraction prompt.

**Verify**: `npm run golden` passes the existing 14 extraction fixtures plus
the new reconciliation fixtures, then complete the manual matrix below.

## Manual acceptance matrix

Use a disposable decision/session where cleanup cannot alter real work.

- [ ] Ask two genuine questions, answer only one, and confirm the unanswered
      card remains open.
- [ ] Complete another turn, then naturally answer the old question. The old
      card becomes answered, records the submitted reply, and its tab/project
      badge decrements without a reload.
- [ ] Open same-project sessions in two tabs. A reply in session B does not
      clear a semantically similar open decision from session A.
- [ ] Click **Answer now**. The correct live tab focuses and receives only the
      draft prefix; the card and badge remain open.
- [ ] Clear/cancel the draft without submitting. Switch tabs and wait through a
      refresh; the card remains open.
- [ ] Click **Answer now**, complete the draft, and press Enter manually. Only
      the resulting structured user transcript event can close the card.
- [ ] Submit an unrelated reply and an ambiguous bare affirmation. Old cards
      remain open.
- [ ] Explicitly answer two old questions in one submitted message. Exactly
      those two cards close; other open cards remain.
- [ ] Break or disable transcript delivery in a disposable setup. Answering in
      the terminal does not optimistically clear the card, terminal operation
      remains normal, and the existing blind-session warning is visible.
- [ ] Quit/relaunch after a reconciled answer and after a cancelled draft.
      Answered/open state survives accurately.
- [ ] Repeat with Claude and Codex transcript-backed sessions. OpenCode and
      Antigravity remain honestly labeled unsupported.

## Full verification

Run the focused check first, then:

```bash
npm run golden
npm run opencode:check
npm run check
npx tsc --noEmit
npm run build
cd src-tauri && cargo test --lib
cd src-tauri && cargo clippy --all-targets -- -D warnings
git diff --check
```

The existing Vite chunk-size advisory is allowed. Golden is mandatory because
this phase introduces a new extraction prompt.

## Done criteria

- [x] The literal `PHASE 32 ACCEPTED` was recorded before implementation.
- [ ] **Answer now** performs no decision-status mutation.
- [ ] Every automatic `answered` transition is backed by a structured submitted
      user message and a conservative same-session match.
- [ ] Cancelled drafts, ambiguous replies, extractor failures, and missing
      transcripts leave decisions open.
- [ ] Conditional writes are idempotent and cannot reopen or rewrite closed
      history.
- [ ] Focused, golden, aggregate, TypeScript, build, Rust, clippy, and whitespace
      gates pass.
- [ ] The live matrix is recorded without private transcript content.
- [ ] No adapter capability, schema, dependency, autonomous input, or unrelated
      product surface changed.

## STOP conditions

Stop and report instead of improvising if:

- the maintainer has not written `PHASE 32 ACCEPTED`;
- Phase 32 receives a failing live disposition that must be fixed first;
- reliable matching appears to require PTY/ANSI parsing or cross-session fuzzy
  inference;
- implementation requires a migration, adapter protocol change, second queue,
  or new external dependency not approved here;
- the new reconciliation golden cases cannot pass without weakening the
  existing decision-extraction contract;
- a focused or full gate fails twice after one reasonable correction.
