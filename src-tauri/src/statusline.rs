//! Plan 023: wraps the user's existing Claude Code `statusLine.command` so
//! its stdin JSON (`rate_limits`, `model`) is also mirrored to Logic Loop's
//! ingest server, without changing what the terminal renders. Never creates
//! a `statusLine` from scratch — first release requires an existing command
//! to wrap.
//!
//! `statusLine` is a singleton object (`{type, command, ...}`), not an array
//! like `hooks.<Event>`, so `ingest.rs`'s array-retain idiom does not apply —
//! this is a single-key swap-and-restore instead. The original command is
//! stored base64-encoded inside the generated wrapper script itself (not a
//! side file), so there is nothing to drift out of sync with `settings.json`;
//! `settings.json`'s `statusLine.command` just points at the wrapper path.
use crate::home::home_or_tmp;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::fs;
use std::path::{Path, PathBuf};

fn wrapper_path() -> PathBuf {
    PathBuf::from(home_or_tmp())
        .join(".context-terminal")
        .join("claude-statusline-wrapper.sh")
}

/// The exact string written into `settings.json`'s `statusLine.command` when
/// our wrapper owns it — single-quoted so a path is never split apart by an
/// intermediate shell.
fn wrapper_command_value() -> String {
    format!("'{}'", wrapper_path().to_string_lossy())
}

const WRAPPER_B64_PREFIX: &str = "ORIGINAL_COMMAND_B64=";

/// Generates the wrapper script. Reads Claude Code's statusLine stdin JSON
/// once, mirrors it to the ingest server in a backgrounded, non-blocking
/// subshell (must never delay the visible status line — stdin can only be
/// read once, so both paths share the same buffered copy), then execs the
/// original command unchanged with that same stdin so its stdout — what the
/// terminal renders — stays byte-identical.
fn generate_wrapper(original_command: &str) -> String {
    let encoded = STANDARD.encode(original_command.as_bytes());
    format!(
        "#!/usr/bin/env bash\n\
         # {marker}\n\
         # Logic Loop's Claude statusLine wrapper (Plan 023). Do not edit by\n\
         # hand — Logic Loop regenerates this file; disabling it from the app\n\
         # restores the original statusLine.command byte-for-byte.\n\
         {prefix}'{encoded}'\n\
         ORIGINAL_COMMAND=\"$(printf '%s' \"$ORIGINAL_COMMAND_B64\" | base64 -d)\"\n\
         INPUT=\"$(cat)\"\n\
         if [ -f \"$HOME/.{marker}\" ]; then\n\
           (\n\
             . \"$HOME/.{marker}\" 2>/dev/null\n\
             printf '%s' \"$INPUT\" | curl -sf -m 2 \\\n\
               -H \"Authorization: Bearer $CT_TOKEN\" \\\n\
               -H \"X-Logic-Loop-Tab: $LOGIC_LOOP_TAB_ID\" \\\n\
               --data-binary @- \"http://127.0.0.1:$CT_PORT/statusline\" >/dev/null 2>&1\n\
           ) &\n\
         fi\n\
         printf '%s' \"$INPUT\" | eval \"$ORIGINAL_COMMAND\"\n",
        marker = crate::ingest::MARKER,
        prefix = WRAPPER_B64_PREFIX,
        encoded = encoded,
    )
}

fn is_ours_wrapper(contents: &str) -> bool {
    contents.contains(crate::ingest::MARKER)
}

/// Byte-exact inverse of `generate_wrapper`'s embedding — base64 means no
/// quoting/escaping to get wrong regardless of what the original command
/// contains (quotes, newlines, pipes).
fn original_from_wrapper(contents: &str) -> Option<String> {
    let line = contents.lines().find(|l| l.starts_with(WRAPPER_B64_PREFIX))?;
    let quoted = line.strip_prefix(WRAPPER_B64_PREFIX)?;
    let encoded = quoted.strip_prefix('\'')?.strip_suffix('\'')?;
    let bytes = STANDARD.decode(encoded).ok()?;
    String::from_utf8(bytes).ok()
}

fn write_wrapper_file(original: &str) -> Result<(), String> {
    let path = wrapper_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, generate_wrapper(original)).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn statusline_command(settings: &serde_json::Value) -> Option<&str> {
    settings.get("statusLine")?.get("command")?.as_str().filter(|c| !c.is_empty())
}

