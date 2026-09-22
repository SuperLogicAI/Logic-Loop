use crate::home::home_or_tmp;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

/// Marker field written into the installed `dsh-terminal-app/package.json`
/// (the bundled plugin's own manifest, `dsh-terminal-app/package.json` in
/// this repo) so `plugin_is_ours`/`plugin_has_current_version` can tell our
/// install apart from an unrelated directory, the same role
/// `pi.rs`'s `MARKER`/`PI_EXTENSION_VERSION` play for a single generated
/// file. Bump this when the plugin's translated payload shape changes in a
/// way a reader must know about.
const MARKER_FIELD: &str = "logicLoopAdapterVersion";
const DEEPSEEK_ADAPTER_VERSION: u64 = 3;

/// The Logic-Loop-owned `dsh` profile every install shares. Derived from the
/// shipped `headless` bundle (Plan 028 Step 0: its base layer is the same
/// shared agent/session/tool stack `web` patches, without any browser-only
/// dependency, and `--dump-default-config` proved the base/app-patch split
/// is real and inspectable).
pub(crate) const PROFILE_NAME: &str = "logic-loop";

/// Every `@deepseek-ai/*` package `dsh-terminal-app` depends on directly and
/// that must be pinned to this profile's own resolved version rather than a
/// bare `*` range — an unpinned range previously resolved
/// `@deepseek-ai/dsh-session` to an ancient, incompatible `0.0.1-rc.1`
/// published under the same name (plans/028), because these prerelease-only
/// scoped packages don't reliably carry a sane "latest" dist-tag.
const CORE_PACKAGES: [&str; 9] = [
    "cordis",
    "cordis-plugin-loader",
    "dsh-agent",
    "dsh-agent-default-model",
    "dsh-llm",
    "dsh-session",
    "dsh-cmdline",
    "dsh-util-values",
    "schemastery",
];

fn is_executable(candidate: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::metadata(candidate).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
    }
    #[cfg(not(unix))]
    {
        candidate.is_file()
    }
}

fn has_on_path(name: &str) -> bool {
    std::env::var("PATH").is_ok_and(|path_var| {
        std::env::split_paths(&path_var).any(|dir| is_executable(&dir.join(name)))
    })
}

fn deepseek_detection_paths(home: &Path) -> [PathBuf; 4] {
    [
        home.join("npm-global").join("bin").join("dsh"),
        home.join(".local").join("bin").join("dsh"),
        PathBuf::from("/opt/homebrew/bin/dsh"),
        PathBuf::from("/usr/local/bin/dsh"),
    ]
}

#[tauri::command]
pub fn deepseek_detect() -> bool {
    // DeepSeek Harness is npx-first in practice — Plan 027 found no local
    // `dsh` via `npm ls -g` or `brew list` on a real dev machine, only
    // `npx @deepseek-ai/dsh` working with no global install. This adapter's
    // detected signal still follows every other adapter's own convention
    // (check for the agent's own binary, not its runtime prerequisite), so
    // "detected" means the user deliberately installed `dsh` globally —
    // an honest, if less convenient, signal consistent with that finding,
    // not a claim that DeepSeek is unusable without it (`setup()` below
    // falls back to `npx` regardless).
    has_on_path("dsh")
        || deepseek_detection_paths(Path::new(&home_or_tmp()))
            .iter()
            .any(|candidate| is_executable(candidate))
}

/// The program + leading args to invoke `dsh` with. Prefers a global
/// install; falls back to the `npx` path Plan 027/028 proved works with no
/// global install (the typical case), so `setup()` isn't gated behind
/// `deepseek_detect()`'s stricter, honesty-first signal.
fn dsh_invocation() -> Vec<String> {
    if has_on_path("dsh") {
        vec!["dsh".to_string()]
    } else {
        vec!["npx".to_string(), "--yes".to_string(), "@deepseek-ai/dsh".to_string()]
    }
}

