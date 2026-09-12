# Phase 33.1 Plan — Extractor spend emergency sprint

## Phase gate

Phase 33 (decision reconciliation) passed its 11-step manual test on
2026-09-11 but is **not shippable**: the same pass burned ~60% of a
five-hour Claude session limit. The maintainer approved this plan's outline
on 2026-09-12 with "Approved, write the 33.1 PLAN.md only do not build".
Implementation waits for the literal token `PHASE 33.1 ACCEPTED`.

Phase 33 stays on `feat/phase33-decision-integrity`; 33.1 lands on the same
branch before it merges to `main`.

## Root cause (verified in source, not measured yet)

`src-tauri/src/extractor.rs:151` spawns

```
claude -p --output-format text --model sonnet
```

with no context stripping. Every extractor call boots a full Claude Code
environment: every user MCP server's tool schema (this machine: Attio, n8n,
Gmail, Calendar, Fathom, Meta, Vapi — ~150 tools), every skill description,
CLAUDE.md discovery, the default system prompt. Estimated 30-60k fixed input
tokens to carry a ~1k prompt, on Sonnet. Phase 33 added a second call per
user turn (reconcile + extract), so fixed overhead doubled.

Secondary amplifiers, in order:

- `repo.insertDecision` is a blind INSERT — no open-row dedup, so duplicate
  cards inflate every later reconciliation prompt.
- Every submitted user message triggers reconciliation whenever the session
  has any open decision, including "yes" / "ok".
- Reconciliation prompt caps are generous: 100 candidates × 2000-char
  question × 2000-char assumption.

`scripts/golden.ts:49` has the identical un-stripped spawn, so golden runs
today also carry the overhead and don't measure the app's real per-call cost.

## Outcome

- Per-call input tokens for the Claude backend drop by an order of magnitude,
  **measured** via `--output-format json` usage, logged once per call.
- Answer-now replies close their card with zero model calls.
- Bare / short / lexically unrelated replies never spawn a reconciliation call.
- The same open question cannot be inserted twice for one session.
- Golden stays 21/21. No panel, schema, ingestion, PTY, or adapter change.

Not in scope (add only if 1-5 below still burn): batched reconciliation,
embeddings, agent-emitted side-channel, a user-facing spend-mode setting,
bundling a local model. The `lmstudio` backend already exists as the
zero-spend option; onboarding copy may point at it but this sprint doesn't
touch Setup.

## Scope

- `src-tauri/src/extractor.rs` — spawn args, `model` param, usage log
- `src/lib/decisions.ts` — deterministic Answer-now close, skip gates,
  reconcile model selection
- `src/lib/decisionReconciliation.ts` — pure gate helpers, tighter caps
- `src/lib/repo.ts` — `insertDecision` dedup query
- `src/lib/landing.ts`, `src/lib/commitMessage.ts` — only the new optional
  `model` arg (default unchanged)
- `scripts/golden.ts` — same spawn args as the app
- `scripts/decision-integrity-check.ts` — gate + dedup + Answer-now cases
- `docs/TESTING.md` — §46 live spend matrix
- `CLAUDE.md` — landmine rewrite (estimate → measured number), phase status
- `plans/README.md` — index row; this plan copied to `plans/013-*.md`

## Sequence

Each step has its own check. Order matters: step 1 is the big cut and gives
the measurement the rest is judged against.

1. **Baseline measurement.** Before any change, run one extraction and one
   reconciliation through the current spawn with `--output-format json` and
   record `usage.input_tokens` / `cache_read_input_tokens` in this plan's
   "Measured" section. Check: two numbers written down. Stop and re-plan if
   the fixed overhead is under ~5k — the root cause would then be wrong.

2. **Strip the child spawn** (`extractor.rs`). Add
   `--strict-mcp-config --tools "" --setting-sources "" --no-session-persistence`
   and `--system-prompt "<one line: output only the JSON the user asks for>"`.
   Keep `--output-format json`, parse `.result` for the text, log
   `usage.input_tokens` at `info` level. Keep the `LOGIC_LOOP_TAB_ID` tether —
   `--strict-mcp-config` does not disable hooks. **Not** `--bare`: it forces
   API-key auth and would break every OAuth / Max-subscription user.
   Add a `model: Option<String>` arg to `run_extractor`, default `sonnet`.
   Mirror the exact arg list in `scripts/golden.ts`. Unit test pins the arg
   vector like `codex_args_are_ephemeral_read_only_json_and_stdin_based`
   does. Check: baseline re-run, number drops ≥10x; golden 21/21.

