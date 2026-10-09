//! Plan 059: usage-only reader for the token spend meter.
//!
//! Separate from `ingest`'s transcript tailer on purpose: it backfills whole
//! files, follows parent *and* child rollouts, and must never feed
//! `ingest://transcript` (extraction), the events table or detectors. It
//! emits only validated numeric usage on `usage://records` and per-thread
//! coverage on `usage://thread`; the frontend writes through `repo.ts`.
//!
//! Parsing selects envelope types, ids, timestamps and numeric usage only.
//! Message content passes through the JSON decoder and is never kept.

use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

const RESCAN: Duration = Duration::from_secs(15);
const POLL: Duration = Duration::from_secs(1);
const BATCH: usize = 500;

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ThreadMeta {
    root: String,
    thread: String,
    /// "main", "worker", or Codex's own label for an internal child (e.g. "guardian").
    kind: String,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub(crate) struct UsageRec {
    agent: &'static str,
    root_session_id: String,
    thread_id: String,
    response_id: String,
    source_ts: i64,
    source_path: String,
    source_offset: u64,
    /// Total input including cache reads and writes (normalized per adapter).
    input: u64,
    cache_read: u64,
    cache_write: u64,
    output: u64,
}

#[derive(Clone, Debug, serde::Serialize)]
struct RecordBatch {
    tab_id: Option<String>,
    project_key: Option<String>,
    records: Vec<UsageRec>,
}

#[derive(Clone, Debug, serde::Serialize)]
struct ThreadHealth {
    agent: &'static str,
    root_session_id: String,
    thread_id: String,
    kind: String,
    tab_id: Option<String>,
    project_key: Option<String>,
    /// pending (no completed turn yet) | recorded | unsupported (turns but no
    /// usage records — older CLI or format change) | unreadable
    status: &'static str,
}

#[derive(Clone, Default)]
struct RootInfo {
    tab_id: Option<String>,
    project_key: Option<String>,
}

#[derive(Default)]
struct Inner {
    roots: HashMap<String, RootInfo>,
    index: HashMap<PathBuf, ThreadMeta>,
    not_rollouts: HashSet<PathBuf>,
    readers: HashSet<PathBuf>,
}

#[derive(Default)]
pub struct UsageState {
    inner: Mutex<Inner>,
    poke: Mutex<Option<Sender<()>>>,
}

/// RFC 3339 (`2026-10-07T18:15:11.292Z` or `+hh:mm`) to epoch ms.
pub(crate) fn rfc3339_ms(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 20 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' || b[16] != b':' {
        return None;
    }
    let n = |r: std::ops::Range<usize>| s.get(r)?.parse::<i64>().ok();
    let (y, mo, d, h, mi, se) = (n(0..4)?, n(5..7)?, n(8..10)?, n(11..13)?, n(14..16)?, n(17..19)?);
    let mut i = 19;
    let mut ms = 0;
    if b.get(i) == Some(&b'.') {
        let start = i + 1;
        i = start;
        while b.get(i).is_some_and(|c| c.is_ascii_digit()) {
            i += 1;
        }
        let frac = s.get(start..i)?;
        ms = format!("{frac:0<3}").get(0..3)?.parse::<i64>().ok()?;
    }
    let offset_min = match b.get(i) {
        Some(b'Z') => 0,
        Some(&sign @ (b'+' | b'-')) => {
            let oh = n(i + 1..i + 3)?;
            let om = n(i + 4..i + 6)?;
            let v = oh * 60 + om;
            if sign == b'+' { v } else { -v }
        }
        _ => return None,
    };
    // days_from_civil (Howard Hinnant).
    let yy = if mo <= 2 { y - 1 } else { y };
    let era = yy.div_euclid(400);
    let yoe = yy - era * 400;
    let mp = (mo + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    Some(((days * 86400 + h * 3600 + mi * 60 + se) - offset_min * 60) * 1000 + ms)
}

fn str_field<'a>(v: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(|x| x.as_str()).filter(|s| !s.is_empty())
}

