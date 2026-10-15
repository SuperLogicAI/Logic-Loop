# Remember: human-confirmed project decisions (`.logic-loop/DECISIONS.md`)

Status: **APPROVED 2026-10-14 (`PHASE 64 APPROVED`, defaults 1–5).** Built on
`feat/phase-64-decision-log`; awaiting `PHASE 64 ACCEPTED`. Phase 63
accepted 2026-10-10. Branch `feat/phase-64-decision-log` from `origin/main`
once the session-routing fix (`fix/session-routing-clear-codex`) has merged,
so the build and any demo include it.

Source: `docs/IDEAS.md` "Human-confirmed project decisions" build brief
(2026-10-14; maintainer call: build this). The brief holds the rationale,
the measurements, the lineage and the two-week experiment. This plan
covers only the build. Read the brief first.

## Problem

Decisions die with the session. A choice made and justified in a Codex tab
on Monday is invisible to a fresh Claude tab on Tuesday unless the human
retypes it. Decision cards already surface the candidates, but nothing
turns one into something a future agent reads.

## What exists

- Decision cards (`SidePanel.tsx` ~1544–1625): open cards with ✕ dismiss,
  ✎ answer, ⌕ context, ⤳ delegate. Closed rows (`closedDecisions`, last
  10, `status !== "open"`) are one truncated line each (~1673).
  `d.user_answer` and `d.agent` exist (`agent` is null for plain Claude).
  The panel's `cwd` prop is already the project key (`App.tsx` 482).
- `board.rs`: `read_board`/`write_board`. The project key is trusted, the
  filename is a hardcoded constant, and calls go through
  `spawn_blocking_*`. Fail open.
- `markdown.rs` (Plan 062): `md_read`/`md_write` with compare-and-swap
  (`WriteOutcome::{Saved, Conflict}`), limited to files in `md_list`
  (`CLAUDE.md`, `AGENTS.md`, `.claude/CLAUDE.md`, `.logic-loop/board.md`,
  root and `docs/` `*.md`). Plan 062 deliberately uses a plain write, not
  temp+rename, to keep symlinks and inodes intact.
- `ProjectOverview.tsx`: the per-project page, with the Overview |
  Markdown toggle.
- `OnboardingModal.tsx`: global adapter setup with no project in scope.

## Build

### Part A: demo-critical

