use crate::home::home_or_tmp;
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;

/// Antigravity's own hook doc (`~/.gemini/antigravity-cli/builtin/skills/
/// agy-customizations/docs/hooks.md`, read against a live install during
/// this phase's build) confirms `hooks.json` namespaces registrations by an
/// arbitrary **hook name** (unlike Claude/Codex's flat per-event arrays), so
/// our whole registration lives under one owned key rather than needing a
/// marker-substring scan per entry.
const HOOK_NAME: &str = "logic-loop";

/// Never `PreToolUse` — its contract (`hooks.md`'s "PreToolUse Contract")
/// requires a `decision` field in the response (`"allow"`/`"deny"`/`"ask"`/
/// `"force_ask"`); the `{}` this module always prints omits it, and the
/// installed CLI's behavior for a missing `decision` on a real tool gate is
/// unverified. Do not register it without first confirming that live and
/// sending an explicit `{"decision": "allow"}` (see Plan 004 in
/// `plans/Antigravity_Implementation_Plans.md`).
///
/// `PreInvocation` was excluded for the same reason until live-verified
/// otherwise (Phase 16, 2026-09-06): its own contract
/// (`hooks.md`'s "PreInvocation Contract") has no required response field at
/// all — `injectSteps` is optional, there is no `decision`/deny semantics,
/// it cannot block or fail the turn. Confirmed live against `agy` 1.1.27
/// via `--input-format stream-json`: (1) a bare `{}` response never blocked,
/// denied, or errored a turn across single- and multi-tool-call turns; (2) a
/// 2-second-sleeping, malformed (empty-stdout) response added exactly that
/// latency and nothing worse — degrades to slow, not stuck, matching this
/// app's existing `-m 2` curl timeout order of magnitude; (3) critically,
/// `invocationNum` resets to `0` at the start of every new top-level turn
/// (two turns sent to one long-lived process each began at `invocationNum:
/// 0`) despite firing multiple times *within* a turn's own tool-call loop
/// (3 firings observed for one turn with 2 tool calls) — so `invocationNum
/// == 0` is a reliable once-per-turn signal, and `translate()` uses exactly
/// that to gate the `UserPromptSubmit` mapping below. All three findings
/// contradicted this constant's own prior doc comment, which had
/// (incorrectly) grouped `PreInvocation` with `PreToolUse` as uniformly
/// unsafe — see CLAUDE.md's Phase 16 entry for the full methodology.
const ANTIGRAVITY_HOOK_EVENTS: [&str; 4] = ["PostToolUse", "PostInvocation", "PreInvocation", "Stop"];

/// Global discovery location per the installed CLI's own docs (`~/.gemini/
/// config/` — "Global Configuration (Machine-Local)"), not the per-project
/// `.agents/hooks.json` (would need one register/strip per project) and not
/// the legacy `~/.gemini/settings.json`.
fn settings_path() -> PathBuf {
    PathBuf::from(home_or_tmp()).join(".gemini").join("config").join("hooks.json")
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

/// Single-quote a string for `sh -c` — closes the quote, escapes the quote
/// itself, reopens it. Needed because a GUI app bundle path can contain
/// spaces (`/Applications/Logic Loop.app/...`) and hook commands run via
/// `sh -c` (per the doc), not JSON, so shell quoting rules apply.
fn shell_single_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

fn command_for(event: &str) -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(format!("{} --antigravity-hook {event}", shell_single_quote(&exe.to_string_lossy())))
}

fn strip_ours(settings: &mut serde_json::Value) {
    if let Some(obj) = settings.as_object_mut() {
        obj.remove(HOOK_NAME);
    }
}

fn apply_setup(settings: &mut serde_json::Value) -> Result<(), String> {
    strip_ours(settings);
    if !settings.is_object() {
        *settings = serde_json::json!({});
    }
    let mut hooks = serde_json::json!({});
    for event in ANTIGRAVITY_HOOK_EVENTS {
        let command = command_for(event)?;
        // Grouped shape (matcher + hooks wrapper) for tool-specific events;
        // flat shape (bare handler list) for everything else.
        hooks[event] = if event == "PostToolUse" {
            serde_json::json!([{ "matcher": "*", "hooks": [{ "type": "command", "command": command }] }])
        } else {
            serde_json::json!([{ "type": "command", "command": command }])
        };
    }
    settings[HOOK_NAME] = hooks;
    Ok(())
}

