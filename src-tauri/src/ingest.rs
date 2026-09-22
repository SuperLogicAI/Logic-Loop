use crate::home::home_or_tmp;
use std::collections::HashSet;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

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

/// Sessions with an active transcript tailer.
#[derive(Default)]
pub struct TailerRegistry(Mutex<HashSet<String>>);

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
    let env_file = dir.join("ingest.env");
    let write_env = || -> std::io::Result<()> {
        fs::create_dir_all(&dir)?;
        fs::write(&env_file, format!("CT_PORT={port}\nCT_TOKEN={token}\n"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))?;
            fs::set_permissions(&env_file, fs::Permissions::from_mode(0o600))?;
        }
        Ok(())
    };
    if let Err(e) = write_env() {
        eprintln!("ingest: cannot write ingest.env: {e}");
        return;
    }

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
            // Headers must be read before `as_reader` borrows the request.
            let tab_id = header_value(&request, "X-Logic-Loop-Tab");
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
                // OpenCode has no transcript file to tail (Plan 038 Part 1):
                // its in-process plugin assembles a completed message's text
                // itself and posts it here as a synthetic transcript line,
                // reusing the exact `ingest://transcript` path the real file
                // tailer already feeds into `decisions.onTranscript` — no
                // separate extraction pipeline needed. Scoped to the
                // `opencode` agent marker specifically, not any payload
                // claiming this event name, matching `is_transcript_path`'s
                // own per-agent scoping discipline one block below.
                if payload.get("hook_event_name").and_then(|v| v.as_str()) == Some("TranscriptLine")
                    && recognized_agent(agent_header.as_deref()) == Some("opencode")
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
                if let Some(path) = payload.get("transcript_path").and_then(|v| v.as_str()) {
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
        Some(_) => false,
    }
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
/// `model`/`rate_limits` are passed through opaquely so a field this server
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

const HOOK_EVENTS: [&str; 5] =
    ["Notification", "Stop", "PostToolUse", "UserPromptSubmit", "SessionStart"];

fn is_ours(entry: &serde_json::Value) -> bool {
    entry["hooks"]
        .as_array()
        .is_some_and(|hs| {
            hs.iter()
                .any(|h| h["command"].as_str().is_some_and(|c| c.contains(MARKER)))
        })
}

pub(crate) fn read_settings() -> Result<serde_json::Value, String> {
    match fs::read_to_string(settings_path()) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| format!("settings.json is not valid JSON: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::json!({})),
        Err(e) => Err(e.to_string()),
    }
}

pub(crate) fn write_settings(v: &serde_json::Value) -> Result<(), String> {
    let path = settings_path();
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
    let mut settings = read_settings()?;
    apply_setup(&mut settings)?;
    write_settings(&settings)
}

#[tauri::command]
pub fn hooks_remove() -> Result<(), String> {
    let mut settings = read_settings()?;
    strip_ours(&mut settings);
    write_settings(&settings)
}

#[tauri::command]
pub fn hooks_status() -> Result<bool, String> {
    let settings = read_settings()?;
    let Some(hooks) = settings.get("hooks").and_then(|h| h.as_object()) else {
        return Ok(false);
    };
    Ok(hooks
        .values()
        .filter_map(|v| v.as_array())
        .flatten()
        .any(is_ours))
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
        // ours present on all four events
        for ev in HOOK_EVENTS {
            assert!(s["hooks"][ev].as_array().unwrap().iter().any(is_ours), "{ev} missing");
        }
        assert_eq!(s["hooks"]["Stop"].as_array().unwrap().len(), 2);
        assert_eq!(s["hooks"]["SessionStart"].as_array().unwrap().len(), 2);
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
}
