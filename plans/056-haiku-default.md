# Haiku 5.5 becomes the default Sidebar LM model

Status: **APPROVED 2026-10-08 (`PHASE 56 APPROVED`, decisions 1-4 as
recommended). Branch `feat/phase-56-haiku-default`. Built; gates green;
live checks 70-73 passed. ACCEPTED 2026-10-08 (`PHASE 56 ACCEPTED`).**

Source: Plan 055 deferred this ("the extractor stays on Sonnet; Haiku failed
about 1 in 7 calls when tried; revisit if Haiku 5.5 ships"). Haiku 5.5
shipped. The maintainer asked for (a) Haiku 5.5 as the default with Sonnet
still selectable and (b) measured cost and speed for both models in the
README.

## Measured (2026-10-08, CLI 2.1.295)

Model resolution: `--model haiku` → `claude-haiku-5-5`; `--model sonnet` →
`claude-sonnet-5-5`.

**Accuracy (golden, `EXTRACTOR_MODEL=claude-haiku-5-5`):**

| Run | Result |
|---|---|
| Full golden ×10 (14 fixtures) | 140/140, 10/10 runs clean |
| `09-question-in-code` alone ×40 (+10 in full runs) | 50/50 |

Haiku 4.5 in Phase 33.1: 09 false positive ~1 in 7, 2/3 full runs clean.
At that rate, 50 clean in a row has p ≈ 0.0005. 95% upper bound on Haiku
5.5's 09 failure rate: ~6% (rule of three). Not attributed: Plan 030's
`--json-schema` and the 21 → 14 fixture cut landed since; Haiku 4.5 was not
re-run.

**Cost and speed (bench: 14 fixtures × 3 per model, same flags as
`extractor.rs`, cost from the CLI's `total_cost_usd`, which matched list
price exactly):**

| | Haiku 5.5 | Sonnet 5.5 |
|---|---|---|
| Pass | 42/42 | 42/42 |
| Cost per call, cache hit (median) | $0.00019 | $0.0026 |
| Cost per call, no cache (median / p90) | $0.00069 / $0.00080 | $0.0072 / $0.0141 |
| Per 1,000 calls | $0.19–$0.69 | $2.60–$7.20 |
| Wall time per call (median / p90) | 3.2 s / 4.0 s | 3.7 s / 5.0 s |
| Input tokens per call (median) | 4.9k | 2.4k |
| Output tokens per call (median) | 288 | 133 |

List prices: Haiku 5.5 $0.10 / $0.50, Sonnet 5.5 $2 / $10 per MTok. "No cache"
is computed from measured tokens at the 5-minute cache-write rate (the CLI
caches its prompt prefix), since app calls are often minutes apart. The bench
ran back to back, so it mostly hit cache.

Haiku uses about twice the input because the CLI's structured-output loop
takes a third turn on 28/42 Haiku calls vs 7/42 Sonnet calls, and each turn
resends ~2.35k tokens. It is still ~10× cheaper per call uncached and ~13×
cached. Cutting that extra turn is out of scope (see below).

The README's "about 1.4k tokens of fixed overhead" predates `--json-schema`;
a two-turn call now measures ~2.35k input tokens, fixture included.

## Build

1. **Default.** `src-tauri/src/extractor.rs:249`: `"sonnet"` →
   `"claude-haiku-5-5"` (Decision 1). One string; covers extraction,
   landing notes and commit messages (Decision 2). Existing users with a
   blank override move to Haiku on upgrade; anyone who typed `sonnet` keeps
   it.
2. **Golden mirrors the default.** `scripts/golden.ts:166`: default →
   `"claude-haiku-5-5"`; update the comment at :164 to the new evidence.
3. **Golden reports cost and speed** (Decision 4). `runClaude` already parses
   the JSON envelope; also return `total_cost_usd` and `duration_ms`, and
   print median cost/time per call in the summary line. Claude backend only.
4. **Sidebar LM control.** `src/components/SidebarLmControl.tsx`: placeholder
   → "Claude model override (optional, default claude-haiku-5-5; `sonnet`
   for Sonnet)". Warning shows only for models other than
   `claude-haiku-5-5`, `haiku` and `sonnet`, and reads "Only claude-haiku-5-5
   and sonnet are golden-set verified." (Decision 3).
   *Revision (2026-10-08, live check 71):* the check is case-insensitive
   and the field has autocapitalize/autocorrect/spellcheck off — macOS
   turned `sonnet` into `Sonnet`, which the CLI accepts but the warning
   flagged. Sonnet is now pinned in the copy too (`claude-sonnet-5-5`,
   added to the verified list; bare `sonnet` still accepted), same
   reason as Decision 1.
