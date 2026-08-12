use base64::Engine;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
    writer: Box<dyn Write + Send>,
}

// Per-session lock, not one map-wide lock: pty_write can block on the writer
// syscall when a child stalls reading its input (busy TUI render, backed-up
// PTY buffer). A single global mutex meant that block froze pty_resize/write/
// kill for every OTHER tab too — felt as mouse-pinwheel on tab switch since
// resize-on-fit needs the same lock. Found 2026-08-11 chasing a UI-freeze report.
#[derive(Default)]
pub struct PtyManager {
    sessions: Mutex<HashMap<u32, Arc<Mutex<PtySession>>>>,
    next_id: AtomicU32,
}

/// child.kill() alone can leave the shell alive (observed orphan zsh after
/// tab close) — SIGKILL the whole process group so the shell and anything it
/// spawned die together.
fn kill_session(s: &mut PtySession) {
    if let Some(pid) = s.child.process_id() {
        unsafe {
            libc::killpg(pid as i32, libc::SIGKILL);
        }
    }
    let _ = s.child.kill();
}

impl PtyManager {
    pub fn live_count(&self) -> usize {
        self.sessions.lock().map(|s| s.len()).unwrap_or(0)
    }

    pub fn kill_all(&self) {
        let drained: Vec<_> = match self.sessions.lock() {
            Ok(mut sessions) => sessions.drain().map(|(_, s)| s).collect(),
            Err(_) => return,
        };
        for s in drained {
            if let Ok(mut session) = s.lock() {
                kill_session(&mut session);
            }
        }
    }
}

/// Expand `~`, then resolve to the real on-disk path. macOS is case-insensitive,
/// so `Desktop/Dev/x` and `Desktop/dev/x` open the same folder but are different
/// SQL keys — panels then split one project into several. Canonicalizing here
/// makes tab cwds agree with the cwd Claude Code hooks report.
/// Falls back to the expanded string when the path doesn't exist (bookmarks may
/// point at folders that are gone).
pub fn canon(p: &str) -> String {
    let expanded = match (p.strip_prefix("~"), std::env::var("HOME")) {
        (Some(rest), Ok(home)) => format!("{home}{rest}"),
        _ => p.to_string(),
    };
    std::fs::canonicalize(&expanded)
        .map(|c| c.to_string_lossy().into_owned())
        .unwrap_or(expanded)
}

#[tauri::command]
pub fn canonicalize_cwd(path: String) -> String {
    canon(&path)
}

/// Stable project key: the nearest enclosing git repo root, else the dir itself.
/// `cd src-tauri && claude` must file against the same project as `claude` from
/// the repo root — keyed on raw cwd they are two projects, and every panel then
/// shows a partial view. `.git` is checked with `exists` so worktrees and
/// submodules (where `.git` is a file, not a dir) resolve too.
/// The walk stops at `$HOME`: a dotfiles repo there would otherwise make every
/// non-repo directory collapse into one giant "project" — silent and total.
pub fn project_key(cwd: &str) -> String {
    let resolved = canon(cwd);
    let home = std::env::var("HOME").map(|h| canon(&h)).unwrap_or_default();
    let mut dir = std::path::Path::new(&resolved);
    loop {
        if !home.is_empty() && dir.as_os_str() == home.as_str() {
            return resolved;
        }
        if dir.join(".git").exists() {
            return dir.to_string_lossy().into_owned();
        }
        match dir.parent() {
            Some(parent) => dir = parent,
            None => return resolved, // not in a repo: the dir is its own project
        }
    }
}

#[tauri::command]
pub fn project_key_of(path: String) -> String {
    project_key(&path)
}

#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    state: State<'_, PtyManager>,
    cwd: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
    tab_id: Option<String>,
) -> Result<u32, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.unwrap_or(24),
            cols: cols.unwrap_or(80),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut cmd = CommandBuilder::new(&shell);
    cmd.arg("-l");
    cmd.env("TERM", "xterm-256color");
    // Tab tether: hooks inherit this and echo it back, so session→tab binding
    // is exact instead of guessed from cwd (two tabs on one repo bound wrong).
    if let Some(tab_id) = tab_id {
        cmd.env("LOGIC_LOOP_TAB_ID", tab_id);
    }
    let cwd = cwd.map(|c| canon(&c));
    if let Some(cwd) = cwd.filter(|c| std::path::Path::new(c).is_dir()) {
        cmd.cwd(cwd);
    }

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let id = state.next_id.fetch_add(1, Ordering::SeqCst);
    state.sessions.lock().map_err(|e| e.to_string())?.insert(
        id,
        Arc::new(Mutex::new(PtySession {
            master: pair.master,
            child,
            writer,
        })),
    );

    // Reader thread: stream output as base64 chunks; on EOF emit exit event.
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                    let _ = app.emit(&format!("pty://output/{id}"), data);
                }
            }
        }
        let _ = app.emit(&format!("pty://exit/{id}"), ());
    });

    Ok(id)
}

