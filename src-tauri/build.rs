//! Tauri's build script: it reads tauri.conf.json and the capabilities, and
//! embeds what the app needs from them.

fn main() {
    tauri_build::build()
}
