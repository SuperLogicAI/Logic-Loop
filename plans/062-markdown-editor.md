# Markdown editor for project instruction files

Status: **ACCEPTED 2026-10-10 (`PHASE 62 ACCEPTED`).** Approved
2026-10-10 (`PHASE 62 APPROVED`, defaults 1–4).
Branch `feat/phase-62-markdown-editor`. Built stacked on the Phase 61
branch because PR #90 hadn't merged at approval, then moved onto `main`
(`c5cc736`) once it merged. The trees were identical, so nothing changed. Implemented; gates green. Built-app checks
111–120 passed. Scope agreed in discussion on
2026-10-10: its own phase, fixed set plus root `*.md`, no preview.

Source: maintainer concept (screenshot, 2026-10-10): Home / project /
Markdown Editor, file list on the left, editor on the right. It follows
Plan 061 and the IDEAS "Editor-native users" feedback.

**Plan revision, stated explicitly.** This partly reverses IDEAS "Editable
code view pop-out — considered, not recommended". Each original objection
against this scope:

- *New editor dependency:* none. A plain `<textarea>`, with native undo.
- *Duplicates the user's editor:* code editing stays out. This covers a
  handful of instruction/notes files, the quick tweak where launching an
  IDE is the heavier move. Plan 061 still hands everything else off.
- *Save race with an agent mid-edit:* still real. Compare-and-swap on save
  (Build 2) handles it.

Code editing stays "not recommended".

## Carried over from Phase 61

- **Reuse, don't rebuild.** `pty::resolve_inside` (canonicalize +
  containment + regular-file check, with unit tests for `..`, absolute
  outside, and out-pointing symlinks) already exists. Move it to a shared
  spot (e.g. `markdown.rs` re-uses it via `crate::pty::resolve_inside`, made
  `pub(crate)`) rather than writing a second copy.
- **Escape hatch.** The editor view gets 061's `OpenInEditor` component
  next to the filename, so "this needs a real editor" is one click away.
  The editor-app setting and its error/recovery path come for free.
- **Button placement rule** (maintainer fix, 2026-10-10): a control sits
  beside the action it configures. The path line becomes **Markdown ·
  Show in Finder · Open in editor · change editor**: Markdown first as the
  in-app action, and "change editor" stays next to Open in editor.
- **Escape key.** Escape handling in `ProjectOverview` stays per-input
  (`stopPropagation`, like the nickname field) and 061's input did the same
  inside `DiffModal` with no regression. The textarea follows suit: Escape
  must never discard a draft or leave the view without the dirty prompt.
- **Testing.** Codex computer use ran 061's UI checks well. Two things to
  repeat or fix:
  - Run file checks in a scratch project, not a real one. 061's synthetic
    hook fixtures left 28 events under
    `/private/tmp/logic-loop-phase61-tests-20261010` in the real
    append-only DB. 062's checks need no hook fixtures (they edit files on
    disk directly), so none should be injected. Archive the scratch project
    on the dashboard afterwards.
  - 061's restart check was deferred to protect live sessions. No 062
    check requires an app restart; keep it that way.
- **Windows.** 061's non-macOS path is unverified (ROADMAP gap table). 062
  is pure file I/O plus a textarea, so it carries no new platform gap
  beyond the CRLF round-trip already listed below.

## Problem

Tuning `CLAUDE.md` / `AGENTS.md` or a parked-ideas file between agent runs
means leaving the app (Plan 061 makes that one click, but it's still a
second app). These files are small and edited often, and they're exactly
what the user steers agents with.

## What exists

- `board.rs`: a fixed-filename pattern with no path parameter beyond the
  trusted `project_key`, hence no traversal surface. `write_board` is a plain
  `std::fs::write`.
- `IdeaBoard.tsx`: reload-before-write (`withFreshBoard`) and re-read on
  window focus. Card splices can merge a fresh read; a whole-file editor
  can't, so it needs compare-and-swap instead.
- Plan 061's `resolve_inside` (`pty.rs`): canonicalize plus containment.
- `ProjectOverview.tsx` path line, which already hosts `OpenInEditor` (061).
- `@tauri-apps/plugin-dialog` is already used (`App.tsx`, `SidePanel.tsx`,
  `OnboardingModal.tsx`), for the unsaved-changes prompt.
- Claude Code's own docs (prompt-caching page): root and user `CLAUDE.md`
  are "read once at session start… the edit also doesn't apply" until
  `/clear`, `/compact` or a restart. The app must not send those itself
  (invariant 4).

## Build

