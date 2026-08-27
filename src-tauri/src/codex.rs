use std::fs;
use std::path::PathBuf;

/// Codex's hook contract is a near-literal clone of Claude's: same event
/// names, same stdin-JSON delivery, so the existing `ingest::hook_command()`
/// curl one-liner is reused verbatim — no translation layer, unlike OpenCode.
const CODEX_HOOK_EVENTS: [&str; 5] =
    ["SessionStart", "Stop", "PostToolUse", "UserPromptSubmit", "PermissionRequest"];

fn home() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/tmp".into())
}

/// Standalone hooks.json, not inline `[hooks]` in config.toml — Codex
/// auto-discovers this file with zero config.toml edits, and avoids touching
/// tables (`[marketplaces]`, `[plugins]`, `[projects]`, `[tui]`, `[notice]`)
/// a naive TOML rewrite could mangle.
fn settings_path() -> PathBuf {
    PathBuf::from(home()).join(".codex").join("hooks.json")
}

/// `command` is the exact string `crate::ingest::hook_command()` produces
/// (reused verbatim, no Codex-specific translation layer), so it embeds
/// `ingest::MARKER` rather than a marker of our own — that's still enough
/// to distinguish our entries from foreign ones in `hooks.json`, a file
/// Claude's settings.json never touches.
fn is_ours(entry: &serde_json::Value) -> bool {
    entry["hooks"]
        .as_array()
        .is_some_and(|hs| {
            hs.iter()
                .any(|h| h["command"].as_str().is_some_and(|c| c.contains(crate::ingest::MARKER)))
        })
}

fn read_settings() -> Result<serde_json::Value, String> {
    match fs::read_to_string(settings_path()) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| format!("hooks.json is not valid JSON: {e}")),
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
    for event in CODEX_HOOK_EVENTS {
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
    for event in CODEX_HOOK_EVENTS {
        let mut entry = serde_json::json!({
            "hooks": [{ "type": "command", "command": crate::ingest::hook_command() }]
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

fn is_executable(candidate: &std::path::Path) -> bool {
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

#[tauri::command]
pub fn codex_detect() -> bool {
    // GUI apps launched from /Applications inherit macOS's minimal default
    // PATH, not the user's shell PATH — mirrors opencode_detect's fallback.
    let path_hit = std::env::var("PATH").is_ok_and(|path_var| {
        std::env::split_paths(&path_var).any(|dir| is_executable(&dir.join("codex")))
    });
    if path_hit {
        return true;
    }
    ["homebrew/bin", ".local/bin"]
        .iter()
        .any(|rel| is_executable(&PathBuf::from(home()).join(rel).join("codex")))
        || is_executable(&PathBuf::from("/opt/homebrew/bin/codex"))
        || is_executable(&PathBuf::from("/usr/local/bin/codex"))
}

#[tauri::command]
pub fn codex_hooks_setup() -> Result<(), String> {
    let mut settings = read_settings()?;
    apply_setup(&mut settings)?;
    write_settings(&settings)
}

#[tauri::command]
pub fn codex_hooks_remove() -> Result<(), String> {
    let mut settings = read_settings()?;
    strip_ours(&mut settings);
    write_settings(&settings)
}

#[tauri::command]
pub fn codex_hooks_status() -> Result<bool, String> {
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
            "hooks": {
                "Stop": [{ "hooks": [{ "type": "command", "command": "echo user-owned" }] }],
                "SessionStart": [{ "hooks": [{ "type": "command", "command": "some-other-tool" }] }]
            }
        })
    }

    #[test]
    fn setup_is_idempotent_and_preserves_foreign_hooks() {
        let mut s = foreign_settings();
        apply_setup(&mut s).unwrap();
        let once = s.clone();
        apply_setup(&mut s).unwrap();
        assert_eq!(s, once, "second setup must not duplicate entries");
        assert_eq!(s["hooks"]["Stop"][0]["hooks"][0]["command"], "echo user-owned");
        assert_eq!(s["hooks"]["SessionStart"][0]["hooks"][0]["command"], "some-other-tool");
        for ev in CODEX_HOOK_EVENTS {
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
    fn setup_registers_permission_request_not_notification() {
        let mut s = serde_json::json!({});
        apply_setup(&mut s).unwrap();
        assert!(s["hooks"]["PermissionRequest"][0]["hooks"][0]["command"]
            .as_str()
            .is_some());
        assert!(s["hooks"].get("Notification").is_none());
    }
}
