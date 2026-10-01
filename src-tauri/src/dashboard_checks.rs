//! Execute the frontend's actual repo SQL against SQLite fixtures. No JS
//! database shim or additional runtime dependency; sqlx is already in use.
use sqlx::{Connection, Row, SqliteConnection};

fn repo_sql(name: &str, quote: char) -> String {
    let repo = include_str!("../../src/lib/repo.ts");
    let marker = format!("export const {name} = {quote}");
    let tail = repo.split_once(&marker).expect("repo SQL constant moved").1;
    tail.split_once(quote).expect("SQL literal end missing").0.to_string()
}

#[test]
fn project_work_log_uses_session_ownership_and_bounds() {
    tauri::async_runtime::block_on(async {
        let mut db = SqliteConnection::connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql("CREATE TABLE session_bindings (session_id TEXT PRIMARY KEY, project_key TEXT, tab_tether TEXT, agent TEXT);
          CREATE TABLE events (id INTEGER PRIMARY KEY, session_id TEXT, ts INTEGER, type TEXT, payload_json TEXT);
          CREATE INDEX idx_events_session ON events(session_id, ts);
          INSERT INTO session_bindings VALUES ('old','/p','shared','codex'), ('new','/p','shared','codex'),
            ('rebound','/p','new-tether','claude'), ('other','/other','shared','codex');
          INSERT INTO events VALUES
            (1,'old',11,'hook:UserPromptSubmit','{\"tab_id\":\"shared\"}'),
            (2,'new',12,'hook:UserPromptSubmit','{\"tab_id\":\"shared\"}'),
            (3,'rebound',13,'transcript','{\"tab_id\":\"old-tether\"}'),
            (4,'rebound',14,'transcript','{}'),
            (5,'other',15,'transcript','{\"tab_id\":\"shared\"}'),
            (6,'old',10,'transcript','{}'),
            (7,'old',21,'transcript','{}'),
            (8,'old',20,'hook:PostToolUse','{}'),
            (9,'old',16,'attention_state_observed','{}');")
            .execute(&mut db).await.unwrap();
        let sql = repo_sql("PROJECT_WORK_LOG_SQL", '`');
        let rows = sqlx::query(&sql).bind("/p").bind(10_i64).bind(20_i64).fetch_all(&mut db).await.unwrap();
        let ids: Vec<i64> = rows.iter().map(|row| row.get("id")).collect();
        assert_eq!(ids, vec![1, 2, 3, 4, 8]);
        assert_eq!(rows[0].get::<String, _>("session_id"), "old");
        assert_eq!(rows[1].get::<String, _>("session_id"), "new");
        assert!(sqlx::query(&sql).bind("/missing").bind(0_i64).bind(99_i64).fetch_all(&mut db).await.unwrap().is_empty());
    });
}

#[test]
fn project_decisions_match_source_open_count_without_a_silent_cap() {
    tauri::async_runtime::block_on(async {
        let mut db = SqliteConnection::connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql("CREATE TABLE decisions (id INTEGER PRIMARY KEY, cwd TEXT, status TEXT, ts INTEGER);
          CREATE TABLE attention_occurrences (decision_id INTEGER, archived INTEGER);
          INSERT INTO decisions VALUES (101,'/other','open',999), (102,'/p','answered',999), (103,'/p','dismissed',999);
          INSERT INTO attention_occurrences VALUES (1,1);")
          .execute(&mut db).await.unwrap();
        let sql = repo_sql("OPEN_PROJECT_DECISIONS_SQL", '"');
        for n in 1..=61_i64 {
            sqlx::query("INSERT INTO decisions VALUES ($1,'/p','open',$1)").bind(n).execute(&mut db).await.unwrap();
            if n == 33 || n == 61 {
                let rows = sqlx::query(&sql).bind("/p").fetch_all(&mut db).await.unwrap();
                assert_eq!(rows.len(), n as usize);
                assert!(rows.iter().any(|row| row.get::<i64, _>("id") == 1), "Inbox archival does not close a source decision");
            }
        }
    });
}
