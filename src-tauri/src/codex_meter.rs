use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

const MAX_OUTPUT: usize = 256_000;
const MAX_BUCKETS: usize = 8;

fn codex_binary() -> String {
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            let candidate = dir.join("codex");
            if candidate.is_file() { return candidate.to_string_lossy().into_owned(); }
        }
    }
    // GUI apps launched from /Applications often have a minimal PATH.
    for path in ["/opt/homebrew/bin/codex", "/usr/local/bin/codex"] {
        if std::path::Path::new(path).is_file() { return path.into(); }
    }
    "codex".into()
}

fn valid_session_id(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) { b == b'-' } else { b.is_ascii_hexdigit() }
        })
}

fn write_message(stdin: &mut impl Write, value: &Value) -> Result<(), String> {
    writeln!(stdin, "{value}").map_err(|e| e.to_string())
}

fn window(value: &Value) -> Option<Value> {
    let used = value.get("usedPercent")?.as_f64()?;
    let duration = value.get("windowDurationMins")?.as_u64()?;
    let reset = value.get("resetsAt")?.as_u64()?;
    if !used.is_finite() || !(0.0..=100.0).contains(&used) || !(1..=100_800).contains(&duration) || reset == 0 {
        return None;
    }
    Some(json!({"usedPercent": used, "windowDurationMins": duration, "resetsAt": reset}))
}

fn parse_responses(lines: &[Value], session_id: &str) -> Result<Value, String> {
    let response = |id| lines.iter().find(|v| v.get("id").and_then(Value::as_i64) == Some(id));
    let thread = response(3).ok_or("thread response missing")?;
    let model = thread.pointer("/result/thread/model").and_then(Value::as_str)
        .filter(|_| thread.pointer("/result/thread/id").and_then(Value::as_str) == Some(session_id))
        .filter(|s| !s.is_empty() && s.len() <= 128);
    let account = response(1).ok_or("account response missing")?;
    let account_type = account.pointer("/result/account/type").and_then(Value::as_str).unwrap_or("none");
    if matches!(account_type, "none" | "apikey" | "apiKey" | "amazonBedrock") {
        return Ok(json!({"state":"unavailable", "model":model, "buckets":[]}));
    }
    let rates = response(2).ok_or("rate limits response missing")?;
    if let Some(error) = rates.get("error") { return Err(format!("rate limits unavailable: {error}")); }
    let mut buckets = Vec::new();
    if let Some(named) = rates.pointer("/result/rateLimitsByLimitId").and_then(Value::as_object) {
        for (key, bucket) in named.iter().take(MAX_BUCKETS) {
            if key.len() > 80 { continue; }
            let name = bucket.get("limitName").and_then(Value::as_str).filter(|s| !s.is_empty() && s.len() <= 80).unwrap_or(key);
            buckets.push(json!({"id":key, "name":name, "primary":window(&bucket["primary"]), "secondary":window(&bucket["secondary"])}));
        }
    } else if let Some(bucket) = rates.pointer("/result/rateLimits") {
        buckets.push(json!({"id":"codex", "name":"Codex", "primary":window(&bucket["primary"]), "secondary":window(&bucket["secondary"])}));
    }
    Ok(json!({"state":"available", "model":model, "buckets":buckets}))
}

