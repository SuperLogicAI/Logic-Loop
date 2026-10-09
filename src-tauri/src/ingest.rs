use crate::home::home_or_tmp;
use std::collections::HashSet;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

pub(crate) const MARKER: &str = "context-terminal/ingest.env";

/// Tether value stamped on the app's own `claude -p` extractor children. Those
/// children inherit the user's hooks and post back here, so without this the app
/// ingests its own extraction runs: they key on the app's cwd (`/`), bind to
/// whatever tab is active, overwrite its cwd, and their transcripts feed the
/// extractor again — a self-amplifying loop. Dropped at the door.
pub const EXTRACTOR_TETHER: &str = "__logic_loop_extractor__";

fn config_dir() -> PathBuf {
    PathBuf::from(home_or_tmp()).join(".context-terminal")
}

pub(crate) fn settings_path() -> PathBuf {
    PathBuf::from(home_or_tmp()).join(".claude/settings.json")
}

/// Plan 055: tab-only install. Logic Loop's Claude hooks (and statusLine
/// wrapper) live here instead of `~/.claude/settings.json`; the app's zsh
/// `claude` function passes it as `--settings` (pty.rs). Its existence is the
/// mode: present = tab-only (even as `{}` with everything off), absent = global.
pub(crate) fn tab_settings_path() -> PathBuf {
    config_dir().join("claude-settings.json")
}

/// Where Logic Loop's own Claude entries are read and written in the current mode.
pub(crate) fn claude_target_path() -> PathBuf {
    let tab = tab_settings_path();
    if tab.exists() {
        tab
    } else {
        settings_path()
    }
}

/// Sessions with an active transcript tailer.
#[derive(Default)]
pub struct TailerRegistry(Mutex<HashSet<String>>);

fn write_endpoint(dir: &Path, port: u16, token: &str) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    let env_file = dir.join("ingest.env");
    fs::write(&env_file, format!("CT_PORT={port}\nCT_TOKEN={token}\n"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir, fs::Permissions::from_mode(0o700))?;
        fs::set_permissions(&env_file, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

fn endpoint_from_env(content: &str) -> Option<(u16, &str)> {
    let port = content.lines().find_map(|line| line.strip_prefix("CT_PORT="))?.parse().ok()?;
    let token = content.lines().find_map(|line| line.strip_prefix("CT_TOKEN="))?;
    if token.len() != 64 || !token.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    Some((port, token))
}

fn endpoint_alive(content: &str) -> bool {
    let Some((port, token)) = endpoint_from_env(content) else {
        return false;
    };
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_millis(500)))
        .build()
        .into();
    agent
        .get(format!("http://127.0.0.1:{port}/health"))
        .header("Authorization", format!("Bearer {token}"))
        .call()
        .is_ok()
}

/// Another app instance can replace the shared endpoint and then exit, leaving
/// surviving sessions posting to a dead port. Reclaim only after the same dead
/// endpoint has been observed twice; a newly started instance gets time to
/// begin serving before the older one considers it stale.
fn repair_endpoint_if_stale(
    dir: &Path,
    port: u16,
    token: &str,
    failed: &mut Option<Option<String>>,
) {
    let env_file = dir.join("ingest.env");
    let own = format!("CT_PORT={port}\nCT_TOKEN={token}\n");
    let current = fs::read_to_string(&env_file).ok();
    if current.as_deref() == Some(own.as_str()) || current.as_deref().is_some_and(endpoint_alive) {
        *failed = None;
        return;
    }
    if failed.as_ref() == Some(&current) {
        // Check again immediately before writing so a healthy newer
        // instance is not displaced by a stale observation.
        if fs::read_to_string(&env_file).ok() == current {
            if let Err(e) = write_endpoint(dir, port, token) {
                eprintln!("ingest: cannot restore ingest.env: {e}");
            }
        }
        *failed = None;
    } else {
        *failed = Some(current);
    }
}

fn watch_endpoint(dir: PathBuf, port: u16, token: String) {
    std::thread::spawn(move || {
        let mut failed: Option<Option<String>> = None;
        loop {
            std::thread::sleep(Duration::from_secs(2));
            repair_endpoint_if_stale(&dir, port, &token, &mut failed);
        }
    });
}

