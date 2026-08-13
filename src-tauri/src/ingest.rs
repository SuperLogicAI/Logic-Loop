use std::collections::HashSet;
use std::fs;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

const MARKER: &str = "context-terminal/ingest.env";

/// Tether value stamped on the app's own `claude -p` extractor children. Those
/// children inherit the user's hooks and post back here, so without this the app
/// ingests its own extraction runs: they key on the app's cwd (`/`), bind to
/// whatever tab is active, overwrite its cwd, and their transcripts feed the
/// extractor again — a self-amplifying loop. Dropped at the door.
pub const EXTRACTOR_TETHER: &str = "__logic_loop_extractor__";

fn home() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/tmp".into())
}

fn config_dir() -> PathBuf {
    PathBuf::from(home()).join(".context-terminal")
}

fn settings_path() -> PathBuf {
    PathBuf::from(home()).join(".claude/settings.json")
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
            let hook_version = header_value(&request, "X-Logic-Loop-Hook");
            let mut body = String::new();
            if request.as_reader().take(1_000_000).read_to_string(&mut body).is_err() {
                let _ = request.respond(tiny_http::Response::empty(400));
                continue;
            }
            if let Ok(mut payload) = serde_json::from_str::<serde_json::Value>(&body) {
                if let Some(path) = payload.get("transcript_path").and_then(|v| v.as_str()) {
                    if let Some(sid) = payload.get("session_id").and_then(|v| v.as_str()) {
                        ensure_tailer(&app, sid.to_string(), path.to_string());
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
                }
                let _ = app.emit("ingest://hook", payload);
            }
            let _ = request.respond(tiny_http::Response::empty(204));
        }
    });
}

fn header_value(request: &tiny_http::Request, name: &'static str) -> Option<String> {
    request
        .headers()
        .iter()
        .find(|h| h.field.equiv(name))
        .map(|h| h.value.as_str().to_string())
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

/// The tail loop proper. Returning means "stop tailing"; the caller
/// de-registers so a later hook can start it again.
fn tail(app: &AppHandle, session_id: &str, path: &str) {
    let Ok(mut file) = fs::File::open(path) else {
        // Claude Code can report a transcript_path it has not created. That is
        // invisible without this — the session keeps sending hooks and the
        // panels just stay empty.
        let _ = app.emit(
            "ingest://tailer-failed",
            serde_json::json!({ "session_id": session_id, "path": path }),
        );
        return;
    };
    let mut offset = file.seek(SeekFrom::End(0)).unwrap_or(0);
    loop {
        std::thread::sleep(std::time::Duration::from_millis(500));
        // An already-open fd survives unlink on Unix, but `metadata`/`seek`
        // still fail once the path is gone — that's a live-delete, not just
        // a not-yet-created transcript, and must warn the same way.
        let Ok(meta) = fs::metadata(path) else {
            let _ = app.emit(
                "ingest://tailer-failed",
                serde_json::json!({ "session_id": session_id, "path": path }),
            );
            return;
        };
        if meta.len() < offset {
            offset = 0; // truncated/rotated
        }
        if meta.len() == offset {
            continue;
        }
        if file.seek(SeekFrom::Start(offset)).is_err() {
            let _ = app.emit(
                "ingest://tailer-failed",
                serde_json::json!({ "session_id": session_id, "path": path }),
            );
            return;
        }
        let mut reader = BufReader::new(&mut file);
        let mut line = String::new();
        while let Ok(n) = reader.read_line(&mut line) {
            if n == 0 {
                break;
            }
            offset += n as u64;
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                let _ = app.emit(
                    "ingest://transcript",
                    serde_json::json!({ "session_id": session_id, "line": trimmed }),
                );
            }
            line.clear();
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
fn hook_command() -> String {
    format!(
        "sh -c '. \"$HOME/.{MARKER}\" 2>/dev/null && curl -sf -m 2 -H \"Authorization: Bearer $CT_TOKEN\" -H \"X-Logic-Loop-Tab: $LOGIC_LOOP_TAB_ID\" -H \"X-Logic-Loop-Hook: {HOOK_VERSION}\" --data-binary @- \"http://127.0.0.1:$CT_PORT/event\" >/dev/null 2>&1; exit 0'"
    )
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

fn read_settings() -> Result<serde_json::Value, String> {
    match fs::read_to_string(settings_path()) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| format!("settings.json is not valid JSON: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::json!({})),
        Err(e) => Err(e.to_string()),
    }
}

fn write_settings(v: &serde_json::Value) -> Result<(), String> {
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
}
