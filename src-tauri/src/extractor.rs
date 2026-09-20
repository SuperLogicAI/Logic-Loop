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

/// Minimal-context instruction: the extraction/reconciliation prompts already
/// spell out their own JSON contract, this just keeps the CLI's default
/// assistant persona from padding the reply.
const CLAUDE_SYSTEM_PROMPT: &str =
    "You output only the JSON object specified by the user prompt. No prose, no code fences, no explanation.";

/// Strips the `claude -p` child down to a bare completion call: no MCP
/// servers, no built-in tools, no user/project/local settings (so no
/// CLAUDE.md discovery), no session file. Cuts fixed per-call overhead from
/// ~57k tokens (every configured MCP server's tool schema, every skill
/// description) to ~1.4k — measured live, see PLAN.md's Phase 33.1 table.
/// `--bare` was considered and rejected: it forces API-key auth and breaks
/// OAuth / Max-subscription logins.
fn claude_args(model: &str) -> Vec<String> {
    vec![
        "-p".into(),
        "--output-format".into(),
        "json".into(),
        "--model".into(),
        model.into(),
        "--strict-mcp-config".into(),
        "--tools".into(),
        "".into(),
        "--setting-sources".into(),
        "".into(),
        "--no-session-persistence".into(),
        "--system-prompt".into(),
        CLAUDE_SYSTEM_PROMPT.into(),
    ]
}

fn claude_result(stdout: &[u8]) -> Result<String, String> {
    let value: serde_json::Value =
        serde_json::from_slice(stdout).map_err(|e| format!("claude: bad json output: {e}"))?;
    if let Some(usage) = value.get("usage") {
        eprintln!(
            "extractor: claude usage input_tokens={} cache_creation_input_tokens={} cache_read_input_tokens={}",
            usage.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0),
            usage.get("cache_creation_input_tokens").and_then(|v| v.as_u64()).unwrap_or(0),
            usage.get("cache_read_input_tokens").and_then(|v| v.as_u64()).unwrap_or(0),
        );
    }
    value
        .get("result")
        .and_then(|v| v.as_str())
        .map(String::from)
        .ok_or_else(|| "claude: no result field in json output".into())
}

/// Total request deadline (connect + send + full body read) for the LM
/// Studio HTTP call. Without this, a stalled local model hangs `ureq`
/// forever on this `spawn_blocking` thread, and `extractorQueue.ts`'s
/// serialized `queue.then(fn, fn)` never sees the call settle — every later
/// queued extraction/landing/commit-message call is blocked behind it
/// permanently. Reuses `EXTRACTOR_TIMEOUT` for one deadline policy across
/// every backend.
fn lmstudio_extract(url: &str, body: &serde_json::Value, timeout: Duration) -> Result<String, String> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(timeout))
        .build()
        .into();
    let resp: serde_json::Value = agent
        .post(format!("{url}/v1/chat/completions"))
        .send_json(body)
        .map_err(|e| format!("lmstudio: {e}"))?
        .body_mut()
        .read_json()
        .map_err(|e| format!("lmstudio parse: {e}"))?;
    resp["choices"][0]["message"]["content"]
        .as_str()
        .map(String::from)
        .ok_or_else(|| "lmstudio: no content in response".into())
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
    let mut completed = false;
    let mut failed = false;
    for line in String::from_utf8_lossy(stdout).lines() {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if value["type"] == "turn.failed" || value["type"] == "error" {
            failed = true;
        }
        if value["type"] == "turn.completed" {
            completed = true;
            if let Some(usage) = value.get("usage") {
                eprintln!(
                    "extractor: codex usage input_tokens={} cached_input_tokens={} output_tokens={} reasoning_output_tokens={}",
                    usage.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0),
                    usage.get("cached_input_tokens").and_then(|v| v.as_u64()).unwrap_or(0),
                    usage.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(0),
                    usage.get("reasoning_output_tokens").and_then(|v| v.as_u64()).unwrap_or(0),
                );
            }
        }
        if value["type"] == "item.completed"
            && value["item"]["type"] == "agent_message"
            && value["item"]["text"].is_string()
        {
            final_text = value["item"]["text"].as_str().map(String::from);
        }
    }
    if failed {
        return Err("codex: turn failed".into());
    }
    if !completed {
        return Err("codex: turn did not complete".into());
    }
    final_text.filter(|text| !text.is_empty()).ok_or_else(|| "codex: no final message".into())
}

/// Run the extraction prompt against the chosen backend, return raw LLM text.
/// Must stay `async fn` dispatching onto `spawn_blocking`, not just `async
/// fn`: marking it async alone (tried 2026-09-12) only moves the call onto a
/// tokio *cooperative* worker thread, which `wait_with_timeout`'s
/// `std::thread::sleep` busy-poll (and lmstudio's blocking `ureq` call) then
/// occupies synchronously for the CLI's full wall-clock time (~20-28s
/// observed) with no `.await` yield point — Tauri's own docs warn this
/// specifically freezes the app, because it starves every other cooperative
/// task sharing that worker (PTY streaming, tailers, the ingest server) the
/// same way blocking the main thread did before. `spawn_blocking` moves the
/// whole synchronous body onto tokio's separate blocking-thread pool, which
/// is never used for cooperative scheduling.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn run_extractor(
    prompt: String,
    backend: String,
    lmstudio_url: Option<String>,
    lmstudio_model: Option<String>,
    ollama_url: Option<String>,
    ollama_model: Option<String>,
    codex_model: Option<String>,
    model: Option<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_extractor_blocking(
            prompt, backend, lmstudio_url, lmstudio_model, ollama_url, ollama_model, codex_model, model,
        )
    })
    .await
    .map_err(|e| format!("extractor task panicked: {e}"))?
}

