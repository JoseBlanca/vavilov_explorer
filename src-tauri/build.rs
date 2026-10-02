//! Tauri's build script: it reads tauri.conf.json and the capabilities, and
//! embeds what the app needs from them.

/// The app's own commands. Declaring them makes Tauri check every call to
/// them against the capabilities, as it checks its own: without the list,
/// any window of the app could call them whatever its capability says
/// (`tauri-2.12.1/src/webview/mod.rs`, the check of the ACL).
const COMMANDS: &[&str] = &[
    "subscribe",
    "describe_table",
    "fetch_rows",
    "set_selection",
    "assign_rows",
    "unassign_rows",
    "set_hover",
    "set_active_classification",
    "select_population",
    "set_role",
    "undo",
    "redo",
    "import_table",
    "export_table",
    "region_decimal_mark",
];

fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let manifest = tauri_build::AppManifest::new().commands(COMMANDS);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .map_err(Into::into)
}
