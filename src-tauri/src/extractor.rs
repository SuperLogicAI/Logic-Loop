use std::io::Write;
use std::process::{Command, Stdio};

fn claude_bin() -> String {
    let local = format!(
        "{}/.local/bin/claude",
        std::env::var("HOME").unwrap_or_default()
    );
    if std::path::Path::new(&local).exists() {
        local
    } else {
        "claude".into() // hope it's on PATH
    }
}

/// Run the extraction prompt against the chosen backend, return raw LLM text.
/// Blocking is fine: Tauri runs commands off the main thread.
#[tauri::command]
pub fn run_extractor(
    prompt: String,
    backend: String,
    lmstudio_url: Option<String>,
    lmstudio_model: Option<String>,
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
        _ => {
            let mut child = Command::new(claude_bin())
                .args(["-p", "--output-format", "text", "--model", "sonnet"])
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
            let out = child
                .wait_with_output()
                .map_err(|e| format!("claude wait: {e}"))?;
            if !out.status.success() {
                return Err(format!("claude exited {}", out.status));
            }
            Ok(String::from_utf8_lossy(&out.stdout).into_owned())
        }
    }
}
