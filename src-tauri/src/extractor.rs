use std::io::{Read, Write};
use std::process::{Child, Command, Output, Stdio};
use std::time::{Duration, Instant};

const EXTRACTOR_TIMEOUT: Duration = Duration::from_secs(120);

fn wait_with_timeout(mut child: Child, label: &str) -> Result<Output, String> {
    let stdout_thread = child.stdout.take().map(|mut pipe| {
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            let _ = pipe.read_to_end(&mut bytes);
            bytes
        })
    });
    let stderr_thread = child.stderr.take().map(|mut pipe| {
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            let _ = pipe.read_to_end(&mut bytes);
            bytes
        })
    });
    let deadline = Instant::now() + EXTRACTOR_TIMEOUT;
    loop {
        match child.try_wait().map_err(|e| format!("{label} wait: {e}"))? {
            Some(status) => {
                let stdout = stdout_thread.map(|t| t.join().unwrap_or_default()).unwrap_or_default();
                let stderr = stderr_thread.map(|t| t.join().unwrap_or_default()).unwrap_or_default();
                return Ok(Output { status, stdout, stderr });
            }
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("{label} timed out"));
            }
            None => std::thread::sleep(Duration::from_millis(50)),
        }
    }
}

fn claude_bin() -> String {
    let local = format!(
        "{}/.local/bin/claude",
        crate::home::home().unwrap_or_default()
    );
    if std::path::Path::new(&local).exists() {
        local
    } else {
        "claude".into() // hope it's on PATH
    }
}

fn codex_bin() -> String {
    let mut candidates = Vec::new();
    if let Some(home) = crate::home::home() {
        candidates.push(format!("{home}/.local/bin/codex"));
    }
    candidates.extend(["/opt/homebrew/bin/codex".into(), "/usr/local/bin/codex".into()]);
    candidates
        .into_iter()
        .find(|path| std::path::Path::new(path).exists())
        .unwrap_or_else(|| "codex".into())
}

fn codex_args(model: Option<&str>) -> Vec<String> {
    let mut args = vec![
        "exec".into(),
        "--ephemeral".into(),
        "--sandbox".into(),
        "read-only".into(),
        "--skip-git-repo-check".into(),
        "--json".into(),
        "-".into(),
    ];
    if let Some(model) = model.filter(|m| !m.is_empty()) {
        args.splice(6..6, ["-m".into(), model.into()]);
    }
    args
}

fn codex_final_message(stdout: &[u8]) -> Result<String, String> {
    let mut final_text = None;
    for line in String::from_utf8_lossy(stdout).lines() {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if value["type"] == "item.completed"
            && value["item"]["type"] == "agent_message"
            && value["item"]["text"].is_string()
        {
            final_text = value["item"]["text"].as_str().map(String::from);
        }
    }
    final_text.filter(|text| !text.is_empty()).ok_or_else(|| "codex: no final message".into())
}

/// Run the extraction prompt against the chosen backend, return raw LLM text.
/// Blocking is fine: Tauri runs commands off the main thread.
#[tauri::command]
pub fn run_extractor(
    prompt: String,
    backend: String,
    lmstudio_url: Option<String>,
    lmstudio_model: Option<String>,
    codex_model: Option<String>,
) -> Result<String, String> {
    match backend.as_str() {
        "lmstudio" => {
            let url = lmstudio_url.unwrap_or_else(|| "http://127.0.0.1:1234".into());
            let mut body = serde_json::json!({
                "messages": [{ "role": "user", "content": prompt }],
                "temperature": 0
            });
            if let Some(m) = lmstudio_model.filter(|m| !m.is_empty()) {
                body["model"] = m.into();
            }
            let resp: serde_json::Value = ureq::post(format!("{url}/v1/chat/completions"))
                .send_json(&body)
                .map_err(|e| format!("lmstudio: {e}"))?
                .body_mut()
                .read_json()
                .map_err(|e| format!("lmstudio parse: {e}"))?;
            resp["choices"][0]["message"]["content"]
                .as_str()
                .map(String::from)
                .ok_or_else(|| "lmstudio: no content in response".into())
        }
        "codex" => {
            let args = codex_args(codex_model.as_deref());
            let mut child = Command::new(codex_bin())
                .args(&args)
                .env("LOGIC_LOOP_TAB_ID", crate::ingest::EXTRACTOR_TETHER)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| format!("codex spawn: {e}"))?;
            child
                .stdin
                .take()
                .ok_or("codex: no stdin")?
                .write_all(prompt.as_bytes())
                .map_err(|e| format!("codex stdin: {e}"))?;
            let out = wait_with_timeout(child, "codex")?;
            if !out.status.success() {
                return Err(format!("codex exited {}", out.status));
            }
            codex_final_message(&out.stdout)
        }
        _ => {
            let mut child = Command::new(claude_bin())
                .args(["-p", "--output-format", "text", "--model", "sonnet"])
                // The child inherits the user's hooks and will post back to our
                // ingest server; the tether tells the server to drop it.
                .env("LOGIC_LOOP_TAB_ID", crate::ingest::EXTRACTOR_TETHER)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| format!("claude spawn: {e}"))?;
            child
                .stdin
                .take()
                .ok_or("claude: no stdin")?
                .write_all(prompt.as_bytes())
                .map_err(|e| format!("claude stdin: {e}"))?;
            let out = wait_with_timeout(child, "claude")?;
            if !out.status.success() {
                return Err(format!("claude exited {}", out.status));
            }
            Ok(String::from_utf8_lossy(&out.stdout).into_owned())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_output_uses_only_the_final_agent_message() {
        let stdout = br#"
{"type":"thread.started","thread_id":"redacted"}
{"type":"item.completed","item":{"type":"reasoning","text":"ignore"}}
{"type":"item.completed","item":{"type":"agent_message","text":"first"}}
not json
{"type":"item.completed","item":{"type":"agent_message","text":"final"}}
{"type":"turn.completed"}
"#;
        assert_eq!(codex_final_message(stdout).unwrap(), "final");
    }

    #[test]
    fn codex_output_requires_a_nonempty_agent_message() {
        let stdout = br#"{"type":"turn.completed"}
{"type":"item.completed","item":{"type":"function_call","text":"tool"}}"#;
        assert!(codex_final_message(stdout).is_err());
    }

    #[test]
    fn codex_args_are_ephemeral_read_only_json_and_stdin_based() {
        let args = codex_args(None);
        assert_eq!(args, ["exec", "--ephemeral", "--sandbox", "read-only", "--skip-git-repo-check", "--json", "-"]);
        let with_model = codex_args(Some("configured-model"));
        assert!(with_model.windows(2).any(|pair| pair == ["-m", "configured-model"]));
    }
}
