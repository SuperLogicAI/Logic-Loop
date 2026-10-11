import { gitDiffCached, gitDiffHead, gitNewFile } from "./pty";

/** Diff pop-out for an Accomplished row (issue #10).
 *
 * The diff commands take a directory, never a path: `git_diff_head` (all
 * uncommitted changes, Plan 063) and `git_diff_cached` (staged). A row hands
 * us one file path that may sit in a different repo than the tab's cwd, so
 * they run in the file's own directory (a row pointing at another checkout
 * diffs that checkout, not this tab's) and the one file's section is sliced
 * out here. A new untracked file is in neither diff; `git_new_file` returns
 * its text (inside the tab's project, not git-ignored) and it's shown as
 * all-added. Nothing is staged on the user's behalf. Fails open throughout:
 * every failure path is an empty string or null. */

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
/** How the pop-out colours each unified-diff line. File headers exist only
 * between `diff --git` and the file's first `@@`, so inside a hunk a removed
 * `-- comment` (shown as `--- comment`) is still a removed line. */
export type DiffLineRole = "meta" | "hunk" | "add" | "del" | "ctx";
export function diffLineRoles(lines: readonly string[]): DiffLineRole[] {
  let inHunk = false;
  return lines.map((line) => {
    if (line.startsWith("diff --git")) {
      inHunk = false;
      return "meta";
    }
    if (line.startsWith("@@")) {
      inHunk = true;
      return "hunk";
    }
    if (!inHunk) return "meta";
    if (line.startsWith("+")) return "add";
    if (line.startsWith("-")) return "del";
    return "ctx";
  });
}

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

/** A new, untracked file as a unified diff: every line added. */
export function newFileDiff(filePath: string, text: string): string {
  const name = filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
  const lines = text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  return [
    `diff --git a/${name} b/${name}`,
    "new file, untracked",
    "--- /dev/null",
    `+++ b/${name}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((l) => `+${l}`),
  ].join("\n");
}

export type DiffSource = "head" | "staged" | "new";
export type FileDiff = { source: DiffSource; text: string };

/** Plan 063 order: per directory, everything uncommitted (HEAD) first — it
 * already includes staged hunks, so a partly staged file shows the agent's
 * newer unstaged edit too. Staged alone only fills in when HEAD has nothing,
 * i.e. a repo with no commits yet. A new untracked file comes last. */
export function pickDiff(
  perDir: readonly { head: string; staged: string }[],
  newFile: string,
  filePath: string
): FileDiff | null {
  for (const { head, staged } of perDir) {
    const h = extractFileDiff(head, filePath);
    if (h) return { source: "head", text: h };
    const st = extractFileDiff(staged, filePath);
    if (st) return { source: "staged", text: st };
  }
  return newFile ? { source: "new", text: newFileDiff(filePath, newFile) } : null;
}

/** Diff for one Accomplished row's file. `fallbackCwd` is the tab's project
 * dir, used when the row's path has no directory of its own and as a second
 * try when the file's own directory is gone (worktree pruned, dir deleted)
 * but the tab's repo still holds the change. Only `git_new_file` takes the
 * path, and it gates it in Rust (`resolve_inside`, literal pathspec). */
export async function loadFileDiff(filePath: string, fallbackCwd: string): Promise<FileDiff | null> {
  const dir = dirOf(filePath) ?? fallbackCwd;
  const tries = dir === fallbackCwd ? [dir] : [dir, fallbackCwd];
  const quiet = (p: Promise<string>) => p.catch(() => "");
  const [perDir, newFile] = await Promise.all([
    Promise.all(
      tries.map(async (at) => ({ head: await quiet(gitDiffHead(at)), staged: await quiet(gitDiffCached(at)) }))
    ),
    quiet(gitNewFile(fallbackCwd, filePath)),
  ]);
  return pickDiff(perDir, newFile, filePath);
}
