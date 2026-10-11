//! Markdown editor (Phase 62): list, read and write a project's instruction
//! and notes files. `name` is never a path the caller chooses — it must be in
//! a fresh `md_list` result (so `../x.md`, `sub/a.md` and absolute paths are
//! impossible), and then passes `pty::resolve_inside` again before any I/O.

use std::path::PathBuf;

/// Shown first, in this order, when present. Then regular `*.md` directly in
/// the project root, then directly in `docs/` — one level, no recursion.
const FIXED: [&str; 4] = ["CLAUDE.md", "AGENTS.md", ".claude/CLAUDE.md", ".logic-loop/board.md"];
/// Keeps the textarea responsive; larger files go through Open in editor.
const MAX_BYTES: u64 = 1024 * 1024;

#[derive(Debug, PartialEq, serde::Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum WriteOutcome {
    Saved,
    Conflict { current: String },
}

#[tauri::command]
pub async fn md_list(project_key: String) -> Vec<String> {
    crate::pty::spawn_blocking_or_default(move || list_blocking(&project_key)).await
}

#[tauri::command]
pub async fn md_read(project_key: String, name: String) -> Result<String, String> {
    crate::pty::spawn_blocking_result("md_read", move || read_blocking(&project_key, &name)).await
}

#[tauri::command]
pub async fn md_write(
    project_key: String,
    name: String,
    base: String,
    content: String,
) -> Result<WriteOutcome, String> {
    crate::pty::spawn_blocking_result("md_write", move || {
        write_blocking(&project_key, &name, &base, &content)
    })
    .await
}

fn editable(project_key: &str, name: &str) -> bool {
    crate::pty::resolve_inside(project_key, Some(name))
        .ok()
        .and_then(|p| std::fs::metadata(p).ok())
        .is_some_and(|m| m.len() <= MAX_BYTES)
}

fn list_blocking(project_key: &str) -> Vec<String> {
    let mut out: Vec<String> =
        FIXED.iter().filter(|n| editable(project_key, n)).map(|n| n.to_string()).collect();
    for dir in ["", "docs/"] {
        let mut found: Vec<String> = std::fs::read_dir(std::path::Path::new(project_key).join(dir))
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|e| e.file_name().into_string().ok())
            .filter(|n| n.to_ascii_lowercase().ends_with(".md"))
            .map(|n| format!("{dir}{n}"))
            // case-insensitive volumes: `claude.md` on disk already listed as CLAUDE.md
            .filter(|n| !out.iter().any(|o| o.eq_ignore_ascii_case(n)))
            .filter(|n| editable(project_key, n))
            .collect();
        found.sort_by_key(|n| n.to_lowercase());
        out.extend(found);
    }
    out
}

fn checked(project_key: &str, name: &str) -> Result<PathBuf, String> {
    if !list_blocking(project_key).iter().any(|n| n == name) {
        return Err("not an editable file in this project".into());
    }
    crate::pty::resolve_inside(project_key, Some(name))
}

fn read_text(path: &PathBuf) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    String::from_utf8(bytes).map_err(|_| "not UTF-8 text".into())
}

fn read_blocking(project_key: &str, name: &str) -> Result<String, String> {
    read_text(&checked(project_key, name)?)
}

