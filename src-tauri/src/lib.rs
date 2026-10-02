//! The Tauri app of Vavilov Explorer: its commands, channels and windows,
//! each a thin layer over the core (.claude/skills/coding/SKILL.md).

pub mod commands;

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
    with_session(tauri::Builder::default()).run(tauri::generate_context!())
}

/// The builder with the session, every command, and the window events the
/// session follows; the app and the tests of the commands start from it.
pub fn with_session<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
        .manage(Mutex::new(Session::new()))
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
            commands::set_selection,
            commands::assign_rows,
            commands::unassign_rows,
            commands::set_hover,
            commands::set_active_classification,
            commands::select_population,
            commands::undo,
            commands::redo,
        ])
}
