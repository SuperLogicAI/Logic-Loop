// Clipboard via macOS built-ins. navigator.clipboard.readText() in WKWebView
// shows the system "Paste" permission pill on every ⌘V; pbpaste/osascript
// read the pasteboard without it.
use std::process::Command;

#[tauri::command]
pub fn clipboard_text() -> String {
    Command::new("pbpaste")
        // GUI-launched app inherits no LANG/LC_ALL; without one pbpaste
        // guesses an encoding and mangles curly quotes/emoji into invalid
        // UTF-8, which from_utf8_lossy below turns into U+FFFD.
        .env("LANG", "en_US.UTF-8")
        .env("LC_ALL", "en_US.UTF-8")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default()
}

/// If the clipboard holds an image, write it as PNG under
/// ~/.context-terminal/pastes/ and return the path. None otherwise.
#[tauri::command]
pub fn clipboard_image_path() -> Option<String> {
    let home = std::env::var("HOME").ok()?;
    let dir = std::path::Path::new(&home).join(".context-terminal/pastes");
    std::fs::create_dir_all(&dir).ok()?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_millis();
    let path = dir.join(format!("paste-{ts}.png"));
    let script = format!(
        "set f to open for access POSIX file \"{}\" with write permission\n\
         write (the clipboard as \u{ab}class PNGf\u{bb}) to f\n\
         close access f",
        path.display()
    );
    let ok = Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if ok && path.metadata().map(|m| m.len() > 0).unwrap_or(false) {
        Some(path.to_string_lossy().into_owned())
    } else {
        let _ = std::fs::remove_file(&path);
        None
    }
}
