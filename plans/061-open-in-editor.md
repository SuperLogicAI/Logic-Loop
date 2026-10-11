# Open in editor / Show in Finder

Status: **APPROVED 2026-10-10 (`PHASE 61 APPROVED`, defaults 1–3, with
Decision 2 revised to the dashboard project view).** Branch
`feat/phase-61-open-in-editor`, cut from `main` after Phase 60 merged (#89).
Implemented; gates green. Built-app checks 104–110 passed (macOS).
**PHASE 61 ACCEPTED** (2026-10-10).

Source: field feedback, 2026-10-10. A non-user vibe-coder (Windows, VS Code
plus Claude Code) won't use any tool that takes him out of his editor: "I want
to see the full file." Recorded in `docs/IDEAS.md`, "Editor-native users".
This plan is the cheap half. It hands the file to the user's real editor
instead of building one, which keeps the decision in IDEAS "Editable code
view pop-out — considered, not recommended".

## Problem

The only way to look at a file the agent touched is `DiffModal`. It shows
the **staged** diff only (`git diff --cached`), so an unstaged edit, a new
untracked file, or "what does the whole file look like now" shows nothing.
Getting to the file means switching to Finder or the editor and finding the
path by hand, which is the context switch this app exists to remove.

## What exists

- `tauri-plugin-opener` 2.5.4 is registered (`src-tauri/src/lib.rs:245`).
  The JS side is already used for `openUrl` (`Terminal.tsx`,
  `OnboardingModal.tsx`).
- `opener:default` (`src-tauri/capabilities/default.json`) already grants
  `allow-reveal-item-in-dir`, so `revealItemInDir(path)` works from JS today
  with no capability change. It does **not** grant `allow-open-path`.
- `DiffModal` (`src/components/DiffModal.tsx`) receives `filePath`, which is
  agent-reported and so **untrusted**, plus `cwd`, the active tab's project
  dir. Two call sites open it: the brief's file list
  (`SidePanel.tsx` ~1247) and Accomplished tool rows (~1915). Putting the
  buttons in the modal covers both.
- Generic `getSetting`/`setSetting` over the `settings` table
  (`src/lib/repo.ts` ~950), currently module-private.
- Precedent for argv-only subprocesses with no shell: `git_commit`
  (`pty.rs` ~890).

## Security (the reason this isn't a one-liner)

`openPath(path)` with **no** app opens the file in its default handler. On
macOS, a `.command`, `.app`, `.terminal` or `.webloc` path **executes** or
launches something. Accomplished paths come from agent tool events, which
invariant 5 treats as untrusted. So an agent-written `run.command`, or a
path like `/tmp/x.command`, would turn a click into code execution. The
static capability scope can't express "inside whichever project this tab
is in", and `$HOME/**` with default-app opening is the hole described above.

So:

- **Never open with the default handler.** Always open with the named
  editor app. `open -a "Visual Studio Code" run.command` opens the text and
  runs nothing.
- **Containment.** Canonicalize `cwd` and the target (this resolves
  symlinks and `..`). The target must be inside canonical `cwd` and must be
  a regular file, or `cwd` itself for "open project". Otherwise return
  `Err("outside this project")`. A symlink inside the repo that points out
  of it is rejected, because canonicalization follows it.
- No capability change: the Rust command calls the subprocess or the
  opener's Rust API directly, and `allow-open-path` stays ungranted for
  the webview.
- The editor name comes from the `settings` table, which only the UI writes.
  Agent content never reaches it.

## Build

1. **Rust: `open_in_editor(cwd: String, path: Option<String>, editor:
   String) -> Result<(), String>`** (the editor param is `editor`, not
   `app`, because `app` is the injected `AppHandle`) in `pty.rs`, next to the git helpers.
   - Pure helper `resolve_inside(cwd, path) -> Result<PathBuf, String>`:
     a relative path joins onto `cwd`, then both are canonicalized and the
     helper checks `starts_with` plus `is_file()` (or `== cwd` when `path` is
     `None`).
   - macOS: `Command::new("open").arg("-a").arg(app).arg(resolved)`, argv
     only and no shell, waiting for the exit status so that a missing app
     surfaces as `Err("Unable to find application …")`. The opener's Rust
     API spawns detached and would swallow that error.
   - Other targets: `app.opener().open_path(resolved, Some(app))`. Windows
     is unverified until Phase 13, and is listed in its gap table.
   - Runs under `spawn_blocking_result` like `git_commit`.
   - Register it in `lib.rs`'s invoke handler.
   - An empty editor name is rejected ("no editor set").
2. **Setting `editor_app`**, default `"Visual Studio Code"`. Export
   `getEditorApp()` / `setEditorApp(name)` from `repo.ts`, following the
   pattern of the panel-mode setters.
3. **`DiffModal` header**: two text buttons under the path line. Both
   placements share one component, `src/components/OpenInEditor.tsx`.
   - **Open in editor** → `invoke("open_in_editor", { cwd, path: filePath,
     editor })`. On error, show the message inline plus a one-line input,
     "Editor app: [Visual Studio Code] Save", which writes `editor_app`.
     A small "change editor" link reveals the same input without an error.
   - **Show in Finder** → `revealItemInDir(resolvedPath)` from JS. Reveal
     can't execute anything, so it skips containment. A relative path is
     joined onto `cwd` first.
   - The empty-diff copy gains "Open in editor to see the whole file."
4. **Project-level, in the dashboard's project view**
   (`ProjectOverview.tsx` ~395): two buttons on the folder-path line, right
   after `projectFolderLabel(projectKey)`, styled like the header's bordered
   buttons. This is the maintainer's concept from 2026-10-10, variant A.
   - **Open in editor**: the same command with `cwd: projectKey, path:
     None`, which opens the folder as an editor window. Errors show the
     editor input inline, the same as in `DiffModal`.
   - **Show in Finder**: `revealItemInDir(projectKey)`, which selects the
     folder in its parent. Not `openPath` on the folder: a project dir named
     `*.app` is a bundle, and the default handler would launch it.
   The path line is the right place because both actions act on that path.
   Variant B, next to "New session tab", mixes them into the session
   actions column and makes it uneven. The side panel gets no
   project-level button; from inside a tab, the diff modal covers files.
5. **Checks.**
   - `cargo test --lib`: `resolve_inside` unit tests on a temp dir. A
     relative file inside → ok. An absolute file inside → ok. `../` escape
     → err. A symlink inside pointing outside → err. A directory as file
     target → err. A missing file → err. `None` → `cwd`.
   - No new TS check script. The UI wiring is two buttons and a setting,
     covered by `tsc` and the manual checks below.
6. **Docs.** `docs/PROGRESS.md`, `docs/TESTING.md` Phase 61 items, the
   ROADMAP Windows gap table (one row for `open_in_editor`), IDEAS
   "Editor-native users" first half marked shipped.

## Decisions (defaults marked; confirm or change at approval)

1. **Which app opens the file.** **A named editor, from the `editor_app`
   setting with VS Code as default** (default). Alternative: the system
   default app limited to a text-extension allowlist (`.md .ts .json …`).
   That needs zero setup but leaks onto every extension the list misses,
   and `.md` often defaults to Xcode or TextEdit.
2. **Project-level entry point.** **Dashboard project view, on the
   folder-path line** (default; revised 2026-10-10 from "side panel's bottom
   row" after the maintainer's mockup). Alternatives: header action column
   next to "New session tab" (mockup variant B), or keep the side-panel row
   as well (a second entry point, more surface for the same action).
3. **Reveal containment.** **None; JS `revealItemInDir` directly**
   (default), because revealing executes nothing. Alternative: route it
   through `resolve_inside` too, for one consistent gate.

## Out of scope

- Any in-app editor, file tree, or search (IDEAS: considered, not
  recommended; restated under "Editor-native users").
- Showing the unstaged/full diff in `DiffModal` (a separate, smaller fix if
  wanted).
- Auto-detecting installed editors (Cursor, Zed). The setting covers them.
- The VS Code companion extension (IDEAS "Editor-native users", second
  half).
- Windows verification (Phase 13).

## Verify

- Focused: `cd src-tauri && cargo test --lib resolve_inside`.
- Gates: `npm run check`, `npx tsc --noEmit`, `npm run build`,
  `cd src-tauri && cargo test --lib`, `cargo clippy --all-targets -- -D
  warnings`, `git diff --check`. No golden (no prompt change). No migration
  (the settings table already exists).

## Manual checks (docs/TESTING.md Phase 61)

Run in the built app.

- [ ] 104. Agent edits a tracked file → Accomplished row → diff modal →
      Open in editor: VS Code opens that file.
- [ ] 105. Agent creates a new untracked file: the modal shows "no staged
      diff", and Open in editor still opens the whole file.
- [ ] 106. Show in Finder selects the file in Finder.
- [ ] 107. Rename `editor_app` to a missing app ("Nope"): inline error and
      editor input appear. Set it to an installed editor (e.g. "Cursor" or
      "TextEdit"); the next click opens there, and the choice survives
      restart.
- [ ] 108. A row whose path is outside the project (e.g. a `~/.claude/…`
      write): Open in editor shows "outside this project" and nothing opens.
- [ ] 109. Create `x.command` (`echo hi > /tmp/pwn`) in the project and let
      the agent "edit" it: Open in editor shows the text in the editor, and
      `/tmp/pwn` is **not** created.
- [ ] 110. Dashboard → open a project → path line: Open in editor opens the
      project folder as a VS Code window; Show in Finder selects the folder
      in Finder.
