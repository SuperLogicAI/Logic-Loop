// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Antigravity spawns this exact binary as its hook `command`; intercept
    // before booting the GUI so `agy` gets a headless process, not a window.
    let args: Vec<String> = std::env::args().collect();
    if let Some(pos) = args.iter().position(|a| a == "--antigravity-hook") {
        if let Some(event) = args.get(pos + 1) {
            app_lib::antigravity::run_hook_mode(event);
        }
    }
    app_lib::run()
}
