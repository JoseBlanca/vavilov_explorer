//! The app's menu, defined once in the backend: the menu bar of the app on
//! macOS, the main window's alone on Windows and Linux (`docs/design.md`,
//! section 10). An item the user chooses is handed to the main window as
//! an action, which the window carries out as it would a control of its
//! own, so that it shows the answer, a refusal among them (`docs/core.md`,
//! section 5).

use std::sync::Mutex;

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, Runtime};
use vavilov_core::{Session, UndoRedo, WindowLabel};

use crate::actions::{MenuAction, send_action};

use crate::commands::report_dropped;

/// Each item the main window carries out: its id, which is also the name
/// the window gives its action, its text, the action, and its shortcut.
/// Undo and Redo have Cmd-Z and Cmd-Shift-Z, and Select None
/// Cmd-Shift-A, Ctrl outside macOS (`docs/design.md`, section 2.1).
const ITEMS: [(&str, &str, MenuAction, Option<&str>); 12] = [
    (
        "importTable",
        "Import table…",
        MenuAction::ImportTable,
        None,
    ),
    (
        "openExample",
        "Open Example Table",
        MenuAction::OpenExample,
        None,
    ),
    ("exportCsv", "Export as CSV…", MenuAction::ExportCsv, None),
    (
        "exportXlsx",
        "Export as Excel…",
        MenuAction::ExportXlsx,
        None,
    ),
    ("undo", "Undo", MenuAction::Undo, Some("CmdOrCtrl+Z")),
    ("redo", "Redo", MenuAction::Redo, Some("CmdOrCtrl+Shift+Z")),
    (
        "selectNone",
        "Select None",
        MenuAction::SelectNone,
        Some("CmdOrCtrl+Shift+A"),
    ),
    ("scatter3d", "3D scatter…", MenuAction::Scatter3d, None),
    ("scatter2d", "2D scatter…", MenuAction::Scatter2d, None),
    ("histogram", "Histogram…", MenuAction::Histogram, None),
    ("map", "Map…", MenuAction::Map, None),
    (
        "countryMap",
        "Map of countries…",
        MenuAction::CountryMap,
        None,
    ),
];

/// The actions whose items need a table, disabled until one is open.
const NEED_A_TABLE: [MenuAction; 8] = [
    MenuAction::ExportCsv,
    MenuAction::ExportXlsx,
    MenuAction::SelectNone,
    MenuAction::Scatter3d,
    MenuAction::Scatter2d,
    MenuAction::Histogram,
    MenuAction::Map,
    MenuAction::CountryMap,
];

/// The id of our Close Window item, outside macOS. muda's own renders
/// disabled on Linux (`muda-0.20.0/src/platform_impl/gtk/mod.rs`).
#[cfg(not(target_os = "macos"))]
const CLOSE_WINDOW: &str = "closeWindow";

/// The id of our Quit item, outside macOS. muda's own renders disabled on
/// Linux, and on Windows posts a quit message that skips
/// `RunEvent::ExitRequested`, where the app will ask to save.
#[cfg(not(target_os = "macos"))]
const QUIT: &str = "quit";

/// The items that follow the session: those that need a table, enabled
/// once one is open, and Undo and Redo, enabled while there is something
/// to undo and to redo.
struct FollowingItems<R: Runtime> {
    table: Vec<MenuItem<R>>,
    undo: MenuItem<R>,
    redo: MenuItem<R>,
}

/// The action of the item of the menu whose id, or the window's name of
/// its action, is `name`; `None` for any other.
#[must_use]
pub fn action_named(name: &str) -> Option<MenuAction> {
    ITEMS
        .iter()
        .find(|(id, _, _, _)| *id == name)
        .map(|(_, _, action, _)| *action)
}

