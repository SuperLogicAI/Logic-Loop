# Adoption blockers: multiple-choice cards, tab-only hooks, cost disclosure

Status: **APPROVED 2026-10-07 (`PHASE 55 APPROVED`, decisions 1-4 as recommended). Branch `feat/phase-55-adoption-blockers`. Built; gates green; awaiting live checks and acceptance.**

Plan revisions during build (stated, not silent):
- No `HOOK_VERSION` bump. The payload shape is unchanged, and the existing
  "partial" hook state already shows Update when an event is added.
- The zsh `claude` function lives in the app's `.zshenv`, not `.zshrc`. That
  one definition also covers the `zsh -l -c` resume shell, so `resume_command`
  is unchanged (B.3 + B.4 collapse into one step).
- Added: PreToolUse `AskUserQuestion` sets the tab to "waiting" (same as a
  permission prompt), and multiple-choice cards hide ✎ answer / ⌕ context —
  prefilling text into Claude's picker would be wrong.

Source: outside feedback 2026-10-07 from a prospective user whose own Claude
reviewed the repo and called it a "non-starter": (a) a Sonnet call "almost
every turn", (b) Claude's multiple-choice prompts are tool calls and never
become cards, (c) Enable writes global hooks into a `~/.claude/settings.json`
they keep in version control. Verified against code the same day; (a) is
overstated, (b) and (c) are accurate. The extractor stays on Sonnet (Haiku
failed about 1 in 7 calls when tried; revisit if Haiku 5.5 ships).
*Update 2026-10-08: Haiku 5.5 shipped and passed golden; it is the default
as of Plan 056.*

## Facts (verified 2026-10-07)

- **Multiple-choice prompts.** `textFromTranscriptLine` keeps `text` blocks
  only, so `AskUserQuestion` (a `tool_use`) never reaches extraction. The
  maintainer's own DB has 255 `AskUserQuestion` PostToolUse events.
  Payload key names (no content read): `tool_input.questions[]` →
  `{question, header, options[{label, description, preview?}], multiSelect}`;
  `tool_response` → `{questions, answers (object), annotations?}`.
  PostToolUse already arrives (matcher `*`), but only after the answer.
- **Event dedupe is safe.** `dedupeKey` includes the event type, so a
  PreToolUse and PostToolUse sharing one `tool_use_id` don't collide.
- **`--settings` hooks merge.** Live probe, CLI 2.1.294: a `UserPromptSubmit`
  hook in `--settings <file>` and one in project `.claude/settings.json` both
  fired on one `claude -p` run (scratchpad only, extractor tether set).
- **Launch paths.** Fan-out and Setup commands are typed into an interactive
  zsh (`pty.rs` `launch_cmd`), so a `.zshrc` function applies. Resume runs
  through `zsh -c` (`resume_command`), which never reads `.zshrc`, so Rust
  must add the flag there itself. Plan 044's `codex` function is the precedent.
- **Cost.** README "Model use and cost" already lists when each call fires.
  Missing: which model, the measured fixed cost per call (~1.4k tokens after
  Phase 33.1 stripping), and that hooks can live outside the user's settings.

## Build

### A. Multiple-choice prompts become cards (no model call)

1. `ingest.rs`: add `PreToolUse` with matcher `AskUserQuestion` to
   `HOOK_EVENTS` (6 → 7). Bump `HOOK_VERSION` 1 → 2 so existing installs show
   "outdated" and re-enable once. The hook command already prints nothing and
   exits 0, so it can't affect the prompt (invariant 2). Bounded latency:
   `curl -m 2`, only on this one tool.
2. `src/lib/askUserQuestion.ts` (new, pure): `questionsFromPre(payload)` →
   `{question, options: string[], multiSelect}[]`; `answersFromPost(payload)`
   → `Map<question, answer>`. Strings and arrays only; anything else → `[]`.
   Agent text stays untrusted data (invariant 5).
3. `ingest.ts`: on `hook:PreToolUse` + `AskUserQuestion`, call
   `repo.insertDecision` per question (status `open`, no assumption,
   `context_json` = `{source: "ask_user_question", tool_use_id, header,
   options, multiSelect}`). Existing open-question dedupe in `insertDecision`
   still applies. On `hook:PostToolUse` + `AskUserQuestion`, answer the
   matching open cards with the selected label(s).
