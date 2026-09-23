# Plan 043: Potential next-action suggestion buttons

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. Stop
> on any condition listed below; do not improvise. When finished, update this
> plan, `plans/README.md`, `docs/TESTING.md`, and `docs/PROGRESS.md` with the
> actual evidence.
>
> **Phase gate**: This plan proposes a new phase. Implementation must not
> begin until the maintainer writes the literal token `PHASE 43 ACCEPTED`
> against a clean `main`.
>
> **Drift check (run first)**:
> `git diff --stat 0bee6d5..HEAD -- src/lib/decisions.ts src/lib/extractor.ts src/lib/board.ts src/lib/repo.ts src/components/AgentStatusBar.tsx src/components/SidePanel.tsx package.json docs/TESTING.md docs/PROGRESS.md plans/README.md`
> If an in-scope file changed, compare it with Current state below. Stop on an
> incompatible contract and revise this plan before implementation.

## Status

- **Status**: PROPOSED — not yet accepted, not started
- **Priority**: P2 — quality-of-life, not adoption-blocking
- **Effort**: S — deterministic tier is now a small extraction refactor plus
  one new error-retry signal, well under a half day; LLM-riding tier adds
  roughly a quarter day once the extraction schema is touched
- **Risk**: LOW — additive UI, no new spawn/PTY surface; the optional tier
  touches the extraction prompt, which is the one part of this plan reviewed
  carefully (invariant #5)
- **Depends on**: `PHASE 43 ACCEPTED`; clean `main`
- **Category**: direction
- **Planned at**: commit `0bee6d5`, 2026-09-23

## Why this matters

Idea doc `docs/IDEAS.md` §"Mid-September Idea Runway", item 3: up to three or
four standalone follow-up prompts shown after a completed turn, clickable but
never auto-sent (invariant #4). The idea doc's own framing assumed this rides
the extraction call. Discussion before this plan concluded that framing is
incomplete: a fully deterministic tier is possible and should ship as the
default, with the LLM-riding tier demoted to an explicit opt-in toggle rather
than the only implementation.

Two tiers, same UI slot, independently useful:

1. **Deterministic (default, ships always on).** Reads structural signals
   that already exist at the moment a turn ends — no model call, no new
   tokens, invariant #3-clean. Reacts to the fact a turn just ended, not to
   what the turn said.
2. **LLM-riding (opt-in, default OFF).** Adds one field to the decision
   extraction call that already fires once per turn pair (`src/lib/
   extractor.ts`, `EXTRACTION_SCHEMA`). Near-zero marginal cost since the call
   already happens and already enforces `--json-schema` (Phase 39/PR 56), but
   it is still a token-dependent path and must be a setting the user turns on,
   not a silent default — per the idea doc's own "toggle on/off if token
   spend increased for lean ops" note.

Tier 2 must never gate or degrade tier 1. If the LLM field is absent,
malformed, or the extraction call fails outright, deterministic buttons still
render exactly as if tier 2 were off (invariant #2, fail open).

**Correction from the design discussion that produced this plan (v2 of this
doc):** `SidePanel.tsx` already ships a "Next" momentum card
(`SidePanel.tsx:623-659`) that cascades latest open landing note → oldest
open decision → oldest open blocker → planned board card's `next`, and
renders one item with a "✓ Done" resolve action. The first draft of this
plan proposed re-reading blockers and board Now-cards independently for tier
1 — that would have silently reimplemented momentum's cascade with a
different priority order. Corrected split:

- **Reuse, don't duplicate.** Extract momentum's cascade into a pure shared
  function; tier 1's only "backlog" source is that same function's result,
  surfaced as a second action on the *existing* Next card — an "↳ Ask"
  button next to "✓ Done" that seeds the terminal input with `momentum.text`
  instead of resolving it. No new component, no new turn-Stop hook, no new
  DB read for this part.
- **The genuinely new signal is error-retry.** Momentum has no concept of "a
  turn just failed, resend it." That's the one piece that needs new
  turn-scoped plumbing and is the actual reason this feature needs a home
  near the terminal, not just inside the side panel.
- Tier 2 (LLM-sourced suggestions) is the one that needs a dedicated
  multi-item render slot, since it can return up to 3 items and has no
  existing UI home the way momentum does.

## Current state

- `src/lib/decisions.ts::onStop` (`decisions.ts:263-286`) and `onTranscript`
  (`decisions.ts:226-261`) are the two points where the app knows a turn has
  ended — `onStop` fires on the `Stop` hook after a 2s delay for the
  transcript tailer; `onTranscript` fires when a `user/message` closes a
  pending assistant turn. Both call `enqueue(...)` which drives `extract()`
  (`decisions.ts:147`) against `src/lib/extractor.ts`'s `buildPrompt`/
  `EXTRACTION_SCHEMA`. This is the one call-site touched by tier 2.
- `src/lib/extractor.ts` is a pure module: `buildPrompt(pair): string` and
  `EXTRACTION_SCHEMA` (JSON Schema string). No I/O. Used by both the app
  pipeline and the golden runner (`npm run golden`), so any schema change
  here is a golden-fixture-affecting change.
- `SidePanel.tsx:623-659` computes `momentum` inline from component-scoped
  `decisions`, `blockers`, `landing`, `plannedCard` state: latest open
  landing note → oldest open decision → oldest open blocker → planned board
  card's `next ?? title`. Renders one item with a "✓ Done" action
  (`finishMomentum`, `SidePanel.tsx:661-668`) that resolves/advances
  whichever source won the cascade. This plan extracts that cascade into a
  pure function so both the existing Next card and this feature's "↳ Ask"
  button consume identical logic — the cascade itself does not change.
- `src/lib/repo.ts::listBlockers(cwd)` (`repo.ts:539`) and
  `readBoard(project_key)` → `parseBoard` (`src/lib/board.ts`) are the reads
  momentum already performs. This plan does not add a second independent
  read of either — see Scope.
- `src/lib/repo.ts` has a generic `settings` key/value table with an
  established boolean-flag pattern: `setClaudeStatuslineWrapperEnabled`
  (`repo.ts:904-912`, key `claude_statusline_wrapper_enabled`, value `"1"`/
  `"0"`). Tier 2's toggle follows this exact pattern with a new key
  `next_actions_llm_enabled`, global scope (matches the idea doc's "lean
  ops" framing — a spend-rate concern, not a per-project one).
- No component currently renders anything at turn-Stop besides the existing
  Decision-card/AttentionInbox pipeline. This plan adds a new UI slot, not an
  extension of an existing one.
- Reporting an error on the just-ended turn already exists:
  `reportTurnError`-equivalent signal is the hook payload's turn-end reason;
  confirm exact shape live in Step 0 rather than assuming it matches the
  DeepSeek Harness runner's local `reason.kind === "error"` shape (Plan 040's
  pattern is a different code path — Claude/Codex/etc. hooks, not the
  Harness session API).

Repository constraints:

- Never send terminal input autonomously (invariant #4). A suggestion button
  seeds the input box; it never calls whatever the codebase uses to submit a
  turn on its own.
- Panels are SQL views (invariant #3). The deterministic tier must not
  introduce a new derived table or a background job — compute at render time
  from existing reads.
- Treat all extracted/agent-authored text as untrusted data (invariant #5).
  LLM-produced `next_actions` strings are the model's own text, rendered
  as literal button labels/seed text — never interpreted, executed, or
  concatenated into another prompt unescaped.
- Fail open (invariant #2): a broken or disabled LLM tier must never affect
  decision extraction, panels, or the deterministic buttons.

## Scope

**In scope**:

- `src/lib/momentum.ts` (new) — extract the cascade currently inline in
  `SidePanel.tsx:623-659` into a pure `computeMomentum(input):
  MomentumItem | null` function, byte-identical behavior. `SidePanel.tsx`
  imports it instead of computing inline; the Next card's rendering, "✓
  Done" action, and priority order do not change.
- `SidePanel.tsx` — add a second action, "↳ Ask", next to the existing "✓
  Done" button on the Next card. Seeds the terminal input with
  `momentum.text` for the session's active tab; does not call
  `finishMomentum`, does not resolve/advance anything.
- `src/lib/nextActions.ts` (new) — much smaller than the first draft: pure
  function(s) combining (a) an optional error-retry suggestion for the turn
  that just ended and (b) tier 2's LLM-sourced suggestions when enabled. No
  blocker/board/decision reads here — those stay exclusively in
  `momentum.ts`.
- `src/lib/extractor.ts` — add optional `next_actions` array to
  `EXTRACTION_SCHEMA` and one instruction block to `buildPrompt`, gated by a
  parameter (not a global read) so the pure module stays side-effect-free.
- `src/lib/decisions.ts` — thread the `next_actions_llm_enabled` setting into
  the `extract()` call site; expose a callback or store update the UI can
  subscribe to, following whatever pattern `onExtractionSucceeded`/`onDone`
  already use.
- `src/lib/repo.ts` — `next_actions_llm_enabled` getter/setter following
  `setClaudeStatuslineWrapperEnabled`'s exact shape.
- A new small component (exact host TBD in Step 0 — likely
  `AgentStatusBar.tsx`) rendering the error-retry button (when present) plus
  up to 3 LLM suggestions when tier 2 is on, cleared on the next
  `UserPromptSubmit`. This is the only new multi-item render surface; the
  momentum-derived suggestion lives on the existing Next card, not here.
- Toggle UI: one row in the existing Setup/settings surface (wherever
  `claude_statusline_wrapper_enabled` is exposed today — confirm in Step 0),
  off by default, with the idea doc's own cost caveat as the row's helper
  text.
- `scripts/momentum-check.ts` (new) — characterization fixtures proving
  `computeMomentum` matches the pre-extraction cascade exactly (landing note
  → decision → blocker → planned card, each source alone and combined), run
  before the `SidePanel.tsx` refactor lands so a behavior change would fail
  the test rather than ship silently.
- `scripts/next-actions-check.ts` (new) — fixtures for error-retry
  presence/absence and LLM-suggestion merge/cap; no blocker/board fixtures
  here (those belong to `momentum-check.ts`).
- `package.json` — register `momentum:check` and `next-actions:check` in the
  aggregate `check` script, alphabetically adjacent to the existing
  `*:check` block.
- `docs/TESTING.md`, `docs/PROGRESS.md`, `plans/README.md` — evidence on
  completion.

**Out of scope**:

- Auto-send of any suggestion. A click only seeds the input; the user still
  presses enter/send (invariant #4, same as the idea doc's own constraint).
- Any change to momentum's priority order, its "✓ Done" resolution behavior,
  or which source wins the cascade — this plan extracts that logic verbatim,
  it does not revise it.
- A second, independent read of blockers or board cards outside
  `momentum.ts`. If a future feature needs that data, it should also import
  `computeMomentum`/its inputs rather than adding a third copy of the query.
- Per-project toggle. Tier 2 is one global setting, matching the "lean ops"
  spend framing, not a per-project trust decision like CONTEXT.md's import.
- Cron/scheduled firing of a suggestion (idea doc item 4 — explicit hard no,
  unrelated to this plan).
- Any change to `streamAssistantText`, terminal rendering, or the DeepSeek
  Harness runner (`dsh-terminal-app/`) — this is a core-app panel feature,
  not adapter-specific.
- New extraction backends, queues, or golden-runner changes beyond the schema
  string itself.
- Changing the existing `decisions` extraction behavior, prompt wording for
  decision extraction, or its accuracy — tier 2 only adds a field alongside.
- A generalized "suggestions" framework covering things other than this one
  button strip.

## Git workflow

- After phase acceptance, branch `feat/next-action-suggestions` from clean
  `main`.
- Conventional commits, e.g. `feat(next-actions): add deterministic
  suggestion buttons` and a separate commit for the opt-in LLM tier so either
  can be reverted independently.
- Do not push or open a PR unless instructed.

## Steps

### Step 0: Confirm the exact turn-end signal, momentum's exact inputs, and toggle-UI host

Before touching any file, confirm live (reading the current call sites, not
assuming from this plan's Current state section):

1. The exact shape of "this turn ended in error" available at the same point
   `onStop`/`onTranscript` fire — which hook payload field, and whether it is
   uniformly available across Claude/Codex/OpenCode/Pi/DeepSeek adapters or
   only some. If it's adapter-specific, error-retry is scoped to adapters
   where the signal is confirmed reliable; note the rest as unsupported
   rather than guessing.
2. Whether the exact prior user-submitted text is already captured per
   session somewhere independent of decision extraction's assistant-side
   buffering (needed verbatim for a retry to resend it), or whether this
   step must add that capture. If it must be added, treat it as new scope
   and confirm it doesn't duplicate something `decisions.ts` already tracks
   internally but doesn't expose.
3. `SidePanel.tsx`'s exact prop/state names for `decisions`, `blockers`,
   `landing`, `plannedCard`, and `cwd` (`SidePanel.tsx:623-631`), to define
   `computeMomentum`'s input type precisely rather than guessing field names.
4. Where per-project vs. global settings toggles currently render in the UI
   (`OnboardingModal.tsx` Setup checklist vs. some other settings surface),
   to place the tier-2 toggle in the pattern users already expect.

**Gate**: proceed only once the error-turn signal, the retry-text source, and
momentum's exact input shape are confirmed against live code. If the error
signal doesn't exist uniformly, revise scope to drop error-retry rather than
fabricate one.

**Verify**: findings recorded in this plan's Current state section before
Step 1 begins.

### Step 1: Extract momentum into a shared pure function (no behavior change)

- Add `src/lib/momentum.ts` with `computeMomentum(input): MomentumItem |
  null`, moving `SidePanel.tsx:623-659`'s cascade verbatim — same priority
  order (landing note → decision → blocker → planned card), same `text`/
  `label` shape. `done()` stays a `SidePanel.tsx`-local concern (it calls
  component-scoped `reload()`/`onBlockersChanged()`/`onDecisionsChanged()`
  after); the pure function only picks the item and exposes what's needed to
  both resolve it (existing behavior) and seed it as a prompt (new).
- `scripts/momentum-check.ts`: fixtures proving `computeMomentum` picks the
  same item the old inline logic would, for each source alone and combined,
  including the empty case (nothing open → `null`, no card renders — this
  must stay true).
- Refactor `SidePanel.tsx` to call `computeMomentum`, deleting the inline
  version. No visible or behavioral change to the existing Next card in this
  step.

**Verify**: `npm run momentum:check` passes; manual check that the Next card
in a project with a known open decision/blocker still shows the identical
item and label it did before the refactor.

### Step 2: "↳ Ask" action on the existing Next card, plus error-retry

- In `SidePanel.tsx`, add an "↳ Ask" button beside the existing "✓ Done"
  button on the Next card (renders only when `momentum` is non-null, same
  condition as today). Clicking it seeds the terminal input for the
  session's active tab with `momentum.text` and focuses it — no call to
  `finishMomentum`, nothing marked resolved.
- Add `src/lib/nextActions.ts`: `errorRetrySuggestion(input): Suggestion |
  null`, pure, using the turn-end error signal and retry text Step 0
  confirmed. Returns `null` when the turn didn't error or the signal isn't
  available for that adapter.
- Render the error-retry suggestion (when present) in the small new
  component from Scope, near the terminal, at turn-Stop. Clicking it seeds
  the input with the exact prior prompt text; does not resubmit.
- Clear the error-retry suggestion on the next `UserPromptSubmit` for that
  session. Momentum's "↳ Ask" has no clear-on-submit behavior — it's tied to
  standing backlog state, not the just-ended turn, and disappears only when
  momentum itself becomes `null` (its source resolved).

**Verify**: manual — (a) click "↳ Ask" on an existing Next card, confirm
input is seeded and nothing is marked done; (b) force a turn to end in
error, confirm the retry suggestion appears near the terminal and seeds the
exact prior prompt; (c) send a new turn, confirm the retry suggestion
clears.

### Step 3: Extraction schema field (LLM tier, additive only)

In `src/lib/extractor.ts`:

- Add `next_actions: string[]` (max 3 entries enforced by prompt instruction
  and re-validated on parse, not trusted from the model) as an **optional**
  property alongside `decisions` in `EXTRACTION_SCHEMA`. Keep it outside
  `required` so a model/backend that ignores it still validates.
- Add one short instruction block to `buildPrompt` describing the field:
  up to 3 standalone follow-up prompts in the user's own voice, grounded only
  in what was just said, empty array if none apply. Reuse the existing
  "output ONLY JSON, no prose" framing already in the prompt — do not
  duplicate or contradict it.
- `parseExtraction` (wherever it lives today — confirm in Step 0/here) must
  treat a missing, malformed, or over-length `next_actions` as an empty list,
  never a parse failure for the whole extraction result (invariant #2 — this
  field's failure must not affect decision extraction).

Extend `npm run golden` fixtures only if golden explicitly checks schema
shape; if golden only checks `decisions` output, no fixture change is needed
— confirm before touching golden.

**Verify**: existing decision-extraction tests and `npm run golden` (if
applicable) still pass unchanged; new fixtures in
`scripts/next-actions-check.ts` (or `decisions`'s own check script — match
whichever already covers extractor parsing) prove malformed/absent
`next_actions` never throws and never blocks `decisions` parsing.

### Step 4: Toggle setting and merge logic

- `src/lib/repo.ts`: `getNextActionsLlmEnabled()` / `setNextActionsLlmEnabled
  (enabled)` following `setClaudeStatuslineWrapperEnabled`'s exact shape,
  key `next_actions_llm_enabled`, default OFF when unset.
- `src/lib/decisions.ts`: read the setting once per `extract()` call (not
  cached indefinitely — a toggle flip should take effect on the next turn,
  not require a restart). When ON and the extraction call succeeds with a
  nonempty `next_actions`, merge its entries with the error-retry suggestion
  (if present) in the new strip component, error-retry first, capped at 4
  total, deduped by text. When OFF, never include the field in what's sent
  to parse, or ignore it if the schema always includes it — whichever keeps
  the prompt smaller when the toggle is off, since the point of the toggle
  is spend control, not just display control. Momentum's "↳ Ask" on the Next
  card is unaffected by this toggle either way — it's tier 1, not tier 2.
- Toggle UI: one row in whatever surface Step 0 identified, default
  unchecked, helper text stating this adds output to a call that already
  runs per turn and may add turns to their statusline usage.

**Verify**: with the setting OFF, extraction call output has no
`next_actions` cost (prompt does not ask for it) and the strip shows only
error-retry (or nothing). With it ON, a mocked/fixture extraction response
including `next_actions` produces a merged strip capped at 4, error-retry
first.

### Step 5: Register the checks and run full gates

Add `"momentum:check": "tsx scripts/momentum-check.ts"` and
`"next-actions:check": "tsx scripts/next-actions-check.ts"` to
`package.json` and register both in the aggregate `check` script, alongside
the other `*:check` entries.

```bash
npm run momentum:check
npm run next-actions:check
npm run decisions:check
npm run decision-integrity:check
npm run onboarding:check
npm run check
npx tsc --noEmit
npm run build
cd src-tauri && cargo test --lib
cd src-tauri && cargo clippy --all-targets -- -D warnings
git diff --check
```

Run `npm run golden` only if Step 3 touched a golden-relevant fixture; state
explicitly in the PR/plan update whether it ran and why.

**Verify**: all commands above exit 0; `git status --short` shows only
Scope-listed paths changed.

### Step 6: Manual acceptance pass

1. Open decision or blocker present: Next card shows "↳ Ask" beside "✓
   Done"; clicking "↳ Ask" seeds input with `momentum.text` and does not
   mark anything resolved; "✓ Done" still works exactly as before.
2. Nothing open (no landing note/decision/blocker/planned card): no Next
   card renders — unchanged from current behavior.
3. Toggle OFF (default): force a turn to end in error → only the error-retry
   suggestion appears near the terminal; no LLM-sourced entries.
4. Toggle ON: complete a turn where the assistant's reply plausibly suggests
   a follow-up → LLM-sourced entries appear in the strip, error-retry first
   if both are present, capped at 4 total.
5. Toggle ON, force a malformed/timed-out extraction response (same fixture
   path used for existing decision-extraction failure testing) → decision
   extraction still degrades exactly as it does today; the strip falls back
   to error-retry-only or empty; nothing throws in the UI.
6. Two tabs, two different projects, one with the toggle globally ON — since
   this is a global setting, confirm both tabs get the LLM tier (no silent
   per-project scoping bug).

## Test plan

- Characterization fixtures for `computeMomentum`: each source alone,
  combined, empty → `null`, proven identical to the pre-refactor inline
  logic.
- Pure fixtures for `errorRetrySuggestion`: present/absent, adapters where
  the signal is unavailable.
- Extractor: `next_actions` optional field round-trips; absent/malformed
  never fails `decisions` parsing.
- Repo: toggle getter/setter default-OFF, round-trip, matches the
  `claude_statusline_wrapper_enabled` test shape.
- Six-row manual matrix above.

## Done criteria

- [ ] Step 0 findings recorded before implementation began.
- [ ] `computeMomentum` extraction is behaviorally identical to the
      pre-refactor inline cascade — proven by `momentum:check`, not assumed.
- [ ] Momentum's "↳ Ask" ships default-on, zero new token cost, zero new DB
      read (reuses momentum's existing inputs), invariant #3 clean.
- [ ] Error-retry ships default-on where the turn-end signal is confirmed
      available, zero token cost.
- [ ] LLM tier is strictly additive to the existing extraction call, default
      OFF, and its failure/absence never affects decision extraction
      (invariant #2).
- [ ] No suggestion is ever auto-sent; every button only seeds input
      (invariant #4).
- [ ] Agent-authored suggestion text is rendered as literal display text
      only, never interpreted (invariant #5).
- [ ] Toggle is global, default OFF, discoverable in the existing
      settings/Setup surface, with cost caveat in its helper text.
- [ ] Full gate list in Step 5 passes; `git status --short` matches Scope.
- [ ] Six-row manual matrix passes with recorded evidence.

## STOP conditions

Stop and report if:

- `momentum:check` cannot prove the extracted function matches the original
  inline cascade exactly — do not ship a silent behavior change to the
  existing Next card.
- The turn-end error signal (Step 0.1) is not uniformly available and would
  require adapter-specific guessing rather than a confirmed contract.
- The exact prior prompt text (Step 0.2) is not available without adding a
  new capture path with its own reliability/redaction question — pause and
  scope that separately rather than folding it in silently.
- `EXTRACTION_SCHEMA` changes would break `npm run golden` in a way not
  resolvable by making `next_actions` optional.
- The only viable UI host for the error-retry/LLM strip requires
  restructuring an existing component beyond an additive render (would need
  its own scoped plan instead).
- Merged/capped suggestion logic cannot guarantee no duplicate or
  auto-sending behavior deterministically in tests.
- A gate fails twice after one focused reasonable fix.

## Maintenance notes

`computeMomentum` is now the single source of the landing-note/decision/
blocker/planned-card priority cascade. Any future feature wanting that same
"what's next" signal (including the parked CONTEXT.md build brief in
docs/IDEAS.md, which reads blockers/board independently today) should import
it rather than re-deriving the cascade a third time. The LLM tier's schema
field should be reviewed any time the decision-extraction prompt itself
changes, since both live in the same `buildPrompt` call and a rewrite of one
risks silently dropping the other's instruction block.
