use base64::Engine;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

/// Runs `f` on tokio's blocking-thread pool instead of the calling thread.
/// Every plain `pub fn` Tauri command runs on the app's main/event-loop
/// thread (Tauri v2 default); one that shells out to `git`/`gh` or does
/// blocking file I/O was confirmed live (2026-09-12, a `sample` capture
/// during a real freeze) to beachball the whole app for the subprocess's
/// full wall-clock time — `git_untracked_files`'s `Command::output()` alone
/// accounted for ~31 of ~31 samples across a ~31s stall, on the exact
/// thread AppKit's window server watches for responsiveness. See CLAUDE.md's
/// "Extractor calls can freeze the whole app" landmine and
/// `plans/017-fix-extractor-freeze.md`. Mirrors `extractor.rs`'s
/// `run_extractor`/`run_extractor_blocking` split, generalized for reuse.
pub(crate) async fn spawn_blocking_or_default<T: Default + Send + 'static>(
    f: impl FnOnce() -> T + Send + 'static,
) -> T {
    tauri::async_runtime::spawn_blocking(f).await.unwrap_or_default()
}

/// Same as `spawn_blocking_or_default`, for commands whose body already
/// returns `Result<T, String>` — a spawn panic becomes an error string
/// carrying `label`, rather than silently defaulting.
pub(crate) async fn spawn_blocking_result<T: Send + 'static>(
    label: &'static str,
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    match tauri::async_runtime::spawn_blocking(f).await {
        Ok(result) => result,
        Err(e) => Err(format!("{label} task panicked: {e}")),
    }
}

pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
    // Not the writer itself — `pty_write` used to call `writer.write_all`
    // directly under this session's lock, so a stalled child (busy TUI
    // render, backed-up PTY buffer) blocked that syscall *while holding the
    // lock* pty_kill/pty_resize also need, i.e. the same freeze class Plan
    // 017 found for git commands on the main thread, just scoped to one
    // session instead of the whole app. Fix: a dedicated writer thread (spawned
    // once in pty_spawn) owns the real `Write` end and drains this channel
    // FIFO, so `write_all` never runs under `session`'s lock at all. Channel
    // is deliberately unbounded — ponytail: this is human/paste-bounded input,
    // not an adversarial data stream, so a bytes-capped backpressure scheme
    // buys nothing a plain queue doesn't already give for free; revisit only
    // if that assumption breaks (e.g. programmatic bulk pty_write).
    writer_tx: mpsc::Sender<Vec<u8>>,
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
    // Windows has no process groups to signal; child.kill() alone is what we
    // get until the Windows port wires up a Job Object (Phase 13).
    #[cfg(unix)]
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
    let expanded = match (p.strip_prefix("~"), crate::home::home()) {
        (Some(rest), Some(home)) => format!("{home}{rest}"),
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

/// Strict counterpart to `canon`/`canonicalize_cwd`, used only by the Setup
/// launch flow's folder picker. Every other caller (bookmarks, ghost-tab
/// restore, `openTab`'s general spawn path) intentionally keeps `canon`'s
/// silent fall-through — a bookmark pointing at a since-deleted folder must
/// keep working, not start erroring. A freshly-picked project folder has no
/// such excuse: a bad pick here should surface, not silently resolve to
/// whatever `pty_spawn` falls back to when `cwd` isn't a directory.
#[tauri::command]
pub fn validate_project_dir(path: String) -> Result<String, String> {
    let resolved = canon(&path);
    if std::path::Path::new(&resolved).is_dir() {
        Ok(resolved)
    } else {
        Err(format!("\"{path}\" is not a folder Logic Loop can open"))
    }
}

/// `pty_spawn`'s own cwd resolution: same silent-fallback shape as
/// `validate_project_dir`'s doc comment describes, plus a `strict` mode for
/// the same Setup launch flow — the folder was valid at pick time
/// (`validate_project_dir`) but a spawn happens later, on click, and can
/// race a `rm -rf` in between. `strict` is only ever true for that one
/// caller; every other `pty_spawn` caller passes `false` and keeps landing
/// wherever the shell's own default cwd is when the folder is gone.
fn resolve_spawn_cwd(cwd: Option<String>, strict: bool) -> Result<Option<String>, String> {
    let Some(c) = cwd.map(|c| canon(&c)) else { return Ok(None) };
    if std::path::Path::new(&c).is_dir() {
        Ok(Some(c))
    } else if strict {
        Err(format!("\"{c}\" is not a folder Logic Loop can open"))
    } else {
        Ok(None)
    }
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
    let home = crate::home::home().map(|h| canon(&h)).unwrap_or_default();
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

/// True when `cwd` has its own `.git` at or above it without crossing `$HOME`
/// to find one — the exact same walk/boundary as `project_key`, kept as a
/// separate bool-returning check because the git_* commands below need a
/// yes/no gate, not a key string. Found necessary 2026-09-12: a stray,
/// unintended `~/.git` (empty, no commits, origin unknown — not created by
/// this codebase, `git init` doesn't appear anywhere in it) meant `git -C
/// <cwd> ...` for a project with no `.git` of its own silently walked all the
/// way up to `$HOME` and operated on the user's entire home directory —
/// `git_untracked_files`'s `--untracked-files=all` enumerating every
/// untracked file under `~` is what actually produced the ~31s stall this
/// file's `spawn_blocking` fix (`plans/017-fix-extractor-freeze.md`) was
/// built to get off the main thread; without this guard, moving the same
/// call to a background thread would have simply moved a very slow
/// unintended operation there instead of removing it. `project_key` already
/// refuses to attribute a project to `$HOME`'s own repo for exactly this
/// reason — every git_* command must refuse to *run against* it too.
fn has_own_repo(cwd: &str) -> bool {
    let resolved = canon(cwd);
    let home = crate::home::home().map(|h| canon(&h)).unwrap_or_default();
    let mut dir = std::path::Path::new(&resolved);
    loop {
        if !home.is_empty() && dir.as_os_str() == home.as_str() {
            return false;
        }
        if dir.join(".git").exists() {
            return true;
        }
        match dir.parent() {
            Some(parent) => dir = parent,
            None => return false,
        }
    }
}

#[tauri::command]
pub fn project_key_of(path: String) -> String {
    project_key(&path)
}

/// A resume session id reaches a shell `-c` argument as a raw string
/// (`claude --resume <sid>; exec <shell> -l`) — anything outside this set
/// could break out into arbitrary shell execution. Session ids are UUIDs we
/// stored ourselves, so a reject here means something is wrong upstream, not
/// a hostile id to sanitize around.
fn valid_resume_id(sid: &str) -> bool {
    !sid.is_empty() && sid.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// Closed set of resume commands, one per adapter that supports it. `agent`
/// is the same marker `ingest.rs` stamps from `X-Logic-Loop-Agent` (persisted
/// alongside the session binding — see `repo.ts`'s `upsertSessionBinding`).
/// Absent or unrecognized values fall back to Claude's syntax, matching the
/// pre-adapter behavior every existing binding already relies on. Never
/// accept an arbitrary command string here — `sid` is still the only
/// variable part, and `valid_resume_id` remains the shell-injection boundary
/// at the call site.
fn resume_command(agent: Option<&str>, sid: &str, shell: &str) -> String {
    match agent {
        Some("codex") => format!("codex --no-daemon resume {sid}; exec {shell} -l"),
        Some("antigravity") => format!("agy --conversation {sid}; exec {shell} -l"),
        Some("pi") => format!("pi --session {sid}; exec {shell} -l"),
        // `opencode`'s default (TUI) command accepts `-s <id>` directly,
        // unlike `run`'s non-interactive one-shot mode used for this
        // adapter's live spike (Plan 038 Part 2 Step 1) — confirmed via
        // `opencode --help`'s top-level options, not yet live-verified for
        // the interactive TUI path specifically (see docs/TESTING.md).
        Some("opencode") => format!("opencode -s {sid}; exec {shell} -l"),
        // Unlike codex/antigravity/pi, `dsh` is npx-first in practice (Plan
        // 027: no global install found on a real dev machine) — using a
        // bare `dsh` here would silently fall through to a plain shell for
        // most users. `npx --yes` is the invocation plans/027/028 proved
        // actually works with no global install.
        Some("deepseek") => format!(
            "npx --yes @deepseek-ai/dsh --profile logic-loop --resume {sid}; exec {shell} -l"
        ),
        _ => format!("claude --resume {sid}; exec {shell} -l"),
    }
}

/// Owns `writer` on a dedicated thread and drains `Vec<u8>` chunks off an
/// unbounded FIFO channel, calling `write_all` for each in receive order.
/// The returned sender is the only way callers touch the writer: sending
/// never blocks on the child's own I/O (that's the thread's problem alone),
/// and because there is exactly one draining thread, write order always
/// matches send order regardless of how many callers send concurrently.
/// The thread exits cleanly once every sender is dropped (channel
/// disconnects) or once a write errors (dead child/closed pty).
fn spawn_ordered_writer(mut writer: Box<dyn Write + Send>) -> mpsc::Sender<Vec<u8>> {
    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        while let Ok(chunk) = rx.recv() {
            if writer.write_all(&chunk).is_err() {
                break;
            }
        }
    });
    tx
}

/// Plan 044: Codex 0.157 auto-starts a shared app-server daemon and runs hooks
/// in *its* environment, so a bare `codex` typed in a tab reports whichever
/// tab first started the daemon. zsh tabs route startup through these
/// app-owned files: each sources the user's own, then `.zshrc` hands ZDOTDIR
/// back (their `.zlogin` and child shells run as normal) and defines `codex`
/// to add `--no-daemon` once, so hooks inherit this tab's tether. No user
/// dotfile, PATH, or Codex config is touched.
const ZSH_FILES: [(&str, &str); 4] = [
    (
        ".zshenv",
        "# Logic Loop (Plan 044). A user .zshenv may move ZDOTDIR; keep that answer.\n\
         _ll_zd=$ZDOTDIR; ZDOTDIR=$LOGIC_LOOP_USER_ZDOTDIR\n\
         [[ -f $ZDOTDIR/.zshenv ]] && builtin source $ZDOTDIR/.zshenv\n\
         LOGIC_LOOP_USER_ZDOTDIR=$ZDOTDIR; ZDOTDIR=$_ll_zd; unset _ll_zd\n",
    ),
    (
        ".zprofile",
        "# Logic Loop (Plan 044)\n\
         _ll_zd=$ZDOTDIR; ZDOTDIR=$LOGIC_LOOP_USER_ZDOTDIR\n\
         [[ -f $ZDOTDIR/.zprofile ]] && builtin source $ZDOTDIR/.zprofile\n\
         ZDOTDIR=$_ll_zd; unset _ll_zd\n",
    ),
    (
        ".zshrc",
        "# Logic Loop (Plan 044). Repoint HISTFILE only if /etc/zshrc aimed it here.\n\
         _ll_zd=$ZDOTDIR; ZDOTDIR=$LOGIC_LOOP_USER_ZDOTDIR\n\
         [[ $HISTFILE == $_ll_zd/* ]] && HISTFILE=$ZDOTDIR/.zsh_history; unset _ll_zd\n\
         [[ -f $ZDOTDIR/.zshrc ]] && builtin source $ZDOTDIR/.zshrc\n\
         # A user's own `codex` alias or function wins (see docs/LANDMINES.md);\n\
         # `function` form so an alias can't mangle this definition.\n\
         (( $+functions[codex] )) || function codex {\n\
         \x20 if (( ${@[(Ie)--no-daemon]} )); then command codex \"$@\"; else command codex --no-daemon \"$@\"; fi\n\
         }\n",
    ),
    (
        // Only reached by the non-interactive `-c` resume shell; interactive
        // shells read the user's own .zlogin once .zshrc restored ZDOTDIR.
        ".zlogin",
        "# Logic Loop (Plan 044)\n\
         _ll_zd=$ZDOTDIR; ZDOTDIR=$LOGIC_LOOP_USER_ZDOTDIR\n\
         [[ -f $ZDOTDIR/.zlogin ]] && builtin source $ZDOTDIR/.zlogin\n\
         ZDOTDIR=$_ll_zd; unset _ll_zd\n",
    ),
];

/// Writes the zsh integration under `<home>/.context-terminal/zsh`. None on
/// any failure: the tab then spawns a plain zsh (fail open, invariant #2).
fn write_zsh_integration(home: &std::path::Path) -> Option<std::path::PathBuf> {
    let dir = home.join(".context-terminal/zsh");
    std::fs::create_dir_all(&dir).ok()?;
    for (name, body) in ZSH_FILES {
        let path = dir.join(name);
        if std::fs::read_to_string(&path).ok().as_deref() == Some(body) {
            continue;
        }
        // tmp + rename: fan-out spawns several tabs at once, and no zsh may
        // source a half-written file.
        let tmp = dir.join(format!("{name}.{:?}.tmp", std::thread::current().id()));
        std::fs::write(&tmp, body).ok()?;
        std::fs::rename(&tmp, &path).ok()?;
    }
    Some(dir)
}

// Each param is a flat named field on the JS `invoke("pty_spawn", {...})`
// call site (Tauri's command convention) — bundling them into a struct would
// mean every caller nests its args under one key, an unrelated-to-this-phase
// rewrite of every existing pty_spawn call site.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    state: State<'_, PtyManager>,
    cwd: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
    tab_id: Option<String>,
    resume_session: Option<String>,
    resume_agent: Option<String>,
    launch_cmd: Option<String>,
    // Setup's launch flow only (invariant carve-out documented on
    // `validate_project_dir`): a folder picked, then deleted before Start is
    // clicked, must surface an error instead of silently landing the new
    // session somewhere else. Every other caller (bookmarks, ghost-tab
    // restore, fan-out, `openTab`'s general path) omits this and keeps the
    // existing silent fallback — a bookmark pointing at a since-deleted
    // folder must keep working.
    strict_cwd: Option<bool>,
) -> Result<u32, String> {
    let cwd = resolve_spawn_cwd(cwd, strict_cwd.unwrap_or(false))?;

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
    // Fail open (invariant #2): an invalid id is silently dropped rather than
    // failing the whole spawn — same UX shape as today's blank restart. A
    // `claude` that isn't on PATH, or a session that can't resume, still
    // falls through to an interactive shell via the trailing `exec`.
    if let Some(sid) = resume_session.filter(|s| valid_resume_id(s)) {
        cmd.arg("-c");
        cmd.arg(resume_command(resume_agent.as_deref(), &sid, &shell));
    }
    cmd.env("TERM", "xterm-256color");
    // Tab tether: hooks inherit this and echo it back, so session→tab binding
    // is exact instead of guessed from cwd (two tabs on one repo bound wrong).
    if let Some(tab_id) = tab_id {
        cmd.env("LOGIC_LOOP_TAB_ID", tab_id);
    }
    // ponytail: zsh only (macOS default); bash/fish tabs keep bare `codex` unbound.
    if std::path::Path::new(&shell).file_name().is_some_and(|n| n == "zsh") {
        if let Some(home) = crate::home::home() {
            if let Some(dir) = write_zsh_integration(std::path::Path::new(&home)) {
                let user_zdotdir = std::env::var("ZDOTDIR").ok().filter(|z| !z.is_empty()).unwrap_or(home);
                cmd.env("LOGIC_LOOP_USER_ZDOTDIR", user_zdotdir);
                cmd.env("ZDOTDIR", dir);
            }
        }
    }
    if let Some(cwd) = cwd {
        cmd.cwd(cwd);
    }

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let writer_tx = spawn_ordered_writer(writer);

    // Fan-out launch command (invariant #4, reworded 2026-08-15): written
    // once here, before the session is stored or the id is returned to JS —
    // spawn-time process configuration, not a write into an already-running
    // PTY. No Tauri command exists to repeat this after the fact, and none
    // should be added; that structural gap is the enforcement, not this
    // being called carefully. Fail open: a bad command just errors inside
    // the shell like a mistyped one would.
    if let Some(c) = launch_cmd.filter(|c| !c.is_empty()) {
        let _ = writer_tx.send(format!("{c}\n").into_bytes());
    }

    let id = state.next_id.fetch_add(1, Ordering::SeqCst);
    state.sessions.lock().map_err(|e| e.to_string())?.insert(
        id,
        Arc::new(Mutex::new(PtySession {
            master: pair.master,
            child,
            writer_tx,
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
    let session = session.lock().map_err(|e| e.to_string())?;
    // Queues onto the writer thread; never calls write_all here, so a
    // stalled child can't block this (or any other tab's) command dispatch.
    session
        .writer_tx
        .send(data.into_bytes())
        .map_err(|_| "pty session writer closed".to_string())
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
pub async fn git_log(cwd: String, limit: Option<u32>) -> Vec<Commit> {
    spawn_blocking_or_default(move || git_log_blocking(cwd, limit)).await
}

fn git_log_blocking(cwd: String, limit: Option<u32>) -> Vec<Commit> {
    if !has_own_repo(&cwd) {
        return vec![];
    }
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

/// Local branch names only — no remotes, no fetch (first-cut existing-branch
/// picker, Phase 9). Empty vec if not a repo / no git, same fail-open shape
/// as `git_log`.
#[tauri::command]
pub async fn git_branches(cwd: String) -> Vec<String> {
    spawn_blocking_or_default(move || git_branches_blocking(cwd)).await
}

fn git_branches_blocking(cwd: String) -> Vec<String> {
    if !has_own_repo(&cwd) {
        return vec![];
    }
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(&cwd)
        .arg("branch")
        .arg("--format=%(refname:short)")
        .output();
    let Ok(out) = out else { return vec![] };
    if !out.status.success() {
        return vec![];
    }
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(|l| l.to_string())
        .collect()
}

/// `new_branch: true` creates `branch` from the repo's current HEAD at
/// `path`; `false` checks out an existing `branch` into the new worktree.
/// This is a foreground, user-triggered action (invariant #2's carve-out) —
/// failures surface git's real stderr rather than being swallowed.
#[tauri::command]
pub async fn git_worktree_add(
    repo_cwd: String,
    path: String,
    branch: String,
    new_branch: bool,
) -> Result<(), String> {
    spawn_blocking_result("git_worktree_add", move || {
        git_worktree_add_blocking(repo_cwd, path, branch, new_branch)
    })
    .await
}

fn git_worktree_add_blocking(repo_cwd: String, path: String, branch: String, new_branch: bool) -> Result<(), String> {
    if !has_own_repo(&repo_cwd) {
        return Err("not a git repository".into());
    }
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut cmd = std::process::Command::new("git");
    cmd.arg("-C").arg(&repo_cwd).arg("worktree").arg("add");
    if new_branch {
        cmd.arg("-b").arg(&branch).arg(&path);
    } else {
        cmd.arg(&path).arg(&branch);
    }
    let out = cmd.output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// `force` only ever set by the caller after an explicit second confirm on a
/// dirty worktree — never defaulted true silently.
#[tauri::command]
pub async fn git_worktree_remove(repo_cwd: String, path: String, force: bool) -> Result<(), String> {
    spawn_blocking_result("git_worktree_remove", move || {
        git_worktree_remove_blocking(repo_cwd, path, force)
    })
    .await
}

fn git_worktree_remove_blocking(repo_cwd: String, path: String, force: bool) -> Result<(), String> {
    if !has_own_repo(&repo_cwd) {
        return Err("not a git repository".into());
    }
    let mut cmd = std::process::Command::new("git");
    cmd.arg("-C").arg(&repo_cwd).arg("worktree").arg("remove");
    if force {
        cmd.arg("--force");
    }
    cmd.arg(&path);
    let out = cmd.output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

#[tauri::command]
pub async fn git_current_branch(cwd: String) -> Result<String, String> {
    spawn_blocking_result("git_current_branch", move || git_current_branch_blocking(cwd)).await
}

fn git_current_branch_blocking(cwd: String) -> Result<String, String> {
    if !has_own_repo(&cwd) {
        return Err("not a git repository".into());
    }
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(&cwd)
        .arg("rev-parse")
        .arg("--abbrev-ref")
        .arg("HEAD")
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Tracked-file dirty check (staged or modified), no untracked files —
/// gates whether the Commit & Push footer is active at all.
#[tauri::command]
pub async fn git_has_changes(cwd: String) -> bool {
    spawn_blocking_or_default(move || git_has_changes_blocking(cwd)).await
}

fn git_has_changes_blocking(cwd: String) -> bool {
    if !has_own_repo(&cwd) {
        return false;
    }
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(&cwd)
        .arg("status")
        .arg("--porcelain")
        .arg("--untracked-files=no")
        .output();
    match out {
        Ok(o) if o.status.success() => !o.stdout.is_empty(),
        _ => false,
    }
}

#[tauri::command]
pub async fn git_add_u(cwd: String) -> Result<(), String> {
    spawn_blocking_result("git_add_u", move || git_add_u_blocking(cwd)).await
}

fn git_add_u_blocking(cwd: String) -> Result<(), String> {
    if !has_own_repo(&cwd) {
        return Err("not a git repository".into());
    }
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(&cwd)
        .arg("add")
        .arg("-u")
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// New files `git add -u` never stages — the Commit & Push footer surfaces
/// these so a commit doesn't silently ship a message describing a file it
/// never actually included (see CLAUDE.md landmines, 2026-08-27).
#[tauri::command]
pub async fn git_untracked_files(cwd: String) -> Vec<String> {
    spawn_blocking_or_default(move || git_untracked_files_blocking(cwd)).await
}

fn git_untracked_files_blocking(cwd: String) -> Vec<String> {
    if !has_own_repo(&cwd) {
        return Vec::new();
    }
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(&cwd)
        .arg("status")
        .arg("--porcelain")
        .arg("--untracked-files=all")
        .output();
    match out {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout)
            .lines()
            .filter_map(|l| l.strip_prefix("?? ").map(|s| s.trim().to_string()))
            .collect(),
        _ => Vec::new(),
    }
}

/// Opt-in counterpart to `git_add_u` — stages untracked files too. Only
/// called when the user has explicitly acknowledged the untracked-files
/// warning in the footer.
#[tauri::command]
pub async fn git_add_all(cwd: String) -> Result<(), String> {
    spawn_blocking_result("git_add_all", move || git_add_all_blocking(cwd)).await
}

fn git_add_all_blocking(cwd: String) -> Result<(), String> {
    if !has_own_repo(&cwd) {
        return Err("not a git repository".into());
    }
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(&cwd)
        .arg("add")
        .arg("-A")
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

#[tauri::command]
pub async fn git_diff_cached(cwd: String) -> String {
    spawn_blocking_or_default(move || git_diff_cached_blocking(cwd)).await
}

fn git_diff_cached_blocking(cwd: String) -> String {
    if !has_own_repo(&cwd) {
        return String::new();
    }
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(&cwd)
        .arg("diff")
        .arg("--cached")
        .output();
    match out {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).into_owned(),
        _ => String::new(),
    }
}

/// Message reaches git as a real subprocess argument (`Command::arg`), never
/// through a shell string — no injection surface even though the content is
/// LLM-generated from repo data.
#[tauri::command]
pub async fn git_commit(cwd: String, message: String) -> Result<(), String> {
    spawn_blocking_result("git_commit", move || git_commit_blocking(cwd, message)).await
}

fn git_commit_blocking(cwd: String, message: String) -> Result<(), String> {
    if !has_own_repo(&cwd) {
        return Err("not a git repository".into());
    }
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(&cwd)
        .arg("commit")
        .arg("-m")
        .arg(&message)
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// Distinct from `git_worktree_add`'s `-b` — same underlying git flag, kept
/// as two commands so the two flows are never confused in review.
#[tauri::command]
pub async fn git_create_branch(cwd: String, branch: String) -> Result<(), String> {
    spawn_blocking_result("git_create_branch", move || git_create_branch_blocking(cwd, branch)).await
}

fn git_create_branch_blocking(cwd: String, branch: String) -> Result<(), String> {
    if !has_own_repo(&cwd) {
        return Err("not a git repository".into());
    }
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(&cwd)
        .arg("checkout")
        .arg("-b")
        .arg(&branch)
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// Checkout of an *existing* branch — the return half of the footer's
/// wip-branch flow, which checks out `git_create_branch`'s new branch
/// in-place in the tab's live working directory and must switch back
/// afterward rather than stranding the tab on the wip branch.
#[tauri::command]
pub async fn git_checkout(cwd: String, branch: String) -> Result<(), String> {
    spawn_blocking_result("git_checkout", move || git_checkout_blocking(cwd, branch)).await
}

fn git_checkout_blocking(cwd: String, branch: String) -> Result<(), String> {
    if !has_own_repo(&cwd) {
        return Err("not a git repository".into());
    }
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(&cwd)
        .arg("checkout")
        .arg(&branch)
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// Never a force-push — a rejected (diverged) push surfaces git's real error
/// to the caller, no auto-rebase/auto-pull/silent retry-with-force.
#[tauri::command]
pub async fn git_push(cwd: String, branch: String, set_upstream: bool) -> Result<(), String> {
    spawn_blocking_result("git_push", move || git_push_blocking(cwd, branch, set_upstream)).await
}

fn git_push_blocking(cwd: String, branch: String, set_upstream: bool) -> Result<(), String> {
    if !has_own_repo(&cwd) {
        return Err("not a git repository".into());
    }
    let mut cmd = std::process::Command::new("git");
    cmd.arg("-C").arg(&cwd).arg("push");
    if set_upstream {
        cmd.arg("-u").arg("origin").arg(&branch);
    } else {
        cmd.arg("origin").arg(&branch);
    }
    let out = cmd.output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// A GUI-launched app's PATH doesn't include Homebrew (`/opt/homebrew/bin`
/// on Apple Silicon, `/usr/local/bin` on Intel) — `gh` resolves fine from a
/// terminal but ENOENTs ("No such file or directory") when Logic Loop is
/// launched from Finder/Dock. Check the common install locations before
/// falling back to bare `"gh"` (still works if PATH happens to have it).
fn gh_binary() -> String {
    for candidate in ["/opt/homebrew/bin/gh", "/usr/local/bin/gh"] {
        if std::path::Path::new(candidate).exists() {
            return candidate.to_string();
        }
    }
    "gh".to_string()
}

/// Best-effort on top of an already-succeeded push — gh has no `-C` flag
/// (unlike git), so the repo is selected via cwd. Any failure (gh missing,
/// unauthenticated, PR already exists) surfaces as an error string; the
/// caller must not treat it as undoing the commit/push that already landed.
#[tauri::command]
pub async fn git_pr_create(cwd: String, title: String, body: String) -> Result<String, String> {
    spawn_blocking_result("git_pr_create", move || git_pr_create_blocking(cwd, title, body)).await
}

fn git_pr_create_blocking(cwd: String, title: String, body: String) -> Result<String, String> {
    if !has_own_repo(&cwd) {
        return Err("not a git repository".into());
    }
    let out = std::process::Command::new(gh_binary())
        .current_dir(&cwd)
        .arg("pr")
        .arg("create")
        .arg("--title")
        .arg(&title)
        .arg("--body")
        .arg(&body)
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        canon, has_own_repo, project_key, resolve_spawn_cwd, resume_command, spawn_ordered_writer,
        valid_resume_id, validate_project_dir, write_zsh_integration,
    };
    use std::io::Write;
    use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    /// A mock `Write` end for exercising `spawn_ordered_writer` without a
    /// real PTY/child process. `delay_first` simulates a stalled child on
    /// its first write; `fail_after` simulates a dead child by erroring on
    /// a given call index.
    struct RecordingWriter {
        buf: Arc<Mutex<Vec<u8>>>,
        calls: Arc<AtomicUsize>,
        delay_first: Option<Duration>,
        fail_after: Option<usize>,
    }

    impl Write for RecordingWriter {
        fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
            let n = self.calls.fetch_add(1, AtomicOrdering::SeqCst);
            if n == 0 {
                if let Some(d) = self.delay_first {
                    std::thread::sleep(d);
                }
            }
            if self.fail_after == Some(n) {
                return Err(std::io::Error::other("boom"));
            }
            self.buf.lock().unwrap().extend_from_slice(data);
            Ok(data.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn validate_project_dir_accepts_a_real_directory() {
        let dir = std::env::temp_dir();
        let resolved = validate_project_dir(dir.to_string_lossy().into_owned()).unwrap();
        assert_eq!(resolved, canon(&dir.to_string_lossy()));
    }

    #[test]
    fn validate_project_dir_rejects_a_missing_path() {
        let missing = std::env::temp_dir().join("logic-loop-plan033-does-not-exist");
        assert!(validate_project_dir(missing.to_string_lossy().into_owned()).is_err());
    }

    #[test]
    fn validate_project_dir_rejects_a_file() {
        let file = std::env::temp_dir().join("logic-loop-plan033-validate-file-test");
        std::fs::write(&file, b"x").unwrap();
        let result = validate_project_dir(file.to_string_lossy().into_owned());
        std::fs::remove_file(&file).ok();
        assert!(result.is_err());
    }

    #[test]
    fn resolve_spawn_cwd_non_strict_silently_drops_a_missing_dir() {
        // Every caller except Setup's launch flow (bookmarks, ghost-tab
        // restore, fan-out) — a since-deleted folder must still spawn a
        // fallback shell, not error.
        let missing = std::env::temp_dir().join("logic-loop-plan033-resolve-missing");
        assert_eq!(resolve_spawn_cwd(Some(missing.to_string_lossy().into_owned()), false), Ok(None));
    }

    #[test]
    fn resolve_spawn_cwd_strict_errors_on_a_missing_dir() {
        // Setup's launch flow: pick a valid folder, delete it, click Start —
        // this is the exact gap Finding 1 (docs/TESTING.md) filed.
        let missing = std::env::temp_dir().join("logic-loop-plan033-resolve-missing-strict");
        assert!(resolve_spawn_cwd(Some(missing.to_string_lossy().into_owned()), true).is_err());
    }

    #[test]
    fn resolve_spawn_cwd_accepts_a_real_directory_in_either_mode() {
        let dir = std::env::temp_dir().to_string_lossy().into_owned();
        let resolved = canon(&dir);
        assert_eq!(resolve_spawn_cwd(Some(dir.clone()), false), Ok(Some(resolved.clone())));
        assert_eq!(resolve_spawn_cwd(Some(dir), true), Ok(Some(resolved)));
    }

    #[test]
    fn resolve_spawn_cwd_passes_through_none() {
        assert_eq!(resolve_spawn_cwd(None, true), Ok(None));
        assert_eq!(resolve_spawn_cwd(None, false), Ok(None));
    }

    #[test]
    fn ordered_writer_preserves_send_order_across_chunks() {
        let buf = Arc::new(Mutex::new(Vec::new()));
        let writer = RecordingWriter {
            buf: buf.clone(),
            calls: Arc::new(AtomicUsize::new(0)),
            delay_first: None,
            fail_after: None,
        };
        let tx = spawn_ordered_writer(Box::new(writer));
        for chunk in ["a", "b", "c", "d", "e"] {
            tx.send(chunk.as_bytes().to_vec()).unwrap();
        }
        for _ in 0..100 {
            if buf.lock().unwrap().len() == 5 {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(*buf.lock().unwrap(), b"abcde", "chunks sent in order must be written in that same order");
    }

    #[test]
    fn ordered_writer_send_does_not_block_while_a_write_is_in_flight() {
        let buf = Arc::new(Mutex::new(Vec::new()));
        let writer = RecordingWriter {
            buf: buf.clone(),
            calls: Arc::new(AtomicUsize::new(0)),
            delay_first: Some(Duration::from_millis(300)),
            fail_after: None,
        };
        let tx = spawn_ordered_writer(Box::new(writer));
        tx.send(b"slow-first-write".to_vec()).unwrap();
        // Give the drain thread a moment to pick this up and start blocking
        // inside write_all before we measure the next send.
        std::thread::sleep(Duration::from_millis(30));
        let start = Instant::now();
        tx.send(b"second-tab-keystroke".to_vec()).unwrap();
        assert!(
            start.elapsed() < Duration::from_millis(100),
            "send must return immediately even while a prior write is stalled: took {:?}",
            start.elapsed()
        );
    }

    #[test]
    fn ordered_writer_thread_exits_after_a_write_error() {
        let buf = Arc::new(Mutex::new(Vec::new()));
        let writer = RecordingWriter {
            buf: buf.clone(),
            calls: Arc::new(AtomicUsize::new(0)),
            delay_first: None,
            fail_after: Some(0),
        };
        let tx = spawn_ordered_writer(Box::new(writer));
        tx.send(b"boom".to_vec()).unwrap();
        std::thread::sleep(Duration::from_millis(100));
        assert!(
            tx.send(b"never written".to_vec()).is_err(),
            "the drain thread must exit (dropping its receiver) once a write fails, \
             so pty_kill is never left waiting on a wedged writer"
        );
        assert!(buf.lock().unwrap().is_empty(), "the failed write must not have appended data");
    }

    #[test]
    fn resume_command_selects_codex_syntax() {
        assert_eq!(
            resume_command(Some("codex"), "abc-123", "/bin/zsh"),
            "codex --no-daemon resume abc-123; exec /bin/zsh -l"
        );
    }

    #[test]
    fn resume_command_selects_antigravity_syntax() {
        assert_eq!(
            resume_command(Some("antigravity"), "abc-123", "/bin/zsh"),
            "agy --conversation abc-123; exec /bin/zsh -l"
        );
    }

    #[test]
    fn resume_command_selects_pi_syntax() {
        assert_eq!(
            resume_command(Some("pi"), "abc-123", "/bin/zsh"),
            "pi --session abc-123; exec /bin/zsh -l"
        );
    }

    #[test]
    fn resume_command_selects_opencode_syntax() {
        assert_eq!(
            resume_command(Some("opencode"), "abc-123", "/bin/zsh"),
            "opencode -s abc-123; exec /bin/zsh -l"
        );
    }

    #[test]
    fn resume_command_selects_deepseek_syntax() {
        assert_eq!(
            resume_command(Some("deepseek"), "abc-123", "/bin/zsh"),
            "npx --yes @deepseek-ai/dsh --profile logic-loop --resume abc-123; exec /bin/zsh -l"
        );
    }

    #[test]
    fn resume_command_defaults_to_claude_syntax() {
        assert_eq!(
            resume_command(None, "abc-123", "/bin/zsh"),
            "claude --resume abc-123; exec /bin/zsh -l"
        );
        assert_eq!(
            resume_command(Some("some-future-agent"), "abc-123", "/bin/zsh"),
            "claude --resume abc-123; exec /bin/zsh -l",
            "an unrecognized agent must not be guessed a command, and must not fall through to no resume at all"
        );
    }

    #[test]
    fn resume_id_rejects_shell_metacharacters() {
        // Real ids: a bare UUID.
        assert!(valid_resume_id("0089eaaf-19fa-41d2-8238-13269b9b3ca0"));
        assert!(valid_resume_id("abc123"));
        // Anything that could break out of the `-c` string.
        for bad in [";", "`", "$(", " ", "a;b", "a`b`", "a$(b)", "a b", "a\nb", ""] {
            assert!(!valid_resume_id(bad), "{bad:?} should be rejected");
        }
    }

    #[test]
    // Still gated after the home() helper: the case-fold assertion needs
    // `~/Library` to exist on a case-insensitive filesystem, and where it does
    // not both spellings fall through canon unchanged and compare unequal.
    // macOS-only, not unix in general — Linux is case-sensitive.
    #[cfg(target_os = "macos")]
    fn canon_resolves_case_and_tilde_to_one_key() {
        let _guard = crate::home::lock_env();
        let home = crate::home::home().unwrap();
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
    // Still gated after the home() helper: on Windows `canonicalize` returns a
    // `\\?\` verbatim path for a home that exists but leaves the nonexistent
    // `~/...` case unprefixed, so the $HOME boundary this asserts is never
    // reached and the walk runs to the drive root instead. That is the path
    // half of the Windows port, not the env-var half.
    #[cfg(unix)]
    fn project_key_outside_a_repo_is_the_dir_itself() {
        let _guard = crate::home::lock_env();
        let home = crate::home::home().unwrap();
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

    #[test]
    fn has_own_repo_refuses_a_home_directory_git_it_did_not_create() {
        // Regression test for the 2026-09-12 finding: an unrelated, unintended
        // `~/.git` (empty, no commits — not created by this codebase) meant
        // `git -C <cwd> ...` for a project with no `.git` of its own silently
        // walked up and operated on the whole home directory. A directory with
        // no `.git` anywhere between it and `$HOME` must report false, even
        // when `$HOME` itself has one.
        let _guard = crate::home::lock_env();
        let _restore_env = crate::home::EnvRestore::capture();

        let home = std::env::temp_dir()
            .join(format!("ll-horepo-home-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(home.join(".git")).unwrap();
        std::env::set_var("HOME", &home);

        // Must live *inside* $HOME to actually exercise the boundary — a
        // scratch dir under /tmp would hit the filesystem root without ever
        // passing through $HOME, proving nothing about the crossing itself.
        let scratch = home.join(format!("ll-horepo-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&scratch);
        std::fs::create_dir_all(&scratch).unwrap();

        assert!(
            !has_own_repo(scratch.to_str().unwrap()),
            "a dir under $HOME, with $HOME's own .git but none of its own, must refuse"
        );

        std::fs::create_dir_all(scratch.join(".git")).unwrap();
        assert!(has_own_repo(scratch.to_str().unwrap()), "its own .git must be honored");

        std::fs::remove_dir_all(&scratch).unwrap();
        std::fs::remove_dir_all(&home).unwrap();
    }

    /// Plan 044: a real interactive zsh through the integration sources the
    /// user's files (including a ZDOTDIR moved by their .zshenv), hands
    /// ZDOTDIR back, and wraps `codex` with exactly one `--no-daemon`.
    #[test]
    fn zsh_integration_wraps_codex_once_and_keeps_user_startup() {
        if !std::path::Path::new("/bin/zsh").exists() {
            return;
        }
        let home = std::env::temp_dir().join(format!("ll-zsh-home-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let cfg = home.join("cfg");
        let bin = home.join("bin");
        std::fs::create_dir_all(&cfg).unwrap();
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(home.join(".zshenv"), "ZDOTDIR=$HOME/cfg\n").unwrap();
        std::fs::write(cfg.join(".zshrc"), "path=($HOME/bin $path)\nalias llmark='echo user-rc'\n").unwrap();
        let fake = bin.join("codex");
        std::fs::write(&fake, "#!/bin/sh\nprintf 'argv:'; printf '[%s]' \"$@\"; echo\n").unwrap();
        std::process::Command::new("chmod").arg("+x").arg(&fake).status().unwrap();
        let dir = write_zsh_integration(&home).expect("integration written");

        let out = std::process::Command::new("/bin/zsh")
            .args(["-l", "-i", "-c"])
            .arg("codex; codex --no-daemon resume 'a b'; llmark; echo zd:$ZDOTDIR; echo hf:$HISTFILE")
            .env_clear()
            .env("HOME", &home)
            .env("PATH", "/usr/bin:/bin")
            .env("ZDOTDIR", &dir)
            .env("LOGIC_LOOP_USER_ZDOTDIR", &home)
            .output()
            .unwrap();
        let stdout = String::from_utf8_lossy(&out.stdout);
        let lines: Vec<&str> = stdout.lines().collect();
        let cfg = cfg.to_str().unwrap();
        assert!(lines.contains(&"argv:[--no-daemon]"), "bare codex not wrapped: {stdout}");
        assert!(lines.contains(&"argv:[--no-daemon][resume][a b]"), "flag duplicated or args lost: {stdout}");
        assert!(lines.contains(&"user-rc"), "user .zshrc alias missing: {stdout}");
        assert!(lines.contains(&format!("zd:{cfg}").as_str()), "ZDOTDIR not handed back: {stdout}");
        assert!(lines.contains(&format!("hf:{cfg}/.zsh_history").as_str()), "HISTFILE left in app dir: {stdout}");
        let _ = std::fs::remove_dir_all(&home);
    }
}