/// Start the ingestion server on a random localhost port with a fresh bearer
/// token; write both to ~/.context-terminal/ingest.env for the hook command.
/// Fail open: any error here logs and returns — terminals must keep working.
pub fn start(app: AppHandle) {
    let mut raw = [0u8; 32];
    if getrandom::fill(&mut raw).is_err() {
        eprintln!("ingest: no entropy, server disabled");
        return;
    }
    let token: String = raw.iter().map(|b| format!("{b:02x}")).collect();

    let server = match tiny_http::Server::http("127.0.0.1:0") {
        Ok(s) => s,
        Err(e) => {
            eprintln!("ingest: bind failed: {e}");
            return;
        }
    };
    let port = match server.server_addr().to_ip() {
        Some(addr) => addr.port(),
        None => return,
    };

    let dir = config_dir();
    if let Err(e) = write_endpoint(&dir, port, &token) {
        eprintln!("ingest: cannot write ingest.env: {e}");
        return;
    }

    watch_endpoint(dir, port, token.clone());
    std::thread::spawn(move || {
        let expected = format!("Bearer {token}");
        for mut request in server.incoming_requests() {
            let authed = request
                .headers()
                .iter()
                .any(|h| h.field.equiv("Authorization") && h.value.as_str() == expected);
            if !authed {
                let _ = request.respond(tiny_http::Response::empty(401));
                continue;
            }
            if request.url() == "/health" {
                let _ = request.respond(tiny_http::Response::empty(204));
                continue;
            }
            if request.url().starts_with("/launch") {
                let url = request.url().to_string();
                let mut body = String::new();
                let status = if request.as_reader().take(4096).read_to_string(&mut body).is_ok() {
                    launch_request(&app.state::<crate::pty::PtyManager>().launches, &url, &body)
                } else {
                    400
                };
                let _ = request.respond(tiny_http::Response::empty(status));
                continue;
            }
            // Headers must be read before `as_reader` borrows the request.
            // Plan 045: split `<tab>:<launch>` first, so every consumer below
            // (extractor check, statusline, `tab_id`) sees the plain tab id.
            let (tab_id, launch_id) = split_tether(header_value(&request, "X-Logic-Loop-Tab"));
            // Our own extractor child — never ingest it, or the app observes
            // itself and the loop feeds forever.
            if tab_id.as_deref() == Some(EXTRACTOR_TETHER) {
                let _ = request.respond(tiny_http::Response::empty(204));
                continue;
            }
            let is_statusline = request.url() == "/statusline";
            let hook_version = header_value(&request, "X-Logic-Loop-Hook");
            let agent_header = header_value(&request, "X-Logic-Loop-Agent");
            let mut body = String::new();
            if request.as_reader().take(1_000_000).read_to_string(&mut body).is_err() {
                let _ = request.respond(tiny_http::Response::empty(400));
                continue;
            }
            if is_statusline {
                if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&body) {
                    emit_statusline(&app, payload, tab_id);
                }
                let _ = request.respond(tiny_http::Response::empty(204));
                continue;
            }
            if let Ok(mut payload) = serde_json::from_str::<serde_json::Value>(&body) {
                // OpenCode and Pi have no transcript file to tail (Plans 038
                // and 039): their in-process adapters reduce completed visible
                // message text and post it here as a synthetic transcript line,
                // reusing the exact `ingest://transcript` path the real file
                // tailer already feeds into `decisions.onTranscript` — no
                // separate extraction pipeline needed. Scoped to the
                // only for the explicit closed set below, not any payload
                // claiming this event name.
                if payload.get("hook_event_name").and_then(|v| v.as_str()) == Some("TranscriptLine")
                    && accepts_synthetic_transcript(recognized_agent(agent_header.as_deref()))
                {
                    if let (Some(sid), Some(line)) = (
                        payload.get("session_id").and_then(|v| v.as_str()),
                        payload.get("line").and_then(|v| v.as_str()),
                    ) {
                        let _ = app.emit(
                            "ingest://transcript",
                            serde_json::json!({ "session_id": sid, "line": line }),
                        );
                    }
                    let _ = request.respond(tiny_http::Response::empty(204));
                    continue;
                }
                // Plan 059: a subagent lifecycle hook never starts a tailer —
                // its path can be a child's file, which would then be tailed
                // as the parent session's transcript.
                if let Some(path) = payload
                    .get("transcript_path")
                    .and_then(|v| v.as_str())
                    .filter(|_| !is_subagent_lifecycle(&payload))
                {
                    if is_transcript_path(path, recognized_agent(agent_header.as_deref())) {
                        if let Some(sid) = payload.get("session_id").and_then(|v| v.as_str()) {
                            ensure_tailer(&app, sid.to_string(), path.to_string());
                        }
                    }
                }
                // The one place a project key is derived from a hook cwd. Two
                // independent call sites is how the project split comes back.
                if let Some(obj) = payload.as_object_mut() {
                    if let Some(cwd) = obj.get("cwd").and_then(|v| v.as_str()) {
                        let key = crate::pty::project_key(cwd);
                        obj.insert("project_key".into(), key.into());
                    }
                    // Absent tether (session started outside the app) stays
                    // absent — the frontend falls back to cwd matching.
                    if let Some(tab) = tab_id.filter(|t| !t.is_empty()) {
                        let launches = &app.state::<crate::pty::PtyManager>().launches;
                        obj.insert("launch".into(), launch_verdict(launches, &tab, launch_id.as_deref()).into());
                        if let Some(id) = launch_id {
                            obj.insert("launch_id".into(), id.into());
                        }
                        obj.insert("tab_id".into(), tab.into());
                    }
                    // Missing header = version 0, today's shape. Recorded only;
                    // nothing branches on it yet.
                    obj.insert(
                        "hook_version".into(),
                        hook_version.and_then(|v| v.parse::<u64>().ok()).unwrap_or(0).into(),
                    );
                    if let Some(agent) = recognized_agent(agent_header.as_deref()) {
                        obj.insert("agent".into(), agent.into());
                    }
                }
                // Plan 059: a Codex hook names its root session; the usage
                // reader finds that root's rollouts (parent + children).
                if recognized_agent(agent_header.as_deref()) == Some("codex") {
                    if let Some(root) = payload.get("session_id").and_then(|v| v.as_str()) {
                        crate::usage::watch(
                            &app,
                            root,
                            payload.get("tab_id").and_then(|v| v.as_str()),
                            payload.get("project_key").and_then(|v| v.as_str()),
                        );
                    }
                }
                let _ = app.emit("ingest://hook", payload);
            }
            let _ = request.respond(tiny_http::Response::empty(204));
        }
    });
}

/// Transcript paths are agent-scoped. An ungated tailer call here would tail
/// arbitrary files and can self-amplify through agent subprocesses.
fn is_transcript_path(path: &str, agent: Option<&str>) -> bool {
    match agent {
        None => path.contains("/.claude/projects/"),
        Some("codex") => crate::home::home()
            .map(|home| is_codex_rollout_path(Path::new(path), Path::new(&home)))
            .unwrap_or(false),
        Some("antigravity") => crate::home::home()
            .map(|home| is_antigravity_transcript_path(Path::new(path), Path::new(&home)))
            .unwrap_or(false),
        Some(_) => false,
    }
}

fn is_antigravity_transcript_path(path: &Path, home: &Path) -> bool {
    let root = home.join(".gemini/antigravity-cli/brain");
    let Ok(relative) = path.strip_prefix(root) else {
        return false;
    };
    let mut components = relative.components();
    if !matches!(components.next(), Some(std::path::Component::Normal(_))) {
        return false;
    }
    for expected in [".system_generated", "logs", "transcript_full.jsonl"] {
        if !matches!(components.next(), Some(std::path::Component::Normal(actual)) if actual == expected) {
            return false;
        }
    }
    components.next().is_none()
}

fn is_codex_rollout_path(path: &Path, home: &Path) -> bool {
    let Ok(relative) = path.strip_prefix(home.join(".codex").join("sessions")) else {
        return false;
    };
    let mut components = relative.components().rev();
    let Some(std::path::Component::Normal(file)) = components.next() else {
        return false;
    };
    let file = file.to_string_lossy();
    if !file.starts_with("rollout-") || !file.ends_with(".jsonl") {
        return false;
    }
    let Some(std::path::Component::Normal(day)) = components.next() else {
        return false;
    };
    let Some(std::path::Component::Normal(month)) = components.next() else {
        return false;
    };
    let Some(std::path::Component::Normal(year)) = components.next() else {
        return false;
    };
    components.next().is_none()
        && is_fixed_digits(&year.to_string_lossy(), 4)
        && is_fixed_digits(&month.to_string_lossy(), 2)
        && is_fixed_digits(&day.to_string_lossy(), 2)
}

fn is_fixed_digits(value: &str, length: usize) -> bool {
    value.len() == length && value.bytes().all(|b| b.is_ascii_digit())
}

/// Plan 045: `X-Logic-Loop-Tab` is `<tab>` or `<tab>:<launch>`. Split on the
/// first `:`; tab ids never contain one.
fn split_tether(header: Option<String>) -> (Option<String>, Option<String>) {
    match header {
        Some(h) => match h.split_once(':') {
            Some((tab, launch)) => (Some(tab.to_string()), Some(launch.to_string())),
            None => (Some(h), None),
        },
        None => (None, None),
    }
}

/// The app-derived `launch` field: `none` (plain tether), else the registry's
/// verdict. A malformed id is `unknown`, so it can never bind.
fn launch_verdict(reg: &crate::launch::LaunchRegistry, tab: &str, launch_id: Option<&str>) -> &'static str {
    match launch_id {
        None => "none",
        Some(id) if !crate::launch::valid_launch_id(id) => "unknown",
        Some(id) => reg.verdict(tab, id).as_str(),
    }
}