5. **README "Model use and cost".** Replace the Sonnet sentence with the
   default, how to switch, and a priced table for both models:

   > On Claude CLI the default model is Haiku 5.5 (`claude -p --model
   > claude-haiku-5-5`); type `sonnet` in Sidebar LM to use Sonnet 5.5.
   > Calls run stripped: no MCP servers, tools, settings or CLAUDE.md.
   >
   > | Model | Cost per extraction call | Per 1,000 calls | Median time |
   > |---|---|---|---|
   > | Haiku 5.5 (default) | $0.0002–$0.0007 | $0.19–$0.69 | 3.2 s |
   > | Sonnet 5.5 | $0.0026–$0.0072 | $2.60–$7.20 | 3.7 s |
   >
   > Measured 2026-10-08 on the 14-case golden set at API list price; the
   > low end is a prompt-cache hit. On a Claude subscription these calls
   > count against your plan limits instead of billing. Landing notes and
   > commit messages scale with the turns or diff sent.

   Exact wording finalized at build, with numbers re-checked by step 3's
   golden output.
6. **Stale Haiku claims.** Add a one-line dated update under Plan 055's
   "revisit if Haiku 5.5 ships", `docs/LANDMINES.md` (Phase 33.1 Haiku
   entry) and `src/lib/decisions.ts:314`'s "Sonnet call" comment → "extractor
   call". Old plans' history otherwise untouched.
7. **Docs.** `docs/PROGRESS.md` entry; `docs/TESTING.md` Phase 56 items.

## Decisions (defaults marked; confirm or change at approval)

1. **Model id.** **Pinned `claude-haiku-5-5`** (default) vs alias `haiku`.
   The alias is how 4.5 slipped in last time: an older CLI or a future
   Haiku would change the model with no golden run. Pinning costs one edit
   per Haiku release.
2. **Scope.** **All three features** (default: one setting, and landing
   notes and commit messages are drafts the user reads before using) vs
   extraction only (keeps Sonnet on the two prose tasks with no golden
   coverage; needs a second default and setting).
3. **UI.** **Keep the free-text field** with new copy (default: Sonnet
   stays one word away) vs a Haiku/Sonnet/custom dropdown (clearer, more
   UI code).
4. **Cost in golden.** **Golden prints median cost/time** (default: README
   numbers become reproducible with `npm run golden`, no new script) vs
   README numbers from this plan's one-off bench only.

## Out of scope

- Cutting Haiku's extra structured-output turn (would roughly halve its
  input tokens; changes `extractor.rs` args or the system prompt, needs its
  own golden run).
- Codex, LM Studio and Ollama defaults.
- Golden coverage for landing notes and commit messages.

## Verify

- `npm run golden` (new default) ×3: all clean, cost/time printed.
- `EXTRACTOR_MODEL=sonnet npm run golden` ×1: clean (Sonnet still works).
- `npm run check`, `npx tsc --noEmit`, `npm run build`,
  `cd src-tauri && cargo test --lib`, `cargo clippy --all-targets -- -D
  warnings`, `git diff --check`.

## Manual checks (docs/TESTING.md Phase 56)

- [ ] 70. Fresh blank override: a Claude turn ending in a question produces a
      Decision card; the extractor child is `--model claude-haiku-5-5`
      (`ps` while it runs).
- [ ] 71. Type `sonnet` in Sidebar LM: next extraction spawns with
      `--model sonnet`; no warning shown. Type `opus`: warning shown.
- [ ] 72. Leave a tab in Auto mode: landing-note draft on Haiku reads
      usable.
- [ ] 73. Commit & Push footer: Haiku commit message reads usable for a
      real staged diff.
