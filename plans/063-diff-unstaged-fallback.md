# Diff pop-out: show unstaged edits and new files

Status: **APPROVED 2026-10-10 (`PHASE 63 APPROVED`, defaults 1–3).**
Branch `feat/phase-63-diff-fallback`, from `main` at `b81d5d2` (Phase 62
merged, #91). Implemented; gates green. Built-app checks 121–128 passed (labeled synthetic
hook fixtures; evidence in `docs/TESTING.md`). **PHASE 63 ACCEPTED**
(2026-10-10).

Stated build revisions:
- The 3,000-line cap is an inline `slice` in `DiffModal` (`LINE_CAP`), not
  a separate helper, so `diff:check` has no cap assert.
- An extra Rust case covers `--literal-pathspecs`: an ignored file named
  `x*`, which as a glob would match an untracked `xa.md`. Removing the flag
  makes the test fail with the ignored file's text.

Source: found while testing Phase 62 (2026-10-10), recorded in
`docs/IDEAS.md` "Half 1c". The maintainer clicked an Accomplished row for a
file Claude had just edited and got "No staged diff for this file", with no
red or green.

## Problem

`DiffModal` reads only `git diff --cached`. Claude Code and most agents
never stage their edits, so the edits you actually want to check show
nothing. A brand-new file the agent wrote (`Wrote X` rows) shows nothing in
any git diff, because git doesn't track it yet. The pop-out is empty in the
two most common cases.

## What exists

- `loadFileDiff(filePath, fallbackCwd)` (`src/lib/diff.ts`) runs
  `git_diff_cached` in the file's own directory, then in the tab's cwd, and
  slices the file's section out with `extractFileDiff`. No path ever
  reaches git; the per-file match happens in TS.
- `git_diff_cached` (`src-tauri/src/pty.rs`): `has_own_repo` guard (stops
  at `$HOME`, LANDMINES), `Command::arg` only, fail-open to `""`.
- `DiffModal` colours lines via `diffLineRoles`. Plan 061 added Open in
  editor under the path line.
- `pty::resolve_inside(cwd, path)` (Plan 061): canonical path, inside the
  project, regular file. `markdown::read_text`: UTF-8 check.
- The Commit & Push footer (`SidePanel.tsx`) also calls `git_diff_cached`.
  It means "staged on purpose" and does not change.

## Build

1. **`git_diff_head(cwd)`** in `pty.rs`: `git -C <cwd> diff HEAD`, the same
   shape as `git_diff_cached` (`has_own_repo` guard, `spawn_blocking`,
   `""` on any failure, including a repo with no commits yet). Factor the
   two into one private `git_diff_blocking(cwd, args)` helper.