/// Plan 045: the zsh wrapper's launch registration (`/launch`) and exit
/// (`/launch/end`). Setup and re-entry register in-process instead. Any
/// failure is only a status code; the wrapper launches Codex regardless.
fn launch_request(reg: &crate::launch::LaunchRegistry, url: &str, body: &str) -> u16 {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(body) else { return 400 };
    let Some(launch_id) = v.get("launch_id").and_then(|x| x.as_str()) else { return 400 };
    match url {
        "/launch/end" => {
            reg.retire(launch_id);
            204
        }
        "/launch" => {
            // The shell posts `$LOGIC_LOOP_PTY_GEN` as a string; accept either form.
            let pty = v.get("pty_gen").and_then(|x| x.as_u64().or_else(|| x.as_str()?.parse().ok()));
            match (v.get("tab_id").and_then(|x| x.as_str()), pty.and_then(|p| u32::try_from(p).ok())) {
                (Some(tab), Some(pty)) if reg.register(tab, pty, launch_id) => 204,
                _ => 409,
            }
        }
        _ => 404,
    }
}

fn header_value(request: &tiny_http::Request, name: &'static str) -> Option<String> {
    request
        .headers()
        .iter()
        .find(|h| h.field.equiv(name))
        .map(|h| h.value.as_str().to_string())
}

/// Live gauge snapshot from the Claude statusLine wrapper (Plan 023): a
/// distinct emit from `/event`'s hook payloads, and never written to the
/// `events` table — statusLine reruns on nearly every assistant message, and
/// this is transient per-tab display state, not an append-only fact.
/// `model`/`rate_limits`/`context_window` are passed through opaquely so a field this server
/// doesn't know about still reaches the frontend, which owns display
/// validation (clamping, missing-field states, staleness).
fn emit_statusline(app: &AppHandle, payload: serde_json::Value, tab_id: Option<String>) {
    let Some(obj) = payload.as_object() else { return };
    let Some(session_id) = obj.get("session_id").and_then(|v| v.as_str()) else { return };
    let project_key = obj
        .get("workspace")
        .and_then(|w| w.get("current_dir"))
        .and_then(|v| v.as_str())
        .map(crate::pty::project_key);
    let mut out = serde_json::json!({
        "session_id": session_id,
        "model": obj.get("model").cloned().unwrap_or(serde_json::Value::Null),
        "rate_limits": obj.get("rate_limits").cloned().unwrap_or(serde_json::Value::Null),
        // Plan 054: context meter in the Idea Board bar.
        "context_window": obj.get("context_window").cloned().unwrap_or(serde_json::Value::Null),
    });
    if let Some(key) = project_key {
        out["project_key"] = key.into();
    }
    // Absent tether (statusLine invoked outside any Logic Loop tab) stays
    // absent — same fallback /event's tab_id handling already documents.
    if let Some(tab) = tab_id.filter(|t| !t.is_empty()) {
        out["tab_id"] = tab.into();
    }
    let _ = app.emit("ingest://statusline", out);
}

/// Tail a session's JSONL transcript from its current end, emitting new lines.
/// ponytail: threads poll every 500ms and live until app exit — fine for a
/// handful of sessions; switch to notify/kqueue if thread count ever matters.
fn is_subagent_lifecycle(payload: &serde_json::Value) -> bool {
    matches!(
        payload.get("hook_event_name").and_then(|v| v.as_str()),
        Some("SubagentStart" | "SubagentStop")
    )
}

fn ensure_tailer(app: &AppHandle, session_id: String, path: String) {
    use tauri::Manager;
    let registry = app.state::<TailerRegistry>();
    {
        let mut set = match registry.0.lock() {
            Ok(s) => s,
            Err(_) => return,
        };
        if !set.insert(session_id.clone()) {
            return;
        }
    }
    let app = app.clone();
    std::thread::spawn(move || {
        tail(&app, &session_id, &path);
        // Every exit path lands here — missing file, deleted file, seek error.
        // Dropping the registry entry lets the next hook re-arm the session;
        // leaving it meant one failed open silently blinded the session for the
        // life of the app, with no transcripts and so no decisions.
        if let Ok(mut set) = app.state::<TailerRegistry>().0.lock() {
            set.remove(&session_id);
        }
    });
}

/// Cross-platform (device/volume, file-id) pair used to detect a path being
/// replaced by a different underlying file (rename-over-path, atomic
/// rewrite) — length alone can't catch a same-size replacement, and an
/// already-open fd keeps reading the *old* file's bytes forever once that
/// happens, silently blinding the tailer to everything written after.
/// Takes an open handle, not `Metadata`: Windows identity is only
/// obtainable via a handle (`GetFileInformationByHandle`), not by path stat.
#[cfg(unix)]
fn file_identity(file: &fs::File) -> Option<(u64, u64)> {
    use std::os::unix::fs::MetadataExt;
    let meta = file.metadata().ok()?;
    Some((meta.dev(), meta.ino()))
}

/// `std::os::windows::fs::MetadataExt`'s `volume_serial_number()`/
/// `file_index()` would do this without a dependency, but both require the
/// unstable `windows_by_handle` feature (rust-lang/rust#63010) — confirmed
/// by a real Windows CI failure (Plan 032) when this first shipped using
/// them. `windows-sys` is Microsoft's own zero-transitive-dependency FFI
/// crate, so this is a native API call via `Cargo.toml`'s windows-only
/// dependency, not new app logic.
#[cfg(windows)]
fn file_identity(file: &fs::File) -> Option<(u64, u64)> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
    };
    let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
    let handle = file.as_raw_handle() as windows_sys::Win32::Foundation::HANDLE;
    // SAFETY: `handle` is a valid, open, live handle for the lifetime of this
    // call (borrowed from `file`, which outlives it); `info` is a properly
    // sized, zeroed out-parameter the call fills in. Returns 0 on failure.
    let ok = unsafe { GetFileInformationByHandle(handle, &mut info) };
    if ok == 0 {
        return None;
    }
    let file_index = ((info.nFileIndexHigh as u64) << 32) | info.nFileIndexLow as u64;
    Some((info.dwVolumeSerialNumber as u64, file_index))
}

#[cfg(not(any(unix, windows)))]
fn file_identity(_file: &fs::File) -> Option<(u64, u64)> {
    None
}

/// Byte-level incremental JSONL reader. `offset` is always the disk position
/// through which we've read (monotonic, never rewound except on truncation/
/// replacement); `pending` holds bytes read but not yet newline-terminated,
/// so a record split across polls (a write still in flight) is reassembled
/// instead of being emitted as a truncated fragment. Framing (this struct)
/// and semantic JSON parsing (the extractor) are deliberately separate.
struct TranscriptReader {
    file: fs::File,
    offset: u64,
    pending: Vec<u8>,
    identity: Option<(u64, u64)>,
}

