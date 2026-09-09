import { gitDiffCached } from "./pty";

/** Diff pop-out for an Accomplished row (issue #10).
 *
 * The only diff the app can ask for is `git_diff_cached(cwd)` — a whole
 * directory's *staged* diff — but a row hands us one file path that may sit
 * in a different repo than the tab's cwd. Bridge: run the existing command in
 * the file's own directory (so a row pointing at another checkout diffs that
 * checkout, not this tab's) and slice the one file's section out of the
 * unified diff here. No new Tauri command, and nothing is staged on the
 * user's behalf — an unstaged file simply has no section, which is the empty
 * state. Fails open throughout: every failure path is an empty string. */

/** Parent directory of a path, either separator. Null when the path carries
 * no directory at all — nothing to point `git -C` at. */
export function dirOf(path: string): string | null {
  const i = path.replace(/\\/g, "/").lastIndexOf("/");
  if (i <= 0) return null;
  return path.slice(0, i);
}

/** Paths a `diff --git` section is about. `--- a/`/`+++ b/` are unambiguous
 * where they exist; the header line is the fallback for sections that have
 * none (a pure mode change), where a path containing a space can't be split
 * reliably — a miss there costs an empty state, never a wrong file. */
function sectionPaths(section: string): string[] {
  const out: string[] = [];
  for (const line of section.split("\n")) {
    if (line.startsWith("@@")) break; // past the header, into hunk content
    const m = /^(?:---|\+\+\+) [ab]\/(.*)$/.exec(line);
    if (m) out.push(m[1]);
  }
  if (out.length === 0) {
    const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(section.split("\n")[0] ?? "");
    if (m) out.push(m[1], m[2]);
  }
  return out;
}

/** The one file's section of a unified diff, or "" if it isn't in there.
 * Diff paths are repo-relative and `file_path` is absolute, so they're
 * matched by path suffix — anchored at a separator, so `src/b/x.ts` never
 * matches a row for `src/a/x.ts`. A rename matches on either side. */
export function extractFileDiff(diff: string, filePath: string): string {
  if (!diff || !filePath) return "";
  const target = filePath.replace(/\\/g, "/");
  const sections = diff.split(/^(?=diff --git )/m).filter((s) => s.startsWith("diff --git "));
  for (const section of sections) {
    const hit = sectionPaths(section).some(
      (p) => p !== "/dev/null" && (target === p || target.endsWith(`/${p}`))
    );
    if (hit) return section.trimEnd();
  }
  return "";
}

/** Staged diff for one Accomplished row's file. `fallbackCwd` is the tab's
 * project dir, used when the row's path has no directory of its own and as a
 * second try when the file's own directory is gone (worktree pruned, dir
 * deleted) but the tab's repo still holds the staged change.
 * The path reaches git as a `Command::arg`, never a shell string, so an
 * agent-supplied path is inert here — see `git_commit`'s note in pty.rs. */
export async function loadFileDiff(filePath: string, fallbackCwd: string): Promise<string> {
  const dir = dirOf(filePath) ?? fallbackCwd;
  const tries = dir === fallbackCwd ? [dir] : [dir, fallbackCwd];
  for (const at of tries) {
    const staged = await gitDiffCached(at).catch(() => "");
    const own = extractFileDiff(staged, filePath);
    if (own) return own;
  }
  return "";
}