/// Pure classification of the current settings + (optional) wrapper file
/// contents. No filesystem access — takes the wrapper file's contents (or
/// `None` if it doesn't exist) as a parameter, so this is fully testable
/// against in-memory fixtures, never a live `~/.claude/settings.json`.
enum Installed {
    /// No `statusLine.command` at all — nothing to wrap, and this release
    /// never creates one from scratch.
    Not,
    /// `statusLine.command` already points at our wrapper, and the wrapper
    /// file is genuinely ours with a readable embedded original.
    Yes(String),
    /// A `statusLine.command` exists but is not ours to touch: a foreign
    /// command, or our wrapper's path with a missing/foreign/corrupt file
    /// (e.g. the user deleted or replaced it since). Never force-restored.
    Foreign(String),
}

fn detect(settings: &serde_json::Value, wrapper_contents: Option<&str>, wrapper_cmd_value: &str) -> Installed {
    match statusline_command(settings) {
        None => Installed::Not,
        Some(cmd) if cmd == wrapper_cmd_value => {
            match wrapper_contents.filter(|c| is_ours_wrapper(c)).and_then(original_from_wrapper) {
                Some(original) => Installed::Yes(original),
                None => Installed::Foreign(cmd.to_string()),
            }
        }
        Some(cmd) => Installed::Foreign(cmd.to_string()),
    }
}

/// Mutates `settings` for `setup()`. A no-op when already installed — the
/// wrapper file is still regenerated by the caller from its own embedded
/// original (template may have changed between Logic Loop versions), but
/// `settings.json`'s `statusLine.command` already points at us.
fn apply_setup_to_settings(settings: &mut serde_json::Value, installed: &Installed, wrapper_cmd_value: &str) {
    if matches!(installed, Installed::Foreign(_)) {
        settings["statusLine"]["command"] = wrapper_cmd_value.into();
    }
}

/// Mutates `settings` for `remove()`. Only `Installed::Yes` is ours to
/// restore; `Not`/`Foreign` leave `settings` untouched.
fn apply_remove_to_settings(settings: &mut serde_json::Value, installed: &Installed) {
    if let Installed::Yes(original) = installed {
        settings["statusLine"]["command"] = original.clone().into();
    }
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

/// Same search `claude_detect` (ingest.rs) already does, kept as its own
/// small copy here (matching this codebase's existing per-adapter duplication
/// in codex.rs/opencode.rs) since this needs the actual path, not just a bool.
fn claude_binary_path() -> Option<PathBuf> {
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_var) {
            let candidate = dir.join("claude");
            if is_executable(&candidate) {
                return Some(candidate);
            }
        }
    }
    let home = PathBuf::from(home_or_tmp());
    [
        home.join(".local/bin/claude"),
        home.join("homebrew/bin/claude"),
        PathBuf::from("/opt/homebrew/bin/claude"),
        PathBuf::from("/usr/local/bin/claude"),
    ]
    .into_iter()
    .find(|c| is_executable(c))
}

/// `rate_limits` first appears in Claude Code CLI v2.1.251. Parses a
/// `claude --version` stdout like `"2.1.270 (Claude Code)"` — pure so the
/// gate is unit-testable without spawning the real CLI.
fn parse_cli_version(output: &str) -> Option<(u32, u32, u32)> {
    let first_token = output.split_whitespace().next()?;
    let mut parts = first_token.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()?.parse().ok()?;
    Some((major, minor, patch))
}

const MIN_CLI_VERSION: (u32, u32, u32) = (2, 1, 251);

fn cli_version_ok(path: &Path) -> Option<bool> {
    let output = std::process::Command::new(path).arg("--version").output().ok()?;
    if !output.status.success() {
        return Some(false);
    }
    Some(parse_cli_version(&String::from_utf8_lossy(&output.stdout)).is_some_and(|v| v >= MIN_CLI_VERSION))
}

#[derive(serde::Serialize)]
pub struct StatuslineStatus {
    /// "not-installed" | "installed" | "foreign"
    pub state: &'static str,
    /// The detected `statusLine.command` (foreign) or the wrapped original
    /// (installed) — verbatim, for the enable-action UI to state plainly
    /// what it found. `None` when `state` is "not-installed".
    pub detected_command: Option<String>,
    /// `None` when no `claude` binary could be found at all (distinct from
    /// a found-but-too-old CLI, which is `Some(false)`).
    pub cli_version_ok: Option<bool>,
}