/// Codex rollout first line. Ids only; the payload's instruction text is ignored.
pub(crate) fn parse_session_meta(line: &str) -> Option<ThreadMeta> {
    if !line.contains("\"session_meta\"") {
        return None;
    }
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    if v.get("type")?.as_str()? != "session_meta" {
        return None;
    }
    let p = v.get("payload")?;
    let thread = str_field(p, "id")?.to_string();
    let root = str_field(p, "session_id").unwrap_or(&thread).to_string();
    let kind = match p.get("source").and_then(|s| s.get("subagent")) {
        None => "main".to_string(),
        Some(sub) => {
            if sub.get("thread_spawn").is_some() {
                "worker".to_string()
            } else {
                // e.g. {"other": "guardian"} — keep a short label only.
                sub.get("other")
                    .and_then(|o| o.as_str())
                    .filter(|s| s.len() <= 32 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'))
                    .unwrap_or("child")
                    .to_string()
            }
        }
    };
    Some(ThreadMeta { root, thread, kind })
}

fn count(u: &serde_json::Value, key: &str) -> Option<u64> {
    match u.get(key) {
        None | Some(serde_json::Value::Null) => Some(0),
        Some(v) => v.as_u64(),
    }
}

/// One `token_usage_record` line → a validated record. Codex `input_tokens`
/// already includes cached and cache-write input.
pub(crate) fn parse_codex_usage(line: &str, path: &str, offset: u64) -> Option<UsageRec> {
    if !line.contains("\"token_usage_record\"") {
        return None; // cheap skip for every other rollout line
    }
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    if v.get("type")?.as_str()? != "token_usage_record" {
        return None;
    }
    let p = v.get("payload")?;
    let u = p.get("usage")?;
    let input = count(u, "input_tokens")?;
    let cache_read = count(u, "cached_input_tokens")?;
    let cache_write = count(u, "cache_write_input_tokens")?;
    let output = count(u, "output_tokens")?;
    Some(UsageRec {
        agent: "codex",
        root_session_id: str_field(p, "session_id")?.to_string(),
        thread_id: str_field(p, "thread_id")?.to_string(),
        response_id: str_field(p, "response_id")?.to_string(),
        source_ts: rfc3339_ms(str_field(&v, "timestamp")?)?,
        source_path: path.to_string(),
        source_offset: offset,
        input,
        cache_read,
        cache_write,
        output,
    })
}

fn is_turn_complete(line: &str) -> bool {
    line.contains("\"task_complete\"")
        && serde_json::from_str::<serde_json::Value>(line).is_ok_and(|v| {
            v.get("type").and_then(|t| t.as_str()) == Some("event_msg")
                && v.get("payload").and_then(|p| p.get("type")).and_then(|t| t.as_str()) == Some("task_complete")
        })
}

#[derive(Default, Debug)]
pub(crate) struct ScanOut {
    records: Vec<UsageRec>,
    turns: usize,
    /// Offset just past the last complete line; a partial last line is retried.
    end: u64,
}

/// Read complete lines from `offset`. Never consumes a line without its `\n`.
pub(crate) fn scan_from(path: &Path, offset: u64) -> std::io::Result<ScanOut> {
    let mut f = File::open(path)?;
    let len = f.metadata()?.len();
    let start = if len < offset { 0 } else { offset }; // truncated/replaced: re-read (dedupe absorbs it)
    f.seek(SeekFrom::Start(start))?;
    let mut r = BufReader::new(f.take(len - start));
    let mut out = ScanOut { end: start, ..Default::default() };
    let path_s = path.to_string_lossy().into_owned();
    let mut buf = Vec::new();
    loop {
        buf.clear();
        let n = r.read_until(b'\n', &mut buf)?;
        if n == 0 || buf.last() != Some(&b'\n') {
            break;
        }
        let line = String::from_utf8_lossy(&buf);
        if let Some(rec) = parse_codex_usage(&line, &path_s, out.end) {
            out.records.push(rec);
        } else if is_turn_complete(&line) {
            out.turns += 1;
        }
        out.end += n as u64;
    }
    Ok(out)
}

fn first_line(path: &Path) -> Option<String> {
    let f = File::open(path).ok()?;
    let mut buf = Vec::new();
    // ponytail: first line carries base instructions (tens of KB); 4 MB cap.
    BufReader::new(f.take(4 << 20)).read_until(b'\n', &mut buf).ok()?;
    (buf.last() == Some(&b'\n')).then(|| String::from_utf8_lossy(&buf).into_owned())
}

pub(crate) fn rollouts_under(dir: &Path, out: &mut Vec<PathBuf>, depth: u8) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            if depth > 0 {
                rollouts_under(&p, out, depth - 1);
            }
        } else if p
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.starts_with("rollout-") && n.ends_with(".jsonl"))
        {
            out.push(p);
        }
    }
}