/// Compare-and-swap: writes only if the file still equals `base`, the exact
/// text the editor loaded, so an agent's edit since then is never clobbered.
fn write_blocking(project_key: &str, name: &str, base: &str, content: &str) -> Result<WriteOutcome, String> {
    if content.len() as u64 > MAX_BYTES {
        return Err("over 1 MB — use Open in editor".into());
    }
    let path = checked(project_key, name)?;
    let current = read_text(&path)?;
    if current != base {
        return Ok(WriteOutcome::Conflict { current });
    }
    // ponytail: tiny TOCTOU window between the read above and this write. An
    // atomic temp+rename would close it but replaces symlinks and changes the
    // inode under the user's other editors; same plain write as write_board.
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(WriteOutcome::Saved)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> (PathBuf, String) {
        let base = std::env::temp_dir().join(format!("logic-loop-plan062-{name}-{}", std::process::id()));
        let root = base.join("project");
        std::fs::create_dir_all(root.join(".logic-loop")).unwrap();
        std::fs::create_dir_all(root.join("docs")).unwrap();
        std::fs::write(root.join("AGENTS.md"), "agents").unwrap();
        std::fs::write(root.join("CLAUDE.md"), "claude").unwrap();
        std::fs::write(root.join(".logic-loop/board.md"), "board").unwrap();
        std::fs::write(root.join("b.md"), "b").unwrap();
        std::fs::write(root.join("A.md"), "a").unwrap();
        std::fs::write(root.join("notes.MD"), "n").unwrap();
        std::fs::write(root.join("readme.txt"), "t").unwrap();
        std::fs::write(root.join("docs/deep.md"), "d").unwrap();
        std::fs::write(root.join("docs/Alpha.md"), "d").unwrap();
        std::fs::create_dir_all(root.join("docs/nested")).unwrap();
        std::fs::write(root.join("docs/nested/too-deep.md"), "d").unwrap();
        std::fs::create_dir_all(root.join("plans")).unwrap();
        std::fs::write(root.join("plans/001.md"), "p").unwrap();
        std::fs::write(base.join("outside.md"), "o").unwrap();
        (base, root.to_string_lossy().into_owned())
    }

    #[test]
    fn list_puts_fixed_set_first_then_root_then_docs_alphabetical() {
        let (base, pk) = fixture("list");
        std::fs::write(PathBuf::from(&pk).join("huge.md"), vec![b'x'; MAX_BYTES as usize + 1]).unwrap();
        let listed = list_blocking(&pk);
        std::fs::remove_dir_all(&base).ok();
        // .claude/CLAUDE.md absent → skipped; docs/nested/, plans/, .txt and >1 MB excluded
        assert_eq!(
            listed,
            ["CLAUDE.md", "AGENTS.md", ".logic-loop/board.md", "A.md", "b.md", "notes.MD", "docs/Alpha.md", "docs/deep.md"]
        );
    }

    #[cfg(unix)]
    #[test]
    fn list_drops_symlink_pointing_outside_and_write_rejects_it() {
        let (base, pk) = fixture("link");
        std::os::unix::fs::symlink(base.join("outside.md"), PathBuf::from(&pk).join("link.md")).unwrap();
        let listed = list_blocking(&pk);
        let write = write_blocking(&pk, "link.md", "o", "pwned");
        let outside = std::fs::read_to_string(base.join("outside.md")).unwrap();
        std::fs::remove_dir_all(&base).ok();
        assert!(!listed.contains(&"link.md".to_string()));
        assert!(write.is_err());
        assert_eq!(outside, "o");
    }

    #[test]
    fn write_rejects_unlisted_and_path_names() {
        let (base, pk) = fixture("names");
        let abs = base.join("outside.md").to_string_lossy().into_owned();
        let results: Vec<_> =
            ["../outside.md", "docs/nested/too-deep.md", "plans/001.md", "readme.txt", abs.as_str(), "missing.md"]
            .iter()
            .map(|n| write_blocking(&pk, n, "", "x"))
            .collect();
        let outside = std::fs::read_to_string(base.join("outside.md")).unwrap();
        std::fs::remove_dir_all(&base).ok();
        assert!(results.iter().all(|r| r.is_err()), "{results:?}");
        assert_eq!(outside, "o");
    }

    #[test]
    fn write_is_compare_and_swap() {
        let (base, pk) = fixture("cas");
        let stale = write_blocking(&pk, "CLAUDE.md", "old text", "mine");
        let after_stale = read_blocking(&pk, "CLAUDE.md");
        let fresh = write_blocking(&pk, "CLAUDE.md", "claude", "mine");
        let after_fresh = read_blocking(&pk, "CLAUDE.md");
        std::fs::remove_dir_all(&base).ok();
        assert_eq!(stale, Ok(WriteOutcome::Conflict { current: "claude".into() }));
        assert_eq!(after_stale.unwrap(), "claude");
        assert_eq!(fresh, Ok(WriteOutcome::Saved));
        assert_eq!(after_fresh.unwrap(), "mine");
    }

    #[test]
    fn read_rejects_non_utf8_and_write_rejects_oversize() {
        let (base, pk) = fixture("bytes");
        std::fs::write(PathBuf::from(&pk).join("bin.md"), [0xff, 0xfe, 0x00]).unwrap();
        let read = read_blocking(&pk, "bin.md");
        let big = write_blocking(&pk, "b.md", "b", &"x".repeat(MAX_BYTES as usize + 1));
        std::fs::remove_dir_all(&base).ok();
        assert_eq!(read.unwrap_err(), "not UTF-8 text");
        assert!(big.is_err());
    }
}