#[tauri::command]
pub fn claude_statusline_status() -> Result<StatuslineStatus, String> {
    let settings = crate::ingest::read_settings()?;
    let wrapper_cmd_value = wrapper_command_value();
    let wrapper_contents = fs::read_to_string(wrapper_path()).ok();
    let (state, detected_command) = match detect(&settings, wrapper_contents.as_deref(), &wrapper_cmd_value) {
        Installed::Not => ("not-installed", None),
        Installed::Yes(original) => ("installed", Some(original)),
        Installed::Foreign(cmd) => ("foreign", Some(cmd)),
    };
    let cli_version_ok = claude_binary_path().and_then(|p| cli_version_ok(&p));
    Ok(StatuslineStatus { state, detected_command, cli_version_ok })
}

#[tauri::command]
pub fn claude_statusline_setup() -> Result<(), String> {
    let mut settings = crate::ingest::read_settings()?;
    let wrapper_cmd_value = wrapper_command_value();
    let wrapper_contents = fs::read_to_string(wrapper_path()).ok();
    let installed = detect(&settings, wrapper_contents.as_deref(), &wrapper_cmd_value);
    let original = match &installed {
        Installed::Yes(o) => o.clone(),
        Installed::Foreign(cmd) => cmd.clone(),
        Installed::Not => return Err("No statusLine.command configured — nothing to wrap".into()),
    };
    write_wrapper_file(&original)?;
    apply_setup_to_settings(&mut settings, &installed, &wrapper_cmd_value);
    if matches!(installed, Installed::Foreign(_)) {
        crate::ingest::write_settings(&settings)?;
    }
    Ok(())
}

