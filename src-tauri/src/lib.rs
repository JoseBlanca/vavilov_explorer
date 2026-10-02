//! The Tauri app of Vavilov Explorer: its commands, channels and windows,
//! each a thin layer over the core (.claude/skills/coding/SKILL.md).

pub mod calls;
pub mod commands;
#[cfg(any(feature = "demo", test))]
pub mod demo;
pub mod dialogs;
pub mod menu;
pub mod transfer;

use std::sync::Mutex;

use tauri::{Manager, Runtime, WindowEvent};
use vavilov_core::Session;

/// Starts the app and runs it until it quits.
///
/// # Errors
///
/// Tauri's error when it cannot start the app, for example when the
/// system's web view is missing.
pub fn run() -> tauri::Result<()> {
    with_session(tauri::Builder::default())
        // The menu is made in the setup, once the main window exists
        // (menu::install), so Tauri's default menu of macOS is not made.
        .enable_macos_default_menu(false)
        .on_menu_event(menu::chosen)
        .setup(|app| {
            menu::install(app.handle())?;
            // A build with the feature `demo` opens with the demo table;
            // one that cannot load it does not start.
            #[cfg(feature = "demo")]
            {
                demo::load(&app.state::<Mutex<Session>>())?;
                menu::enable_table_items(app.handle());
            }
            Ok(())
        })
        .run(tauri::generate_context!())
}

/// The builder with the session, every command, and the window events the
/// session follows; the app and the tests of the commands start from it.
pub fn with_session<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
        .manage(Mutex::new(Session::new()))
        // The system's dialogs of the import and the export; registered
        // here, so that the tests of the commands have them too, since a
        // command that asks for the dialogs without it panics.
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                match window.try_state::<Mutex<Session>>() {
                    Some(session) => commands::unsubscribe(&session, window.label()),
                    None => eprintln!(
                        "Vavilov Explorer defect: no session to unsubscribe window {}",
                        window.label()
                    ),
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::subscribe,
            commands::describe_table,
            commands::fetch_rows,
            commands::set_selection,
            commands::assign_rows,
            commands::unassign_rows,
            commands::set_hover,
            commands::set_active_classification,
            commands::select_population,
            commands::set_role,
            commands::undo,
            commands::redo,
            commands::import_table,
            commands::export_table,
        ])
}
