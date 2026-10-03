//! Idea Board (Phase 18): `.logic-loop/board.md`, one file per project,
//! keyed by `project_key` (already canonicalized/trusted — computed by
//! `pty::project_key`, never a raw path from the caller). No path parameter
//! is accepted beyond the project key itself, so there is no traversal
//! surface to guard against: the filename is a hardcoded constant joined
//! onto a trusted directory.

use std::path::PathBuf;

fn board_path(project_key: &str) -> PathBuf {
    PathBuf::from(project_key).join(".logic-loop").join("board.md")
}

/// Shown once, the first time a project ever opens the Idea Board (no
/// `board.md` on disk yet) — demonstrates the `## `/`status:`/`link:`/`next:`
/// shape so a new user doesn't have to reverse-engineer the format from an
/// empty box. Deleting or editing it is a normal card edit from then on.
const EXAMPLE_BOARD: &str = "## Example: something you're considering\n\
status: idea\n\
A one-line idea. Delete this card, or turn it into a real one.\n\
## Example: something queued up next\n\
status: planned\n\
next: the first concrete step to take\n\
link: https://example.com/related-issue\n\
## Example: something already shipped\n\
status: done\n\
Cards move to `done` instead of being deleted, so history stays in the file.\n";

/// Missing file → seed it with a one-time example board and return that, so
/// first launch shows real formatting instead of an empty box. Any other
/// read error → empty board (fail open, invariant #2 — a board panel must
/// never affect terminals); an existing-but-empty file (user cleared it) is
/// returned as-is, never reseeded.
///
/// `project_key` itself must already exist as a directory before seeding —
/// `write_board_blocking`'s `create_dir_all` will happily create a whole
/// missing path, `project_key` included. Without this guard, opening the
/// board panel for a tab whose cwd doesn't exist (Finding 2,
/// docs/TESTING.md: a bookmark pointing at a deleted/typo'd folder) silently
/// materializes that folder on disk as a side effect of seeding
/// `<project_key>/.logic-loop/board.md` — which is exactly what made a
/// bookmark's *second* click "work": the first click's board read had
/// already created the folder the first click's own spawn couldn't find.
#[tauri::command]
pub async fn read_board(project_key: String) -> String {
    crate::pty::spawn_blocking_or_default(move || read_board_blocking(project_key)).await
}

fn read_board_blocking(project_key: String) -> String {
    if !std::path::Path::new(&project_key).is_dir() {
        return String::new();
    }
    match std::fs::read_to_string(board_path(&project_key)) {
        Ok(content) => content,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let seeded = write_board_blocking(project_key, EXAMPLE_BOARD.to_string());
            if seeded.is_ok() { EXAMPLE_BOARD.to_string() } else { String::new() }
        }
        Err(_) => String::new(),
    }
}

#[tauri::command]
pub async fn write_board(project_key: String, content: String) -> Result<(), String> {
    crate::pty::spawn_blocking_result("write_board", move || write_board_blocking(project_key, content)).await
}

/// Plan 048: a passive read for the Project Overview card, distinct from
/// `read_board` — that command seeds an example board on first read, which
/// is right for opening the Idea Board panel but wrong for a dashboard that
/// might render a card for a project never opened there. Never writes, never
/// creates a directory, and tells missing apart from empty apart from a real
/// read error so the UI can show "Example board"/"no board yet"/an error
/// instead of quietly rendering zero counts for all three.
#[derive(Debug, serde::Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum BoardPeek {
    Ready { content: String },
    Missing,
    Error { message: String },
}

// Required by spawn_blocking_or_default's T: Default bound (the blocking-task
// panic path) — distinct from Missing, since a panic is not "no board here".
impl Default for BoardPeek {
    fn default() -> Self {
        BoardPeek::Error { message: "board read task panicked".to_string() }
    }
}

#[tauri::command]
pub async fn peek_board(project_key: String) -> BoardPeek {
    crate::pty::spawn_blocking_or_default(move || peek_board_blocking(project_key)).await
}

fn peek_board_blocking(project_key: String) -> BoardPeek {
    match std::fs::metadata(&project_key) {
        Ok(metadata) if metadata.is_dir() => {}
        Ok(_) => return BoardPeek::Error { message: "Project folder is not a directory".into() },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return BoardPeek::Missing,
        Err(e) => return BoardPeek::Error { message: e.to_string() },
    }
    match std::fs::read_to_string(board_path(&project_key)) {
        Ok(content) => BoardPeek::Ready { content },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => BoardPeek::Missing,
        Err(e) => BoardPeek::Error { message: e.to_string() },
    }
}