/// Cap a single unterminated record: a transcript line this large is not a
/// slow write in progress, it's a different framing (or a corrupt/foreign
/// file) — drop the fragment rather than buffer it forever.
const MAX_PENDING_BYTES: usize = 4 * 1024 * 1024;

enum TailOutcome {
    Records(Vec<String>),
    Gone,
}

impl TranscriptReader {
    /// Open fresh and seek to the current end — only newly appended content
    /// is tailed, matching prior behavior.
    fn open(path: &Path) -> std::io::Result<Self> {
        let mut file = fs::File::open(path)?;
        let offset = file.seek(SeekFrom::End(0))?;
        let identity = file_identity(&file);
        Ok(Self { file, offset, pending: Vec::new(), identity })
    }

    /// Re-derive complete records from the current on-disk state. Returns
    /// `Gone` when the path can no longer be opened (live delete) so the
    /// caller can emit the same failure signal as a missing initial open.
    /// Opens a fresh handle on the path every poll purely to check identity
    /// — Windows can only get a file-id from a handle, not a path stat —
    /// and reuses that same open to double as the "is it still there" and
    /// "how big is it now" check, replacing three separate path-based calls
    /// the original version needed.
    fn poll(&mut self, path: &Path) -> TailOutcome {
        let Ok(probe) = fs::File::open(path) else {
            return TailOutcome::Gone;
        };
        let Ok(meta) = probe.metadata() else {
            return TailOutcome::Gone;
        };
        let identity = file_identity(&probe);
        // Identity known and changed: the path now points at a different
        // file. Switch to it and drop any partial fragment from the old
        // file — it belongs to content that's gone, not to this one.
        if identity.is_some() && identity != self.identity {
            self.file = probe;
            self.offset = 0;
            self.pending.clear();
            self.identity = identity;
        } else if meta.len() < self.offset {
            // Same file, shrunk in place (truncated/rotated) — re-read from
            // the start; a stale fragment from the old tail is meaningless.
            self.offset = 0;
            self.pending.clear();
        }
        if meta.len() <= self.offset {
            return TailOutcome::Records(Vec::new());
        }
        if self.file.seek(SeekFrom::Start(self.offset)).is_err() {
            return TailOutcome::Gone;
        }
        let mut buf = Vec::new();
        if self.file.read_to_end(&mut buf).is_err() {
            return TailOutcome::Gone;
        }
        self.offset += buf.len() as u64;
        self.pending.extend_from_slice(&buf);

        let mut records = Vec::new();
        while let Some(pos) = self.pending.iter().position(|&b| b == b'\n') {
            let record: Vec<u8> = self.pending.drain(..=pos).collect();
            let text = String::from_utf8_lossy(&record[..record.len() - 1]);
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                records.push(trimmed.to_string());
            }
        }
        if self.pending.len() > MAX_PENDING_BYTES {
            self.pending.clear();
        }
        TailOutcome::Records(records)
    }
}

/// The tail loop proper. Returning means "stop tailing"; the caller
/// de-registers so a later hook can start it again.
fn tail(app: &AppHandle, session_id: &str, path: &str) {
    let Ok(mut reader) = TranscriptReader::open(Path::new(path)) else {
        // Claude Code can report a transcript_path it has not created. That is
        // invisible without this — the session keeps sending hooks and the
        // panels just stay empty.
        let _ = app.emit(
            "ingest://tailer-failed",
            serde_json::json!({ "session_id": session_id, "path": path }),
        );
        return;
    };
    loop {
        std::thread::sleep(std::time::Duration::from_millis(500));
        match reader.poll(Path::new(path)) {
            TailOutcome::Gone => {
                let _ = app.emit(
                    "ingest://tailer-failed",
                    serde_json::json!({ "session_id": session_id, "path": path }),
                );
                return;
            }
            TailOutcome::Records(records) => {
                for line in records {
                    let _ = app.emit(
                        "ingest://transcript",
                        serde_json::json!({ "session_id": session_id, "line": line }),
                    );
                }
            }
        }
    }
}

/// Payload shape version. Bump when the emitted payload changes in a way a
/// reader must know about; `apply_setup` rewrites installed entries in place.
const HOOK_VERSION: u32 = 1;

/// Headers, not JSON: this is a one-line `sh -c` piping Claude Code's stdin
/// straight to curl, and assembling JSON in sh is how quoting bugs happen.
/// `$LOGIC_LOOP_TAB_ID` comes from the PTY env (see `pty_spawn`) and is empty
/// for sessions started outside the app — the frontend then falls back to cwd.
pub(crate) fn hook_command() -> String {
    hook_command_with_agent(None)
}

/// Adapter identity marker, sent as a header (never JSON body — an adapter's
/// stdin is piped through this command unmodified). `agent` is always a
/// fixed Rust-selected constant, never adapter-controlled input. Recognized
/// values are the `RECOGNIZED_AGENTS` allowlist below; an unrecognized or
/// absent header stays absent in the normalized payload rather than being
/// guessed as Claude.
pub(crate) fn hook_command_with_agent(agent: Option<&'static str>) -> String {
    let agent_header = agent
        .map(|a| format!(" -H \"X-Logic-Loop-Agent: {a}\""))
        .unwrap_or_default();
    format!(
        "sh -c '. \"$HOME/.{MARKER}\" 2>/dev/null && curl -sf -m 2 -H \"Authorization: Bearer $CT_TOKEN\" -H \"X-Logic-Loop-Tab: $LOGIC_LOOP_TAB_ID\" -H \"X-Logic-Loop-Hook: {HOOK_VERSION}\"{agent_header} --data-binary @- \"http://127.0.0.1:$CT_PORT/event\" >/dev/null 2>&1; exit 0'"
    )
}

/// Adapter identity is an ingestion-origin marker (which adapter's hook sent
/// this event), distinct from Codex's own `agent_id` payload field (which
/// identifies a *subagent* within a Codex session and is used by
/// `stateForHook` to avoid driving the parent tab's state). Extend this list
/// when a future adapter plan wires up its own marker.
const RECOGNIZED_AGENTS: [&str; 5] = ["codex", "opencode", "antigravity", "pi", "deepseek"];

/// An unrecognized or absent header must stay absent rather than being
/// guessed as Claude — pulled out as a pure function so the allowlist
/// behavior is unit-testable without a live HTTP request.
fn recognized_agent(header: Option<&str>) -> Option<&str> {
    header.filter(|a| RECOGNIZED_AGENTS.contains(a))
}

/// Only adapters whose in-process message reducers have a live-verified
/// synthetic transcript contract may bypass file tailing.
fn accepts_synthetic_transcript(agent: Option<&str>) -> bool {
    matches!(agent, Some("opencode" | "pi" | "deepseek"))
}