4. Decision card: when `context_json.source === "ask_user_question"`, list
   the option labels under the question (read-only). No click-to-answer:
   answers happen in the terminal (invariant 4).
5. Never answered (Esc, interrupt): see Decision 2.
6. Subagent `AskUserQuestion` follows the same `isSubagentHook` rules as other
   hooks today.

### B. Tab-only hook install (zero writes to `~/.claude/settings.json`)

1. New Claude install mode on the Setup card: **Global** (today) or
   **Logic Loop tabs only**. Switching modes removes the other mode's install
   first, so both never run together.
2. Tab-only: Rust writes `~/.context-terminal/claude-settings.json` holding
   the same `hooks` block `apply_setup` builds today, plus `statusLine` if the
   wrapper is opted in (Decision 3). `~/.claude/settings.json` is read only to
   snapshot an existing `statusLine.command`, and never written.
3. zsh integration `.zshrc`: `(( $+functions[claude] )) || function claude`
   adds `--settings ~/.context-terminal/claude-settings.json` only when that
   file exists and the args don't already include `--settings`. Same "user's
   own function or alias wins" rule as `codex`.
4. `resume_command`'s Claude arm adds the same flag when the file exists.
5. `hooks_status` reports the mode, and "on" means the mode's file is
   complete. Disabling deletes the file.
6. Known limits: shown on the card, and documented.
   - Sessions started outside Logic Loop tabs (another terminal, IDE) send no
     events in tab-only mode, so the cwd fallback in `bindSession` has nothing
     to bind.
   - bash/fish tabs have no wrapper, same as `codex` today. The card offers
     Global for those.
7. LANDMINES: add the `--settings` merge fact with its CLI version, and the
   `zsh -c` resume caveat.

### C. Cost and install disclosure (README)

1. "Model use and cost": name the default (`claude -p --model sonnet`), the
   ~1.4k fixed overhead per call (no MCP, tools, settings or CLAUDE.md
   loaded), and that multiple-choice cards cost nothing.
2. "What it touches": describe both install modes. Supported-agents table row
   for Claude Code: "Hooks in `~/.claude/settings.json`, or tab-only via
   `--settings`".

## Decisions (defaults marked; confirm or change at approval)

1. **Default mode for new installs: Global (default)** vs Tab-only. Global
   keeps outside-terminal coverage, which existing users rely on. The Setup
   card shows tab-only right next to it with a one-line reason to pick it.
2. **Unanswered multiple-choice card: dismiss it on the session's next `Stop`
   or `UserPromptSubmit` (default)**, since the agent can't reach either one
   while the prompt is still open. Alternative: leave it open until the
   14-day stale sweep.
3. **Tab-only also carries the statusLine wrapper (default)**, so the usage
   and context meters keep working with zero global writes. The snapshot
   semantics match today's wrapper.
4. **No migration (default).** Existing Global installs stay Global; the user
   switches mode by hand.

## Out of scope

Changing the extractor model or prefilter. Answering cards from the panel
(invariant 4). Tab-only modes for other adapters (Codex `hooks.json` has no
per-launch equivalent verified). Single-session or subagent-first workflows.

## Verify

New `scripts/ask-user-question-check.ts` (wired into `npm run check`): Pre
and Post parsers for valid payloads, a missing `questions`, non-string
labels, multiSelect answers, and non-`AskUserQuestion` tools. Rust unit tests:
`HOOK_EVENTS` and matcher round-trip; tab-only file contents; the global file
is untouched in tab-only mode (byte-identical before and after setup and
remove); `resume_command` with and without the file. Then `npm run check`,
`npx tsc --noEmit`, `npm run build`, `cargo test --lib`, clippy
`-D warnings`, `git diff --check`. Golden not run (prompts unchanged).

Live (TESTING.md Phase 55):
- A Claude tab prompt that triggers `AskUserQuestion` shows a card with
  options before you answer, and the card closes with your choice afterward.
- Esc on the prompt dismisses the card per Decision 2.
- Tab-only: `~/.claude/settings.json` hash is unchanged after enable, use and
  disable; the tab still sends events, and a resumed tab does too.
- A `claude` run in Terminal.app sends nothing while tab-only is active.
- Global → tab-only → Global round-trip restores the global file byte for byte.
