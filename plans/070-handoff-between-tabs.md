# Hand a reply to another agent tab

Status: **PROPOSED 2026-11-15. Not approved; no implementation authorized.**
Needs `PHASE 69 ACCEPTED` and then the literal `PHASE 70 APPROVED`.

Planned at `03b2063` (`main`). Source: maintainer request 2026-11-15, following
`docs/IDEAS.md` "Agent Flows" (the compliant shape it describes).

Estimated effort: one to two days. One pure module, one check, one modal, one
small terminal registry, a button, one event type. No schema change, no
migration, no Rust, no new dependency, no prompt change.

## Problem

The maintainer runs two agents side by side on one project (last 30 days: 144
Codex sessions, 115 Claude) and carries text between them by hand. In their
words, the two common cases:

1. **Plan review loop.** Ask both agents for a plan. Send one plan to the other
   with "considering what you found, X suggested this, review their plan and
   give notes". Send the notes back for a second pass. Send the revision over
   for one last adversarial review, then finalize.
2. **Parse out and hand off.** Ask the agent in focus to write up a piece of
   work for someone else, then copy it into another tab, sometimes edited,
   often not.

Each hop is select, copy, switch tab, type a framing sentence, paste. The app
already has the text: Plan 068 kept exactly the transcript lines with readable
message text.

The receiver is an existing live session with its own context, so this is not
a spawn. It is a prefill into another tab's prompt, which the human then sends.

## What it is

A **Hand off** button for the active tab. It opens a small dialog holding the
tab's last assistant message, a framing line, and a choice of target tab in the
same project. Confirming pastes the text into the target's prompt, unsent, and
focuses that tab. The human reads it and presses Enter.

This is level 1 of three. Level 2 (a card that offers the handoff when an
agent finishes) and level 3 (no click) are not in this plan. Level 3 would
re-open invariant #4.

## Measured (maintainer database, read-only, counts only)

Last 14 days: 750 `hook:Stop` events, 733 with a stored assistant message just
before them. Length of that message: p50 1,221 chars, p90 2,719, p99 5,579, max
10,532. No `ExitPlanMode` tool events, so plans arrive as ordinary assistant
text and need no special source.

## Current code this builds on

Click-to-prefill already exists and is the sanctioned exception under
invariant #4. `src/App.tsx`:

```ts
// :1715
// Answer-now prefill: writes only a draft into the bound tab's terminal.
const answerNow = useCallback((d: Decision) => {
  // ...
  focusTab(tab.id);
  void ptyWrite(tab.ptyId, `Re: "${d.question}" — `);
}, [focusTab]);

// :1729  Momentum's "↳ Ask" (Plan 043): prefill only, same discipline
const prefillActiveTab = useCallback((text: string) => {
  if (!activeTab || activeTab.status !== "live") return;
  void ptyWrite(activeTab.ptyId, text);
}, [activeTab]);
```

Both write short single-line text straight to the PTY. A handoff is multi-line,
and raw newlines written to a PTY submit line by line in agent TUIs. The paste
path in `src/components/Terminal.tsx:44-60` solves that for ⌘V by calling
`term.paste()`, which wraps the text in bracketed-paste markers when the
program in the terminal has turned bracketed paste on.

The installed xterm is 6.0.0. Its typings
(`node_modules/@xterm/xterm/typings/xterm.d.ts`) expose `paste(data: string)`
and `modes.bracketedPasteMode: boolean`.

Each tab keeps its own xterm instance for the tab's lifetime
(`Terminal.tsx:28`, "Create xterm once per tab"), mounted whether or not the
tab is visible. Terminal input goes through `term.onData`
(`Terminal.tsx:88`), which calls `stampInput` and then `ptyWrite`, so pasted
text counts as human input for turn provenance.

Other pieces:

- `repo.recentTranscript(sessionId, limit)` (`repo.ts:1223`) returns a
  session's latest stored transcript lines, oldest first.
- `textFromTranscriptLine` (`decisions.ts:129`) turns a line into
  `{ role, text }` for all six adapters. `repo.ts` cannot import
  `decisions.ts` (circular), so anything combining them lives outside `repo.ts`.
- `Tab` (`types.ts:73`) has `id`, `ptyId`, `title`, `cwd` (the project root),
  `status`, `sessionId`, `agentState`, `agent` (undefined means Claude).
- `stateForHook` (`ingest.ts:516`) maps `SessionEnd` to `idle`, so tab state
  alone does not say whether an agent is still running in a tab.
- Agent display labels are in `src/lib/onboarding.ts` (`label: "Codex"` and
  so on).
- The Next card's `↳ Ask` button is at `SidePanel.tsx:1525`. Modal exemplar:
  `src/components/LandingNoteModal.tsx` (Esc closes from anywhere, focus on
  open). Check-script exemplar: `scripts/compaction-check.ts`.

## Scope

Done = from any agent tab, two clicks put that tab's last reply, framed and
quoted, into another same-project tab's prompt without sending it, and each
handoff leaves one countable event.

