import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export function ptySpawn(
  cwd: string | null,
  cols: number,
  rows: number,
  tabId?: string,
  resumeSession?: string,
  launchCmd?: string
): Promise<number> {
  return invoke<number>("pty_spawn", { cwd, cols, rows, tabId, resumeSession, launchCmd });
}

/** Resolve `~` and case/symlinks to the real path. */
export function canonicalizeCwd(path: string): Promise<string> {
  return invoke<string>("canonicalize_cwd", { path });
}

/** Nearest enclosing git repo root — the project key panels query by. */
export function projectKeyOf(path: string): Promise<string> {
  return invoke<string>("project_key_of", { path });
}

export function ptyWrite(id: number, data: string): Promise<void> {
  return invoke("pty_write", { id, data });
}

export function ptyResize(id: number, cols: number, rows: number): Promise<void> {
  return invoke("pty_resize", { id, cols, rows });
}

export function ptyKill(id: number): Promise<void> {
  return invoke("pty_kill", { id });
}

export function ptyLiveCount(): Promise<number> {
  return invoke<number>("pty_live_count");
}

export function ptyKillAll(): Promise<void> {
  return invoke("pty_kill_all");
}

export function gitBranches(cwd: string): Promise<string[]> {
  return invoke<string[]>("git_branches", { cwd });
}

export function gitWorktreeAdd(
  repoCwd: string,
  path: string,
  branch: string,
  newBranch: boolean
): Promise<void> {
  return invoke("git_worktree_add", { repoCwd, path, branch, newBranch });
}

export function gitWorktreeRemove(repoCwd: string, path: string, force: boolean): Promise<void> {
  return invoke("git_worktree_remove", { repoCwd, path, force });
}

export function gitCurrentBranch(cwd: string): Promise<string> {
  return invoke<string>("git_current_branch", { cwd });
}

export function gitHasChanges(cwd: string): Promise<boolean> {
  return invoke<boolean>("git_has_changes", { cwd });
}

export function gitAddU(cwd: string): Promise<void> {
  return invoke("git_add_u", { cwd });
}

export function gitDiffCached(cwd: string): Promise<string> {
  return invoke<string>("git_diff_cached", { cwd });
}

export function gitCommit(cwd: string, message: string): Promise<void> {
  return invoke("git_commit", { cwd, message });
}

export function gitCreateBranch(cwd: string, branch: string): Promise<void> {
  return invoke("git_create_branch", { cwd, branch });
}

export function gitPush(cwd: string, branch: string, setUpstream: boolean): Promise<void> {
  return invoke("git_push", { cwd, branch, setUpstream });
}

/** Returns the PR URL on success. Best-effort on top of an already-pushed
 * branch — a failure here (no `gh`, unauthenticated, PR exists) must not be
 * read as the commit/push having failed. */
export function gitPrCreate(cwd: string, title: string, body: string): Promise<string> {
  return invoke<string>("git_pr_create", { cwd, title, body });
}

export function onPtyOutput(id: number, cb: (data: Uint8Array) => void): Promise<UnlistenFn> {
  return listen<string>(`pty://output/${id}`, (e) => {
    const raw = atob(e.payload);
    const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    cb(bytes);
  });
}

export function onPtyExit(id: number, cb: () => void): Promise<UnlistenFn> {
  return listen(`pty://exit/${id}`, () => cb());
}