1. **Rust, in `board.rs`, next to `write_board`:**
   - `read_decision_log(project_key) -> String`. Returns `""` when the
     file is missing or on any error (fail open). Never seeds a file.
   - `append_decision_log(project_key, line) -> Result<(), String>`.
     Rejects anything that isn't a single line (`\n` or `\r`), doesn't
     start with `- D-`, or is over 1,000 bytes. The project key must be an
     existing directory, as in `write_board_blocking`. On first write it
     creates `.logic-loop/` and the header (`create_new`, so a race
     between two first writes can't produce two headers). Then it appends
     with `OpenOptions::append`, so a concurrent hand edit survives.
   - `ensure_union_merge` (private, called by both writes): creates
     `.logic-loop/.gitattributes` with `DECISIONS.md merge=union`, or
     appends that line if the file exists without it. Other lines are
     kept. Idempotent.
   - `write_decision_log(project_key, base, content) ->
     Result<WriteOutcome, String>`. Compare-and-swap like `md_write`
     (reuses `markdown::WriteOutcome`, 1 MB cap). Used only by supersede.
   - Register the three commands in `lib.rs`.
2. **Pure TS, in `src/lib/decisionLog.ts`:**
   - `HEADER`: the brief's three header lines.
   - `formatEntry({ id, decision, reason, revisitIf?, supersedes?, agent,
     date, cardId })`. Collapses all whitespace to single spaces. Strips
     leading `#`, `>` and `-`, and every backtick fence. Enforces the caps
     (160 / 240 / 120). Adds a final `.` when one is missing. Prefixes
     `Because ` unless the reason already starts with it. Output:
     `- D-20261014-7f3a · Use X for Y. Because Z. Revisit if W. Supersedes
     D-… (codex · 2026-10-14 · card #1234)`.
   - `newId(date, existingIds, rand = crypto.getRandomValues)`. Produces
     `D-YYYYMMDD-xxxx` and retries on a collision.
   - `currentEntries(file)` → `{ id, text, superseded }[]`, parsed only
     from lines matching `^- (\[SUPERSEDED by D-…\] )?(D-\d{8}-[0-9a-f]{4}) · `.
   - `rememberedCards(file)` → `Map<cardId, entryId>`. Reads only the
     trailer anchored at the end of the line, so a `card #5` typed inside
     the decision text can't fake a mapping.
   - `supersede(file, oldId, newLine)`. Prefixes exactly one line with
     `[SUPERSEDED by <new id>] ` and appends `newLine`. Throws on zero
     matches, several matches, or an entry that is already superseded.
   - `addLinkLine(text, line)`, `removeLinkLine(text, line)`,
     `hasLinkLine(text, line)`. The add is idempotent, and add then remove
     is byte-identical for an empty file, a file with a trailing newline
     and one without.
   - `scripts/decision-log-check.ts` → `npm run decision-log:check`,
     added to `npm run check`. It asserts:
     - always one line: fixtures with newlines, fences and leading
       `#`/`>`/`-` stay on one line;
     - the caps hold;
     - the ID format is right and a forced collision retries;
     - supersede marks exactly one line, and each of its three error
       cases throws;
     - the trailer parse ignores a fake `card #` inside the text;
     - the link-line round trip is byte-identical in all three cases.
3. **Remember editor, a new `src/components/RememberEditor.tsx`**, inline
   under the card:
   - The card's question, and its answer when there is one, shown
     read-only for context.
   - Fields:
     - **Decision**, prefilled from `user_answer`;
     - **Reason**, always empty to start;
     - **Revisit if**, optional;
     - **Supersedes**, a select over current, non-superseded entries.
   - Character counters. Save stays disabled until Decision and Reason
     are both non-empty after trimming.
   - Muted helper line: "Saved into the repo for every agent to read. No
     secrets or client data."
   - Save with no supersede calls `append_decision_log`. Save with a
     supersede computes `supersede(current, …)` and calls
     `write_decision_log`. On `Conflict`, it recomputes once from
     `current`; a second conflict shows an error and keeps the typed
     fields.
   - Errors show inline. Nothing touches terminals.
4. **SidePanel wiring:**
   - Read the log on mount and whenever `cwd` changes, and after each
     save. Use the cancelled-flag pattern.
   - A `◆ remember` action on open cards (in the action row) and on
     answered or delegated closed rows (a small button at the row's end).
     Not on dismissed or stale cards.
   - A card that is already in `rememberedCards` shows "Remembered as
     D-…" instead of the button.
   - Remember never changes the card's status (Decision 2).
5. **Share with Claude**, in `ProjectOverview.tsx` (Decision 3):
   - A small "Remembered decisions" block: N current entries, then a
     "Claude: shared ✓ / Share" control.
   - Share and Unshare call `md_read` and then `md_write` (compare-and-
     swap) on the root `CLAUDE.md`, using `addLinkLine` or
     `removeLinkLine` with `@.logic-loop/DECISIONS.md`. No new Rust.
   - A missing `CLAUDE.md` shows "No CLAUDE.md in this project" and
     offers nothing (Decision 4).
   - Never on automatically, never global. Remember works whether or not
     sharing is on.

### Part B: same phase; may slip a day, and any slip will be stated

6. **Share with Codex**, the same control for `AGENTS.md` with the
   brief's pointer line: "Project decisions live in
   `.logic-loop/DECISIONS.md`. Read it before changing anything it covers;
   lines marked SUPERSEDED are history." The status always adds "load not
   observed".
7. **Travel note.** `decision_log_travel(project_key)` →
   `"tracked" | "ignored" | "no_repo"`:
   - `has_own_repo` guard, then `git -C <root> check-ignore -q
     .logic-loop/DECISIONS.md`, `spawn_blocking`, fail open to
     `"tracked"` (read LANDMINES' git-shelling entries first).
   - "ignored" and "no_repo" show "Stays on this machine; won't travel
     with the repo" in the Overview block.
8. **`markdown.rs` `FIXED`** gains `.logic-loop/DECISIONS.md`, so the file
   opens in the Markdown view for hand edits (Decision 5). Update the list
   test.

## Stated revisions from the brief

- **Supersede uses compare-and-swap, not temp+rename.** This follows
  Plan 062's precedent: rename replaces symlinks and inodes, and it also
  silently clobbers a hand edit made between the read and the write.
  Compare-and-swap refuses the write and lets the caller retry.
- **The sharing toggle lives in Project Overview, not
  `OnboardingModal`.** The onboarding modal is global adapter setup with
  no project in scope, and the brief requires sharing to be per project.
- **Link-line setup is pure TS over the existing `md_read`/`md_write`,**
  so the brief's Rust round-trip tests become `decision-log:check`
  asserts. Same coverage, no new Rust command.

## Security and invariants

- **Trust boundary (#5).** Only fields the human saved go into the file.
  The prefill must be confirmed, and the Reason is always typed by the
  human. Never written: the question, `assumption`, `context_json`,
  transcript text, or anything from `events`. No model call anywhere.
- **Validation at the Rust boundary.** The TS formatter is not trusted
  alone: `append_decision_log` rejects multi-line input and anything
  without the `- D-` prefix, and both writes are size-capped. The paths
  are hardcoded constants under the trusted project key, the same surface
  as `board.md`.
- **Process configuration, not input (#4).** The file and link lines are
  read at the next session start. Nothing is written to a live PTY.
- **Fail open (#2).** A read error means an empty log, and write errors
  show in the editor. Terminals are never affected.
- **Panels stay dumb (#3).** No schema change and no migration: the file
  is the record. `card #id` points back to the local DB.
- **Writes outside `.logic-loop/`:** only the one link line per
  instruction file, only on an explicit click, and reversible
  byte-for-byte.

## Decisions (defaults marked; confirm or change at approval)

1. **Where Remember appears.** **Open cards, plus answered and delegated
   closed rows** (default). Alternative: answered rows only. That is
   cleaner, but answering happens in the terminal, so the human would
   have to wait for the card to close first.
2. **Remember and card status.** **No status change** (default). Remember
   only writes the file. Alternative: Remember on an open card also marks
   it answered with the Decision text, which is a DB write and puts
   status semantics into this feature.
3. **Sharing toggle location.** **Project Overview** (default; see the
   revisions above). Alternative: inside the Decisions panel header.
4. **Missing `CLAUDE.md`/`AGENTS.md`.** **Don't create it** (default):
   no new Rust, and Logic Loop never creates instruction files.
   Alternative: create the file containing only the link line, which
   needs a new command, and Unshare then leaves an empty file behind.
5. **DECISIONS.md in the Markdown view.** **Yes** (default): it's a
   one-line change and matches "edit freely" in the header. Alternative:
   leave it out.

## Out of scope

The brief's list applies:
- auto-promotion or bulk Remember;
- reasons drafted by a model;
- question or transcript text in the file;
- search, MCP or embeddings;
- schema changes;
- targets other than Claude and Codex;
- `InstructionsLoaded` load verification;
- CONTEXT.md (shelved);
- transcript retention.

Also out: Windows verification (Phase 13; a ROADMAP gap row will cover
`check-ignore` and append semantics).

## Verify

- Focused:
  - `npm run decision-log:check`;
  - `cd src-tauri && cargo test --lib decision_log`, with Rust tests in a
    temp dir under the system temp root:
    - the first append creates the header and the `.gitattributes` line
      exactly once;
    - an existing `.gitattributes` with other lines keeps them and gains
      the line once;
    - multi-line, unprefixed and oversize appends are rejected;
    - a non-directory project key errors;
    - `write_decision_log` returns `Conflict` on a stale base;
    - `.gitattributes` content is unchanged after a second write.
- Gates:
  - `npm run check` and `npm run opencode:check`;
  - `npx tsc --noEmit` and `npm run build`;
  - `cd src-tauri && cargo test --lib` and
    `cargo clippy --all-targets -- -D warnings`;
  - `git diff --check`.
- No golden run (no prompt change). No migration.

## Manual checks (docs/TESTING.md Phase 64)

Run these in the built app, in a scratch repo under `/private/tmp/…` with
placeholder content only. Archive the repo on the dashboard afterwards.

- [ ] 129. Remember on an answered card:
      - the question and answer show read-only, and Decision is
        prefilled;
      - Save stays disabled without a Reason;
      - the line appears in `DECISIONS.md` within 1 s, and the card
        shows "Remembered as D-…".
- [ ] 130. The first Remember creates the header and
      `.logic-loop/.gitattributes` (`DECISIONS.md merge=union`). A second
      Remember adds neither again.
- [ ] 131. A Decision containing newlines, a ``` fence and a leading `#`
      saves as one line.
- [ ] 132. Supersede:
      - exactly one old line is prefixed `[SUPERSEDED by …]`;
      - the new line is appended;
      - superseded entries are missing from the picker.
- [ ] 133. Hand-edit `DECISIONS.md` in an external editor with the panel
      open, then supersede in the app: the hand edit survives.
- [ ] 134. Share with Claude adds the line to `CLAUDE.md`. A fresh Claude
      tab given a task that depends on a remembered decision names the
      choice and the reason. Unshare makes `git diff CLAUDE.md` empty.
- [ ] 135. Share with Codex: same steps for `AGENTS.md`. Record recall
      whether it passes or fails; this is the brief's experiment input.
- [ ] 136. Two worktree branches each Remember an entry, then merge:
      clean, with both lines present.
- [ ] 137. With `.logic-loop/` gitignored, Overview shows "won't travel".
- [ ] 138. Regression: answer, delegate, dismiss and dismiss batch behave
      as before, and terminals are unaffected throughout.

Afterwards: run the brief's recall experiment, steps 1–3 (about 10 real
decisions in this repo, with a baseline run without the link line), and
record the results in `docs/TESTING.md`. Step 4 (the two-week review)
waits for the window to pass.
