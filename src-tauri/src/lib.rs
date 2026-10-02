//! The Tauri app of Vavilov Explorer: its commands, channels and windows,
//! each a thin layer over the core (.claude/skills/coding/SKILL.md).

/// Starts the app and runs it until it quits.
///
/// # Errors
///
/// Tauri's error when it cannot start the app, for example when the
/// system's web view is missing.
pub fn run() -> tauri::Result<()> {
    tauri::Builder::default().run(tauri::generate_context!())
}