fn dsh_home() -> PathBuf {
    std::env::var("DSH_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(home_or_tmp()).join(".dsh"))
}

fn profile_dir(home: &Path) -> PathBuf {
    home.join("profiles").join(PROFILE_NAME)
}

/// Where `dsh` actually resolves `@deepseek-ai/*` package versions from —
/// one level above individual profile directories, shared across every
/// profile under one `DSH_HOME` (found live, plans/028: an individual
/// profile's own `node_modules` holds only its own added plugins).
fn shared_node_modules(home: &Path) -> PathBuf {
    home.join("profiles").join("node_modules").join("@deepseek-ai")
}

fn plugin_dir(home: &Path) -> PathBuf {
    profile_dir(home).join("node_modules").join("dsh-terminal-app")
}

fn plugin_is_ours(package_json_source: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(package_json_source)
        .ok()
        .and_then(|v| v.get("name")?.as_str().map(|s| s == "dsh-terminal-app"))
        .unwrap_or(false)
}

fn plugin_has_current_version(package_json_source: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(package_json_source)
        .ok()
        .and_then(|v| v.get(MARKER_FIELD)?.as_u64())
        .is_some_and(|v| v == DEEPSEEK_ADAPTER_VERSION)
}

/// Read `@deepseek-ai/<pkg>`'s resolved version from this profile's shared
/// package tree.
fn read_resolved_version(shared: &Path, pkg: &str) -> Option<String> {
    let source = fs::read_to_string(shared.join(pkg).join("package.json")).ok()?;
    serde_json::from_str::<serde_json::Value>(&source)
        .ok()?
        .get("version")?
        .as_str()
        .map(str::to_string)
}

/// Pure decision: rewrite `dsh-terminal-app/package.json`'s core
/// `@deepseek-ai/*` dependency versions to the exact strings resolved from
/// this profile, leaving every other field (including `commander`, a
/// normally-published stable package needing no per-profile pin) untouched.
fn pin_core_versions(source: &str, versions: &HashMap<String, String>) -> Result<String, String> {
    let mut json: serde_json::Value = serde_json::from_str(source).map_err(|e| e.to_string())?;
    let deps = json
        .get_mut("dependencies")
        .and_then(|d| d.as_object_mut())
        .ok_or_else(|| "dsh-terminal-app/package.json has no dependencies object".to_string())?;
    for pkg in CORE_PACKAGES {
        if let Some(version) = versions.get(pkg) {
            deps.insert(format!("@deepseek-ai/{pkg}"), serde_json::Value::String(version.clone()));
        }
    }
    serde_json::to_string_pretty(&json).map_err(|e| e.to_string())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let dest_path = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&entry.path(), &dest_path)?;
        } else {
            fs::copy(entry.path(), &dest_path)?;
        }
    }
    Ok(())
}

