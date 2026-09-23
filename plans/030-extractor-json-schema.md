# Plan 030 — Enforce extractor output with `--json-schema` (Claude backend)

## Phase gate

**ISOLATED SUPRA EXPERIMENT AUTHORIZED 2026-09-22.** The maintainer explicitly
directed a separate worktree and bypassed the normal phase sequence for this
trial. The branch remains unmerged pending a value decision. This is not a
numbered Logic Loop phase or acceptance of the current Phase 41 work.
Origin: `docs/IDEAS.md`
"Mid-September Idea Runway" item 1, planned 2026-09-18 against
`origin/main` at `80f1d65`.

## Upstream contract — verified, not assumed

Checked live against Claude Code CLI docs (code.claude.com/docs, fetched
2026-09-18), not training data:

- `claude -p --output-format json --json-schema '<schema>'` returns
  validated JSON in the response's **`structured_output`** field. The
  ordinary `result` field is not where it lands.
- An invalid schema exits code 1 with
  `Error: --json-schema is not a valid JSON Schema`. Two earlier checks:
  `not valid JSON` and `must be a JSON object`.
- **Version floor: v2.1.205.** Before it, an invalid schema was *silently
  ignored* and returned unstructured text. Local CLI is v2.1.270, past the
  floor — but the app cannot assume the user's CLI is. See Risk 1. The
  installed CLI for this trial is v2.1.280.
- `format` (e.g. `"format": "email"`) is accepted as an annotation and not
  enforced. Irrelevant to our schemas; noted so nobody adds one expecting
  validation.

## Correction to the IDEAS entry that motivated this

IDEAS runway item 1 says this "likely also removes the haiku fence-wrapping
class of bug from Phase 33.1 for good" and proposes to "drop the fence
tolerance entirely." Two parts of that are wrong and the plan does not
follow them:

1. **Fence tolerance cannot be dropped.** `run_extractor` now has four
   backends (`claude`, `codex`, `lmstudio`, `ollama`). Only the Claude
   decisions path in this plan uses `--json-schema`. The shared strip in
   `src/lib/extractor.ts` still serves the others. It stays.
2. **This does not reopen haiku for extraction.** Phase 33.1 rejected haiku
   on extraction for a reproducible ~1-in-7 **false positive** on
   `09-question-in-code` — extracting a decision from a question inside a
   code comment. That is a semantic judgment failure, not a formatting one.
   A schema constrains shape, not judgment. The haiku fence bug was in
   *reconciliation*, which Plan 016 deleted outright. Extraction stays
   sonnet; nothing here changes that, and no golden re-run on haiku is in
   scope.

