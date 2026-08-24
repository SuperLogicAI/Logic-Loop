mod clipboard;
mod extractor;
mod ingest;
mod opencode;
mod pty;

use pty::PtyManager;
use tauri::menu::{MenuBuilder, MenuItem, SubmenuBuilder};
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "create bookmarks",
        sql: "CREATE TABLE IF NOT EXISTS bookmarks (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                cwd TEXT NOT NULL,
                color TEXT NOT NULL,
                position INTEGER NOT NULL
              );",
        kind: MigrationKind::Up,
    },
    Migration {
        version: 2,
        description: "create events",
        sql: "CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY,
                session_id TEXT NOT NULL,
                type TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                ts INTEGER NOT NULL
              );
              CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, ts);",
        kind: MigrationKind::Up,
    },
    Migration {
        version: 3,
        description: "create blockers",
        sql: "CREATE TABLE IF NOT EXISTS blockers (
                id INTEGER PRIMARY KEY,
                cwd TEXT NOT NULL,
                text TEXT NOT NULL,
                source TEXT NOT NULL,
                resolved INTEGER NOT NULL DEFAULT 0,
                ts INTEGER NOT NULL
              );
              CREATE INDEX IF NOT EXISTS idx_blockers_cwd ON blockers(cwd, resolved);",
        kind: MigrationKind::Up,
    },
    Migration {
        version: 4,
        description: "create decisions and settings",
        sql: "CREATE TABLE IF NOT EXISTS decisions (
                id INTEGER PRIMARY KEY,
                session_id TEXT NOT NULL,
                cwd TEXT NOT NULL,
                question TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'open',
                user_answer TEXT,
                assumption TEXT,
                context_json TEXT NOT NULL,
                ts INTEGER NOT NULL
              );
              CREATE INDEX IF NOT EXISTS idx_decisions_cwd ON decisions(cwd, status);
              CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
              );",
        kind: MigrationKind::Up,
    },
    Migration {
        version: 5,
        description: "create notes",
        sql: "CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY,
                cwd TEXT NOT NULL,
                kind TEXT NOT NULL,
                body TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'open',
                session_id TEXT,
                ts INTEGER NOT NULL
              );
              CREATE INDEX IF NOT EXISTS idx_notes_cwd ON notes(cwd, kind, status);",
        kind: MigrationKind::Up,
    },
    Migration {
        version: 6,
        description: "events dedupe key",
        // dedupe_key is computed and supplied by repo.ts's addEvent (see
        // dedupeKey there for the natural-id-with-time-bucket-fallback logic
        // and why). NULL for pre-migration rows; SQLite allows unlimited
        // NULLs in a UNIQUE index, so history is untouched. INSERT OR IGNORE
        // at the call site makes a caught duplicate a silent no-op — no
        // catch/error-handling change needed to stay fail-open.
        sql: "ALTER TABLE events ADD COLUMN dedupe_key TEXT;
              CREATE UNIQUE INDEX IF NOT EXISTS idx_events_dedupe ON events(dedupe_key);",
        kind: MigrationKind::Up,
    },
    Migration {
        version: 7,
        description: "session bindings for re-entry",
        sql: "CREATE TABLE IF NOT EXISTS session_bindings (
                session_id TEXT PRIMARY KEY,
                tab_tether TEXT NOT NULL,
                project_key TEXT NOT NULL,
                cwd TEXT NOT NULL,
                transcript_path TEXT NOT NULL,
                active INTEGER NOT NULL DEFAULT 1,
                updated_at INTEGER NOT NULL
              );
              CREATE INDEX IF NOT EXISTS idx_session_bindings_tether
                ON session_bindings(tab_tether, active, updated_at);",
        kind: MigrationKind::Up,
    },
    Migration {
        version: 8,
        description: "fan-out spawn groups",
        sql: "CREATE TABLE IF NOT EXISTS spawn_groups (
                id TEXT PRIMARY KEY,
                parent_tab_id TEXT NOT NULL,
                label TEXT,
                created_at INTEGER NOT NULL
              );
              CREATE TABLE IF NOT EXISTS spawn_group_members (
                group_id TEXT NOT NULL REFERENCES spawn_groups(id),
                child_tab_id TEXT NOT NULL,
                cmd TEXT,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (group_id, child_tab_id)
              );
              CREATE INDEX IF NOT EXISTS idx_spawn_members_child
                ON spawn_group_members(child_tab_id);
              CREATE INDEX IF NOT EXISTS idx_spawn_groups_parent
                ON spawn_groups(parent_tab_id);",
        kind: MigrationKind::Up,
    },
    Migration {
        version: 9,
        description: "worktree-bound tabs",
        sql: "CREATE TABLE IF NOT EXISTS worktree_tabs (
                tab_id TEXT PRIMARY KEY,
                repo_cwd TEXT NOT NULL,
                worktree_path TEXT NOT NULL,
                branch TEXT NOT NULL,
                created_at INTEGER NOT NULL
              );",
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:context-terminal.db", migrations)
                .build(),
        )
        .manage(PtyManager::default())
        .manage(ingest::TailerRegistry::default())
        .setup(|app| {
            // Default menu's Quit (⌘Q) calls native terminate, bypassing the
            // JS quit guard entirely. Custom Quit item closes windows instead,
            // which runs the guard's confirm dialog. Edit roles kept — the
            // webview's clipboard shortcuts depend on them.
            let quit = MenuItem::with_id(app, "quit", "Quit Logic Loop", true, Some("CmdOrCtrl+Q"))?;
            let app_menu = SubmenuBuilder::new(app, "Logic Loop")
                .about(None)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .item(&quit)
                .build()?;
            // No Paste role: its ⌘V accelerator fires alongside the webview
            // keydown, double-pasting into terminals (and its insertText path
            // strips line breaks). ⌘V is handled in the frontend instead —
            // xterm's custom key handler for terminals, App.tsx for form
            // fields.
            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .select_all()
                .build()?;
            let window_menu = SubmenuBuilder::new(app, "Window").minimize().maximize().build()?;
            let menu = MenuBuilder::new(app)
                .items(&[&app_menu, &edit_menu, &window_menu])
                .build()?;
            app.set_menu(menu)?;
            ingest::start(app.handle().clone());
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id() == "quit" {
                for window in app.webview_windows().values() {
                    let _ = window.close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            pty::pty_spawn,
            pty::canonicalize_cwd,
            pty::project_key_of,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            pty::pty_live_count,
            pty::pty_kill_all,
            pty::git_log,
            pty::git_branches,
            pty::git_worktree_add,
            pty::git_worktree_remove,
            pty::git_current_branch,
            pty::git_has_changes,
            pty::git_add_u,
            pty::git_diff_cached,
            pty::git_commit,
            pty::git_create_branch,
            pty::git_push,
            pty::git_pr_create,
            ingest::hooks_setup,
            ingest::hooks_remove,
            ingest::hooks_status,
            opencode::opencode_detect,
            opencode::opencode_hooks_setup,
            opencode::opencode_hooks_remove,
            opencode::opencode_hooks_status,
            extractor::run_extractor,
            clipboard::clipboard_text,
            clipboard::clipboard_image_path
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                window.state::<PtyManager>().kill_all();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // ⌘Q / menu Quit fires ExitRequested without going through the
            // window close path, skipping the JS quit guard. Reroute it to
            // window.close() so the guard's confirm dialog runs. Once no
            // windows remain (guard confirmed → destroy), let the exit happen.
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() && !app.webview_windows().is_empty() {
                    api.prevent_exit();
                    for window in app.webview_windows().values() {
                        let _ = window.close();
                    }
                }
            }
        });
}