3. **Deterministic Answer-now close** (`decisions.ts`). Answer-now already
   writes `Re: "<question>" — ` into the PTY. In `onTranscript`, before
   enqueueing reconciliation: if the submitted reply starts with `Re: "`,
   extract the quoted text, exact-match it against
   `openDecisionsForSession` questions, call `answerOpenDecisions` and skip
   the model call. No match → fall through to the normal path. Pure matcher
   lives in `decisionReconciliation.ts`. Check: `decision-integrity:check`
   case — prefixed reply closes exactly its card with a stubbed `invoke` that
   throws if reached.

4. **Skip gates** (`decisionReconciliation.ts`, called from `reconcile`
   before `run_extractor`). Skip when any of: reply trimmed < 12 chars;
   reply matches bare-affirmation set (`yes|yeah|ok|okay|sure|do it|go|go
   ahead|sounds good|yes, do it|proceed|continue|k|y`, case-insensitive,
   trailing punctuation stripped); zero content-word overlap (words ≥4 chars,
   stopword list of ~40 English function words) between reply and every
   candidate question+assumption. Gate is `// ponytail:` marked with its
   ceiling — a paraphrased answer with no shared word falls through to
   "not answered", which is Phase 33's stated conservative default anyway.
   Check: golden 18 (ambiguous affirmation) and 19 (unrelated reply) now
   pass with zero spawns — golden runner counts spawns per case; unit cases
   for each gate branch.

5. **Dedup on insert** (`repo.insertDecision`). Normalize question
   (lowercase, collapse whitespace, strip trailing punctuation). Before
   INSERT, `SELECT 1 FROM decisions WHERE session_id=? AND status='open'
   AND <same normalization in SQL> = ?`; if present, skip. Normalization in
   TS, applied to both sides — do it in SQL with `lower(trim(question))`
   only if the TS normalization can be expressed identically; otherwise
   fetch open questions and compare in TS (session-scoped, ≤100 rows, cheap).
   No migration. Check: unit case — same question twice, one row; different
   question, two rows; same question after first is answered, second row
   inserted (dedup is open-only, by design).

6. **Shrink reconcile prompt.** `MAX_CANDIDATES` 100 → 20 newest (query
   flips to `ORDER BY ts DESC LIMIT 20`, prompt re-sorts oldest-first),
   `MAX_QUESTION_CHARS` / `MAX_ASSUMPTION_CHARS` 2000 → 400. Reconcile calls
   pass `model: "haiku"`; extraction keeps `sonnet`. Check: golden 15-21
   (reconcile set) still pass on haiku. If any fails, revert only the model
   change and note it — caps stay.

7. **Docs + gates.** Rewrite the Phase 33 landmine in `CLAUDE.md` with the
   before/after numbers from steps 1-2. Add TESTING.md §46. Run
   `npm run check`, `tsc --noEmit`, `cargo test`, `cargo clippy --all-targets
   -- -D warnings`, `npm run golden`, `git diff --check`.

## Measured

Filled in during step 1 and step 2. Do not ship 33.1 with this section
empty.

| call | before (input tokens) | after |
|---|---|---|
| extraction | 57,293 (2 input + 40,604 cache-creation + 16,687 cache-read) | 1,402 (2 input + 1,400 cache-creation + 0 cache-read) — 41x |
| reconciliation | 57,015 (2 input + 34,960 cache-creation + 22,053 cache-read) | 1,124 (2 input + 1,122 cache-creation + 0 cache-read) — 51x |

## Manual test (docs/TESTING.md §46)

1. Fresh session, ask the agent a question that makes it ask you one back.
   Card appears. Reply "ok". Confirm the log shows **no** reconciliation
   spawn.
2. Click Answer now, submit the prefilled line. Card closes; log shows no
   spawn.
3. Ask the agent to restate the same question. No second card.
4. Answer an older card in natural language naming it. Card closes via one
   haiku call; log shows input tokens in the low thousands, not tens of.
5. Repeat Phase 33's 11-step matrix once and note session-limit consumption
   next to the ~60% figure from 2026-09-11.

## Risks

- `--setting-sources ""` may not be accepted as empty by the installed CLI
  version; fallback is omitting the flag and relying on `--strict-mcp-config
  --tools ""` plus `--system-prompt` for the bulk of the cut. Step 1/2
  measurement decides.
- Haiku on reconciliation may regress golden 16 (one-of-several) or 20
  (multiple answers). Model choice is reverted independently of the caps.
- Lexical gate is English-only. Acceptable; documented ceiling.
- Golden runner spawn-count assertion is new — if the runner cannot observe
  gate skips without restructuring, assert via the unit check instead and
  note it.