#[tauri::command]
pub fn claude_statusline_remove() -> Result<(), String> {
    let mut settings = crate::ingest::read_settings()?;
    let wrapper_cmd_value = wrapper_command_value();
    let wrapper_contents = fs::read_to_string(wrapper_path()).ok();
    let installed = detect(&settings, wrapper_contents.as_deref(), &wrapper_cmd_value);
    let was_ours = matches!(installed, Installed::Yes(_));
    apply_remove_to_settings(&mut settings, &installed);
    if was_ours {
        crate::ingest::write_settings(&settings)?;
        let _ = fs::remove_file(wrapper_path());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const WRAPPER_CMD: &str = "'/home/x/.context-terminal/claude-statusline-wrapper.sh'";

    #[test]
    fn no_statusline_configured_is_not_installed() {
        assert!(matches!(detect(&serde_json::json!({}), None, WRAPPER_CMD), Installed::Not));
        assert!(matches!(
            detect(&serde_json::json!({ "statusLine": {} }), None, WRAPPER_CMD),
            Installed::Not
        ));
    }

    #[test]
    fn setup_wraps_a_foreign_command_and_second_call_is_idempotent() {
        let mut settings = serde_json::json!({
            "statusLine": { "type": "command", "command": "~/.claude/my-bar.sh", "padding": 0 },
            "model": "opus"
        });
        let first = detect(&settings, None, WRAPPER_CMD);
        assert!(matches!(&first, Installed::Foreign(c) if c == "~/.claude/my-bar.sh"));
        apply_setup_to_settings(&mut settings, &first, WRAPPER_CMD);
        assert_eq!(settings["statusLine"]["command"], WRAPPER_CMD);
        // Untouched siblings, both inside and outside `statusLine`.
        assert_eq!(settings["statusLine"]["padding"], 0);
        assert_eq!(settings["statusLine"]["type"], "command");
        assert_eq!(settings["model"], "opus");
        let once = settings.clone();

        // Second call: settings.json now really does point at our wrapper,
        // and the wrapper file embeds the real original.
        let wrapper_contents = generate_wrapper("~/.claude/my-bar.sh");
        let second = detect(&settings, Some(&wrapper_contents), WRAPPER_CMD);
        assert!(matches!(&second, Installed::Yes(o) if o == "~/.claude/my-bar.sh"));
        apply_setup_to_settings(&mut settings, &second, WRAPPER_CMD);
        assert_eq!(settings, once, "second setup must not change settings.json at all");
    }

    #[test]
    fn setup_on_no_statusline_is_rejected_before_any_mutation() {
        let installed = detect(&serde_json::json!({}), None, WRAPPER_CMD);
        assert!(matches!(installed, Installed::Not));
        // claude_statusline_setup returns Err in this case (checked at the
        // command layer) rather than calling apply_setup_to_settings at all —
        // this never creates a statusLine from scratch.
    }

    #[test]
    fn remove_restores_the_exact_original_string() {
        let original = "~/.claude/my-bar.sh --format compact";
        let mut settings = serde_json::json!({
            "statusLine": { "type": "command", "command": WRAPPER_CMD, "refreshInterval": 5 }
        });
        let wrapper_contents = generate_wrapper(original);
        let installed = detect(&settings, Some(&wrapper_contents), WRAPPER_CMD);
        apply_remove_to_settings(&mut settings, &installed);
        assert_eq!(settings["statusLine"]["command"], original);
        assert_eq!(settings["statusLine"]["refreshInterval"], 5);
    }

    #[test]
    fn remove_on_a_foreign_statusline_is_a_noop() {
        let settings = serde_json::json!({ "statusLine": { "command": "some-other-tool" } });
        let installed = detect(&settings, None, WRAPPER_CMD);
        let mut mutated = settings.clone();
        apply_remove_to_settings(&mut mutated, &installed);
        assert_eq!(mutated, settings, "remove on a foreign statusLine must not touch settings.json");
    }

    #[test]
    fn wrapper_path_repointed_away_makes_remove_a_noop_even_though_the_file_exists() {
        // settings.json no longer points at our wrapper (user repointed it),
        // even though our wrapper file is still sitting on disk.
        let settings = serde_json::json!({ "statusLine": { "command": "some-other-tool" } });
        let wrapper_contents = generate_wrapper("original");
        let installed = detect(&settings, Some(&wrapper_contents), WRAPPER_CMD);
        assert!(matches!(installed, Installed::Foreign(_)));
        let mut mutated = settings.clone();
        apply_remove_to_settings(&mut mutated, &installed);
        assert_eq!(mutated, settings);
    }

    #[test]
    fn wrapper_path_pointed_but_file_missing_or_foreign_is_not_force_restored() {
        // settings.json points at our wrapper path, but the file is missing.
        let settings = serde_json::json!({ "statusLine": { "command": WRAPPER_CMD } });
        let installed = detect(&settings, None, WRAPPER_CMD);
        assert!(matches!(installed, Installed::Foreign(ref c) if c == WRAPPER_CMD));
        let mut mutated = settings.clone();
        apply_remove_to_settings(&mut mutated, &installed);
        assert_eq!(mutated, settings, "must never force-restore a guess");

        // Same path, but the file exists and just isn't ours (no marker).
        let foreign_file = "#!/bin/sh\necho hi\n";
        let installed2 = detect(&settings, Some(foreign_file), WRAPPER_CMD);
        assert!(matches!(installed2, Installed::Foreign(_)));
    }

    #[test]
    fn wrapper_round_trips_arbitrary_originals_byte_exact() {
        for original in [
            "~/.claude/my-bar.sh",
            "echo 'hi' | some-tool --flag=\"value with spaces\"",
            "cmd --path=/a/b'c/d",
            "multi\nline\ncommand",
            "",
        ] {
            let wrapper = generate_wrapper(original);
            assert!(is_ours_wrapper(&wrapper), "missing marker: {wrapper}");
            assert_eq!(original_from_wrapper(&wrapper).as_deref(), Some(original));
        }
    }

    #[test]
    fn foreign_script_carries_no_marker_and_no_original() {
        let foreign = "#!/bin/sh\necho hi\n";
        assert!(!is_ours_wrapper(foreign));
        assert_eq!(original_from_wrapper(foreign), None);
    }

    #[test]
    fn cli_version_parses_and_gates_correctly() {
        assert_eq!(parse_cli_version("2.1.270 (Claude Code)"), Some((2, 1, 270)));
        assert_eq!(parse_cli_version("2.1.251"), Some((2, 1, 251)));
        assert_eq!(parse_cli_version("not a version"), None);
        assert_eq!(parse_cli_version(""), None);
        assert!(parse_cli_version("2.1.251").unwrap() >= MIN_CLI_VERSION);
        assert!(parse_cli_version("2.1.250").unwrap() < MIN_CLI_VERSION);
        assert!(parse_cli_version("2.0.999").unwrap() < MIN_CLI_VERSION);
        assert!(parse_cli_version("3.0.0").unwrap() >= MIN_CLI_VERSION);
    }
}