1. **Rust module `src-tauri/src/markdown.rs`**, registered in `lib.rs`.
   - `md_list(project_key) -> Vec<String>`: relative names. The fixed set
     comes first when present, in this order: `CLAUDE.md`, `AGENTS.md`,
     `.claude/CLAUDE.md`, `.logic-loop/board.md`. Then every other
     regular-file `*.md` (case-insensitive extension) directly in the
     project root, alphabetical. ~~No recursion, nothing from `docs/`.~~
     **Revised during build (maintainer, 2026-10-10):** then every `*.md`
     directly in `docs/`, alphabetical, as `docs/<name>`. In this repo,
     `docs/` holds the most-edited files (PROGRESS, LANDMINES, ROADMAP,
     TESTING). Still one level: no `docs/*/`, no `plans/`, no recursion.
     Entries whose canonical path leaves the canonical root (symlinks
     pointing out) are dropped. Files over 1 MB are dropped.
   - `md_read(project_key, name) -> Result<String, String>`.
   - `md_write(project_key, name, base, content) -> Result<WriteOutcome,
     String>`, where `WriteOutcome` is `Saved | Conflict { current }`.
   - **The only path gate:** `name` must be in a fresh `md_list` result.
     Membership replaces path validation: `../x.md`, `sub/a.md` and
     absolute paths can't be in the list. Then canonicalize once more and
     check containment before touching the file (defense in depth; reuse
     the 061 helper, moved to a shared spot if needed).
   - **Compare-and-swap:** read the current file. If it isn't byte-equal to
     `base`, return `Conflict { current }` without writing. Otherwise write
     with `std::fs::write`, matching `write_board`. There's a tiny TOCTOU
     window between the read and the write. That's accepted and noted in
     the code; an atomic rename would replace symlinks and change inodes
     under the user's other editors.
   - Non-UTF-8 → `Err("not UTF-8 text")`. No creating new files.
   - Reuse `crate::pty::resolve_inside` (make it `pub(crate)`); no second
     containment helper.
2. **`src/components/MarkdownEditor.tsx`** (the concept layout).
   - ~~Breadcrumb `Home / <project> / Markdown`.~~ The body of the Markdown
     view only; the project header stays (Build 3). File list on the left, with
     a `●` on the open file when it has unsaved changes. A monospace
     `<textarea>` on the right, with the filename as its heading.
     `OpenInEditor` (061) sits beside the heading, scoped to the open file.
   - State: `base` (the exact string read from disk, never derived from
     the textarea) and `draft`. Dirty = `draft !== textareaOf(base)`.
   - **Line endings:** a textarea normalizes `\r\n` to `\n`. If `base`
     contained `\r\n`, convert `draft` back before saving, so a CRLF file
     doesn't turn into a whole-file diff. A pure helper in
     `src/lib/markdownEditor.ts`.
   - Cmd+S saves, along with a Save button. Saving while the file is
     unchanged is a no-op.
   - **Conflict banner:** "Changed on disk since you opened it." Options:
     **Reload** (drops your edit) and **Overwrite** (an explicit human
     choice; resends with `base = current`).
   - On window focus: if the draft is clean, reload silently; if it's
     dirty, check the disk and show the banner early if it changed.
   - ~~Switching files or leaving the view while dirty: plugin-dialog `ask`,
     "Discard unsaved changes?"~~ **Revised during build:** a prompt can't
     catch every way out (clicking a terminal tab unmounts the view with no
     hook to ask), so a prompt would still lose drafts. Instead, unsaved
     drafts live in an in-memory map keyed by project + file. They survive
     file switches, Back and tab changes, and show `●` in the list. A
     stashed draft whose base no longer matches disk reopens with the
     conflict banner. Accepted limit: quitting the app drops unsaved drafts.
   - Under `CLAUDE.md` / `.claude/CLAUDE.md` / `AGENTS.md`, one muted line:
     "Running agents keep the version they started with; it loads on
     `/clear`, `/compact`, or a new session."
   - No preview and no HTML rendering, so the file's content is only ever
     text inside a textarea (invariant 5 holds trivially).
   - **Revised during build (maintainer, 2026-10-10): syntax colours.** Still
     no preview. A colour layer sits under a transparent textarea in one
     grid cell (`highlightMarkdown` in `src/lib/markdownEditor.ts`):
     `#`/`##`/`###+` headings in different colours, list markers, bold,
     inline code, links, `@imports`, fences, quotes, rules. Tokens are
     verbatim slices rendered as React text, never HTML, so invariant 5
     still holds. No new dependency. Check 120.
3. **Entry point.** ~~A **Markdown** button on the project path line.~~
   **Revised during build (maintainer redesign, 2026-10-10)**, also folding
   in a regrouping of the existing header:
   ```
   Home / Project  [Overview | Markdown]        [Continue in… ▾] [New session tab]
   folder/path  Show in Finder  Open in editor  change editor     [Copy update] [Pin] [Archive]
   ```
   - A segmented `Overview | Markdown` toggle beside the title, styled like
     the time-range toggle. `ProjectOverview` holds `view`.
   - The header stays in both views and only the body swaps, so Continue,
     Copy update and the rest stay reachable while editing. The editor has
     no breadcrumb of its own.
   - Row 1 right: session actions (the Continue control in all three of its
     forms, plus New session tab). Row 2 right: housekeeping (Copy update,
     Pin, Archive). Previously Continue sat in a stacked column beside the
     housekeeping buttons.
   - ~~Empty list → button hidden.~~ The toggle always shows; an empty
     project gets "No markdown files in this project's root or docs/
     folder." Hiding it would cost an extra `md_list` read on every overview
     load for a rare case.
