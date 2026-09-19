// Single source for the user's home directory. `HOME` does not exist on
// Windows — the equivalent is `USERPROFILE` — so reading `HOME` alone made
// every adapter fall through to its own fallback there and register its hooks
// into a path Windows has no notion of, silently and with no error surfaced.

/// The first of `HOME`, `USERPROFILE` that is set. `None` when neither is, so
/// each call site keeps the fallback it already had rather than one being
/// imposed here.
pub fn home() -> Option<String> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()
}

/// The fallback the four agent adapters share, factored out so the literal has
/// one definition instead of one per adapter. `std::env::temp_dir()` is used
/// over a hardcoded `/tmp` so this resolves on Windows too, where `/tmp`
/// doesn't exist.
pub fn home_or_tmp() -> String {
    home().unwrap_or_else(|| std::env::temp_dir().to_string_lossy().into_owned())
}

// Tests across this file and pty.rs read/write HOME and USERPROFILE; without
// a shared lock, cargo test's parallel threads can race and panic each other
// (one test unsets HOME mid-`unwrap()` in another). Every test touching
// either var must hold this first.
#[cfg(test)]
pub(crate) static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg(test)]
pub(crate) fn lock_env() -> std::sync::MutexGuard<'static, ()> {
    // A test failure while changing process-wide environment variables must not
    // hide later failures behind a poisoned lock.
    ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
pub(crate) struct EnvRestore(Option<std::ffi::OsString>, Option<std::ffi::OsString>);

#[cfg(test)]
impl EnvRestore {
    pub(crate) fn capture() -> Self {
        Self(std::env::var_os("HOME"), std::env::var_os("USERPROFILE"))
    }
}

#[cfg(test)]
impl Drop for EnvRestore {
    fn drop(&mut self) {
        match &self.0 {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }
        match &self.1 {
            Some(value) => std::env::set_var("USERPROFILE", value),
            None => std::env::remove_var("USERPROFILE"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn home_falls_back_to_userprofile_when_home_unset() {
        let _guard = lock_env();
        let _restore_env = EnvRestore::capture();

        std::env::remove_var("HOME");
        std::env::set_var("USERPROFILE", "/tmp/fake-userprofile");
        assert_eq!(home().as_deref(), Some("/tmp/fake-userprofile"));

        std::env::remove_var("HOME");
        std::env::remove_var("USERPROFILE");
        assert_eq!(home(), None);
        assert_eq!(home_or_tmp(), std::env::temp_dir().to_string_lossy());

    }
}
