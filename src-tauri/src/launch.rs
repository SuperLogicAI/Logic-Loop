//! Plan 045: Codex launch registry. A launch is one `codex` process Logic Loop
//! started (or saw registered) for a tab's current PTY. Its random id rides the
//! existing `LOGIC_LOOP_TAB_ID` value as `<tab>:<launch>`, so hooks prove which
//! launch they came from without changing the hook command. In memory only:
//! PTYs, and so live launches, die with the app.

use std::collections::HashMap;
use std::sync::Mutex;

/// How ingest classifies a hook's launch id. `None` (plain tether) is decided
/// by the header split, not here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    /// Registered for this tab, not retired, PTY still live.
    Current,
    /// Known, but ended or its PTY died.
    Retired,
    /// Never registered, or registered for a different tab.
    Unknown,
}

impl Verdict {
    pub fn as_str(self) -> &'static str {
        match self {
            Verdict::Current => "current",
            Verdict::Retired => "retired",
            Verdict::Unknown => "unknown",
        }
    }
}

struct Launch {
    tab_id: String,
    pty: u32,
    retired: bool,
}

#[derive(Default)]
struct Inner {
    /// Live PTY id → the tab it was spawned for.
    ptys: HashMap<u32, String>,
    // ponytail: retired launches are kept (human-scale: one per `codex` run) so
    // late hooks read "retired" rather than "unknown"; prune if that ever grows.
    launches: HashMap<String, Launch>,
}

#[derive(Default)]
pub struct LaunchRegistry(Mutex<Inner>);

/// Shell (`uuidgen`) and Rust (hex) ids both pass; `:` never does, so the
/// `<tab>:<launch>` split stays unambiguous.
pub fn valid_launch_id(id: &str) -> bool {
    (8..=64).contains(&id.len()) && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// 128-bit random, hex. None only if the OS has no entropy; the caller then
/// launches untracked (fail open).
pub fn new_launch_id() -> Option<String> {
    let mut raw = [0u8; 16];
    getrandom::fill(&mut raw).ok()?;
    Some(raw.iter().map(|b| format!("{b:02x}")).collect())
}

impl LaunchRegistry {
    pub fn pty_opened(&self, pty: u32, tab_id: &str) {
        if let Ok(mut inner) = self.0.lock() {
            inner.ptys.insert(pty, tab_id.to_string());
        }
    }

    /// PTY exit, kill, or tab close: every launch it hosted is over.
    pub fn pty_closed(&self, pty: u32) {
        if let Ok(mut inner) = self.0.lock() {
            inner.ptys.remove(&pty);
            for launch in inner.launches.values_mut().filter(|l| l.pty == pty) {
                launch.retired = true;
            }
        }
    }

    /// Accepts only a fresh, valid id for a live PTY spawned for this tab.
    pub fn register(&self, tab_id: &str, pty: u32, launch_id: &str) -> bool {
        if !valid_launch_id(launch_id) {
            return false;
        }
        let Ok(mut inner) = self.0.lock() else { return false };
        if inner.ptys.get(&pty).map(String::as_str) != Some(tab_id) || inner.launches.contains_key(launch_id) {
            return false;
        }
        inner.launches.insert(
            launch_id.to_string(),
            Launch { tab_id: tab_id.to_string(), pty, retired: false },
        );
        true
    }

    pub fn retire(&self, launch_id: &str) {
        if let Ok(mut inner) = self.0.lock() {
            if let Some(launch) = inner.launches.get_mut(launch_id) {
                launch.retired = true;
            }
        }
    }

    pub fn verdict(&self, tab_id: &str, launch_id: &str) -> Verdict {
        let Ok(inner) = self.0.lock() else { return Verdict::Unknown };
        match inner.launches.get(launch_id) {
            Some(l) if l.tab_id != tab_id => Verdict::Unknown,
            Some(l) if l.retired || !inner.ptys.contains_key(&l.pty) => Verdict::Retired,
            Some(_) => Verdict::Current,
            None => Verdict::Unknown,
        }
    }

    /// Kill-all path (webview reload, app quit).
    pub fn close_all(&self) {
        if let Ok(mut inner) = self.0.lock() {
            inner.ptys.clear();
            for launch in inner.launches.values_mut() {
                launch.retired = true;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const L1: &str = "0123456789abcdef0123456789abcdef";
    const L2: &str = "E621E1F8-C36C-495A-93FC-0C247A3E6E5F";

    fn reg_with_pty() -> LaunchRegistry {
        let reg = LaunchRegistry::default();
        reg.pty_opened(7, "tab-a");
        reg
    }

    #[test]
    fn registered_launch_is_current_for_its_tab_only() {
        let reg = reg_with_pty();
        assert!(reg.register("tab-a", 7, L1));
        assert_eq!(reg.verdict("tab-a", L1), Verdict::Current);
        assert_eq!(reg.verdict("tab-b", L1), Verdict::Unknown);
        assert_eq!(reg.verdict("tab-a", L2), Verdict::Unknown);
    }

    #[test]
    fn register_rejects_dead_or_mismatched_pty_bad_id_and_reuse() {
        let reg = reg_with_pty();
        assert!(!reg.register("tab-a", 8, L1), "unknown pty");
        assert!(!reg.register("tab-b", 7, L1), "pty belongs to another tab");
        assert!(!reg.register("tab-a", 7, "short"), "invalid id");
        assert!(!reg.register("tab-a", 7, "abcdefgh:ijk"), "colon would break the split");
        assert!(reg.register("tab-a", 7, L2), "uuidgen shape accepted");
        assert!(!reg.register("tab-a", 7, L2), "an id registers once");
    }

    #[test]
    fn retire_and_pty_death_make_launches_retired() {
        let reg = reg_with_pty();
        reg.pty_opened(9, "tab-a");
        assert!(reg.register("tab-a", 7, L1));
        assert!(reg.register("tab-a", 9, L2));
        reg.retire(L1);
        assert_eq!(reg.verdict("tab-a", L1), Verdict::Retired);
        assert_eq!(reg.verdict("tab-a", L2), Verdict::Current);
        reg.pty_closed(9);
        assert_eq!(reg.verdict("tab-a", L2), Verdict::Retired);
        assert!(!reg.register("tab-a", 9, "ffffffffffffffff"), "closed pty takes no new launches");
    }

    #[test]
    fn close_all_retires_everything() {
        let reg = reg_with_pty();
        assert!(reg.register("tab-a", 7, L1));
        reg.close_all();
        assert_eq!(reg.verdict("tab-a", L1), Verdict::Retired);
    }

    #[test]
    fn generated_ids_are_valid_and_distinct() {
        let a = new_launch_id().unwrap();
        let b = new_launch_id().unwrap();
        assert!(valid_launch_id(&a) && valid_launch_id(&b));
        assert_ne!(a, b);
    }
}
