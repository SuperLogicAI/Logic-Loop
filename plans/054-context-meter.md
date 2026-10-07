# Context meter: live context-window % in the Idea Board bar

Status: **APPROVED 2026-10-07 (`PHASE 54 APPROVED`, decisions 1-4 as recommended). Branch `feat/phase-54-context-meter`. Built; gates green; awaiting live checks and acceptance.**

Source: maintainer request 2026-10-07: show `/context`-style usage for Claude
Code and Codex as a subtle loading-bar percentage, bottom-right, right-aligned
in the Idea Board's top bar, starting with the agent session and updating live.
Similar to the sidebar usage-limit meters (Plan 023 Claude, Codex meter).

## Data sources (verified 2026-10-07; field names and numbers only)

- **Claude Code:** statusLine stdin JSON carries `context_window`
  (`used_percentage`, `context_window_size`, `current_usage`, …). Documented
  contract (code.claude.com/docs/en/statusline, via Context7). `used_percentage`
  is input-only (`input + cache_creation + cache_read`), same as `/context`.
  `current_usage` is null before the first response and right after `/compact`.
  Logic Loop's Plan 023 wrapper already mirrors this JSON to `/statusline`,
  but `emit_statusline` (`ingest.rs:378`) forwards only `model` and
  `rate_limits`. Fix: also forward `context_window`.
- **Codex:** rollout `event_msg` / `token_count` events carry
  `info.last_token_usage.total_tokens` and `info.model_context_window`
  (live rollout: 80,221 / 258,400). Rollout lines already reach
  `onTranscriptLine` (`App.tsx:1194`). No new listener, process or poll.

Transcripts stay untrusted data: the parser reads two numeric fields and
nothing else.

## Build

1. `ingest.rs` `emit_statusline`: pass `context_window` through opaquely
   (same treatment as `rate_limits`). `types.ts`: add the field.
2. `src/lib/contextMeter.ts` (new, pure): `claudeContext(payload)` and
   `codexContext(line)` → `{ percent, usedTokens, windowTokens } | null`.
   Reject non-finite numbers and windows ≤ 0. Percent is clamped only for the
   bar fill, never for the displayed number.
3. `App.tsx`: in the existing `onTranscriptLine`, when the session's agent is
   `codex` and `codexContext` returns a value, store it in a new transient
   `codexContextBySession` state map. Claude reads the existing
   `claudeStatusline` map. Not persisted: transient display state, same
   precedent as Plan 023's usage meters.
4. `ContextMeter` (small component): `ctx ▬▬▬▭ 42%`, ~48px bar, `text-[10px]`,
   zinc text, same 70/90 attn/danger thresholds as the usage blocks. Tooltip:
   `84k / 200k tokens · <agent>`. Renders nothing until the first value arrives
   (no placeholder text in the bar).
5. `IdeaBoard`: new `trailing?: ReactNode` prop, rendered `ml-auto` in both
   the collapsed and expanded header bars. Clicks on it don't toggle the board.
   App passes the active tab's meter.
6. Checks: extend an existing `scripts/*-check.ts` (or add
   `context-meter-check.ts` wired into `npm run check`) covering both parsers:
   valid, null `current_usage`, missing fields, non-finite, zero window,
   non-`token_count` lines.

## Decisions (defaults marked; confirm or change at approval)

1. **Claude without the statusLine wrapper: show nothing (default)** vs a
   transcript fallback (sum `message.usage` from the last assistant line;
   window size would have to be guessed from the model, e.g. 200k vs 1M, and
   the transcript format is the non-stable one per invariant 1). Default keeps
   the number exact and the code small.
2. **Codex percent = `last_token_usage.total_tokens / model_context_window`
   (default).** Codex's own footer may apply a fixed baseline and read a few
   points different; the live check compares them, and we switch formulas only
   if the gap is visible.
3. **Active tab only (default).** No per-tab badges.
4. **Hide the meter after `/compact` until the next response (default)**
   vs keep showing the last value marked stale.

## Out of scope

Persisting context history, other adapters (OpenCode, Pi, Antigravity,
DeepSeek: no verified source yet), alerts or notifications at thresholds,
sending `/compact` or anything else to the terminal (invariant 4).

## Verify

Focused check script, then `npm run check`, `npx tsc --noEmit`,
`npm run build`, `cargo test --lib`, clippy `-D warnings`, `git diff --check`.
Live (TESTING.md Phase 54): Claude tab with wrapper shows % that matches
`/context` within 1 point and updates after each response; Codex tab shows
% that updates per turn and is compared against the Codex footer; plain shell
tab and Claude without the wrapper show nothing; meter sits right-aligned in
both collapsed and expanded Idea Board bars; clicking it doesn't toggle the board.
