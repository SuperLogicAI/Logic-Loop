# Plan 018 — Transcript schema-drift tripwire

## Phase gate

Not a numbered phase — a small, additive detection feature directed live by
the maintainer 2026-09-12 ("build the local detection tripwire"), following
a live discovery during Plan 017's investigation trail: Claude Code CLI
v2.1.270 adds several new preamble/metadata line types to its local
transcript (`type: last-prompt`/`mode`/`permission-mode`/`atis-latch`/
`bridge-session`).

**Correction, same day:** the first read of this only sampled the first 5
lines of a 41-line transcript file and concluded the whole format had
changed incompatibly. A later live test (a real 3-turn Terminal.app session,
decision card extracted correctly and matched the actual conversation)
proved that wrong — the real `assistant`/`user` message lines
`textFromTranscriptLine` already reads are still present, unchanged, mixed
in with the new preamble lines. **Extraction is not currently broken.** This
plan ships as preemptive insurance against a real future break, not a fix
for an active one — see the corrected finding in CLAUDE.md's Phase-status
entries for Plan 017/018 and invariant #1's caveat.

## Why this shape, not a changelog-watching agent

The maintainer's original ask was for "a robust evergreen way... maybe an AI
agent... that can read patch notes and proactively present key findings."
Recommended instead, and built: local, in-process detection of the actual
failure signature, rather than external monitoring of a source that might
not even mention the specific break. Cheaper (a counter and a threshold
check in code that already runs on every transcript line), more reliable
(catches the exact failure live instead of guessing what to watch for), and
consistent with this codebase's existing fail-open-but-visible pattern (the
tailer-failure warning strip, `ingest://tailer-failed` → `blindSessions`).

Anthropic's own docs still say the entry format "changes between versions,
so scripts that parse these files directly can break on any release" — that
risk is real and unaffected by this correction, even though v2.1.270 itself
didn't trigger it. A tripwire that fires whenever a real break eventually
happens, whatever the new format looks like, is worth having on standby.

## What was built

- `src/lib/decisions.ts`:
  - `transcriptEnvelopeType(line): "recognized" | "unrecognized" | "unparseable"`
    — pure, exported. `"recognized"` means the line's top-level `type` is
    `"assistant"`/`"user"` (Claude) or `"response_item"` (Codex) — the exact
    same envelope gate `textFromTranscriptLine` already checks, exposed
    separately so it doesn't require extractable text (a tool-only turn is a
    normal, silent no-op today and must not look like drift).
    `"unparseable"` (invalid JSON, e.g. a partial line mid-flush) is its own
    case and never counts toward the streak either way — ordinary tailing
    noise, not a schema signal.
  - Per-session state: `unrecognizedStreak` (consecutive unrecognized-
    envelope line count, reset to zero the moment a recognized one arrives)
    and `driftWarned` (fire once per session, not once per line).
    `SCHEMA_DRIFT_THRESHOLD = 20` — generous enough to absorb a session's
    small number of non-message lines (the v2.1.270 preamble included) at
    start without false-firing on a healthy transcript, confirmed live (see
    Verification below).
  - `onTranscript` gained an optional trailing `onSchemaDrift?: (agent:
    string) => void` param, called (with `context.agent ?? "claude"`)
    unconditionally on every line, before the existing text-extraction path
    — the signal must not depend on any single turn's content.
- `src/App.tsx`: wires that callback into the existing `adapterWarnings`
  state (the same array `onAdapterWarning`/foreign-hook detection already
  populates) — deduped the same way, no new Rust command, no new Tauri
  event, no new UI component.
- `src/components/SidePanel.tsx`: `adapterWarningMessage()` gained a case for
  `reason === "transcript_schema_unrecognized"`, rendered through the
  already-existing adapter-warning strip.
- `scripts/decision-integrity-check.ts`: `transcriptEnvelopeType` tested
  against real old-format Claude/Codex lines (recognized), the actual
  v2.1.270 preamble line types found live 2026-09-12 (unrecognized, in
  isolation — this pins that these specific literal lines are correctly
  flagged, not that a real session trips the full threshold), and malformed
  JSON (unparseable, not drift). Source-shape assertion pins that
  `onTranscript` calls `trackSchemaDrift` before `textFromTranscriptLine`.

## Not done / explicitly out of scope

- No parser update for the new preamble line types — not needed; they don't
  block extraction, `textFromTranscriptLine` already ignores unrecognized
  lines safely.
- No changelog-reading agent, no scheduled monitoring, no version pinning.
- No Rust changes — this is a pure JS/TS feature end to end.

## Verification

- [x] `npx tsc --noEmit`
- [x] `npm run decision-integrity:check` — new tripwire tests pass, including
      the exact v2.1.270 preamble line types found live
- [x] `npm run check` — 26/26
- [x] `npm run build`
- No `cargo test`/clippy rerun (no Rust changes)
- No `npm run golden` rerun (no extraction-prompt change)
- [x] Live manual check (2026-09-12): a real 3-turn Terminal.app session on
      v2.1.270 (mixed preamble + real message lines) extracted a decision
      card correctly and the warning strip stayed silent — confirms the
      threshold doesn't false-fire on this exact real-world shape. The
      tripwire's actual firing behavior on a genuine break remains
      unobserved live, verified only by unit test — no real break is
      currently available to reproduce against.
