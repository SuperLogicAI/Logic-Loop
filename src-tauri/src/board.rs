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

/// Missing file or any read error → empty board (fail open, invariant #2 —
/// a board panel must never affect terminals). The UI treats "" the same as
/// a genuinely empty file: no cards, `+` still live.
#[tauri::command]
pub async fn read_board(project_key: String) -> String {
    crate::pty::spawn_blocking_or_default(move || read_board_blocking(project_key)).await
}

fn read_board_blocking(project_key: String) -> String {
    std::fs::read_to_string(board_path(&project_key)).unwrap_or_default()
}

#[tauri::command]
pub async fn write_board(project_key: String, content: String) -> Result<(), String> {
    crate::pty::spawn_blocking_result("write_board", move || write_board_blocking(project_key, content)).await
}

fn write_board_blocking(project_key: String, content: String) -> Result<(), String> {
    let path = board_path(&project_key);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Tests exercise the `_blocking` inner functions directly — same
    // convention as `extractor.rs`'s tests — so they stay plain sync `#[test]`
    // fns with no need for a tokio test runtime around the `pub async fn`
    // command wrappers, which only add the `spawn_blocking` dispatch.

    #[test]
    fn read_missing_file_is_empty_not_an_error() {
        let dir = std::env::temp_dir().join(format!("logic-loop-board-test-{}", std::process::id()));
        assert_eq!(read_board_blocking(dir.to_string_lossy().into_owned()), "");
    }

    #[test]
    fn write_creates_dot_logic_loop_dir_and_round_trips() {
        let dir = std::env::temp_dir().join(format!("logic-loop-board-test-rw-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let key = dir.to_string_lossy().into_owned();

        write_board_blocking(key.clone(), "## card one\nstatus: idea\n".into()).unwrap();
        assert_eq!(read_board_blocking(key.clone()), "## card one\nstatus: idea\n");

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
