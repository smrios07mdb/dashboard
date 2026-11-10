// No console window on Windows release builds (inert on macOS; Tauri's default).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    hupomnemata_menubar::run()
}