#[allow(clippy::too_many_arguments)]
fn run_extractor_blocking(
    prompt: String,
    backend: String,
    lmstudio_url: Option<String>,
    lmstudio_model: Option<String>,
    ollama_url: Option<String>,
    ollama_model: Option<String>,
    codex_model: Option<String>,
    model: Option<String>,
) -> Result<String, String> {
    let model = model.filter(|m| !m.is_empty()).unwrap_or_else(|| "sonnet".into());
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
            lmstudio_extract(&url, &body, EXTRACTOR_TIMEOUT)
        }
        // Ollama's `/v1/chat/completions` is OpenAI-compatible, same request/
        // response shape LM Studio uses — reuses `lmstudio_extract` as-is.
        // Unlike LM Studio, Ollama has no "whatever's loaded" default: the
        // model field is required or the call 400s, so an empty override
        // falls back to a common default pull rather than omitting it.
        "ollama" => {
            let url = ollama_url.unwrap_or_else(|| "http://127.0.0.1:11434".into());
            let m = ollama_model.filter(|m| !m.is_empty()).unwrap_or_else(|| "llama3.2".into());
            let body = serde_json::json!({
                "messages": [{ "role": "user", "content": prompt }],
                "model": m,
                "temperature": 0
            });
            lmstudio_extract(&url, &body, EXTRACTOR_TIMEOUT)
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
                .args(claude_args(&model))
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
            claude_result(&out.stdout)
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
    fn codex_output_rejects_a_failed_or_incomplete_turn() {
        let failed = br#"{"type":"item.completed","item":{"type":"agent_message","text":"stale"}}
{"type":"turn.failed"}"#;
        let incomplete = br#"{"type":"item.completed","item":{"type":"agent_message","text":"stale"}}"#;
        assert!(codex_final_message(failed).is_err());
        assert!(codex_final_message(incomplete).is_err());
    }

    #[test]
    fn codex_output_tolerates_missing_usage() {
        let stdout = br#"{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}
{"type":"turn.completed"}"#;
        assert_eq!(codex_final_message(stdout).unwrap(), "ok");
    }

    #[test]
    fn claude_args_are_stripped_to_a_bare_json_completion() {
        let args = claude_args("sonnet");
        assert_eq!(
            args,
            [
                "-p",
                "--output-format",
                "json",
                "--model",
                "sonnet",
                "--strict-mcp-config",
                "--tools",
                "",
                "--setting-sources",
                "",
                "--no-session-persistence",
                "--system-prompt",
                CLAUDE_SYSTEM_PROMPT,
            ]
        );
        assert_eq!(claude_args("haiku")[4], "haiku");
    }

    #[test]
    fn claude_result_extracts_result_field_and_tolerates_missing_usage() {
        assert_eq!(
            claude_result(br#"{"result":"{\"decisions\":[]}"}"#).unwrap(),
            r#"{"decisions":[]}"#
        );
        assert_eq!(
            claude_result(br#"{"usage":{"input_tokens":2},"result":"ok"}"#).unwrap(),
            "ok"
        );
        assert!(claude_result(b"not json").is_err());
        assert!(claude_result(br#"{"usage":{}}"#).is_err(), "missing result field");
    }

    #[test]
    fn lmstudio_request_respects_a_total_deadline() {
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            // Accept the connection but never write a response — simulates a
            // stalled local model that never finishes generating.
            if let Ok((stream, _)) = listener.accept() {
                std::thread::sleep(Duration::from_secs(5));
                drop(stream);
            }
        });
        let url = format!("http://{addr}");
        let body = serde_json::json!({ "messages": [], "temperature": 0 });
        let start = Instant::now();
        let result = lmstudio_extract(&url, &body, Duration::from_millis(300));
        assert!(result.is_err(), "a withheld response must fail, not hang forever");
        assert!(
            start.elapsed() < Duration::from_secs(2),
            "must fail near the configured deadline, not block indefinitely: took {:?}",
            start.elapsed()
        );
    }

    #[test]
    fn codex_args_are_ephemeral_read_only_json_and_stdin_based() {
        let args = codex_args(None);
        assert_eq!(args, ["exec", "--ephemeral", "--sandbox", "read-only", "--skip-git-repo-check", "--json", "-"]);
        let with_model = codex_args(Some("configured-model"));
        assert_eq!(
            with_model,
            [
                "exec",
                "--ephemeral",
                "--sandbox",
                "read-only",
                "--skip-git-repo-check",
                "--json",
                "-m",
                "configured-model",
                "-",
            ]
        );
    }
}