2. **`git_new_file(cwd, path)`** in `pty.rs`: returns the file's text only
   when every gate passes, else `""`:
   - `has_own_repo(cwd)`;
   - `resolve_inside(cwd, Some(path))`, so the file must be a regular file
     inside the tab's project, with symlinks and `..` followed;
   - `git --literal-pathspecs -C <root> ls-files --others --exclude-standard
     -- <relative path>` is non-empty, meaning untracked and **not
     ignored**. The path is passed relative to the canonical root, which
     avoids Windows `\\?\` paths, and `--literal-pathspecs` stops a file
     named `:(glob)*` from acting as pathspec magic;
   - at most 1 MB, and UTF-8 (`markdown::read_text`, made `pub(crate)`).
3. **`src/lib/diff.ts`**:
   - `newFileDiff(name, text)` builds a unified diff with
     `diff --git`, `--- /dev/null`, `+++ b/<name>` and
     `@@ -0,0 +1,N @@`, then every line prefixed with `+`. The existing
     renderer colours it all green with no other change.
   - `pickDiff(...)` is a pure function that applies the order in Decision 1
     and returns `{ source: "head" | "staged" | "new", text } | null`.
   - `loadFileDiff` keeps its directory tries (the file's own dir, then the
     tab's cwd), so a row in another checkout still diffs that checkout. In
     each dir it asks for HEAD, then staged. `git_new_file` runs last,
     against the tab's cwd only, like Open in editor.
4. **`DiffModal`**:
   - A small label above the diff: "Uncommitted changes (vs last commit)",
     "Staged changes (no commits yet)" or "New file, not tracked by git
     yet". A muted second line under the HEAD label: "Everything
     uncommitted in this file, not only this turn's edit."
   - Render at most 3,000 lines, then "… N more lines. Open in editor to
     see the rest." (Decision 2).
   - New empty-state copy: "No uncommitted changes in this file. It may
     already be committed, ignored by git, or outside this project's repo.
     Open in editor to see the whole file."

## Security

- Paths come off Accomplished rows: agent-reported and untrusted.
  - `git_diff_head` takes no path, only a directory, exactly like
    `git_diff_cached` today.
  - `git_new_file` is the only new command that reads file content. It
    goes through `resolve_inside`, so `~/.ssh/id_rsa`, `../x` and symlinks
    out of the project return `""`.
- **Ignored files are never shown.** `--exclude-standard` keeps `.env`,
  `.env.local` and the like out, even inside the project, so a secret the
  agent wrote doesn't appear on screen or in a screenshot.
- Diff and file text render as React text only, never HTML (invariant 5).
- Read-only: nothing is staged, committed or written. The footer's staged
  semantics are untouched.

## Decisions (defaults marked; confirm or change at approval)

1. **Diff order.** **HEAD first, then staged, then new file** (default).
   `git diff HEAD` already includes staged changes, so this shows
   everything uncommitted in the file. Staged-only runs only when HEAD
   fails, which means a repo with no commits yet. Alternative (as worded in
   IDEAS): staged first, falling back to HEAD only when nothing is staged.
   That misleads on a partly staged file, showing the staged half and
   hiding the agent's newer unstaged edit.
2. **Render cap.** **3,000 lines, then a note** (default). A new 1 MB file
   is about 20k lines of spans, which stalls the modal. Alternative: no
   cap, as today.
3. **New-file content for files outside the tab's project.** **Not shown**
   (default): it uses the same containment as Open in editor. Alternative:
   allow the file's own repo root as the containment root, which covers
   rows from another checkout but widens what the command will read.

## Out of scope

- Per-turn diffs (only what this turn changed). That needs a snapshot at
  turn start, which is a new subsystem.
- Syntax highlighting inside the diff.
- Binary files: git's "Binary files differ" line shows as it does today,
  and a non-UTF-8 new file returns `""`, which gives the empty state.
- Any change to the Commit & Push footer.
- Windows verification (Phase 13). A new ROADMAP gap row covers
  `git_new_file`'s relative pathspec.

## Verify

- Focused: `cd src-tauri && cargo test --lib git_new_file git_diff_head`.
  Tests use a temp repo with `git init` under the system temp dir, not
  `$HOME`. Cases:
  - untracked file returns its text;
  - tracked file returns `""`;
  - ignored file returns `""`;
  - symlink out of the project returns `""`;
  - file over 1 MB returns `""`;
  - `git_diff_head` in a repo with no commits returns `""`.
- `npm run diff:check` covers:
  - `newFileDiff` gets all-`add` roles from `diffLineRoles`;
  - `pickDiff` order (HEAD before staged; staged only when HEAD is empty;
    new file last; all empty gives `null`);
  - the cap helper.
- Gates: `npm run check`, `npm run opencode:check`, `npx tsc --noEmit`,
  `npm run build`, `cd src-tauri && cargo test --lib`, `cargo clippy
  --all-targets -- -D warnings`, `git diff --check`. No golden (no prompt
  change). No migration.

## Manual checks (docs/TESTING.md Phase 63)

Run in the built app, in a scratch repo under `/private/tmp/…`; archive it
on the dashboard afterwards.

- [ ] 121. Agent edits a tracked file and doesn't stage it → Accomplished
      row → pop-out shows red and green lines, labelled "Uncommitted
      changes (vs last commit)".
- [ ] 122. Same file, now partly staged by you (`git add -p`) with a newer
      unstaged edit from the agent: both edits show.
- [ ] 123. Agent creates a new file → all green, labelled "New file, not
      tracked by git yet".
- [ ] 124. Agent creates a git-ignored file (e.g. `.env.local` with a fake
      value): empty state, and the content is not shown.
- [ ] 125. Agent commits its edit: the pop-out shows the new empty-state
      copy.
- [ ] 126. A row outside the project (e.g. a `~/.claude/…` write): empty
      state, no content.
- [ ] 127. A new file over 3,000 lines: the cap note shows, and Open in
      editor opens the whole file.
- [ ] 128. Commit & Push footer: staging and committing behave as before.
