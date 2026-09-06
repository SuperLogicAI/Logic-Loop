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
/// one definition instead of one per adapter.
pub fn home_or_tmp() -> String {
    home().unwrap_or_else(|| "/tmp".into())
}