/// Clone the session's Arc under the map lock, then drop it immediately —
/// I/O (write/resize/kill) happens against the per-session lock only, so one
/// stalled tab's blocking syscall can't freeze every other tab's commands.
fn get_session(state: &State<'_, PtyManager>, id: u32) -> Result<Arc<Mutex<PtySession>>, String> {
    state
        .sessions
        .lock()
        .map_err(|e| e.to_string())?
        .get(&id)
        .cloned()
        .ok_or_else(|| "no such session".to_string())
}

#[tauri::command]
pub fn pty_write(state: State<'_, PtyManager>, id: u32, data: String) -> Result<(), String> {
    let session = get_session(&state, id)?;
    let mut session = session.lock().map_err(|e| e.to_string())?;
    session.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(state: State<'_, PtyManager>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let session = get_session(&state, id)?;
    let session = session.lock().map_err(|e| e.to_string())?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_kill(state: State<'_, PtyManager>, id: u32) -> Result<(), String> {
    let removed = state.sessions.lock().map_err(|e| e.to_string())?.remove(&id);
    if let Some(session) = removed {
        if let Ok(mut session) = session.lock() {
            kill_session(&mut session);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn pty_live_count(state: State<'_, PtyManager>) -> usize {
    state.live_count()
}

/// Frontend calls this on load: after a webview crash/reload the old tabs'
/// PTYs are unreachable — reap them all before spawning fresh ones.
#[tauri::command]
pub fn pty_kill_all(state: State<'_, PtyManager>) {
    state.kill_all();
}

#[derive(serde::Serialize)]
pub struct Commit {
    pub hash: String,
    pub ts: i64,
    pub subject: String,
}

/// Recent git commits for a project dir. Not ANSI parsing — plain
/// machine-format subprocess output. Empty vec if not a repo / no git.
#[tauri::command]
pub fn git_log(cwd: String, limit: Option<u32>) -> Vec<Commit> {
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(&cwd)
        .arg("log")
        .arg(format!("-n{}", limit.unwrap_or(20)))
        .arg("--pretty=format:%h%x09%ct%x09%s")
        .output();
    let Ok(out) = out else { return vec![] };
    if !out.status.success() {
        return vec![];
    }
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|l| {
            let mut parts = l.splitn(3, '\t');
            Some(Commit {
                hash: parts.next()?.to_string(),
                ts: parts.next()?.parse().ok()?,
                subject: parts.next()?.to_string(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{canon, project_key};

    #[test]
    fn canon_resolves_case_and_tilde_to_one_key() {
        let home = std::env::var("HOME").unwrap();
        // `~` expands, and a case-variant spelling of an existing dir resolves to
        // the same string — that equality is what keeps a project from splitting
        // into several SQL keys.
        assert_eq!(canon("~"), canon(&home));
        assert_eq!(canon(&format!("{home}/Library")), canon(&format!("{home}/library")));
        // Nonexistent paths fall through expanded, never panic.
        assert_eq!(canon("~/definitely-not-a-real-dir-xyz"), format!("{home}/definitely-not-a-real-dir-xyz"));
    }

    #[test]
    fn project_key_collapses_subdirs_to_the_repo_root() {
        let tmp = std::env::temp_dir().join(format!("ll-pk-{}", std::process::id()));
        let sub = tmp.join("src-tauri/src");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::create_dir_all(tmp.join(".git")).unwrap();

        let root = canon(tmp.to_str().unwrap());
        // The whole point: repo root and any depth of subdir are ONE key.
        assert_eq!(project_key(tmp.to_str().unwrap()), root);
        assert_eq!(project_key(sub.to_str().unwrap()), root);

        // A worktree/submodule `.git` is a file, not a dir — still a repo root.
        let wt = tmp.join("wt");
        std::fs::create_dir_all(wt.join("inner")).unwrap();
        std::fs::write(wt.join(".git"), "gitdir: /elsewhere\n").unwrap();
        assert_eq!(
            project_key(wt.join("inner").to_str().unwrap()),
            canon(wt.to_str().unwrap())
        );

        std::fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn project_key_outside_a_repo_is_the_dir_itself() {
        let home = std::env::var("HOME").unwrap();
        // No `.git` anywhere up to `/` → the dir is its own project, no panic
        // and no walk off the end of the tree.
        let key = project_key("/tmp");
        assert!(!key.is_empty());
        // Nonexistent paths fall through canon and still resolve. This also
        // covers the $HOME boundary: the walk stops there rather than adopting
        // a dotfiles repo as the key for everything under home.
        assert_eq!(
            project_key("~/definitely-not-a-real-dir-xyz"),
            format!("{home}/definitely-not-a-real-dir-xyz")
        );
    }
}