4. **Checks.**
   - `cargo test --lib markdown`: list order and contents (fixed set
     first, root `*.md` then `docs/*.md` alphabetical, `.MD` counted,
     `docs/nested/`, `plans/` and non-md excluded, out-pointing symlink dropped, >1 MB dropped). Write rejects
     an unlisted name, `../x.md`, `sub/a.md` and an absolute path. Conflict
     returns current and leaves the file untouched; a matching base saves.
     Non-UTF-8 read errors.
   - New `scripts/markdown-editor-check.ts` (`npm run
     markdown-editor:check`, added to `npm run check`): a CRLF round-trip
     keeps CRLF, LF stays LF, dirty detection ignores the normalization.
   - Cmd+S: confirm no existing global binding conflicts (Plan 035
     keyboard rules) when building.
5. **Docs.** `docs/PROGRESS.md`, `docs/TESTING.md` Phase 62 items, IDEAS
   "Editor-native users" updated, and the "Editable code view" entry's
   reversal note marked shipped. ROADMAP Windows gap table: CRLF is the
   Windows default, so the round-trip matters there; note it.

## Decisions (defaults marked; confirm or change at approval)

1. **`.claude/CLAUDE.md` in the fixed set.** **Yes** (default). Claude Code
   reads it as project memory just like root `CLAUDE.md`. Alternative: root
   files plus board only.
2. **Conflict choices.** **Reload + Overwrite** (default). Alternative:
   Reload only (safer, but it loses your typing; you'd copy it out by hand
   first).
3. **Size cap.** **1 MB** (default), which keeps the textarea responsive.
   Alternative: none.
4. **Board.md in the list.** **Yes** (default), as a raw view next to the
   Idea Board's card UI; compare-and-swap covers both writers. Alternative:
   leave it out, since the board already has an editor.

## Out of scope

- Markdown preview / rendering (decided 2026-10-10).
- `docs/*/**`, `plans/` or any recursion; creating, renaming or deleting
  files.
- Non-markdown files; code editing (IDEAS, still not recommended).
- Syntax highlighting, search/replace, multi-file tabs.
- Telling running agents to reload (invariant 4).

## Verify

- Focused: `cd src-tauri && cargo test --lib markdown`,
  `npm run markdown-editor:check`.
- Gates: `npm run check`, `npm run opencode:check`, `npx tsc --noEmit`,
  `npm run build`, `cd src-tauri && cargo test --lib`, `cargo clippy
  --all-targets -- -D warnings`, `git diff --check`. No golden. No
  migration.

## Manual checks (docs/TESTING.md Phase 62)

Run in the built app.

- [ ] 111. Dashboard → project → Markdown: the list shows CLAUDE.md,
      AGENTS.md, board.md first, then the other root `.md` files, then
      `docs/*.md` (as `docs/…`); nothing from `docs/` subfolders or
      `plans/`.
- [ ] 112. Edit CLAUDE.md, Cmd+S: the file on disk matches; `git diff`
      shows only that change.
- [ ] 113. Open a file, have an agent edit it in a tab, then type and save:
      the conflict banner appears and the file is untouched. Reload shows
      the agent's version; repeat and use Overwrite, which saves yours.
- [ ] 114. Dirty draft → click another file, then Back, then a terminal
      tab, then return to Markdown: the draft is still there, and the file
      shows `●` in the list throughout.
- [ ] 115. A CRLF `.md` (`printf 'a\r\nb\r\n' > crlf.md`): edit and save;
      `file crlf.md` still reports CRLF and `git diff` is one line.
- [ ] 116. A Claude tab running when CLAUDE.md is edited: the muted
      reload note is visible. After `/clear` in that tab (typed by you),
      `/context` shows the new content.
- [ ] 117. A root `.md` symlinked to a file outside the project is not
      listed.
- [ ] 118. In the editor view, Open in editor (061) opens the current file
      in the configured editor.
- [ ] 119. Header layout, in both views: row 1 reads Home / project ·
      `Overview | Markdown` toggle · Continue control + New session tab on
      the right; row 2 reads folder path · Show in Finder · Open in editor ·
      change editor · Copy update / Pin / Archive on the right. Switching to
      Markdown keeps the header; Continue works from the Markdown view.
      Check the Continue control's three forms: 2+ workspace tabs (dropdown),
      exactly 1 (blue Continue), none (Start session).
- [ ] 120. Syntax colours: `#` and `##` headings take different colours,
      and so do list markers, `**bold**`, `` `code` ``, links, `@imports`,
      fenced blocks, `>` quotes and `---` rules. Typing, selecting, ⌘A and
      arrow keys keep the caret exactly on the coloured text, including
      long wrapped lines and the end of a long file (docs/IDEAS.md). Typing
      at the bottom of a long file scrolls to keep the caret visible.

Run 111–115 and 117 in a scratch project (`/private/tmp/…`); archive it on
the dashboard afterwards. No check needs an app restart or injected hooks.