Files in scope: `src/lib/handoff.ts` (new), `src/lib/terminalRegistry.ts`
(new), `src/components/HandoffModal.tsx` (new), `src/components/Terminal.tsx`,
`src/components/SidePanel.tsx`, `src/App.tsx`, `scripts/handoff-check.ts`
(new), `package.json`, `docs/TESTING.md`, `docs/PROGRESS.md`,
`docs/LANDMINES.md`, `docs/IDEAS.md` (mark the Agent Flows entry),
`plans/README.md`, this file.

## Approach

### `src/lib/handoff.ts` (pure)

- **`lastAssistantMessage(lines)`**: walk stored transcript lines newest first
  and return the first `textFromTranscriptLine` result with role `assistant`,
  full text, not sliced.
- **`sanitizeHandoffText(text)`**: normalize `\r\n`, `\r`, U+2028 and U+2029 to
  `\n`; remove every other C0 control character except tab, plus DEL and the C1
  range; trim trailing whitespace. With ESC gone, the text cannot contain a
  bracketed-paste end marker, so it cannot break out of the paste.
- **`buildHandoff({ preset, fromLabel, fromTitle, text })`**:

  ```
  <framing line>

  ----- from Codex · <tab title> -----
  <text>
  ----- end -----
  ```

  Framing presets, taken from the maintainer's own wording:

  | Preset | Line |
  |---|---|
  | Review | Another agent (Codex) proposed the plan below. Considering what you found, review it and give me notes. |
  | Revise | Here are review notes from Codex on your plan. Revise it and give me a second pass. |
  | Final check | Here is Codex's revised plan. Do one last adversarial review, then give me the final version. |
  | Plain | Handed off from Codex: |

- **`eligibleTargets(tabs, sourceId, projectKeyOf)`**: tabs other than the
  source that are `live`, have a `sessionId`, and share the source's project
  key.
- **`handoffEventPayload(...)`**: `{ v: 1, project_key, tab_id, to_tab_id,
  to_session_id, adapter_id, to_adapter_id, preset, chars, edited, delivery }`
  where `delivery` is `"prefill"` or `"copy"`. Lengths and ids only. The text
  itself is never stored a second time.

### `src/lib/terminalRegistry.ts`

A module-level `Map<tabId, (text: string) => boolean>`. `Terminal.tsx`
registers a function in the effect that creates the xterm and removes it in
that effect's cleanup. The function returns `false` without writing when
`term.modes.bracketedPasteMode` is off, and otherwise calls `term.paste(text)`
and returns `true`. `pasteIntoTab(tabId, text)` looks the function up.

Going through `term.paste` rather than `ptyWrite` is the point: xterm adds the
bracketed-paste markers, and `onData` stamps the input as human.

### `HandoffModal.tsx`

Opened by App with the source tab. Shows the target picker (preselected when
there is exactly one), four preset chips (Review by default), and an editable
textarea holding `buildHandoff(...)`. Changing preset rebuilds the text only if
the user has not edited it. Buttons: **Prefill in &lt;target&gt;**, **Copy**,
Cancel. Esc closes. If the source has no stored assistant message the textarea
starts with the framing line alone and says so.

On **Prefill**: sanitize, call `pasteIntoTab`. On `true`, focus the target with
the existing `focusTab`, log the event, close. On `false`, copy to the
clipboard instead, say "That tab isn't ready for pasted text. Copied instead.",
and log `delivery: "copy"`.

### Button and wiring

- `SidePanel.tsx`: a **⇄ Hand off** button in the side panel's header row for
  the active tab, via a new `onHandoff` prop. Disabled, with a title explaining
  why, when the tab has no session or there is no eligible target. If the
  header row has no room, put it beside `↳ Ask` and say so as a stated
  revision.
- `App.tsx`: modal state, the `onHandoff` callback, and the event write through
  `repo.addEvent(sourceSessionId, "handoff", JSON.stringify(payload))`.

### Existing prefills through the same sanitizer

`answerNow` and `prefillActiveTab` write extracted agent text to a PTY as is. A
newline inside a decision question would submit it. Pass both through
`sanitizeHandoffText(...).replace(/\n/g, " ")`. Two lines, same trust boundary.

## Steps (each with its check)

1. `handoff.ts` plus `scripts/handoff-check.ts`, wired into `npm run check`.
   Check: `npm run handoff:check` covers: last assistant message picked from
   Claude and Codex fixture lines, ignoring later user and non-text lines; no
   assistant line gives null; sanitizer output has no character below 0x20
   other than `\n` and `\t`, no 0x7f, no 0x80–0x9f, and never ends in
   whitespace; an embedded `ESC [ 2 0 1 ~` loses its ESC; each preset names the
   source agent; `eligibleTargets` excludes the source, dead tabs, tabs with no
   session and tabs in another project; the event payload has no key holding
   the text and `chars` equals the sent length.
2. `terminalRegistry.ts` and the `Terminal.tsx` registration. Check:
   `npx tsc --noEmit`; StrictMode double-mount leaves exactly one entry per tab
   (cleanup removes it), shown by a preview-harness console count.