fn sessions_dir() -> Option<PathBuf> {
    crate::home::home().map(|h| PathBuf::from(h).join(".codex").join("sessions"))
}

/// Register a Codex root session seen on a hook, then wake discovery.
pub fn watch(app: &AppHandle, root: &str, tab_id: Option<&str>, project_key: Option<&str>) {
    if root.is_empty() {
        return;
    }
    let state = app.state::<UsageState>();
    {
        let Ok(mut inner) = state.inner.lock() else { return };
        let info = inner.roots.entry(root.to_string()).or_default();
        if info.tab_id.is_none() {
            info.tab_id = tab_id.filter(|t| !t.is_empty()).map(str::to_string);
        }
        if info.project_key.is_none() {
            info.project_key = project_key.filter(|k| !k.is_empty()).map(str::to_string);
        }
    }
    if let Ok(poke) = state.poke.lock() {
        if let Some(tx) = poke.as_ref() {
            let _ = tx.send(());
        }
    };
}

pub fn start(app: AppHandle) {
    let (tx, rx) = channel();
    if let Ok(mut poke) = app.state::<UsageState>().poke.lock() {
        *poke = Some(tx);
    }
    std::thread::spawn(move || discovery_loop(app, rx));
}

fn discovery_loop(app: AppHandle, rx: Receiver<()>) {
    loop {
        // Wakes on a new root or every RESCAN — guardian/internal children
        // fire no hooks, so the periodic scan is what finds them.
        let _ = rx.recv_timeout(RESCAN);
        while rx.try_recv().is_ok() {}
        if let Some(dir) = sessions_dir() {
            discover(&app, &dir);
        }
    }
}

fn discover(app: &AppHandle, dir: &Path) {
    let state = app.state::<UsageState>();
    if state.inner.lock().map(|i| i.roots.is_empty()).unwrap_or(true) {
        return;
    }
    let mut files = Vec::new();
    rollouts_under(dir, &mut files, 4); // all YYYY/MM/DD dirs: resumes and children cross dates
    let mut start = Vec::new();
    {
        let Ok(mut inner) = state.inner.lock() else { return };
        for f in files {
            if inner.index.contains_key(&f) || inner.not_rollouts.contains(&f) {
                continue;
            }
            match first_line(&f) {
                None => {} // empty or first line still being written: retry next scan
                Some(line) => match parse_session_meta(&line) {
                    Some(meta) => {
                        inner.index.insert(f, meta);
                    }
                    None => {
                        inner.not_rollouts.insert(f);
                    }
                },
            }
        }
        let wanted: Vec<(PathBuf, ThreadMeta)> = inner
            .index
            .iter()
            .filter(|(p, m)| inner.roots.contains_key(&m.root) && !inner.readers.contains(*p))
            .map(|(p, m)| (p.clone(), m.clone()))
            .collect();
        for (p, m) in wanted {
            inner.readers.insert(p.clone());
            start.push((p, m));
        }
    }
    for (path, meta) in start {
        let app = app.clone();
        // ponytail: one polling thread per rollout file, alive until app exit
        // (same model as ingest's tailer); switch to notify/kqueue if counts grow.
        std::thread::spawn(move || read_loop(app, path, meta));
    }
}