fn hooks_status_from(settings: &serde_json::Value) -> bool {
    settings.get(HOOK_NAME).is_some()
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
pub fn antigravity_detect() -> bool {
    // GUI apps launched from /Applications inherit macOS's minimal default
    // PATH, not the user's shell PATH — mirrors codex_detect's fallback.
    // `agy` installs to `~/.local/bin` via its curl installer (confirmed on
    // this machine); Homebrew paths hedge against that changing.
    let path_hit = std::env::var("PATH").is_ok_and(|path_var| {
        std::env::split_paths(&path_var).any(|dir| is_executable(&dir.join("agy")))
    });
    if path_hit {
        return true;
    }
    ["homebrew/bin", ".local/bin"]
        .iter()
        .any(|rel| is_executable(&PathBuf::from(home_or_tmp()).join(rel).join("agy")))
        || is_executable(&PathBuf::from("/opt/homebrew/bin/agy"))
        || is_executable(&PathBuf::from("/usr/local/bin/agy"))
}

#[tauri::command]
pub fn antigravity_hooks_setup() -> Result<(), String> {
    let mut settings = read_settings()?;
    apply_setup(&mut settings)?;
    write_settings(&settings)
}

#[tauri::command]
pub fn antigravity_hooks_remove() -> Result<(), String> {
    let mut settings = read_settings()?;
    strip_ours(&mut settings);
    write_settings(&settings)
}

#[tauri::command]
pub fn antigravity_hooks_status() -> Result<bool, String> {
    let settings = read_settings()?;
    Ok(hooks_status_from(&settings))
}

/// Remap Antigravity's native camelCase hook payload into the canonical
/// snake_case wire shape every other adapter already produces. Pure and
/// total — never panics, never fails; a field it can't find is just absent
/// from the output, which the existing ingest/state-mapping code already
/// treats as "unknown" (falls back to `"?"` in the Accomplished panel,
/// `null` state in `stateForHook`).
///
/// Corrected against live payloads captured 2026-08-27 during manual testing
/// (Phase 11 item 3) — the doc's claim that `PostToolUse` "carries no
/// toolCall" is wrong: a real payload had a populated `toolCall`
/// (`name`/`args`), so tool identity is mapped after all.
///
/// The doc's `error` example (`"exit status 1"`) does not describe
/// `run_command`. Root-caused the same day by decoding `hooks.proto`'s
/// `FileDescriptorProto` out of the `agy` binary itself and diffing it
/// against paired captures of a failing and a succeeding command:
///
/// * `PostToolHookArgs` really has four fields — `step_idx`, `tool_call`,
///   `error`, and an **undocumented `result`** (a string).
/// * A genuine non-zero exit sends `"error": ""`, byte-identical to a
///   success. `error` is not the failure signal.
/// * `result` never reaches a command hook at all. Neither do
///   `PostInvocationHookArgs.model_output`/`.model_thinking` nor
///   `StopHookArgs.final_model_output` — while zero-valued fields like
///   `executionNum: 0` *are* emitted, proving these four are actively
///   stripped (`jsonhook.dropUnsupportedFields`) rather than merely empty.
///   Every stripped field is free-text tool/model output; they appear to be
///   reserved for prompt-mode hooks, which the doc lists as unimplemented.
///   `jsonhook.Caller.UseFullHookInterface` is an SDK-level setter, not a
///   `hooks.json` key — a command hook cannot opt in.
///
/// So a failed `run_command` is **not observable** from an agy command hook.
/// `error` is still mapped when present and non-empty, since the doc's
/// example shape may yet describe some other failure class (a tool-invocation
/// crash, never triggered live), but `is_error` will not fire for an ordinary
/// non-zero exit and no rewrite here can change that. Do not "fix" this by
/// inferring failure from `PostInvocation`'s model prose or the transcript —
/// that is agent content, untrusted per invariant #5, and parsing it for
/// meaning is what invariant #1 exists to forbid.
fn translate(event: &str, input: &serde_json::Value) -> serde_json::Value {
    let mut out = serde_json::json!({ "hook_event_name": event });
    // Turn-epoch fix (Phase 16): agy has no direct UserPromptSubmit
    // equivalent, and Stop alone left every session permanently stuck idle
    // after turn 1 (nothing ever cleared `stoppedSessions` — see
    // ingest.ts's epoch guard). `invocationNum == 0` (or absent, treated the
    // same way — a payload missing the field entirely should not be assumed
    // mid-turn) is the first model call of a new top-level turn, live-
    // verified reliable across resumed turns in one process (see this file's
    // `ANTIGRAVITY_HOOK_EVENTS` doc comment for the methodology). Any later
    // invocation within the same turn's tool-call loop keeps the plain
    // `"PreInvocation"` name, which `stateForHook`'s default arm ignores —
    // exactly like the already-registered, currently-inert `PostInvocation`.
    if event == "PreInvocation" {
        let first_call = input.get("invocationNum").and_then(|v| v.as_u64()).unwrap_or(0) == 0;
        if first_call {
            out["hook_event_name"] = "UserPromptSubmit".into();
        }
    }
    if let Some(cid) = input.get("conversationId").and_then(|v| v.as_str()) {
        out["session_id"] = cid.into();
    }
    if let Some(cwd) = input
        .get("workspacePaths")
        .and_then(|v| v.as_array())
        .and_then(|a| a.first())
        .and_then(|v| v.as_str())
    {
        out["cwd"] = cwd.into();
    }
    if let Some(tp) = input.get("transcriptPath").and_then(|v| v.as_str()) {
        out["transcript_path"] = tp.into();
    }
    if event == "PostToolUse" {
        if let Some(name) = input.get("toolCall").and_then(|tc| tc.get("name")).and_then(|v| v.as_str()) {
            out["tool_name"] = name.into();
        }
        if let Some(args) = input.get("toolCall").and_then(|tc| tc.get("args")) {
            let mut normalized = args.clone();
            normalize_tool_args(&mut normalized);
            out["tool_input"] = normalized;
        }
        if let Some(err) = input.get("error").and_then(|v| v.as_str()).filter(|e| !e.is_empty()) {
            out["tool_response"] = serde_json::json!({ "is_error": true, "error": err });
        }
    }
    out
}

/// Antigravity's own PascalCase tool arg field names, added under the shared
/// lowercase keys `repo.ts`'s Accomplished panel, `delta.ts`'s Since-you-left
/// digest, and `App.tsx`'s blocker-detection gate already look for — without
/// this every Antigravity tool row rendered blank detail and drove zero
/// digest/blocker signal, even though `tool_input` itself was already
/// populated (Phase 16 finding). Additive only: the raw PascalCase fields
/// stay untouched for any future consumer that wants Antigravity-specific
/// detail (e.g. `WaitMsBeforeAsync`), and an already-present lowercase key is
/// never overwritten.
fn normalize_tool_args(args: &mut serde_json::Value) {
    let Some(obj) = args.as_object_mut() else { return };
    let mut add = |key: &str, sources: &[&str]| {
        if obj.contains_key(key) {
            return;
        }
        for src in sources {
            if let Some(v) = obj.get(*src).and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
                let v = v.to_string();
                obj.insert(key.into(), v.into());
                return;
            }
        }
    };
    add("command", &["CommandLine"]);
    add("file_path", &["TargetFile", "AbsolutePath", "SearchPath", "SearchDirectory"]);
    add("description", &["toolSummary", "toolAction", "Description"]);
}