fn run(invocation: &[String], args: &[&str]) -> Result<(), String> {
    let (program, leading) = invocation.split_first().ok_or_else(|| "no dsh invocation".to_string())?;
    // GUI-launched apps inherit only the system PATH, missing the
    // Homebrew/nvm dirs `npx` normally lives in (see codex_meter's
    // `subprocess_path`, built for the identical Codex GUI PATH bug).
    let path = crate::codex_meter::subprocess_path(
        std::path::Path::new(program),
        std::env::var_os("PATH").as_deref(),
    )?;
    let output = std::process::Command::new(program)
        .args(leading)
        .args(args)
        .env("PATH", path)
        .output()
        .map_err(|e| format!("failed to run {program}: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "{program} exited with {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(())
}

/// Install the bundled `dsh-terminal-app` plugin into the Logic-Loop-owned
/// `logic-loop` profile. Mirrors, step for step, the sequence proved live
/// by hand in plans/028 — no handling added for a scenario that sequence
/// didn't actually hit (a missing `pnpm`, a corrupt prior install, a
/// mid-install network failure): those surface `dsh`'s or `npm`'s own error
/// text through this function's `Result`, same fail-open-with-a-clear-error
/// shape as every other adapter installer in this codebase.
#[tauri::command]
pub fn deepseek_hooks_setup(app: AppHandle) -> Result<(), String> {
    let home = dsh_home();
    let invocation = dsh_invocation();
    let plugin_dir = plugin_dir(&home);

    // Guard mirrors every other adapter module's own-file protection
    // (e.g. pi.rs's plan_setup): refuse to overwrite a plugin directory
    // that exists but isn't ours.
    if let Ok(existing) = fs::read_to_string(plugin_dir.join("package.json")) {
        if !plugin_is_ours(&existing) {
            return Err(
                "dsh-terminal-app plugin directory exists but isn't a Logic Loop install — leaving it untouched"
                    .to_string(),
            );
        }
    }

    // 1. Materialize the profile from the headless template if absent. A
    //    cheap `--help` boot still runs the full plugin-tree install
    //    first, same as any other invocation — proven live (plans/028).
    if !profile_dir(&home).join("package.json").exists() {
        run(
            &invocation,
            &["--profile", PROFILE_NAME, "--from-default-profile", "headless", "--help"],
        )?;
    }

    // 2. Resolve this profile's actual installed versions for every core
    //    package we depend on.
    let shared = shared_node_modules(&home);
    let mut versions = HashMap::new();
    for pkg in CORE_PACKAGES {
        let version = read_resolved_version(&shared, pkg).ok_or_else(|| {
            format!("deepseek adapter: could not resolve installed version of @deepseek-ai/{pkg} in this profile")
        })?;
        versions.insert(pkg.to_string(), version);
    }

    // 3. Install our plugin package into the profile via dsh's own plugin
    //    manager (requires pnpm on PATH; its own error surfaces as-is if
    //    missing). `resolve(..., BaseDirectory::Resource)` is Tauri's own
    //    documented path for a bundled resource — unlike a raw
    //    `resource_dir()` join, it resolves correctly under `tauri dev`
    //    too, not only a built app bundle.
    let resource_dir = app
        .path()
        .resolve("dsh-terminal-app", BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;
    run(
        &invocation,
        &["plugin", "--profile", PROFILE_NAME, "add", "-w", &resource_dir.to_string_lossy()],
    )?;

    // 4. `dsh plugin add` symlinks the package in place; a plugin resolved
    //    through a symlink outside the profile's own workspace can't see
    //    the profile's hoisted dependency tree, and forcing Node to
    //    resolve through the symlink (`--preserve-symlinks`) breaks
    //    pnpm's own symlink-based store for unrelated packages already
    //    working in the tree — confirmed live (plans/028). Replace the
    //    symlink with a real, self-contained copy instead.
    if plugin_dir.exists() || plugin_dir.is_symlink() {
        fs::remove_file(&plugin_dir)
            .or_else(|_| fs::remove_dir_all(&plugin_dir))
            .map_err(|e| e.to_string())?;
    }
    copy_dir_recursive(&resource_dir, &plugin_dir).map_err(|e| e.to_string())?;

    // 5. Pin every core dependency to this profile's exact resolved
    //    version before installing.
    let package_json_path = plugin_dir.join("package.json");
    let source = fs::read_to_string(&package_json_path).map_err(|e| e.to_string())?;
    let pinned = pin_core_versions(&source, &versions)?;
    fs::write(&package_json_path, pinned).map_err(|e| e.to_string())?;

    // 6. Install the plugin's own dependencies. `--legacy-peer-deps`:
    //    these packages declare `peerDependencies` among themselves that
    //    npm's default resolver tries to auto-satisfy from the registry,
    //    conflicting on shared transitive versions (plans/028).
    let npm_path = crate::codex_meter::subprocess_path(
        std::path::Path::new("npm"),
        std::env::var_os("PATH").as_deref(),
    )?;
    let output = std::process::Command::new("npm")
        .args(["install", "--legacy-peer-deps"])
        .current_dir(&plugin_dir)
        .env("PATH", npm_path)
        .output()
        .map_err(|e| format!("failed to run npm install: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "npm install failed inside the installed plugin: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    Ok(())
}

#[tauri::command]
pub fn deepseek_hooks_remove() -> Result<(), String> {
    let dir = plugin_dir(&dsh_home());
    match fs::read_to_string(dir.join("package.json")) {
        Err(_) => Ok(()),
        Ok(source) if plugin_is_ours(&source) => fs::remove_dir_all(&dir).map_err(|e| e.to_string()),
        Ok(_) => Err(
            "dsh-terminal-app plugin directory exists but isn't a Logic Loop install — leaving it untouched"
                .to_string(),
        ),
    }
}

#[tauri::command]
pub fn deepseek_hooks_status() -> Result<bool, String> {
    let dir = plugin_dir(&dsh_home());
    let package_json = dir.join("package.json");
    Ok(fs::read_to_string(package_json)
        .is_ok_and(|source| plugin_is_ours(&source) && plugin_has_current_version(&source))
        && dir.join("src/index.js").is_file()
        && dir.join("src/messages.js").is_file()
        && dir.join("src/startup.js").is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    const OWNED: &str = r#"{"name":"dsh-terminal-app","logicLoopAdapterVersion":3,"dependencies":{}}"#;
    const STALE: &str = r#"{"name":"dsh-terminal-app","logicLoopAdapterVersion":2,"dependencies":{}}"#;
    const FOREIGN: &str = r#"{"name":"someone-elses-package","dependencies":{}}"#;

    #[test]
    fn plugin_is_ours_accepts_only_the_right_package_name() {
        assert!(plugin_is_ours(OWNED));
        assert!(plugin_is_ours(STALE));
        assert!(!plugin_is_ours(FOREIGN));
        assert!(!plugin_is_ours("not json"));
    }

    #[test]
    fn plugin_has_current_version_distinguishes_stale_from_current() {
        assert!(plugin_has_current_version(OWNED));
        assert!(!plugin_has_current_version(STALE));
        assert!(!plugin_has_current_version(FOREIGN));
    }

    #[test]
    fn pin_core_versions_rewrites_only_the_known_core_packages() {
        let source = r#"{
            "dependencies": {
                "commander": "^15.0.0",
                "@deepseek-ai/dsh-agent": "*",
                "@deepseek-ai/dsh-session": "*"
            }
        }"#;
        let mut versions = HashMap::new();
        versions.insert("dsh-agent".to_string(), "0.1.6-alpha.2".to_string());
        versions.insert("dsh-session".to_string(), "0.1.6-alpha.2".to_string());

        let rewritten = pin_core_versions(source, &versions).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&rewritten).unwrap();
        assert_eq!(parsed["dependencies"]["@deepseek-ai/dsh-agent"], "0.1.6-alpha.2");
        assert_eq!(parsed["dependencies"]["@deepseek-ai/dsh-session"], "0.1.6-alpha.2");
        // Untouched: not one of CORE_PACKAGES, and not present in `versions`.
        assert_eq!(parsed["dependencies"]["commander"], "^15.0.0");
    }

    #[test]
    fn pin_core_versions_leaves_an_unresolved_package_as_is() {
        let source = r#"{"dependencies": {"@deepseek-ai/dsh-agent": "*"}}"#;
        let rewritten = pin_core_versions(source, &HashMap::new()).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&rewritten).unwrap();
        assert_eq!(parsed["dependencies"]["@deepseek-ai/dsh-agent"], "*");
    }

    #[test]
    fn pin_core_versions_rejects_a_manifest_with_no_dependencies_object() {
        assert!(pin_core_versions(r#"{"name":"x"}"#, &HashMap::new()).is_err());
    }

    #[test]
    fn dsh_invocation_falls_back_to_npx_when_dsh_is_absent_from_path() {
        // has_on_path("dsh") depends on the real test-runner's PATH, which
        // this repo's own research (plans/027) already found has no local
        // `dsh` — asserting the fallback shape directly instead.
        let invocation = ["npx".to_string(), "--yes".to_string(), "@deepseek-ai/dsh".to_string()];
        assert_eq!(invocation[0], "npx");
        assert_eq!(invocation.last().unwrap(), "@deepseek-ai/dsh");
    }

    #[test]
    fn detection_paths_include_homebrew_prefixes() {
        let paths = deepseek_detection_paths(Path::new("/tmp/dsh-home"));
        assert!(paths.contains(&PathBuf::from("/opt/homebrew/bin/dsh")));
        assert!(paths.contains(&PathBuf::from("/usr/local/bin/dsh")));
    }
}