fn root_info(app: &AppHandle, root: &str) -> RootInfo {
    app.state::<UsageState>()
        .inner
        .lock()
        .ok()
        .and_then(|i| i.roots.get(root).cloned())
        .unwrap_or_default()
}

fn read_loop(app: AppHandle, path: PathBuf, meta: ThreadMeta) {
    let mut offset = 0u64; // backfill the whole file; INSERT OR IGNORE dedupes replays
    let mut recorded = false;
    let mut turns = 0usize;
    let mut last_status = "";
    loop {
        let info = root_info(&app, &meta.root);
        let status = match scan_from(&path, offset) {
            Ok(out) => {
                offset = out.end;
                turns += out.turns;
                if !out.records.is_empty() {
                    recorded = true;
                    for chunk in out.records.chunks(BATCH) {
                        let _ = app.emit(
                            "usage://records",
                            RecordBatch { tab_id: info.tab_id.clone(), project_key: info.project_key.clone(), records: chunk.to_vec() },
                        );
                    }
                }
                if recorded {
                    "recorded"
                } else if turns > 0 {
                    "unsupported"
                } else {
                    "pending"
                }
            }
            Err(_) => "unreadable",
        };
        if status != last_status {
            last_status = status;
            let _ = app.emit(
                "usage://thread",
                ThreadHealth {
                    agent: "codex",
                    root_session_id: meta.root.clone(),
                    thread_id: meta.thread.clone(),
                    kind: meta.kind.clone(),
                    tab_id: info.tab_id.clone(),
                    project_key: info.project_key.clone(),
                    status,
                },
            );
        }
        std::thread::sleep(POLL);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ll-usage-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    const META_MAIN: &str = r#"{"timestamp":"2026-10-07T18:13:37.000Z","type":"session_meta","payload":{"id":"T1","session_id":"T1","source":"cli","base_instructions":{"text":"ignored"}}}"#;
    const META_WORKER: &str = r#"{"timestamp":"2026-10-07T18:15:03.671Z","type":"session_meta","payload":{"id":"T2","session_id":"T1","source":{"subagent":{"thread_spawn":{"parent_thread_id":"T1","agent_nickname":"x"}}}}}"#;
    const META_GUARD: &str = r#"{"type":"session_meta","payload":{"id":"T3","session_id":"T1","source":{"subagent":{"other":"guardian"}}}}"#;

    fn rec(thread: &str, resp: &str, ts: &str, input: u64, read: u64, out: u64) -> String {
        format!(
            r#"{{"timestamp":"{ts}","type":"token_usage_record","payload":{{"thread_id":"{thread}","turn_id":"u","session_id":"T1","root_turn_id":"u","response_id":"{resp}","usage":{{"input_tokens":{input},"cached_input_tokens":{read},"cache_write_input_tokens":0,"output_tokens":{out},"reasoning_output_tokens":0,"total_tokens":{}}}}}}}"#,
            input + out
        )
    }

    #[test]
    fn rfc3339_parses_utc_offsets_and_fractions() {
        assert_eq!(rfc3339_ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(rfc3339_ms("1970-01-01T00:00:01.5Z"), Some(1500));
        assert_eq!(rfc3339_ms("2026-10-07T18:15:11.292Z"), Some(1_791_396_911_292));
        assert_eq!(rfc3339_ms("1970-01-01T01:00:00+01:00"), Some(0));
        assert_eq!(rfc3339_ms("not a time"), None);
    }

    #[test]
    fn session_meta_kinds() {
        assert_eq!(parse_session_meta(META_MAIN).unwrap(), ThreadMeta { root: "T1".into(), thread: "T1".into(), kind: "main".into() });
        assert_eq!(parse_session_meta(META_WORKER).unwrap().kind, "worker");
        let g = parse_session_meta(META_GUARD).unwrap();
        assert_eq!((g.root.as_str(), g.thread.as_str(), g.kind.as_str()), ("T1", "T3", "guardian"));
        assert!(parse_session_meta(&rec("T1", "r", "2026-10-07T18:15:11Z", 1, 0, 1)).is_none());
    }

    #[test]
    fn usage_record_validates_and_keeps_numbers_only() {
        let r = parse_codex_usage(&rec("T2", "r1", "2026-10-07T18:15:11.292Z", 17627, 7808, 93), "/p", 42).unwrap();
        assert_eq!((r.input, r.cache_read, r.cache_write, r.output), (17627, 7808, 0, 93));
        assert_eq!((r.thread_id.as_str(), r.response_id.as_str(), r.source_offset), ("T2", "r1", 42));
        assert_eq!(r.source_ts, 1_791_396_911_292);
        let negative = rec("T2", "r1", "2026-10-07T18:15:11Z", 1, 0, 1).replace("\"output_tokens\":1", "\"output_tokens\":-1");
        assert!(parse_codex_usage(&negative, "/p", 0).is_none());
        let no_resp = rec("T2", "", "2026-10-07T18:15:11Z", 1, 0, 1);
        assert!(parse_codex_usage(&no_resp, "/p", 0).is_none());
    }

    #[test]
    fn scan_keeps_offsets_and_retries_a_partial_line() {
        let d = tmp("scan");
        let p = d.join("rollout-x.jsonl");
        let l1 = format!("{META_MAIN}\n");
        let l2 = format!("{}\n", rec("T1", "r1", "2026-10-07T18:15:11Z", 10, 0, 1));
        let done = "{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_complete\"}}\n";
        let l3 = rec("T1", "r2", "2026-10-07T18:16:11Z", 20, 5, 2); // no newline yet
        std::fs::write(&p, format!("{l1}{l2}{done}{l3}")).unwrap();
        let a = scan_from(&p, 0).unwrap();
        assert_eq!(a.records.len(), 1);
        assert_eq!(a.records[0].source_offset, l1.len() as u64);
        assert_eq!(a.turns, 1);
        assert_eq!(a.end, (l1.len() + l2.len() + done.len()) as u64);
        std::fs::OpenOptions::new().append(true).open(&p).unwrap().write_all(b"\n").unwrap();
        let b = scan_from(&p, a.end).unwrap();
        assert_eq!(b.records.len(), 1);
        assert_eq!(b.records[0].response_id, "r2");
        assert_eq!(b.records[0].source_offset, a.end);
        // Replaced by a shorter file: start over (dedupe by path + offset absorbs replays).
        std::fs::write(&p, &l1).unwrap();
        assert_eq!(scan_from(&p, b.end).unwrap().end, l1.len() as u64);
    }

    #[test]
    fn discovery_walks_every_date_dir() {
        let d = tmp("walk");
        for (rel, line) in [("2026/10/02/rollout-a.jsonl", META_MAIN), ("2026/10/03/rollout-b.jsonl", META_WORKER), ("2026/10/03/other.txt", "x")] {
            let p = d.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(&p, format!("{line}\n")).unwrap();
        }
        let mut files = Vec::new();
        rollouts_under(&d, &mut files, 4);
        files.sort();
        assert_eq!(files.len(), 2);
        let metas: Vec<_> = files.iter().map(|f| parse_session_meta(&first_line(f).unwrap()).unwrap()).collect();
        assert!(metas.iter().all(|m| m.root == "T1"));
        // A first line still being written isn't indexed yet.
        let partial = d.join("2026/10/03/rollout-c.jsonl");
        std::fs::write(&partial, META_MAIN).unwrap();
        assert!(first_line(&partial).is_none());
    }
}