/// Makes the menu of the app and gives it to the app on macOS and to the
/// main window alone on Windows and Linux; called once, when the app
/// starts, after the main window is made.
///
/// # Errors
///
/// Tauri's error when a menu cannot be made or set, or `WindowNotFound`
/// when there is no main window outside macOS.
pub fn install<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    // Undo and Redo start disabled, with nothing to undo.
    let items = ITEMS.map(|(id, text, action, shortcut)| {
        let enabled = !NEED_A_TABLE.contains(&action)
            && !matches!(action, MenuAction::Undo | MenuAction::Redo);
        MenuItem::with_id(app, id, text, enabled, shortcut)
    });
    let [
        import,
        open_example,
        export_csv,
        export_xlsx,
        undo,
        redo,
        select_none,
        scatter3d,
        scatter2d,
        histogram,
        map,
        country_map,
    ] = items;
    let (
        import,
        open_example,
        export_csv,
        export_xlsx,
        undo,
        redo,
        select_none,
        scatter3d,
        scatter2d,
        histogram,
        map,
        country_map,
    ) = (
        import?,
        open_example?,
        export_csv?,
        export_xlsx?,
        undo?,
        redo?,
        select_none?,
        scatter3d?,
        scatter2d?,
        histogram?,
        map?,
        country_map?,
    );
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &import,
            &open_example,
            &PredefinedMenuItem::separator(app)?,
            &export_csv,
            &export_xlsx,
            &PredefinedMenuItem::separator(app)?,
            #[cfg(target_os = "macos")]
            &PredefinedMenuItem::close_window(app, None)?,
            #[cfg(not(target_os = "macos"))]
            &close_window_item(app)?,
            #[cfg(not(target_os = "macos"))]
            &quit_item(app)?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &undo,
            &redo,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
            &select_none,
        ],
    )?;
    let plot = Submenu::with_items(
        app,
        "Plot",
        true,
        &[&scatter3d, &scatter2d, &histogram, &map, &country_map],
    )?;
    #[cfg(target_os = "macos")]
    {
        let name = app.package_info().name.clone();
        let application = Submenu::with_items(
            app,
            &name,
            true,
            &[
                &PredefinedMenuItem::about(app, None, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::services(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::hide(app, None)?,
                &PredefinedMenuItem::hide_others(app, None)?,
                &PredefinedMenuItem::show_all(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::quit(app, None)?,
            ],
        )?;
        let window = Submenu::with_items(
            app,
            "Window",
            true,
            &[
                &PredefinedMenuItem::minimize(app, None)?,
                &PredefinedMenuItem::maximize(app, None)?,
            ],
        )?;
        let menu = Menu::with_items(app, &[&application, &file, &edit, &plot, &window])?;
        app.set_menu(menu)?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let menu = Menu::with_items(app, &[&file, &edit, &plot])?;
        // Builder::menu would give it to every window (tauri-2.12.1,
        // src/window/mod.rs, the window's menu), and the widgets have none.
        app.get_webview_window(WindowLabel::MAIN)
            .ok_or(tauri::Error::WindowNotFound)?
            .set_menu(menu)?;
    }
    app.manage(FollowingItems {
        table: vec![
            export_csv,
            export_xlsx,
            select_none,
            scatter3d,
            scatter2d,
            histogram,
            map,
            country_map,
        ],
        undo,
        redo,
    });
    Ok(())
}

/// Close Window, with muda's text and shortcut for the platform
/// (`muda-0.20.0/src/items/predefined.rs`).
#[cfg(not(target_os = "macos"))]
fn close_window_item<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<MenuItem<R>> {
    let text = if cfg!(windows) {
        "Close"
    } else {
        "C&lose Window"
    };
    MenuItem::with_id(app, CLOSE_WINDOW, text, true, Some("Alt+F4"))
}

/// Quit, with muda's text for the platform
/// (`muda-0.20.0/src/items/predefined.rs`).
#[cfg(not(target_os = "macos"))]
fn quit_item<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<MenuItem<R>> {
    let text = if cfg!(windows) { "&Exit" } else { "&Quit" };
    MenuItem::with_id(app, QUIT, text, true, None::<&str>)
}

/// Carries out the item the user chose: hands an item of ours to the main
/// window, as its action, and outside macOS closes the main window or
/// quits. A main window that has not subscribed yet gets no action, which
/// is written to the log; one that is reloading still has its old channel
/// registered, and the action is lost with the page it was sent to.
pub fn chosen<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    #[cfg(not(target_os = "macos"))]
    {
        if event.id() == CLOSE_WINDOW {
            close_main_window(app);
            return;
        }
        if event.id() == QUIT {
            app.exit(0);
            return;
        }
    }
    let Some(action) = action_named(event.id().as_ref()) else {
        // The predefined items, cut, copy and the rest, are the system's.
        return;
    };
    let Some(session) = app.try_state::<Mutex<Session>>() else {
        eprintln!("Vavilov Explorer defect: no session for the menu's {action:?}");
        return;
    };
    if action.shows_in_main_window() {
        bring_main_window_forward(app);
    }
    let sent = match session.lock() {
        Ok(mut session) => send_action(&mut session, action),
        Err(_) => {
            eprintln!("Vavilov Explorer defect: the session's lock is poisoned; {action:?} lost");
            return;
        }
    };
    match sent {
        Ok(None) => {}
        Ok(Some(dropped)) => report_dropped(app, vec![dropped]),
        Err(error) => {
            eprintln!("Vavilov Explorer: the menu's {action:?} reached no window: {error}")
        }
    }
}

/// Brings the main window to the front, where an item of the menu shows its
/// dialog or its message, when another window was in front of it.
fn bring_main_window_forward<R: Runtime>(app: &AppHandle<R>) {
    match app.get_webview_window(WindowLabel::MAIN) {
        Some(window) => {
            if let Err(error) = window.set_focus() {
                eprintln!(
                    "Vavilov Explorer: the main window could not be brought forward: {error}"
                );
            }
        }
        None => eprintln!("Vavilov Explorer defect: an item of the menu with no main window"),
    }
}

/// Closes the main window, as the user's click on its close button does.
#[cfg(not(target_os = "macos"))]
fn close_main_window<R: Runtime>(app: &AppHandle<R>) {
    match app.get_webview_window(WindowLabel::MAIN) {
        Some(window) => {
            if let Err(error) = window.close() {
                eprintln!("Vavilov Explorer: the main window could not be closed: {error}");
            }
        }
        None => eprintln!("Vavilov Explorer defect: Close Window with no main window"),
    }
}

/// Enables the items that need a table, once one is open; a failure is
/// written to the log, and leaves them as they were.
pub fn enable_table_items<R: Runtime>(app: &AppHandle<R>) {
    let Some(items) = app.try_state::<FollowingItems<R>>() else {
        eprintln!("Vavilov Explorer defect: no menu whose export items to enable");
        return;
    };
    for item in &items.table {
        set_enabled(item, true);
    }
}

/// Enables Undo and Redo while there is something to undo and to redo; a
/// failure is written to the log, and leaves them as they were.
pub fn show_undo_redo<R: Runtime>(app: &AppHandle<R>, undo_redo: UndoRedo) {
    let Some(items) = app.try_state::<FollowingItems<R>>() else {
        eprintln!("Vavilov Explorer defect: no menu whose Undo and Redo to enable");
        return;
    };
    set_enabled(&items.undo, undo_redo.can_undo);
    set_enabled(&items.redo, undo_redo.can_redo);
}

fn set_enabled<R: Runtime>(item: &MenuItem<R>, enabled: bool) {
    if let Err(error) = item.set_enabled(enabled) {
        eprintln!(
            "Vavilov Explorer: the menu item {} could not be set to enabled {enabled}: {error}",
            item.id().as_ref()
        );
    }
}

#[cfg(test)]
mod tests;