fn read_snapshot(session_id: &str) -> Result<Value, String> {
    if !valid_session_id(session_id) { return Err("invalid Codex session ID".into()); }
    let mut child = Command::new(codex_binary()).args(["app-server", "--stdio"])
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null())
        .spawn().map_err(|e| format!("Codex app-server unavailable: {e}"))?;
    let stdout = child.stdout.take().ok_or("Codex stdout missing")?;
    let (tx, rx) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        let mut lines = Vec::new();
        let mut total = 0;
        for line in BufReader::new(stdout).lines() {
            let line = match line { Ok(line) => line, Err(_) => break };
            total += line.len();
            if total > MAX_OUTPUT { break; }
            if let Ok(value) = serde_json::from_str::<Value>(&line) {
                if value.get("id").and_then(Value::as_i64).is_some() { let _ = tx.send(value.clone()); }
                lines.push(value);
            }
        }
        lines
    });
    let mut stdin = child.stdin.take().ok_or("Codex stdin missing")?;
    write_message(&mut stdin, &json!({"method":"initialize","id":0,"params":{"clientInfo":{"name":"logic_loop","title":"Logic Loop","version":"0.1.0"}}}))?;
    let init = match rx.recv_timeout(Duration::from_secs(3)) {
        Ok(value) => value,
        Err(_) => { let _ = child.kill(); let _ = child.wait(); return Err("Codex app-server initialization timed out".into()); }
    };
    if init.get("error").is_some() { let _ = child.kill(); let _ = child.wait(); return Err("Codex app-server rejected initialization".into()); }
    write_message(&mut stdin, &json!({"method":"initialized"}))?;
    write_message(&mut stdin, &json!({"method":"account/read","id":1,"params":{"refreshToken":false}}))?;
    write_message(&mut stdin, &json!({"method":"account/rateLimits/read","id":2}))?;
    write_message(&mut stdin, &json!({"method":"thread/read","id":3,"params":{"threadId":session_id,"includeTurns":false}}))?;
    let mut received = [false; 3];
    let response_deadline = Instant::now() + Duration::from_secs(6);
    while !received.iter().all(|value| *value) {
        let remaining = response_deadline.saturating_duration_since(Instant::now());
        let Ok(value) = rx.recv_timeout(remaining) else {
            let _ = child.kill(); let _ = child.wait();
            return Err("Codex app-server read timed out".into());
        };
        if let Some(id @ 1..=3) = value.get("id").and_then(Value::as_i64) {
            received[(id - 1) as usize] = true;
        }
    }
    drop(stdin);
    let deadline = Instant::now() + Duration::from_secs(6);
    loop {
        if child.try_wait().map_err(|e| e.to_string())?.is_some() { break; }
        if Instant::now() >= deadline {
            let _ = child.kill(); let _ = child.wait();
            return Err("Codex app-server read timed out".into());
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    let lines = reader.join().map_err(|_| "Codex response reader failed")?;
    parse_responses(&lines, session_id)
}

#[tauri::command]
pub async fn codex_meter_read(session_id: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || read_snapshot(&session_id))
        .await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    const ID: &str = "01a0b398-ad50-73e2-8842-097683f1b287";
    #[test]
    fn parses_named_buckets_without_combining_windows() {
        let lines = vec![json!({"id":1,"result":{"account":{"type":"chatgpt"}}}), json!({"id":2,"result":{"rateLimitsByLimitId":{"codex":{"primary":{"usedPercent":4,"windowDurationMins":300,"resetsAt":1789737586},"secondary":null},"base_model_inference":{"primary":{"usedPercent":0,"windowDurationMins":10080,"resetsAt":1789866931}}}}}), json!({"id":3,"result":{"thread":{"id":ID,"model":"gpt-5.6-sol"}}})];
        let result = parse_responses(&lines, ID).unwrap();
        assert_eq!(result["model"], "gpt-5.6-sol");
        assert_eq!(result["buckets"].as_array().unwrap().len(), 2);
        assert!(result["buckets"].as_array().unwrap().iter().any(|b| b["secondary"].is_null()));
    }
    #[test]
    fn rejects_invalid_window_and_wrong_thread() {
        assert!(window(&json!({"usedPercent":101,"windowDurationMins":300,"resetsAt":1})).is_none());
        assert!(!valid_session_id("not-a-session"));
        let lines = vec![json!({"id":1,"result":{"account":{"type":"chatgpt"}}}), json!({"id":2,"result":{"rateLimits":{}}}), json!({"id":3,"result":{"thread":{"id":"wrong","model":"gpt-5"}}})];
        assert!(parse_responses(&lines, ID).unwrap()["model"].is_null());
    }
    #[test]
    #[ignore = "requires an installed, authenticated local Codex CLI"]
    fn live_read_only_app_server_round_trip() {
        let id = std::env::var("LOGIC_LOOP_CODEX_TEST_SESSION").expect("set a local CLI rollout session ID");
        let result = read_snapshot(&id).unwrap();
        assert_eq!(result["state"], "available");
        assert!(result["model"].as_str().is_some());
    }
}