/// `PostToolUseFailure` (Plan 053) is Claude Code's separate hook for failed
/// tool calls; detectors scan only its `error` text, never successful output.
///
/// `PreToolUse` (Plan 055) is matched to `AskUserQuestion` only: Claude's
/// multiple-choice prompt is a tool call, so this is the one moment the open
/// question exists as structured data. Prints nothing, exits 0 — never a
/// permission decision.
///
/// `SubagentStart`/`SubagentStop` (Plan 059) feed the active-subagent badge
/// only; the frontend persists them and returns before any parent mutation.
const HOOK_EVENTS: [&str; 9] = [
    "Notification",
    "Stop",
    "PostToolUse",
    "PostToolUseFailure",
    "UserPromptSubmit",
    "SessionStart",
    "PreToolUse",
    "SubagentStart",
    "SubagentStop",
];

fn is_ours(entry: &serde_json::Value) -> bool {
    entry["hooks"]
        .as_array()
        .is_some_and(|hs| {
            hs.iter()
                .any(|h| h["command"].as_str().is_some_and(|c| c.contains(MARKER)))
        })
}

pub(crate) fn read_settings() -> Result<serde_json::Value, String> {
    read_json_at(&settings_path())
}

pub(crate) fn write_settings(v: &serde_json::Value) -> Result<(), String> {
    write_json_at(&settings_path(), v)
}

pub(crate) fn read_json_at(path: &Path) -> Result<serde_json::Value, String> {
    match fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| format!("{} is not valid JSON: {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::json!({})),
        Err(e) => Err(e.to_string()),
    }
}

pub(crate) fn write_json_at(path: &Path, v: &serde_json::Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let pretty = serde_json::to_string_pretty(v).map_err(|e| e.to_string())?;
    fs::write(path, pretty + "\n").map_err(|e| e.to_string())
}

fn strip_ours(settings: &mut serde_json::Value) {
    let Some(hooks) = settings.get_mut("hooks").and_then(|h| h.as_object_mut()) else {
        return;
    };
    for event in HOOK_EVENTS {
        if let Some(arr) = hooks.get_mut(event).and_then(|v| v.as_array_mut()) {
            arr.retain(|e| !is_ours(e));
        }
    }
    hooks.retain(|_, v| v.as_array().is_none_or(|a| !a.is_empty()));
}

fn apply_setup(settings: &mut serde_json::Value) -> Result<(), String> {
    strip_ours(settings);
    if !settings.get("hooks").is_some_and(|h| h.is_object()) {
        settings["hooks"] = serde_json::json!({});
    }
    let hooks = settings["hooks"].as_object_mut().ok_or("hooks not an object")?;
    for event in HOOK_EVENTS {
        let mut entry = serde_json::json!({
            "hooks": [{ "type": "command", "command": hook_command() }]
        });
        if event == "PostToolUse" {
            entry["matcher"] = "*".into();
        } else if event == "PostToolUseFailure" {
            entry["matcher"] = "Bash".into();
        } else if event == "PreToolUse" {
            entry["matcher"] = "AskUserQuestion".into();
        }
        hooks
            .entry(event)
            .or_insert_with(|| serde_json::json!([]))
            .as_array_mut()
            .ok_or_else(|| format!("hooks.{event} is not an array"))?
            .push(entry);
    }
    Ok(())
}

fn is_executable(candidate: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::metadata(candidate).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
    }
    #[cfg(not(unix))]
    {
        candidate.is_file()
    }
}

fn claude_candidates(home: &Path) -> [PathBuf; 4] {
    [
        home.join(".local/bin/claude"),
        home.join("homebrew/bin/claude"),
        PathBuf::from("/opt/homebrew/bin/claude"),
        PathBuf::from("/usr/local/bin/claude"),
    ]
}

#[tauri::command]
pub fn claude_detect() -> bool {
    let path_hit = std::env::var("PATH").is_ok_and(|path_var| {
        std::env::split_paths(&path_var).any(|dir| is_executable(&dir.join("claude")))
    });
    path_hit
        || claude_candidates(&PathBuf::from(home_or_tmp()))
            .iter()
            .any(|candidate| is_executable(candidate))
}

#[tauri::command]
pub fn hooks_setup() -> Result<(), String> {
    let path = claude_target_path();
    let mut settings = read_json_at(&path)?;
    apply_setup(&mut settings)?;
    write_json_at(&path, &settings)
}

#[tauri::command]
pub fn hooks_remove() -> Result<(), String> {
    let path = claude_target_path();
    let mut settings = read_json_at(&path)?;
    strip_ours(&mut settings);
    write_json_at(&path, &settings)
}

/// "off" = none of ours, "on" = ours on every `HOOK_EVENTS` event, "partial" =
/// ours on some but not all (an install from before an event was added; the
/// UI offers Update, which re-runs the idempotent `hooks_setup`).
fn hooks_state(settings: &serde_json::Value) -> &'static str {
    let has_ours = |event: &str| {
        settings["hooks"][event].as_array().is_some_and(|a| a.iter().any(is_ours))
    };
    let present = HOOK_EVENTS.iter().filter(|e| has_ours(e)).count();
    match present {
        0 => "off",
        n if n == HOOK_EVENTS.len() => "on",
        _ => "partial",
    }
}

#[tauri::command]
pub fn hooks_status() -> Result<&'static str, String> {
    Ok(hooks_state(&read_json_at(&claude_target_path())?))
}

/// Moves our hooks from one settings value to another, only if any are
/// installed — an untouched source stays byte-identical (no strip, no
/// empty-array cleanup of the user's own entries).
fn move_hooks(from: &mut serde_json::Value, to: &mut serde_json::Value) -> Result<(), String> {
    if hooks_state(from) == "off" {
        return Ok(());
    }
    strip_ours(from);
    apply_setup(to)
}

#[tauri::command]
pub fn claude_hooks_mode() -> &'static str {
    if tab_settings_path().exists() {
        "tabs"
    } else {
        "global"
    }
}