3. `HandoffModal.tsx`, the button and App wiring. Check: preview-harness pass
   in dark and light: one target preselected; preset chips change an unedited
   text and leave an edited one alone; Esc closes; the button is disabled with
   one tab open.
4. The two existing prefills through the sanitizer. Check:
   `npm run decisions:check`, `npm run momentum:check`, and a new assert that a
   question containing a newline prefills as one line.
5. Gates and docs: `npm run check`, `npx tsc --noEmit`, `npm run build`,
   `git diff --check`. Rust is untouched; say so instead of rerunning cargo.
   `docs/TESTING.md` gets the manual list, `docs/LANDMINES.md` the bracketed
   paste rule, `docs/IDEAS.md` a line on the Agent Flows entry, and
   `docs/PROGRESS.md` the phase entry.

## Stop and report instead of improvising

- The excerpts above no longer match the code.
- `term.modes.bracketedPasteMode` or `term.paste` is missing from the installed
  xterm typings.
- Delivery seems to need `ptyWrite` with hand-built escape markers.
- Any design that adds a trailing newline, a timer, or a send without a click.
- The handoff needs a Rust command, a migration or a new dependency.

## Risks

- **Target is a shell, not an agent.** If the agent in the target tab has
  exited, the text lands at a shell prompt. zsh has bracketed paste on, so
  nothing runs on paste, but pressing Enter would run agent-written text as
  shell input. Mitigations: the dialog names the target, the target gets focus
  so the human sees where the text went, and nothing is ever sent for them.
  Tab state cannot rule this out today (see `stateForHook`). Recorded in
  `docs/LANDMINES.md`; manual check 6 covers it.
- **One agent's words become another's prompt.** That is what the maintainer
  does by hand now. The text is shown, editable, marked as quoted, and sent
  only by the human. It is a prompt-injection path if sent unread, which is why
  level 3 is out.
- **Wrong message picked.** The last assistant line may be a short sign-off
  rather than the plan. The text is editable and Copy still works. If this
  shows up in use, add "include the previous message" later.
- **Agent TUIs differ on large pastes.** Claude Code collapses long pastes to a
  placeholder. Sizes here are small (p99 5,579 chars); verified per agent in
  manual checks 1 and 2 only.

## Invariants

- **#4:** human-clicked, prefill only, never sent, same discipline as
  `answerNow` and `↳ Ask`. No path writes to a terminal without a click.
- **#5:** the reply is untrusted data. It is quoted between markers, shown
  before use, stripped of control characters, and never read by the app for
  meaning.
- **#1:** the source is stored transcript text, never terminal output.
- **#2:** every failure (no message, no registry entry, clipboard error) leaves
  terminals untouched and the dialog open with a message.
- **#3:** one appended `handoff` event; the button reads existing rows.
- **#6:** untouched.

## Experiment

The point of v1 is to learn whether this replaces the copy-paste. Review after
14 days of use with:

```sql
SELECT json_extract(payload_json,'$.preset') preset,
       json_extract(payload_json,'$.delivery') delivery,
       count(*) n, sum(json_extract(payload_json,'$.edited')) edited
FROM events WHERE type = 'handoff' GROUP BY 1, 2;
```

- 20 or more handoffs: plan level 2, the offered-handoff card.
- Mostly unedited and mostly one preset after another: the loop is regular
  enough to suggest the next step.
- Fewer than 5: remove the button or leave it; build nothing more.

## Decisions

Defaults to confirm or change at approval:

1. **Same project only**, compared by project key. Fan-out and worktree tabs
   are other projects for this purpose. (Settled in chat 2026-11-15.)
2. **Four presets, fixed wording, no saved custom templates.**
3. **Source is the last assistant message only.**
4. **Button in the side-panel header**, no keyboard shortcut in v1.
5. **Sanitize the two existing prefills in this phase.**

## Out of scope

- Any send without a click, timers, or links that persist between tabs.
- Cross-project handoffs and the Agent Flows canvas.
- Spawning a new session as the target.
- Suggesting the next step of the review loop.
- Handing off diffs, decisions, or files. Text only.
- Detecting whether an agent is still running in the target tab.

## Manual checks (docs/TESTING.md Phase 70)

On the installed app, one project, a Claude tab and a Codex tab:

1. Claude to Codex, Review preset: the text appears in Codex's prompt as one
   pasted block and is not sent. Enter sends it.
2. Codex to Claude, Revise preset: same.
3. Edit the text in the dialog first: the edited text is what arrives.
4. Split view with both tabs visible: focus moves to the target pane.
5. Copy: the clipboard holds the same text; nothing is written to any tab.
6. Quit the agent in the target tab so it sits at a shell prompt, then hand
   off: the text is pasted and nothing runs. Clear the line; do not press
   Enter.
7. With one tab open, or a tab with no session, the button is disabled and
   says why.
8. While the target agent is working: the text waits in its prompt.
9. `SELECT count(*) FROM events WHERE type = 'handoff'` rises by one per
   handoff, and no row's payload contains message text.
