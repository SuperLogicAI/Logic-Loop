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

#[test]
fn hot_event_reads_use_their_indexes() {
    tauri::async_runtime::block_on(async {
        let repo = include_str!("../../src/lib/repo.ts");
        let valid_events = repo
            .split_once("WITH valid_events AS (").expect("valid_events moved").1
            .split_once("outstanding_results AS").expect("outstanding_results moved").0
            .trim_end()
            .trim_end_matches("),");
        let events_since = repo
            .split_once("`SELECT id, ts, type, payload_json FROM events").expect("eventsSince moved").1
            .split_once('`').expect("eventsSince end missing").0;
        let mut db = SqliteConnection::connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql("CREATE TABLE events (id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL,
            payload_json TEXT NOT NULL, ts INTEGER NOT NULL, dedupe_key TEXT);
          CREATE INDEX idx_events_session ON events(session_id, ts);")
          .execute(&mut db).await.unwrap();
        sqlx::raw_sql(crate::EVENTS_TYPE_INDEX_SQL).execute(&mut db).await.unwrap();
        sqlx::raw_sql(crate::EVENTS_TS_INDEX_SQL).execute(&mut db).await.unwrap();
        let sql = format!(
            "EXPLAIN QUERY PLAN WITH valid_events AS ({valid_events})
             SELECT id FROM valid_events WHERE type = 'attention_state_observed'"
        );
        let plan = sqlx::query(&sql).fetch_all(&mut db).await.unwrap();
        assert!(
            plan.iter().any(|row| row.get::<String, _>("detail").contains("idx_events_type_ts")),
            "Attention reads fell back to a table scan"
        );
        let sql = format!("EXPLAIN QUERY PLAN SELECT id, ts, type, payload_json FROM events{events_since}");
        let plan = sqlx::query(&sql).bind(0_i64).bind("tab").bind("session").fetch_all(&mut db).await.unwrap();
        assert!(
            plan.iter().any(|row| row.get::<String, _>("detail").contains("idx_events_ts")),
            "eventsSince fell back to a table scan"
        );
    });
}