What this actually buys, stated plainly: the Claude extraction path stops
depending on the model's cooperation about formatting. That failure mode
caused one real reverted regression already (Phase 33.1, haiku's fenced
reply failing `parseReconciliation`'s strict contract). It also makes a
loud failure out of a currently-silent one. Modest, real, cheap. Not a
spend lever.

## Scope

**In:** the decisions/blockers extraction call only — the one prompt whose
reply is a JSON object.

**Out, and why:**
- `landing.ts` — reply is one line of prose, not JSON. Its own strip at
  `landing.ts:36` is unrelated. Wrapping prose in an object to satisfy a
  schema is churn for nothing.
- `commitMessage.ts` — same, prose.
- Codex and LM Studio backends — no such flag.
- Reconciliation — deleted by Plan 016, and `decision-integrity:check` pins
  that `reconcile()` never calls `run_extractor`. Do not reintroduce it.

## Build

1. **`src-tauri/src/extractor.rs`**
   - `claude_args(model)` → `claude_args(model, schema: Option<&str>)`.
     When `Some`, append `--json-schema <schema>`. When `None`, byte-identical
     to today's vector — every existing call site keeps its current behavior.
   - `claude_result()` (`extractor.rs:95`): read `structured_output` first,
     fall back to `result` when absent. Return it directly when it is a JSON
     string; otherwise serialize the validated JSON value with
     `serde_json::to_string` before passing it to `parseExtraction`. The
     fallback is what keeps a pre-v2.1.205 CLI, or a `None`-schema call,
     working unchanged.
   - `run_extractor` gains an optional `schema: Option<String>` param,
     ignored by the `codex` and `lmstudio` arms.
   - Keep `CLAUDE_SYSTEM_PROMPT`'s "no code fences" sentence. It is still
     load-bearing for the other two backends and costs ~15 tokens.
2. **`src/lib/decisions.ts`** — define the extraction schema next to the
   prompt it belongs to (one object, same shape `parseExtraction` already
   validates). Pass it through the existing `run_extractor` invoke.
   `parseExtraction` itself is **unchanged** — it still validates, still
   tolerates fences, because Codex/LM Studio still reach it.
3. No migration, no new Tauri command, no new event, no UI.

## Verification

- `cargo test --lib` — extend `claude_args_are_stripped_to_a_bare_json_completion`
  with a `None`/`Some` pair asserting the `None` vector is unchanged and
     `Some` appends exactly two args. Add `claude_result` tests for an
     object-valued `structured_output`, a string-valued `structured_output`,
     an absent field, and both fields present.
- `npm run check` — no new script; `decisions:check` and
  `decision-integrity:check` must stay green untouched.
- `tsc --noEmit`, production build, `cargo clippy -D warnings`,
  `git diff --check`.
- **`npm run golden`** — mandatory, the extraction prompt path changes.
  Expect 14/14 on sonnet. **This costs real session limit** (CLAUDE.md
  Phase 33/33.1). Budget one run; do not loop it.
- Live: one real decision extracted end-to-end in the app on the Claude
  backend, and one on the Codex backend to prove the untouched path still
  works. New `docs/TESTING.md` section.

## Risks

1. **CLI older than v2.1.205 silently ignores the schema** and returns
   prose in `result`. The `structured_output`-then-`result` fallback
   degrades to exactly today's behavior, fence strip included. Acceptable,
   fail-open per invariant #2. Do not add a version probe — that's a
   subprocess call on every extraction to defend a path that already works.
2. **Schema too large / rejected** exits 1 and the extraction fails. Keep
   the schema flat, no `$ref`. The Rust arm already surfaces a non-zero
   exit as an error string; onboarding's silent-extraction-failure surface
   (`5d5a8ec`) shows it.
3. **Scope creep into a second call site.** Any future `run_extractor`
   caller that passes a schema must also read `structured_output` — that's
   why the field-reading lives in `claude_result`, once, not at call sites.

## Done means

`claude_args(model, None)` is provably byte-identical to today's vector;
the decisions path passes a schema and reads `structured_output`, serializing
non-string JSON values before validation;
`parseExtraction` and the non-Claude backends behave unchanged; golden 14/14 on
sonnet; gates clean; one live Claude extraction and one live Codex
extraction observed.

## Isolated Supra sprint result — 2026-09-22

Branch `feat/extractor-json-schema` in a separate worktree, based on `main`
at `b6beb1d`. The maintainer will decide whether to merge it. The scope was
extended to `src/lib/extractor.ts` and `scripts/golden.ts` so the app and
golden runner share exactly one schema and the golden run exercises the new
Claude output path. Ollama's presence is baseline drift from this plan's
original three-backend description; its implementation is untouched.

- `claude_args(..., None)` retains the original argument vector; `Some`
  appends `--json-schema`. Rust tests cover both paths and object/string/
  absent/conflicting `structured_output` cases.
- Decision extraction passes the shared schema only for the Claude backend.
  Other extractor callers and backends remain on the existing path, including
  fence-tolerant `parseExtraction`.
- `npx tsc --noEmit`, production build, `npm run check` (33 scripts on this
  `main` baseline), `cargo test --lib` (136 passed, one existing ignored),
  Clippy with warnings denied, and `git diff --check` passed.
- The one planned real Claude golden run passed 14/14 with `--json-schema`
  and `structured_output`; provider expense was not measured here.
- A live app check on this worktree is pending. The running production app
  has active sessions and a second unisolated instance would compete for its
  shared ingest endpoint. No installation or global hook change was made.

This is build/test evidence, not a claim that the UI path is live-accepted or
that schema validation improves semantic extraction quality or expense.