/// Plan 055: switch where Logic Loop's Claude entries live, carrying whatever
/// is installed (hooks, statusLine wrapper) across. `~/.claude/settings.json`
/// is written only when it actually changes — removing our own entries on the
/// way to tab-only, or adding them back on the way to global.
#[tauri::command]
pub fn claude_hooks_mode_set(mode: String) -> Result<(), String> {
    let to_tabs = match mode.as_str() {
        "tabs" => true,
        "global" => false,
        _ => return Err(format!("unknown mode: {mode}")),
    };
    let tab_path = tab_settings_path();
    if to_tabs == tab_path.exists() {
        return Ok(());
    }
    let mut global = read_settings()?;
    let before = global.clone();
    let mut tab = read_json_at(&tab_path)?;
    if to_tabs {
        move_hooks(&mut global, &mut tab)?;
    } else {
        move_hooks(&mut tab, &mut global)?;
    }
    crate::statusline::move_install(&mut global, &mut tab, to_tabs)?;
    if global != before {
        write_settings(&global)?;
    }
    if to_tabs {
        write_json_at(&tab_path, &tab)
    } else {
        fs::remove_file(&tab_path).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// A fresh, collision-safe path for each test — tests run in parallel and
    /// share `temp_dir()`.
    fn temp_path(label: &str) -> PathBuf {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "logic-loop-test-{}-{}-{}.jsonl",
            std::process::id(),
            label,
            n
        ))
    }

    fn write_new(path: &Path, contents: &[u8]) {
        let mut f = fs::File::create(path).unwrap();
        f.write_all(contents).unwrap();
    }

    fn append(path: &Path, contents: &[u8]) {
        let mut f = fs::OpenOptions::new().append(true).open(path).unwrap();
        f.write_all(contents).unwrap();
    }

    #[test]
    fn surviving_instance_reclaims_dead_endpoint_after_two_checks() {
        let dir = temp_path("endpoint-recovery");
        fs::create_dir(&dir).unwrap();
        let stale = format!("CT_PORT=1\nCT_TOKEN={}\n", "a".repeat(64));
        fs::write(dir.join("ingest.env"), &stale).unwrap();
        let mut failed = None;
        let own_token = "b".repeat(64);

        repair_endpoint_if_stale(&dir, 42424, &own_token, &mut failed);
        assert_eq!(fs::read_to_string(dir.join("ingest.env")).unwrap(), stale);
        repair_endpoint_if_stale(&dir, 42424, &own_token, &mut failed);
        assert_eq!(
            fs::read_to_string(dir.join("ingest.env")).unwrap(),
            format!("CT_PORT=42424\nCT_TOKEN={own_token}\n")
        );

        fs::remove_file(dir.join("ingest.env")).unwrap();
        fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn surviving_instance_keeps_another_live_endpoint() {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let port = server.server_addr().to_ip().unwrap().port();
        let token = "c".repeat(64);
        let dir = temp_path("endpoint-live");
        write_endpoint(&dir, port, &token).unwrap();
        let other = fs::read_to_string(dir.join("ingest.env")).unwrap();
        let responder = std::thread::spawn(move || {
            let request = server.recv_timeout(Duration::from_secs(2)).unwrap().unwrap();
            assert_eq!(request.url(), "/health");
            assert!(request.headers().iter().any(|header| {
                header.field.equiv("Authorization")
                    && header.value.as_str() == format!("Bearer {token}")
            }));
            request.respond(tiny_http::Response::empty(204)).unwrap();
        });

        let mut failed = None;
        repair_endpoint_if_stale(&dir, 42424, &"d".repeat(64), &mut failed);
        responder.join().unwrap();
        assert_eq!(fs::read_to_string(dir.join("ingest.env")).unwrap(), other);
        assert!(failed.is_none());

        fs::remove_file(dir.join("ingest.env")).unwrap();
        fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn split_write_across_polls_reassembles_record() {
        let path = temp_path("split");
        write_new(&path, b"");
        let mut reader = TranscriptReader::open(&path).unwrap();

        append(&path, b"{\"partial\":");
        let TailOutcome::Records(recs) = reader.poll(&path) else { panic!("gone") };
        assert!(recs.is_empty(), "must not emit an unterminated fragment");

        append(&path, b"true}\n");
        let TailOutcome::Records(recs) = reader.poll(&path) else { panic!("gone") };
        assert_eq!(recs, vec!["{\"partial\":true}".to_string()]);

        fs::remove_file(&path).ok();
    }

    #[test]
    fn multiple_records_plus_trailing_partial_in_one_write() {
        let path = temp_path("multi");
        write_new(&path, b"");
        let mut reader = TranscriptReader::open(&path).unwrap();

        append(&path, b"A\nB\npartial");
        let TailOutcome::Records(recs) = reader.poll(&path) else { panic!("gone") };
        assert_eq!(recs, vec!["A".to_string(), "B".to_string()]);

        append(&path, b"\n");
        let TailOutcome::Records(recs) = reader.poll(&path) else { panic!("gone") };
        assert_eq!(recs, vec!["partial".to_string()]);

        fs::remove_file(&path).ok();
    }

    #[test]
    fn crlf_and_blank_lines_are_trimmed_and_skipped() {
        let path = temp_path("crlf");
        write_new(&path, b"");
        let mut reader = TranscriptReader::open(&path).unwrap();

        append(&path, b"foo\r\n\r\n   \nbar\r\n");
        let TailOutcome::Records(recs) = reader.poll(&path) else { panic!("gone") };
        assert_eq!(recs, vec!["foo".to_string(), "bar".to_string()]);

        fs::remove_file(&path).ok();
    }

    #[test]
    fn truncation_in_place_rereads_from_start() {
        let path = temp_path("truncate");
        write_new(&path, b"old-line\n");
        let mut reader = TranscriptReader::open(&path).unwrap();
        // Consume nothing yet (opened at end) — now shrink the same inode.
        write_new(&path, b"new\n");
        let TailOutcome::Records(recs) = reader.poll(&path) else { panic!("gone") };
        assert_eq!(recs, vec!["new".to_string()]);

        fs::remove_file(&path).ok();
    }

    #[test]
    fn replacement_with_a_new_inode_reopens_and_drops_stale_partial() {
        let path = temp_path("replace");
        write_new(&path, b"");
        let mut reader = TranscriptReader::open(&path).unwrap();

        // Leave an unterminated fragment from the "old" file.
        append(&path, b"stale-partial-no-newline");
        let TailOutcome::Records(recs) = reader.poll(&path) else { panic!("gone") };
        assert!(recs.is_empty());

        // Replace the path with a brand new file (new inode on Unix/Windows).
        fs::remove_file(&path).unwrap();
        write_new(&path, b"fresh\n");
        let TailOutcome::Records(recs) = reader.poll(&path) else { panic!("gone") };
        assert_eq!(
            recs,
            vec!["fresh".to_string()],
            "must read the new file's content, not a mix with the old fd's stale bytes"
        );

        fs::remove_file(&path).ok();
    }

    #[test]
    fn oversized_unterminated_record_is_dropped_not_buffered_forever() {
        let path = temp_path("oversized");
        write_new(&path, b"");
        let mut reader = TranscriptReader::open(&path).unwrap();

        let huge = vec![b'x'; MAX_PENDING_BYTES + 10];
        append(&path, &huge);
        let TailOutcome::Records(recs) = reader.poll(&path) else { panic!("gone") };
        assert!(recs.is_empty());

        append(&path, b"ok\n");
        let TailOutcome::Records(recs) = reader.poll(&path) else { panic!("gone") };
        assert_eq!(
            recs,
            vec!["ok".to_string()],
            "pending must have been reset, not grown into one giant garbled record"
        );

        fs::remove_file(&path).ok();
    }

    #[test]
    fn poll_on_a_deleted_path_reports_gone() {
        let path = temp_path("deleted");
        write_new(&path, b"");
        let mut reader = TranscriptReader::open(&path).unwrap();
        fs::remove_file(&path).unwrap();
        assert!(matches!(reader.poll(&path), TailOutcome::Gone));
    }

    fn foreign_settings() -> serde_json::Value {
        serde_json::json!({
            "model": "opus",
            "hooks": {
                "Stop": [{ "hooks": [{ "type": "command", "command": "echo user-owned" }] }],
                "SessionStart": [{ "hooks": [{ "type": "command", "command": "caveman-mode" }] }]
            }
        })
    }

    #[test]
    fn tether_split_and_launch_verdicts() {
        let s = |h: &str| split_tether(Some(h.to_string()));
        assert_eq!(s("tab-a"), (Some("tab-a".into()), None));
        assert_eq!(s("tab-a:abc"), (Some("tab-a".into()), Some("abc".into())));
        assert_eq!(s("tab-a:x:y"), (Some("tab-a".into()), Some("x:y".into())), "double wrap stays one bad id");
        assert_eq!(split_tether(None), (None, None));
        assert_eq!(s(EXTRACTOR_TETHER).0.as_deref(), Some(EXTRACTOR_TETHER), "extractor check still matches");

        let reg = crate::launch::LaunchRegistry::default();
        reg.pty_opened(1, "tab-a");
        let id = "0123456789abcdef";
        assert!(reg.register("tab-a", 1, id));
        assert_eq!(launch_verdict(&reg, "tab-a", None), "none");
        assert_eq!(launch_verdict(&reg, "tab-a", Some(id)), "current");
        assert_eq!(launch_verdict(&reg, "tab-b", Some(id)), "unknown");
        assert_eq!(launch_verdict(&reg, "tab-a", Some("x:y")), "unknown");
        reg.pty_closed(1);
        assert_eq!(launch_verdict(&reg, "tab-a", Some(id)), "retired");
    }

    #[test]
    fn launch_endpoint_registers_retires_and_rejects() {
        let reg = crate::launch::LaunchRegistry::default();
        reg.pty_opened(3, "tab-a");
        let id = "0123456789abcdef";
        let body = |tab: &str, pty: &str| format!(r#"{{"tab_id":"{tab}","pty_gen":{pty},"launch_id":"{id}"}}"#);
        assert_eq!(launch_request(&reg, "/launch", "not json"), 400);
        assert_eq!(launch_request(&reg, "/launch", r#"{"tab_id":"tab-a","pty_gen":3}"#), 400);
        assert_eq!(launch_request(&reg, "/launch", &body("tab-b", "3")), 409, "wrong tab");
        assert_eq!(launch_request(&reg, "/launch", &body("tab-a", "4")), 409, "dead pty");
        assert_eq!(launch_request(&reg, "/launch", &body("tab-a", "\"3\"")), 204, "string pty_gen from the shell");
        assert_eq!(reg.verdict("tab-a", id), crate::launch::Verdict::Current);
        assert_eq!(launch_request(&reg, "/launch/end", &format!(r#"{{"launch_id":"{id}"}}"#)), 204);
        assert_eq!(reg.verdict("tab-a", id), crate::launch::Verdict::Retired);
        assert_eq!(launch_request(&reg, "/launchpad", &body("tab-a", "3")), 404);
    }

    #[test]
    fn hook_command_carries_the_contract_version_and_tether() {
        let cmd = hook_command();
        assert!(cmd.contains(&format!("X-Logic-Loop-Hook: {HOOK_VERSION}")), "{cmd}");
        assert!(cmd.contains("X-Logic-Loop-Tab: $LOGIC_LOOP_TAB_ID"), "{cmd}");
    }

    #[test]
    fn default_hook_command_carries_no_agent_marker() {
        assert!(!hook_command().contains("X-Logic-Loop-Agent"));
        assert_eq!(hook_command(), hook_command_with_agent(None));
    }

    #[test]
    fn claude_candidates_cover_gui_app_install_locations() {
        let home = Path::new("/example/home");
        assert_eq!(
            claude_candidates(home),
            [
                PathBuf::from("/example/home/.local/bin/claude"),
                PathBuf::from("/example/home/homebrew/bin/claude"),
                PathBuf::from("/opt/homebrew/bin/claude"),
                PathBuf::from("/usr/local/bin/claude"),
            ]
        );
    }

    #[test]
    fn agent_marked_command_carries_the_marker_and_is_otherwise_identical() {
        let marked = hook_command_with_agent(Some("codex"));
        assert!(marked.contains("X-Logic-Loop-Agent: codex"), "{marked}");
        assert_eq!(
            marked.replace(" -H \"X-Logic-Loop-Agent: codex\"", ""),
            hook_command(),
            "agent header must be the only difference from the default command"
        );
    }

    #[test]
    fn setup_is_idempotent_and_preserves_foreign_hooks() {
        let mut s = foreign_settings();
        apply_setup(&mut s).unwrap();
        let once = s.clone();
        apply_setup(&mut s).unwrap();
        assert_eq!(s, once, "second setup must not duplicate entries");
        // foreign hooks untouched
        assert_eq!(s["hooks"]["Stop"][0]["hooks"][0]["command"], "echo user-owned");
        assert_eq!(s["hooks"]["SessionStart"][0]["hooks"][0]["command"], "caveman-mode");
        assert_eq!(s["model"], "opus");
        // ours present on every event
        for ev in HOOK_EVENTS {
            assert!(s["hooks"][ev].as_array().unwrap().iter().any(is_ours), "{ev} missing");
        }
        assert_eq!(s["hooks"]["Stop"].as_array().unwrap().len(), 2);
        assert_eq!(s["hooks"]["SessionStart"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn failure_hook_registers_with_bash_matcher_and_only_ours() {
        let mut s = foreign_settings();
        apply_setup(&mut s).unwrap();
        assert_eq!(s["hooks"]["PostToolUseFailure"].as_array().unwrap().len(), 1);
        assert_eq!(s["hooks"]["PostToolUseFailure"][0]["matcher"], "Bash");
        assert_eq!(s["hooks"]["PostToolUse"][0]["matcher"], "*");
    }

    #[test]
    fn hooks_state_reports_off_partial_on_and_update_fixes_partial() {
        let mut s = foreign_settings();
        assert_eq!(hooks_state(&s), "off");
        apply_setup(&mut s).unwrap();
        assert_eq!(hooks_state(&s), "on");
        // Old 5-event install: ours everywhere except PostToolUseFailure.
        s["hooks"].as_object_mut().unwrap().remove("PostToolUseFailure");
        assert_eq!(hooks_state(&s), "partial");
        apply_setup(&mut s).unwrap();
        assert_eq!(hooks_state(&s), "on");
        for ev in HOOK_EVENTS {
            let n = s["hooks"][ev].as_array().unwrap().iter().filter(|e| is_ours(e)).count();
            assert_eq!(n, 1, "{ev}: exactly one of ours after update");
        }
        assert_eq!(s["hooks"]["Stop"][0]["hooks"][0]["command"], "echo user-owned");
    }

    #[test]
    fn ask_user_question_hook_registers_with_its_own_matcher() {
        let mut s = foreign_settings();
        apply_setup(&mut s).unwrap();
        assert_eq!(s["hooks"]["PreToolUse"].as_array().unwrap().len(), 1);
        assert_eq!(s["hooks"]["PreToolUse"][0]["matcher"], "AskUserQuestion");
        // A 6-event install (before Plan 055) reads as partial → Update.
        s["hooks"].as_object_mut().unwrap().remove("PreToolUse");
        assert_eq!(hooks_state(&s), "partial");
    }

    /// Plan 055: mode switches move only our entries; a global file with
    /// nothing of ours is left exactly as it was.
    #[test]
    fn move_hooks_round_trips_and_leaves_untouched_sources_alone() {
        let orig = foreign_settings();
        let mut global = orig.clone();
        apply_setup(&mut global).unwrap();
        let mut tab = serde_json::json!({});
        move_hooks(&mut global, &mut tab).unwrap();
        assert_eq!(hooks_state(&global), "off");
        assert_eq!(hooks_state(&tab), "on");
        assert_eq!(global, orig, "global back to its pre-setup content");
        move_hooks(&mut tab, &mut global).unwrap();
        assert_eq!(hooks_state(&global), "on");
        assert_eq!(hooks_state(&tab), "off");

        let mut untouched = serde_json::json!({ "hooks": { "Stop": [] }, "model": "opus" });
        let before = untouched.clone();
        let mut tab = serde_json::json!({});
        move_hooks(&mut untouched, &mut tab).unwrap();
        assert_eq!(untouched, before, "no install → no strip, empty arrays kept");
        assert_eq!(tab, serde_json::json!({}));
    }

    #[test]
    fn remove_restores_original() {
        let orig = foreign_settings();
        let mut s = orig.clone();
        apply_setup(&mut s).unwrap();
        strip_ours(&mut s);
        assert_eq!(s, orig, "remove must restore pre-setup settings exactly");
    }

    #[test]
    fn setup_on_empty_settings() {
        let mut s = serde_json::json!({});
        apply_setup(&mut s).unwrap();
        assert!(s["hooks"]["PostToolUse"][0]["matcher"] == "*");
        strip_ours(&mut s);
        assert_eq!(s, serde_json::json!({ "hooks": {} }));
    }

    #[test]
    fn recognized_agent_accepts_only_the_allowlist() {
        assert_eq!(recognized_agent(Some("codex")), Some("codex"));
        assert_eq!(recognized_agent(Some("opencode")), Some("opencode"));
        assert_eq!(recognized_agent(Some("antigravity")), Some("antigravity"));
        assert_eq!(recognized_agent(Some("pi")), Some("pi"));
        assert_eq!(recognized_agent(Some("deepseek")), Some("deepseek"));
        assert_eq!(recognized_agent(Some("claude")), None);
        assert_eq!(recognized_agent(Some("")), None);
        assert_eq!(recognized_agent(None), None);
    }

    #[test]
    fn synthetic_transcripts_accept_only_verified_adapters() {
        assert!(accepts_synthetic_transcript(Some("opencode")));
        assert!(accepts_synthetic_transcript(Some("pi")));
        assert!(!accepts_synthetic_transcript(Some("codex")));
        assert!(!accepts_synthetic_transcript(Some("antigravity")));
        assert!(accepts_synthetic_transcript(Some("deepseek")));
        assert!(!accepts_synthetic_transcript(Some("claude")));
        assert!(!accepts_synthetic_transcript(None));
    }

    #[test]
    fn transcript_paths_are_agent_scoped() {
        assert!(is_transcript_path(
            "/Users/x/.claude/projects/-foo/abc-123.jsonl",
            None
        ));
        let rollout =
            "/Users/x/.codex/sessions/2026/08/27/rollout-2026-08-27T06-10-13-abc.jsonl";
        assert!(is_codex_rollout_path(
            std::path::Path::new(rollout),
            std::path::Path::new("/Users/x")
        ));
        assert!(!is_transcript_path(rollout, None));
        assert!(!is_transcript_path(rollout, Some("antigravity")));
        // Pi is a recognized agent but must never be tailed as a transcript
        // source — its extension POSTs structured events directly, no file.
        assert!(!is_transcript_path(rollout, Some("pi")));
        // Same for deepseek — dsh-terminal-app's own ctx.on("session/event")
        // observer POSTs directly, no transcript file exists to tail.
        assert!(!is_transcript_path(rollout, Some("deepseek")));
        assert!(!is_codex_rollout_path(
            std::path::Path::new("/Users/x/.codex/sessions/2026/08/27/events.jsonl"),
            std::path::Path::new("/Users/x")
        ));
        assert!(!is_codex_rollout_path(
            std::path::Path::new(
                "/Users/x/.codex/sessions/2026/8/27/rollout-2026-08-27T06-10-13-abc.jsonl"
            ),
            std::path::Path::new("/Users/x")
        ));
        assert!(!is_codex_rollout_path(
            std::path::Path::new(
                "/Users/x/.codex/sessions/2026/08/27/rollout-2026-08-27T06-10-13-abc.txt"
            ),
            std::path::Path::new("/Users/x")
        ));
        assert!(!is_codex_rollout_path(
            std::path::Path::new(
                "/Users/other/.codex/sessions/2026/08/27/rollout-2026-08-27T06-10-13-abc.jsonl"
            ),
            std::path::Path::new("/Users/x")
        ));
        assert!(!is_transcript_path("", None));
    }

    #[test]
    fn antigravity_transcript_path_is_structurally_scoped() {
        let home = Path::new("test-home");
        let brain = home.join(".gemini/antigravity-cli/brain");
        let session = brain.join("session-123");
        let valid = session.join(".system_generated/logs/transcript_full.jsonl");
        assert!(is_antigravity_transcript_path(&valid, home));
        for invalid in [
            session.join(".system_generated/logs/transcript.jsonl"),
            session.join("logs/transcript_full.jsonl"),
            session.join(".system_generated/logs/extra/transcript_full.jsonl"),
            session.join("../session-456/.system_generated/logs/transcript_full.jsonl"),
            brain.join(".system_generated/logs/transcript_full.jsonl"),
            home.join(".gemini/antigravity-cli/other/session-123/.system_generated/logs/transcript_full.jsonl"),
            Path::new("other-home").join(".gemini/antigravity-cli/brain/session-123/.system_generated/logs/transcript_full.jsonl"),
        ] {
            assert!(!is_antigravity_transcript_path(&invalid, home), "{}", invalid.display());
        }
        let _env_guard = crate::home::lock_env();
        let actual_home = crate::home::home().unwrap();
        let actual_path = Path::new(&actual_home)
            .join(".gemini/antigravity-cli/brain/session-123/.system_generated/logs/transcript_full.jsonl");
        let actual_path = actual_path.to_str().unwrap();
        assert!(is_transcript_path(actual_path, Some("antigravity")));
        assert!(!is_transcript_path(actual_path, Some("codex")));
        assert!(!is_transcript_path(actual_path, None));
        assert!(!is_transcript_path(actual_path, Some("pi")));
    }
}
