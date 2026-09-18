//! Bounded read-only access to Safe Router's versioned metadata-log view.

use serde::Serialize;
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};
use sqlx::{Connection, Row};
use std::path::{Path, PathBuf};
use std::time::Duration;

const QUERY: &str = "SELECT id, ts, plane, key_id, model_req, model_served, backend, disposition, status, tokens_in, tokens_out, usage_state, client_tag FROM v_requests_v2 ORDER BY id DESC LIMIT 100";

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TrafficSnapshot {
    Missing,
    V1,
    Ready { rows: Vec<TrafficRow> },
    Error,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrafficRow {
    id: i64,
    ts: String,
    plane: String,
    key_id: String,
    model_req: String,
    model_served: Option<String>,
    backend: Option<String>,
    disposition: String,
    status: Option<i64>,
    tokens_in: Option<i64>,
    tokens_out: Option<i64>,
    usage_state: String,
    client_tag: Option<String>,
}

#[tauri::command]
pub async fn read_safe_router_traffic() -> TrafficSnapshot {
    let Some(home) = crate::home::home() else {
        return TrafficSnapshot::Missing;
    };
    read_path(&PathBuf::from(home).join(".safe-router").join("log.db")).await
}

fn file_uri(path: &Path) -> String {
    // Prevent metacharacters in a home path from changing the URI mode.
    let mut uri = String::from("file:");
    for byte in path.to_string_lossy().as_bytes() {
        match byte {
            b'/' | b'-' | b'_' | b'.' | b'~' | b'0'..=b'9' | b'A'..=b'Z' | b'a'..=b'z' => uri.push(char::from(*byte)),
            _ => uri.push_str(&format!("%{byte:02X}")),
        }
    }
    uri.push_str("?mode=ro");
    uri
}

async fn open_read_only(path: &Path) -> Result<SqliteConnection, sqlx::Error> {
    // sqlx-sqlite calls sqlite3_open_v2 with SQLITE_OPEN_URI and
    // SQLITE_OPEN_READONLY for these options, independently of the URI mode.
    let options = SqliteConnectOptions::new()
        .filename(file_uri(path))
        .read_only(true)
        .create_if_missing(false)
        .busy_timeout(Duration::from_millis(150))
        .pragma("query_only", "1");
    let mut connection = SqliteConnection::connect_with(&options).await?;
    let enabled: i64 = sqlx::query_scalar("PRAGMA query_only").fetch_one(&mut connection).await?;
    if enabled != 1 {
        return Err(sqlx::Error::Protocol("query_only did not enable".into()));
    }
    Ok(connection)
}

async fn read_path(path: &Path) -> TrafficSnapshot {
    match path.try_exists() {
        Ok(false) => return TrafficSnapshot::Missing,
        Err(_) => return TrafficSnapshot::Error,
        Ok(true) => {}
    }
    let Ok(mut connection) = open_read_only(path).await else { return TrafficSnapshot::Error; };
    let Ok(version) = sqlx::query_scalar::<_, i64>("PRAGMA user_version").fetch_one(&mut connection).await else { return TrafficSnapshot::Error; };
    if version == 1 { return TrafficSnapshot::V1; }
    if version < 2 { return TrafficSnapshot::Error; }
    let Ok(view_exists) = sqlx::query_scalar::<_, i64>("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='view' AND name='v_requests_v2')")
        .fetch_one(&mut connection).await else { return TrafficSnapshot::Error; };
    if view_exists != 1 { return TrafficSnapshot::Error; }
    let Ok(raw_rows) = sqlx::query(QUERY).fetch_all(&mut connection).await else { return TrafficSnapshot::Error; };
    let mut rows = Vec::with_capacity(100);
    for raw in raw_rows {
        let parsed = (|| -> Result<TrafficRow, sqlx::Error> {
            let usage_state: String = raw.try_get("usage_state")?;
            if !matches!(usage_state.as_str(), "complete" | "partial" | "not_recorded") {
                return Err(sqlx::Error::Protocol("unknown usage state".into()));
            }
            Ok(TrafficRow {
                id: raw.try_get("id")?, ts: raw.try_get("ts")?, plane: raw.try_get("plane")?,
                key_id: raw.try_get("key_id")?, model_req: raw.try_get("model_req")?,
                model_served: raw.try_get("model_served")?, backend: raw.try_get("backend")?,
                disposition: raw.try_get("disposition")?, status: raw.try_get("status")?,
                tokens_in: raw.try_get("tokens_in")?, tokens_out: raw.try_get("tokens_out")?,
                usage_state, client_tag: raw.try_get("client_tag")?,
            })
        })();
        let Ok(row) = parsed else { return TrafficSnapshot::Error; };
        rows.push(row);
    }
    TrafficSnapshot::Ready { rows }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!("logic-loop-traffic-{label}-{}-{}.db", std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()))
    }

    async fn fixture(path: &Path, version: i64) -> SqliteConnection {
        let mut writer = SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(path).create_if_missing(true)).await.unwrap();
        sqlx::query("PRAGMA journal_mode=WAL").execute(&mut writer).await.unwrap();
        sqlx::query(&format!("PRAGMA user_version={version}")).execute(&mut writer).await.unwrap();
        sqlx::query("CREATE TABLE requests (id INTEGER PRIMARY KEY, ts TEXT, plane TEXT, key_id TEXT, model_req TEXT, model_served TEXT, backend TEXT, disposition TEXT, status INTEGER, tokens_in INTEGER, tokens_out INTEGER, client_tag TEXT)").execute(&mut writer).await.unwrap();
        sqlx::query("CREATE VIEW v_requests_v1 AS SELECT id, ts, plane, key_id, model_req, model_served, backend, disposition, status, tokens_in, tokens_out, client_tag FROM requests").execute(&mut writer).await.unwrap();
        if version >= 2 {
            sqlx::query("CREATE VIEW v_requests_v2 AS SELECT id, ts, plane, key_id, model_req, model_served, backend, disposition, status, tokens_in, tokens_out, CASE WHEN tokens_in IS NOT NULL AND tokens_out IS NOT NULL THEN 'complete' WHEN tokens_in IS NOT NULL OR tokens_out IS NOT NULL THEN 'partial' ELSE 'not_recorded' END AS usage_state, client_tag FROM requests").execute(&mut writer).await.unwrap();
        }
        writer
    }

    #[test]
    fn missing_file_is_not_created() {
        tauri::async_runtime::block_on(async {
            let path = temp_path("missing");
            assert!(matches!(read_path(&path).await, TrafficSnapshot::Missing));
            assert!(!path.exists());
            assert!(file_uri(Path::new("/tmp/a?b#c.db")).contains("a%3Fb%23c.db?mode=ro"));
        });
    }

    #[test]
    fn non_database_path_is_unavailable() {
        tauri::async_runtime::block_on(async {
            assert!(matches!(read_path(&std::env::temp_dir()).await, TrafficSnapshot::Error));
        });
    }

    #[test]
    fn connection_cannot_create_or_write() {
        tauri::async_runtime::block_on(async {
            let path = temp_path("readonly");
            let mut writer = fixture(&path, 2).await;
            sqlx::query("INSERT INTO requests (ts,plane,key_id,model_req,disposition,tokens_in,tokens_out) VALUES ('now','safe','key','model','served',0,NULL)").execute(&mut writer).await.unwrap();
            let mut reader = open_read_only(&path).await.unwrap();
            assert!(sqlx::query("CREATE TABLE forbidden (x INTEGER)").execute(&mut reader).await.is_err());
            assert!(sqlx::query("INSERT INTO requests (ts,plane,key_id,model_req,disposition) VALUES ('x','safe','x','x','served')").execute(&mut reader).await.is_err());
            assert!(sqlx::query("INSERT INTO v_requests_v2 (id) VALUES (99)").execute(&mut reader).await.is_err());
            assert!(matches!(read_path(&path).await, TrafficSnapshot::Ready { rows } if rows.len() == 1 && rows[0].tokens_in == Some(0) && rows[0].tokens_out.is_none() && rows[0].usage_state == "partial"));
            let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM requests").fetch_one(&mut writer).await.unwrap();
            assert_eq!(count, 1);
        });
    }

    #[test]
    fn old_and_broken_contract_are_distinct() {
        tauri::async_runtime::block_on(async {
            let v1_path = temp_path("v1");
            let _v1 = fixture(&v1_path, 1).await;
            assert!(matches!(read_path(&v1_path).await, TrafficSnapshot::V1));
            let broken_path = temp_path("broken");
            let mut broken = fixture(&broken_path, 2).await;
            assert!(matches!(read_path(&broken_path).await, TrafficSnapshot::Ready { rows } if rows.is_empty()));
            sqlx::query("DROP VIEW v_requests_v2").execute(&mut broken).await.unwrap();
            assert!(matches!(read_path(&broken_path).await, TrafficSnapshot::Error));
        });
    }

    #[test]
    fn unknown_usage_state_is_contract_error() {
        tauri::async_runtime::block_on(async {
            let path = temp_path("usage");
            let mut writer = fixture(&path, 2).await;
            sqlx::query("DROP VIEW v_requests_v2").execute(&mut writer).await.unwrap();
            sqlx::query("CREATE VIEW v_requests_v2 AS SELECT id, ts, plane, key_id, model_req, model_served, backend, disposition, status, tokens_in, tokens_out, 'bogus' AS usage_state, client_tag FROM requests").execute(&mut writer).await.unwrap();
            sqlx::query("INSERT INTO requests (ts,plane,key_id,model_req,disposition) VALUES ('now','safe','key','model','served')").execute(&mut writer).await.unwrap();
            assert!(matches!(read_path(&path).await, TrafficSnapshot::Error));
        });
    }

    #[test]
    fn latest_rows_are_bounded_while_writer_is_open() {
        tauri::async_runtime::block_on(async {
            let path = temp_path("bounded");
            let mut writer = fixture(&path, 2).await;
            for i in 0..105 {
                sqlx::query("INSERT INTO requests (ts,plane,key_id,model_req,disposition) VALUES (?1,'safe','key','model','served')").bind(i.to_string()).execute(&mut writer).await.unwrap();
            }
            match read_path(&path).await {
                TrafficSnapshot::Ready { rows } => {
                    assert_eq!(rows.len(), 100);
                    assert_eq!(rows[0].id, 105);
                    assert_eq!(rows.last().unwrap().id, 6);
                    assert!(rows[0].tokens_in.is_none());
                    assert_eq!(rows[0].usage_state, "not_recorded");
                }
                _ => panic!("expected a readable v2 view"),
            }
        });
    }
}
