//! Passive dashboard Git evidence. Existing workspace Git APIs keep their
//! fail-open contract; this command distinguishes unavailable from empty.
use crate::pty::Commit;
use std::path::Path;

// Same home-directory boundary as pty::has_own_repo, with I/O errors
// preserved instead of exists()/is_dir() converting denial into absence.
fn project_has_repo(cwd: &str) -> Result<bool, String> {
    let resolved = std::fs::canonicalize(cwd).map_err(|_| "Project folder is unavailable".to_string())?;
    if !resolved.is_dir() {
        return Err("Project folder is not a directory".into());
    }
    let home = crate::home::home().and_then(|p| std::fs::canonicalize(p).ok());
    let mut dir: &Path = &resolved;
    loop {
        if home.as_deref() == Some(dir) {
            return Ok(false);
        }
        match std::fs::metadata(dir.join(".git")) {
            Ok(_) => return Ok(true),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("Repository metadata is unavailable".into()),
        }
        match dir.parent() {
            Some(parent) => dir = parent,
            None => return Ok(false),
        }
    }
}

#[tauri::command]
pub async fn dashboard_git_log(cwd: String, since_ms: i64, until_ms: i64) -> Result<Vec<Commit>, String> {
    crate::pty::spawn_blocking_result("dashboard_git_log", move || git_window(&cwd, since_ms, until_ms)).await
}

fn git_window(cwd: &str, since_ms: i64, until_ms: i64) -> Result<Vec<Commit>, String> {
    if since_ms < 0 || until_ms < since_ms {
        return Err("Invalid commit date range".into());
    }
    if !project_has_repo(cwd)? {
        return Ok(vec![]);
    }
    let out = std::process::Command::new("git")
        .env("LC_ALL", "C")
        .args(["-C", cwd, "log"])
        .arg(format!("--since-as-filter=@{}", since_ms / 1000))
        .arg(format!("--until=@{}", until_ms / 1000))
        .arg("--pretty=format:%h%x09%ct%x09%s")
        .output().map_err(|_| "Couldn't run Git".to_string())?;
    if !out.status.success() {
        if String::from_utf8_lossy(&out.stderr).contains("does not have any commits yet") {
            return Ok(vec![]);
        }
        return Err("Couldn't read local commits".into());
    }
    let text = String::from_utf8(out.stdout).map_err(|_| "Invalid Git response".to_string())?;
    let mut commits = vec![];
    for line in text.lines() {
        let mut fields = line.splitn(3, '\t');
        let hash = fields.next().ok_or("Invalid Git response")?;
        let ts: i64 = fields.next().ok_or("Invalid Git response")?.parse().map_err(|_| "Invalid Git timestamp")?;
        let subject = fields.next().ok_or("Invalid Git response")?;
        // Git filters in whole seconds; enforce the actual (since, until]
        // millisecond window too, including its two edge seconds.
        let ms = ts.checked_mul(1000).ok_or("Invalid Git timestamp")?;
        if ms > since_ms && ms <= until_ms {
            commits.push(Commit { hash: hash.into(), ts, subject: subject.into() });
        }
    }
    Ok(commits)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn git_window_missing_folder_is_error_and_creates_nothing() {
        let dir = std::env::temp_dir().join(format!("logic-loop-dashboard-missing-{}", std::process::id()));
        assert!(!dir.exists());
        assert!(git_window(dir.to_str().unwrap(), 0, 1).is_err());
        assert!(!dir.exists());
    }

    #[test]
    fn git_window_covers_all_commits_and_rejects_invalid_repositories() {
        let _guard = crate::home::lock_env();
        let dir = std::env::temp_dir().join(format!("logic-loop-dashboard-git-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let cwd = dir.to_str().unwrap();
        let git = |args: &[&str]| {
            let out = std::process::Command::new("git").args(["-C", cwd]).args(args).output().unwrap();
            assert!(out.status.success(), "git fixture failed");
        };
        assert!(git_window(cwd, 0, 1_900_000_000_000).unwrap().is_empty());
        git(&["init", "-q"]);
        assert!(git_window(cwd, 0, 1_900_000_000_000).unwrap().is_empty());
        for n in 0..61 {
            let stamp = format!("{} +0000", 1_700_000_000 + n);
            let out = std::process::Command::new("git").args(["-C", cwd, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                "commit", "--allow-empty", "-q", "-m", "Fixture"])
                .env("GIT_AUTHOR_DATE", &stamp).env("GIT_COMMITTER_DATE", &stamp).output().unwrap();
            assert!(out.status.success());
        }
        let commits = git_window(cwd, 1_699_999_999_000, 1_700_000_060_000).unwrap();
        assert_eq!(commits.len(), 61, "no latest-50 cap");
        assert_eq!(git_window(cwd, 1_700_000_059_000, 1_700_000_060_000).unwrap().len(), 1);
        assert!(git_window(cwd, 1_800_000_000_000, 1_800_000_001_000).unwrap().is_empty());
        assert!(git_window(cwd, 2, 1).is_err());
        std::fs::remove_dir_all(dir.join(".git")).unwrap();
        std::fs::write(dir.join(".git"), "invalid git metadata").unwrap();
        assert!(git_window(cwd, 0, 1_900_000_000_000).is_err(), "Git errors must not become no commits");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
