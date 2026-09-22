# Plan 038: OpenCode adapter expansion — decision extraction and re-entry

## Status

CANDIDATE — not implemented or approved. Picked up 2026-09-21 while Plan 037
is paused (Agy quota cooldown; all of 037 waits for Agy specifically, not
delegated elsewhere). P1/P2 mixed — see per-part status. Depends on: none
blocking; OpenCode is already a DONE adapter (Phase 8) — this only adds
features to it.

## Why this matters

OpenCode is the only live adapter with a **real in-process plugin/event
API** rather than a shelled-out hooks contract — `docs/ROADMAP.md` already
calls it "richest semantic surface after Claude." Despite that, it's one of
only two adapters (with Antigravity, pre–Plan 037 Part C) that ships **no
decision/blocker extraction**, and the only adapter besides Antigravity
(pre-Agy-003) with **no session re-entry**. Both gaps look cheaper to close
here than anywhere else: no transcript file to tail, no `is_transcript_path`
gate to widen, no invariant-#5 risk beyond what Claude/Codex extraction
already carries — the plugin already receives message and tool content
in-process. Confirmed live doc facts below (not guesses) make both parts
more tractable than they'd look from the adapter's current file alone.

## Current state (`src-tauri/src/opencode.rs`)

- `plugin_source()` (lines ~44–147) generates a `.mjs` plugin registered
  into `~/.config/opencode/opencode.json`'s `"plugin"` array.
- `EVENT_MAP` (line ~78) maps only three generic `event.type` values:
  `session.created` → `SessionStart`, `session.idle` → `Stop`,
  `permission.asked` → `Notification`.
- `chat.message` hook (line ~127) fires on prompt submission — currently
  posts only `session_id`/`cwd`, **discards the actual prompt text**.
- `tool.execute.after` hook (line ~136) posts `tool_name`/`tool_input`/
  `tool_response` in full — already normalized, no PascalCase-style
  mismatch the way Antigravity needed Agy 002 for.
- The module's own doc comment (lines 44–49) already flags the `EVENT_MAP`
  field extraction as "defensive... guessing wrong" and asks for
  verification against a live run "once the real shape is confirmed" —
  unclear whether that verification ever happened; treat as open until
  confirmed in this plan.
- No `message.updated` (or any assistant-response) event is subscribed —
  the plugin has no path today to the model's own reply text.
- `src-tauri/src/pty.rs`'s resume selector (`resume_command`, ~line 240)
  has arms for `claude`, `codex`, `antigravity`, `pi`, `dsh` — no
  `opencode` arm. `docs/TESTING.md` §51 confirms Setup currently reports
  "Re-entry not supported" for OpenCode.

## Confirmed live-documented facts (Context7, `/anomalyco/opencode`,
fetched 2026-09-21 — still needs a live-CLI spike before shipping, same
discipline as every other adapter here, but these are real doc citations,
not assumptions)

- **Resume is real and documented**: `opencode --session <id>` (`-s`)
  continues a specific session; `--continue`/`-c` continues the most
  recent one; `--fork` forks instead of continuing in place. The TUI's own
  exit splash prints `opencode --mini -s <session_id>` as the literal
  resume command.
- **`message.updated` is a real, schema-defined event** (`packages/schema/
  src/v1/session.ts`): fires whenever a message is created or updated,
  payload is `{sessionID, info: Message}` — the `info` object is the
  actual message, which for an assistant message should carry response
  content. Exact shape of `Message` (text location, streaming/partial
  states) is not yet confirmed here — spike target, not an assumption to
  code against blind.
- **`session.created` fires on resume replay too**, not just fresh
  creation, per the same schema doc — relevant to Part 2's binding logic,
  since a naive `SessionStart`-triggers-a-new-binding approach could
  misfire on every resume rather than only on a genuinely new session.

---

# Part 1: Decision/blocker extraction

## Status

P1. Higher-confidence than Antigravity's equivalent (Plan 037 Part C) —
content arrives in-process already, no file-format unknown, no gate to
widen.

## Scope