/// Headless entry point: `main.rs` routes `--antigravity-hook <Event>` here
/// before booting the GUI. Reads Antigravity's native stdin JSON, translates
/// it, and shells out to the same `ingest::hook_command()` curl one-liner
/// every other adapter's hook already uses — reusing its tether/marker/
/// timeout handling rather than duplicating it. Always exits 0: a
/// translation or delivery failure must never surface to Antigravity as a
/// bad `command` result on a Post* event.
pub fn run_hook_mode(event_name: &str) -> ! {
    let mut raw = String::new();
    let _ = std::io::stdin().read_to_string(&mut raw);
    if let Ok(input) = serde_json::from_str::<serde_json::Value>(&raw) {
        let translated = translate(event_name, &input);
        if translated.get("session_id").and_then(|v| v.as_str()).is_some_and(|s| !s.is_empty()) {
            if let Ok(mut child) = std::process::Command::new("sh")
                .arg("-c")
                .arg(crate::ingest::hook_command())
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
            {
                if let Some(mut stdin) = child.stdin.take() {
                    let _ = stdin.write_all(translated.to_string().as_bytes());
                }
                let _ = child.wait();
            }
        }
    }
    // Antigravity expects a JSON object on our stdout for every hook type
    // (PostToolUse's contract explicitly documents `{}`); print it
    // unconditionally so a translation/delivery failure above never leaves
    // malformed/empty stdout for Antigravity to parse.
    print!("{{}}");
    let _ = std::io::stdout().flush();
    std::process::exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn foreign_settings() -> serde_json::Value {
        serde_json::json!({
            "lint-checker": {
                "PostToolUse": [{
                    "matcher": "run_command",
                    "hooks": [{ "type": "command", "command": "./scripts/lint.sh" }]
                }]
            }
        })
    }

    #[test]
    fn setup_is_idempotent_and_preserves_foreign_hooks() {
        let mut s = foreign_settings();
        apply_setup(&mut s).unwrap();
        let once = s.clone();
        apply_setup(&mut s).unwrap();
        assert_eq!(s, once, "second setup must not duplicate or drift");
        assert_eq!(s["lint-checker"]["PostToolUse"][0]["hooks"][0]["command"], "./scripts/lint.sh");
        assert_eq!(s[HOOK_NAME]["PostToolUse"][0]["matcher"], "*");
        assert!(s[HOOK_NAME]["PostToolUse"][0]["hooks"][0]["command"].as_str().is_some());
        assert!(s[HOOK_NAME]["PostInvocation"][0]["command"].as_str().is_some());
        assert!(s[HOOK_NAME]["Stop"][0]["command"].as_str().is_some());
        for event in ANTIGRAVITY_HOOK_EVENTS {
            assert!(s[HOOK_NAME][event].is_array(), "{event} missing");
        }
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
        assert!(hooks_status_from(&s));
        strip_ours(&mut s);
        assert_eq!(s, serde_json::json!({}));
    }

    #[test]
    fn translate_maps_common_fields() {
        let input = serde_json::json!({
            "conversationId": "abc-123",
            "workspacePaths": ["/tmp/proj"],
            "transcriptPath": "/tmp/proj/.gemini/antigravity-cli/transcript.jsonl"
        });
        let out = translate("Stop", &input);
        assert_eq!(out["session_id"], "abc-123");
        assert_eq!(out["cwd"], "/tmp/proj");
        assert_eq!(out["hook_event_name"], "Stop");
        assert_eq!(out["transcript_path"], "/tmp/proj/.gemini/antigravity-cli/transcript.jsonl");
        assert!(out.get("tool_response").is_none());
    }

    #[test]
    fn translate_post_tool_use_maps_tool_call_name_and_args() {
        // Real payload captured 2026-08-27 (Phase 11 item 3 manual test) —
        // contrary to the doc, PostToolUse does carry a populated toolCall.
        let input = serde_json::json!({
            "conversationId": "abc-123",
            "workspacePaths": ["/tmp/proj"],
            "error": "",
            "toolCall": {
                "name": "run_command",
                "args": { "CommandLine": "ls /nope", "Cwd": "/tmp/proj" }
            }
        });
        let out = translate("PostToolUse", &input);
        assert_eq!(out["tool_name"], "run_command");
        assert_eq!(out["tool_input"]["CommandLine"], "ls /nope");
        assert!(out.get("tool_response").is_none(), "empty error string must not fabricate a tool_response");
    }

    #[test]
    fn translate_non_post_tool_use_never_maps_tool_call() {
        let input = serde_json::json!({
            "conversationId": "abc-123",
            "workspacePaths": ["/tmp/proj"],
            "toolCall": { "name": "run_command", "args": {} }
        });
        assert!(translate("PostInvocation", &input).get("tool_name").is_none());
        assert!(translate("Stop", &input).get("tool_name").is_none());
    }

    #[test]
    fn translate_post_tool_use_error_becomes_tool_response() {
        let input = serde_json::json!({
            "conversationId": "abc-123",
            "workspacePaths": ["/tmp/proj"],
            "error": "exit status 1"
        });
        let out = translate("PostToolUse", &input);
        assert_eq!(out["tool_response"]["is_error"], true);
        assert_eq!(out["tool_response"]["error"], "exit status 1");
    }

    #[test]
    fn translate_post_tool_use_without_error_has_no_tool_response() {
        let input = serde_json::json!({ "conversationId": "abc-123", "workspacePaths": ["/tmp/proj"] });
        let out = translate("PostToolUse", &input);
        assert!(out.get("tool_response").is_none());
    }

    #[test]
    fn translate_post_tool_use_empty_error_string_has_no_tool_response() {
        // Real agy payloads send `"error": ""` on every tool call, not an
        // absent key (2026-08-27 manual test, Phase 11 item 2/3) — the doc's
        // "present if the tool failed" is wrong in both directions. An empty
        // string must not read as a failure.
        let input = serde_json::json!({
            "conversationId": "abc-123",
            "workspacePaths": ["/tmp/proj"],
            "error": ""
        });
        let out = translate("PostToolUse", &input);
        assert!(out.get("tool_response").is_none());
    }

    #[test]
    fn translate_real_failing_run_command_payload_carries_no_failure_signal() {
        // Verbatim capture (2026-08-27, Phase 11 item 3) of `ls
        // /this_path_does_not_exist_xyz` — a command that genuinely exited
        // non-zero. Byte-for-byte the same `"error": ""` a succeeding
        // `echo hello_ok` produced, and no `result` field: agy strips it from
        // command-hook payloads (see `translate()`'s doc comment). This test
        // exists to pin the negative result — if a future agy release starts
        // delivering `result`, or populates `error`, this assertion fails and
        // that is the signal to wire `tool_response` up properly.
        let input = serde_json::json!({
            "artifactDirectoryPath": "/Users/u/.gemini/antigravity-cli/brain/67f69d2e",
            "conversationId": "67f69d2e-43ea-4789-b92b-9094c02a891b",
            "error": "",
            "modelName": "gemini-3.5-flash-extra-low",
            "stepIdx": 2,
            "toolCall": {
                "args": {
                    "CommandLine": "ls /this_path_does_not_exist_xyz",
                    "Cwd": "/tmp/ws2",
                    "WaitMsBeforeAsync": 5000,
                    "toolAction": "Running ls command",
                    "toolSummary": "Run ls command"
                },
                "name": "run_command"
            },
            "transcriptPath": "/Users/u/.gemini/antigravity-cli/brain/67f69d2e/.system_generated/logs/transcript_full.jsonl",
            "workspacePaths": ["/tmp/ws2"]
        });
        let out = translate("PostToolUse", &input);
        assert_eq!(out["session_id"], "67f69d2e-43ea-4789-b92b-9094c02a891b");
        assert_eq!(out["cwd"], "/tmp/ws2");
        assert_eq!(out["tool_name"], "run_command");
        assert_eq!(out["tool_input"]["CommandLine"], "ls /this_path_does_not_exist_xyz");
        assert!(
            out.get("tool_response").is_none(),
            "agy signals no failure for a non-zero exit; do not fabricate one"
        );
    }

    #[test]
    fn translate_pre_invocation_first_call_maps_to_user_prompt_submit() {
        let input = serde_json::json!({
            "conversationId": "abc-123",
            "workspacePaths": ["/tmp/proj"],
            "invocationNum": 0
        });
        let out = translate("PreInvocation", &input);
        assert_eq!(out["hook_event_name"], "UserPromptSubmit");
        assert_eq!(out["session_id"], "abc-123");
    }

    #[test]
    fn translate_pre_invocation_missing_invocation_num_defaults_to_first_call() {
        let input = serde_json::json!({ "conversationId": "abc-123", "workspacePaths": ["/tmp/proj"] });
        assert_eq!(translate("PreInvocation", &input)["hook_event_name"], "UserPromptSubmit");
    }

    #[test]
    fn translate_pre_invocation_later_call_keeps_its_own_name() {
        // Real turns fire PreInvocation multiple times (once per intra-turn
        // tool-call loop iteration) — only invocationNum 0 is a new turn.
        let input = serde_json::json!({
            "conversationId": "abc-123",
            "workspacePaths": ["/tmp/proj"],
            "invocationNum": 2
        });
        let out = translate("PreInvocation", &input);
        assert_eq!(
            out["hook_event_name"], "PreInvocation",
            "a mid-turn invocation must not reopen the epoch or count as a new turn"
        );
    }

    #[test]
    fn translate_normalizes_run_command_args() {
        let input = serde_json::json!({
            "conversationId": "abc-123",
            "workspacePaths": ["/tmp/ws2"],
            "error": "",
            "toolCall": {
                "name": "run_command",
                "args": { "CommandLine": "ls /nope", "Cwd": "/tmp/ws2", "toolSummary": "Run ls command" }
            }
        });
        let out = translate("PostToolUse", &input);
        assert_eq!(out["tool_input"]["command"], "ls /nope");
        assert_eq!(out["tool_input"]["description"], "Run ls command");
        // Raw PascalCase fields survive untouched alongside the new keys.
        assert_eq!(out["tool_input"]["CommandLine"], "ls /nope");
        assert_eq!(out["tool_input"]["Cwd"], "/tmp/ws2");
    }

    #[test]
    fn translate_normalizes_write_to_file_and_view_file_args() {
        let write = translate(
            "PostToolUse",
            &serde_json::json!({
                "conversationId": "abc-123",
                "toolCall": { "name": "write_to_file", "args": { "TargetFile": "/tmp/ws2/foo.ts", "Description": "add foo" } }
            }),
        );
        assert_eq!(write["tool_input"]["file_path"], "/tmp/ws2/foo.ts");
        assert_eq!(write["tool_input"]["description"], "add foo");

        let view = translate(
            "PostToolUse",
            &serde_json::json!({
                "conversationId": "abc-123",
                "toolCall": { "name": "view_file", "args": { "AbsolutePath": "/tmp/ws2/bar.ts" } }
            }),
        );
        assert_eq!(view["tool_input"]["file_path"], "/tmp/ws2/bar.ts");
    }

    #[test]
    fn translate_normalizes_grep_search_args() {
        let out = translate(
            "PostToolUse",
            &serde_json::json!({
                "conversationId": "abc-123",
                "toolCall": { "name": "grep_search", "args": { "SearchPath": "/tmp/ws2", "toolAction": "Searching for TODO" } }
            }),
        );
        assert_eq!(out["tool_input"]["file_path"], "/tmp/ws2");
        assert_eq!(out["tool_input"]["description"], "Searching for TODO");
    }

    #[test]
    fn normalize_tool_args_never_overwrites_an_existing_lowercase_key() {
        let mut args = serde_json::json!({ "command": "already-here", "CommandLine": "different" });
        normalize_tool_args(&mut args);
        assert_eq!(args["command"], "already-here");
    }

    #[test]
    fn normalize_tool_args_skips_empty_source_strings() {
        let mut args = serde_json::json!({ "CommandLine": "" });
        normalize_tool_args(&mut args);
        assert!(args.get("command").is_none(), "an empty source string must not fabricate a command");
    }

    #[test]
    fn translate_empty_workspace_paths_omits_cwd() {
        // A projectless/headless agy session really does send
        // `"workspacePaths": []` (captured 2026-08-27). An empty array must
        // omit `cwd` entirely rather than emit `""` — an empty cwd matches
        // nothing in every panel query, and `bindSession` needs the field
        // absent to fall through to the tether.
        let input = serde_json::json!({ "conversationId": "abc-123", "workspacePaths": [] });
        let out = translate("Stop", &input);
        assert!(out.get("cwd").is_none());
    }

    #[test]
    fn translate_post_invocation_and_stop_never_fabricate_tool_response() {
        let input = serde_json::json!({ "conversationId": "abc-123", "workspacePaths": ["/tmp/proj"], "error": "boom" });
        assert!(translate("PostInvocation", &input).get("tool_response").is_none());
        assert!(translate("Stop", &input).get("tool_response").is_none());
    }

    #[test]
    fn translate_missing_conversation_id_omits_session_id() {
        let input = serde_json::json!({ "workspacePaths": ["/tmp/proj"] });
        let out = translate("Stop", &input);
        assert!(out.get("session_id").is_none());
    }

    #[test]
    fn translate_missing_workspace_paths_omits_cwd() {
        let input = serde_json::json!({ "conversationId": "abc-123" });
        let out = translate("Stop", &input);
        assert!(out.get("cwd").is_none());
    }

    #[test]
    fn shell_single_quote_handles_embedded_quotes_and_spaces() {
        assert_eq!(shell_single_quote("/Applications/Logic Loop.app/x"), "'/Applications/Logic Loop.app/x'");
        assert_eq!(shell_single_quote("it's/here"), "'it'\\''s/here'");
    }

    #[test]
    fn command_for_embeds_event_name_and_flag() {
        let cmd = command_for("PostToolUse").unwrap();
        assert!(cmd.contains("--antigravity-hook PostToolUse"), "{cmd}");
    }
}