fn write_board_blocking(project_key: String, content: String) -> Result<(), String> {
    if !std::path::Path::new(&project_key).is_dir() {
        return Err(format!("\"{project_key}\" is not a folder Logic Loop can open"));
    }
    let path = board_path(&project_key);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn peek_denied_project_metadata_is_error_not_missing() {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(format!("logic-loop-board-denied-{}", std::process::id()));
        let project = root.join("project");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o000)).unwrap();
        let result = peek_board_blocking(project.to_string_lossy().into_owned());
        // Restore before assertions so a test failure cannot strand the fixture.
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700)).unwrap();
        std::fs::remove_dir_all(&root).unwrap();
        // Root can bypass DAC permissions in Linux CI; there a successful
        // missing-board read is valid. Ordinary users must see Error.
        if unsafe { libc::geteuid() } != 0 {
            assert!(matches!(result, BoardPeek::Error { .. }));
        }
    }

    // Tests exercise the `_blocking` inner functions directly — same
    // convention as `extractor.rs`'s tests — so they stay plain sync `#[test]`
    // fns with no need for a tokio test runtime around the `pub async fn`
    // command wrappers, which only add the `spawn_blocking` dispatch.

    #[test]
    fn read_missing_file_seeds_example_board_once() {
        let dir = std::env::temp_dir().join(format!("logic-loop-board-test-seed-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let key = dir.to_string_lossy().into_owned();

        let seeded = read_board_blocking(key.clone());
        assert_eq!(seeded, EXAMPLE_BOARD);
        assert!(board_path(&key).exists());

        // A second read must not reseed over a user's edit/clear.
        write_board_blocking(key.clone(), String::new()).unwrap();
        assert_eq!(read_board_blocking(key.clone()), "");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn read_missing_project_dir_returns_empty_and_creates_nothing() {
        // Regression test for Finding 2 (docs/TESTING.md, 2026-09-21): a tab
        // opened against a folder that doesn't exist (bookmark pointing at a
        // deleted/typo'd path) must not have its Idea Board panel silently
        // `mkdir` that folder into existence as a side effect of seeding the
        // example board.
        let dir = std::env::temp_dir().join(format!("logic-loop-board-test-missing-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let key = dir.to_string_lossy().into_owned();

        assert_eq!(read_board_blocking(key), "");
        assert!(!dir.exists(), "a nonexistent project dir must not be created by reading its board");
    }

    #[test]
    fn write_to_missing_project_dir_errors_and_creates_nothing() {
        let dir = std::env::temp_dir().join(format!("logic-loop-board-test-write-missing-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let key = dir.to_string_lossy().into_owned();

        assert!(write_board_blocking(key, "x".into()).is_err());
        assert!(!dir.exists(), "a nonexistent project dir must not be created by writing its board");
    }

    #[test]
    fn write_creates_dot_logic_loop_dir_and_round_trips() {
        let dir = std::env::temp_dir().join(format!("logic-loop-board-test-rw-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let key = dir.to_string_lossy().into_owned();

        write_board_blocking(key.clone(), "## card one\nstatus: idea\n".into()).unwrap();
        assert_eq!(read_board_blocking(key.clone()), "## card one\nstatus: idea\n");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn peek_missing_project_dir_reports_missing_and_creates_nothing() {
        let dir = std::env::temp_dir().join(format!("logic-loop-board-test-peek-nodir-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let key = dir.to_string_lossy().into_owned();

        assert!(matches!(peek_board_blocking(key), BoardPeek::Missing));
        assert!(!dir.exists(), "peek must not create a nonexistent project dir");
    }

    #[test]
    fn peek_missing_board_reports_missing_without_seeding() {
        // The behavior that distinguishes peek_board from read_board: no
        // example-board write as a side effect of a passive read.
        let dir = std::env::temp_dir().join(format!("logic-loop-board-test-peek-noboard-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let key = dir.to_string_lossy().into_owned();

        assert!(matches!(peek_board_blocking(key.clone()), BoardPeek::Missing));
        assert!(!board_path(&key).exists(), "peek must never seed board.md");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn peek_existing_board_returns_ready_with_content() {
        let dir = std::env::temp_dir().join(format!("logic-loop-board-test-peek-ready-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let key = dir.to_string_lossy().into_owned();
        write_board_blocking(key.clone(), "## card one\nstatus: idea\n".into()).unwrap();

        match peek_board_blocking(key) {
            BoardPeek::Ready { content } => assert_eq!(content, "## card one\nstatus: idea\n"),
            other => panic!("expected Ready, got {other:?}"),
        }

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn peek_unreadable_board_path_reports_error_not_missing() {
        // board.md exists as a directory instead of a file — a real read
        // error distinct from "missing" (no file) and "empty" (empty file).
        let dir = std::env::temp_dir().join(format!("logic-loop-board-test-peek-err-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let key = dir.to_string_lossy().into_owned();
        std::fs::create_dir_all(board_path(&key)).unwrap();

        assert!(matches!(peek_board_blocking(key), BoardPeek::Error { .. }));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn write_to_nonexistent_project_dir_fails_cleanly() {
        // ponytail: relying on OS permission-denial (e.g. writing under "/")
        // isn't cross-platform — Windows CI runners can create dirs there.
        // Instead put a *file* where a directory needs to go, so
        // create_dir_all hits ENOTDIR (or the Windows equivalent) everywhere.
        let dir = std::env::temp_dir().join(format!(
            "logic-loop-board-test-blocked-{}",
            std::process::id()
        ));
        std::fs::write(&dir, "not a directory").unwrap();
        let key = dir.to_string_lossy().into_owned();

        assert!(write_board_blocking(key, "x".into()).is_err());

        std::fs::remove_file(&dir).ok();
    }
}