**In scope**: `src-tauri/src/opencode.rs` (`plugin_source()` — add
`message.updated` handling and stop discarding `chat.message`'s prompt
text), `src-tauri/src/extractor.rs` (feed OpenCode turns into the existing
extraction path — likely as a new `source: "opencode"` shape carrying
prompt+response pairs directly, rather than a transcript path, since
there's no file to point at), `src/lib/ingest.ts` if a new
`hook_event_name` mapping is needed, `docs/TESTING.md`.

**Out of scope**: any change to Claude/Codex/Antigravity extraction; using
`tool.execute.after`'s content for extraction (decisions live in prose,
not tool calls — matches every other adapter's existing scope).

## Steps

### Step 1 (gate): Live-spike `message.updated`'s real payload

Run a real OpenCode session with a temporary instrumented plugin logging
every `event` callback's raw payload, specifically capturing
`message.updated` for both user and assistant messages. Confirm: (a) the
actual field path to response text (`info.content`? `info.parts`? —
OpenCode's TUI is known to render streaming partial updates, so confirm
whether this fires once per complete message or many times per streamed
token — a naive "post on every `message.updated`" could spam the ingest
server or extractor on a partial fragment); (b) whether `chat.message`'s
existing `input` argument already carries the full prompt text inline
(cheaper than also subscribing to `message.updated` for the user side).

**If `message.updated` fires many times per message with partial content**:
only post/extract on whatever signal marks the message complete (check for
a `role`/`status`/`finish` field in the payload) — do not extract from a
partial fragment.

#### Step 1 findings (live, 2026-09-21, opencode 1.18.32, `opencode run`)

Ran a real 2-turn session (`opencode run "Read sample.txt..."` then
`opencode run -s <id> "What did I just ask..."`) against a debug plugin
logging every raw event to a file. Confirmed, materially different from
what this plan assumed going in:

- **`chat.message`'s `input` carries only `{sessionID}` — no prompt text
  at all.** The existing code comment's doubt was correct; this path is
  not usable for the user-prompt side.
- **`message.updated`'s `info` object never carries text content.** It's
  pure metadata: `role`, `time.{created,completed}`, `finish`
  (`"tool-calls"` vs the final text-bearing message), `tokens`, `cost`,
  `modelID`. Text lives elsewhere.
- **Actual text lives in `message.part.updated` events**, keyed by
  `part.id` and `part.messageID`, with `part.type`. Relevant types seen:
  `text` (the visible prompt/reply), `reasoning` (model chain-of-thought —
  **must be excluded**, it's not what the user saw, extracting it would
  pull in content beyond the actual visible reply), `tool`, `step-start`,
  `step-finish` (no text). A given `part.id` fires `message.part.updated`
  multiple times as it fills in — **the last update for that `part.id`
  carries the full accumulated text**, not a fragment; earlier ones for
  the same id can be empty-string placeholders. Correct handling: keep a
  map of `part.id → latest text`, keyed by type `"text"` only.
- **`message.part.delta` is raw per-token streaming** (`{messageID,
  partID, field: "text", delta: "..."}`) — confirmed present, confirmed
  not needed: `message.part.updated`'s last-write-wins already gives the
  full text without reassembling deltas.
- **A single user turn produces multiple assistant `message.updated`
  entries**, not one: one per tool-call round-trip (`finish: "tool-calls"`,
  no text parts) plus a final one (`finish` other than `"tool-calls"`,
  carrying the actual reply's `text` part(s)). The correct signal for
  "this is the assistant's visible reply" is not `finish` at all — it's
  simply **the assistant message that owns at least one non-empty
  `type: "text"` part**; tool-call-only intermediate messages naturally
  have none, so no explicit `finish`-field branching is needed.
- **Completion signal**: `message.updated`'s `info.time.completed` is
  present once that specific message is done (absent while still
  in-flight) — use this to know when it's safe to read that message's
  accumulated parts, not to gate on `finish` interpretation.
- Real payload excerpts (sanitized) are informal notes only; not
  committed to the repo — reproduce via the steps above if needed again.

**Conclusion**: viable, but the actual extraction plumbing is a
part-correlation problem (buffer parts by id/messageID, flush on the
owning message's completion), not a single-field read. Step 2 below is
revised accordingly.

### Step 2: Wire prompt + response into the extraction path (revised per Step 1 findings)

In `plugin_source()`, add a `message.part.updated` case to the `event`
callback: when `event.properties.part.type === "text"`, store
`{[part.id]: {messageID, text}}` in an in-memory `Map` (module-scope inside
the generated plugin, matching the pattern OpenCode's own SDK examples use
for in-process state — the plugin instance lives for the process lifetime,
same as the existing `ingest`/`tabId` closures already do). Add handling
for `message.updated`: when `info.time.completed` is present, look up all
buffered parts whose `messageID` matches, and if any have non-empty text,
join them in part-id-arrival order and post one `hook_event_name` payload
carrying `role` (`user`/`assistant`) and the joined text — reusing
`UserPromptSubmit`/`Stop`-adjacent semantics is wrong here (those already
map to lifecycle, not content); this needs a new payload field
(e.g. `turn_text`) on the existing `PostToolUse`-adjacent flow, or a
dedicated event name the extractor path reads — finalize the exact wire
shape against `extractor.rs`'s existing input contract before writing
Rust, not the other way around. Discard buffered parts for a `messageID`
after flushing (bounded memory, no leak across a long session).

Reuse the existing extractor.rs prompt/pipeline shape — this plan does not
add a new extraction *prompt*, only a new *source* of turn text feeding
the same pipeline Claude/Codex already use. Untrusted-content handling
(invariant #5) applies identically: OpenCode message content is agent
output, never treated as instructions to Logic Loop's own extraction call.
`reasoning`-type part content must never be included — it's not what the
user saw and could contain the model arguing with itself in ways that
read as false decisions/questions if fed to the extractor.

**Verify**: extractor unit tests for the new source-shape parsing, plus a
new `opencode.rs` test (or JS-level fixture, matching how this file is
already tested) asserting the part-buffering-and-flush logic joins
multi-part text correctly and never emits on an incomplete message.
`npm run golden` **only if** an actual extraction prompt path changed —
if this is purely a new turn-text source feeding the existing prompt
unchanged, golden should not need a rerun (confirm this assumption before
running it speculatively).

#### Step 2 — actual wire shape shipped, and a second bug the earlier
findings missed (2026-09-21)

Rather than a new payload field on an existing lifecycle event, this
reuses `onTranscript`'s existing turn-pairing machinery wholesale: the
plugin posts a synthetic **`TranscriptLine`** event
(`{hook_event_name: "TranscriptLine", session_id, cwd, line}`) where
`line` is a JSON string shaped `{type: "opencode_message", role, text}`.
`ingest.rs`'s `/event` handler recognizes this event name **scoped to the
`opencode` agent marker only** and re-emits it as `ingest://transcript`
(`{session_id, line}`) — the exact shape the real Claude/Codex file tailer
already emits — instead of `ingest://hook`. `decisions.ts`'s
`textFromTranscriptLine` gained one more envelope case
(`type === "opencode_message"`) that reads `{role, text}` directly, no
block/content-array parsing needed (OpenCode's plugin already reduced it
to plain text in-process). Every downstream consumer —
`onTranscript`'s assistant-buffer/pairing state machine, the schema-drift
tripwire, `repo.addEvent`'s raw log — works completely unchanged. This
was the simplest option on the ladder that actually held: reusing the
existing pipe beat inventing a parallel one.

**A second real bug found by testing against the Step 1 capture, not
assumed**: the first implementation gated *every* flush on
`info.time.completed`. Replaying the actual captured event trace through
that logic (a Python re-simulation of the exact buffering rule, run
against the real `spike.log`) produced only the two **assistant** replies
— the user's own prompt text never flushed at all, because **user
messages never receive a `time.completed` timestamp in this OpenCode
version, ever** (confirmed across both turns of the live capture — every
`role: "user"` `message.updated` entry has a `time.created` and no
`time.completed` key, full stop). Since `onTranscript`'s pairing/
extraction trigger fires specifically on receiving a **user** line,
shipping the original logic would have silently never extracted anything
for OpenCode — activity would look correct, extraction would just quietly
never run. Fixed: only assistant messages gate on `info.time.completed`
(they genuinely stream and need it); user messages flush as soon as their
(non-streamed, single-shot) text part has arrived, using the fact that
`message.updated` reliably re-fires for the same message id afterward —
an early firing before the part lands is a harmless no-op on an empty
buffer, not a wrong flush.

**Verified twice, both against real data, not assumption:**
1. A hand-simulation in Python of the corrected rule, replayed against the
   real captured `spike.log` trace — produced the exact real prompt/reply
   pairs for both turns, correctly ordered, no duplicates, no `reasoning`
   leakage.
2. The **actual compiled `plugin_source()` output** (dumped via a
   throwaway test, removed afterward — not shipped), loaded into a real
   `opencode run` process with a `fetch`-interception wrapper that passed
   through every URL except the local ingest endpoint (a blanket global
   override was tried first and hung the whole process — it also broke
   OpenCode's own provider API calls; scoping the intercept to the
   ingest URL fixed it) — no real network call ever left the process.
   The real plugin posted exactly one correct `TranscriptLine` per role,
   correctly paired, alongside the unaffected pre-existing lifecycle
   events.

Golden not rerun — no extraction prompt changed, only a new upstream
source feeding the same `buildPrompt`/`parseExtraction` path Claude/Codex
already use, confirmed by reading `extractor.rs` and `decisions.ts`
before this step, not assumed.

New automated coverage: `src-tauri/src/opencode.rs`'s
`plugin_source_buffers_text_parts_and_posts_transcript_lines` (string-
presence, matching this file's existing test style) and
`scripts/opencode-transcript-check.ts` (new, registered in `package.json`
as `opencode-transcript:check` and in the aggregate `check` script) —
role/text round-trip, empty-text rejection, unrecognized-role rejection,
malformed-input rejection, and the schema-drift tripwire recognizing the
new envelope type, mirroring `codex-transcript-check.ts`'s coverage shape
for the Codex envelope.

### Step 3: Frontend wiring and manual verification

Decisions panel picks up OpenCode-sourced open questions the same way it
does Claude/Codex ones. Real OpenCode session with a genuine open
question in it; confirm it surfaces correctly and dismiss/answer-now both
work.

**Verify**: full gate list (`tsc --noEmit`, `cargo clippy -D warnings`,
`cargo test --lib`, `npm run check`, `git diff --check`); update
`README.md`'s OpenCode extraction column from `—` to `✅`.

## Done criteria

- [ ] Step 1's live findings on `message.updated`'s real shape and firing
      cadence recorded before any shipped extraction code.
- [ ] No extraction attempted on a partial/streaming message fragment.
- [ ] A real OpenCode session's open question surfaces in the Decisions
      panel.
- [ ] Invariant #5 holds — no new prompt-injection surface.
- [ ] All gates pass.

## STOP conditions

- `message.updated` payload has no reliable "message is complete" signal —
  stop and report; do not guess a heuristic (e.g. "no updates for 2s")
  without it being a documented, deliberate STOP-and-decide moment, not a
  silent workaround.
- The `chat.message` hook's `input` doesn't actually carry full prompt
  text live despite the current code's parameter name suggesting it might
  — report the real shape found.

---

# Part 2: Session re-entry / resume

## Status

P2. Resume command itself is already documented and low-risk to wire
(closed-set selector, same pattern as every other adapter); the harder
part is correctly detecting "this is a genuinely new session" vs. "this
is a resume replay," per the live-documented fact that `session.created`
fires on both.

## Scope

**In scope**: `src-tauri/src/pty.rs` (`resume_command`'s closed-set
selector — add an `"opencode"` arm), `src-tauri/src/opencode.rs` (if
`SessionStart`-equivalent binding logic needs adjusting to not treat every
resume replay as a brand-new session), `src/App.tsx`/`src/lib/repo.ts` if
OpenCode needs its own arm in existing agent-agnostic binding code
(likely already agent-agnostic post Codex Plan 002 — confirm, don't
re-derive), `docs/TESTING.md`.

**Out of scope**: `--fork` support (forking creates a second session,
different feature, not in scope for re-entry parity with other adapters).

## Steps

### Step 1 (gate): Live-verify resume against the installed CLI

Confirm `opencode --session <id>` (or `--mini -s <id>` per the exit
splash's own suggested form) actually restores prior context in a new
process, the same proof bar every other adapter's resume command met
(Antigravity's Plan 025, Codex's Plan 002). Separately confirm whether
`session.created`'s replay-fire on resume would cause the existing
`SessionStart`-triggers-a-binding-write logic to misfire (e.g. overwrite
title/color, or miscount as a fresh session) — if OpenCode's plugin
distinguishes fresh-create from resume-replay in the event payload, use
that; if not, this needs its own STOP-and-decide moment, not a guessed
heuristic.

#### Step 1 findings (live, 2026-09-21, opencode 1.18.32)

- **Resume confirmed working**: `opencode run -s <session_id> "..."` in a
  fresh process correctly recalled prior-turn context ("You asked me to
  read sample.txt and report its exact contents in one short sentence" —
  accurate recall of the first turn's actual prompt). Same proof bar as
  Antigravity/Codex's resume verification.
- **`session.created` did NOT re-fire on resume** — occurred exactly once
  across both the fresh session and the resumed second process. This
  contradicts the upstream doc excerpt fetched for this plan ("runs for
  both fresh creation and resume replay"). Live behavior wins per this
  repo's standing rule: doc text has been wrong before for other adapters
  (Antigravity `PostToolUse`/`PreInvocation`, `docs/LANDMINES.md`) and is
  wrong here too.
- **Practical effect: good news for this part.** The existing
  `SessionStart`-triggers-a-binding-write logic will not double-fire on a
  simple `-s` resume, at least via `opencode run`. Still worth a
  TUI-driven resume check in Step 3 (this spike used non-interactive `run`
  only) before fully trusting it — the TUI's own `/resume` command may
  follow a different internal path than the CLI flag did.
- `session.idle` fired once per turn (twice total across two turns) with
  no epoch-stuck symptom in this basic check — unlike Antigravity, no
  turn-epoch bug surfaced here, but this was only a 2-turn, non-interactive
  smoke test, not the multi-turn TUI regression Step 3 still requires.

### Step 2: Extend the resume selector

Add `"opencode"` to `resume_command`'s closed-set match in `pty.rs`, using
the verified command from Step 1. Keep the existing shell-injection
boundary (`valid_resume_id`) unchanged.

**Verify**: `cd src-tauri && cargo test --lib pty::tests` — new resume-
selection test for `opencode`, alongside the existing per-adapter cases.

**Real pre-existing bug found while implementing this (2026-09-21):**
`App.tsx`'s `SessionStart`-triggers-a-binding-write path
(`App.tsx:947-965`) turns out to already be fully agent-agnostic —
`transcript_path` is optional there (`p.transcript_path ?? ""`), and
OpenCode's plugin has emitted a `SessionStart`-mapped event since Phase 8
(`EVENT_MAP`'s `"session.created" → "SessionStart"`). So a
`session_bindings` row for `agent: "opencode"` was very likely already
being written, and a ghost tab with a "Re-enter" button was very likely
already appearing for OpenCode sessions after quit/relaunch — **but
clicking it, before this step's fix, ran `resume_command`'s fallback arm
and silently launched `claude --resume <sid>`, not OpenCode.** The
`onboarding.ts` `capabilities.reentry: false` flag never gated this — it
only controls the Setup checklist's display text
(`OnboardingModal.tsx:309-314`), not the runtime ghost-tab/Re-enter path.
This step's fix is a strict correctness improvement independent of
whether Step 3 below passes; the flag stays `false` until Step 3's live
TUI check does, per this repo's own "don't claim it until live-verified"
convention, but the previously-silent wrong-command bug is fixed either
way.

### Step 3: Manual regression

Real OpenCode session, quit/relaunch, confirm a ghost tab appears and
Re-enter restores the same session with prior context — full parity check
against the Antigravity/Codex precedent, not a partial pass.

**Verify**: full gate list; update `README.md`'s OpenCode row ("Resume/
re-entry supported").

## Done criteria

- [ ] Step 1's live resume proof recorded (CLI version, actual command,
      confirmed context recall).
- [ ] `session.created`'s resume-replay firing does not corrupt existing
      binding state.
- [ ] Quit/relaunch/Re-enter passes live for a real OpenCode session.
- [ ] Claude/Codex/Antigravity/Pi resume behavior unchanged.
- [ ] All gates pass.

## STOP conditions

- Step 1's live resume attempt does not restore real prior context (e.g.
  starts a visually similar but actually fresh session) — report the
  actual behavior, do not ship a resume command that silently fails to
  resume.
- No reliable fresh-vs-replay signal exists in `session.created`'s payload
  and no alternative signal is found — report and consider Part 2 blocked
  pending an upstream fix, same STOP category as Antigravity's Plan 003
  when its first-turn detector needed a fallback.

---

## Execution contract

First read AGENTS.md, CLAUDE.md, CONTRIBUTING.md, and this file in full.
Confirm current phase acceptance before any code. Each part gates
independently — a Part 1 pass doesn't authorize skipping Part 2's Step 1.
Use isolated `feat/<slug>` branches per part. Never run `npm run golden`
speculatively.

Keep Tauri v2/Rust/portable-pty/React/strict TypeScript/Tailwind/xterm/
SQLite. All DB access through `src/lib/repo.ts`, migrations new and
numbered, structured semantics only, PTY bytes untouched, no autonomous
terminal input. Agent/transcript text is untrusted (invariant #5). Hooks/
panels fail open (invariant #2). Context7-fetched doc facts above are
real citations, not guesses, but are still unverified against a live
`opencode` process — treat every one as "docs say" until each part's own
Step 1 confirms it, matching this repo's established doc-vs-live caution.

## Final acceptance and stop rules

- Each part's own Done criteria and STOP conditions govern independently.
- `git diff --name-only` per part stays within that part's scope plus this
  plan, `plans/README.md`, `docs/ROADMAP.md`, `docs/TESTING.md`.
- Record real manual/live evidence (OpenCode version, date, actual payload
  excerpts) in `docs/TESTING.md`.
- Report and stop for: missing phase approval, a live finding that
  contradicts this plan's assumptions, or any required scope expansion.
