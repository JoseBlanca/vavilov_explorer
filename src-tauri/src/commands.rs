//! The Tauri commands: each takes the session's lock and hands its call to
//! [`calls::call`], which reads its arguments and calls the dispatcher;
//! the dispatcher sends the change to every window before it returns
//! (`docs/core.md`, section 4). No rule about the data is here.

use std::sync::{Mutex, MutexGuard};

use tauri::ipc::{Channel, InvokeResponseBody, Response};
use tauri::{AppHandle, Manager, Runtime, State, WebviewWindow};
use vavilov_core::{
    CommandError, Dropped, SendFailed, Session, Subscriber, TableDescription, WindowLabel,
    export_table as export_bytes,
};

use crate::calls;
use crate::dialogs;
use crate::example;
use crate::menu;
use crate::region;
use crate::transfer::{self, ExportAnswer, ImportAnswer};
use crate::widgets::{Closed, Widgets, WindowHost};
use crate::windows::{self, TauriWindows};

/// The session, as every command takes it.
pub type SessionState<'a> = State<'a, Mutex<Session>>;

/// The widgets and their windows, as the commands of the windows take them.
/// A command that takes both locks takes the session's first.
pub type WidgetsState<'a> = State<'a, Mutex<Widgets>>;

/// Registers the window's channel and returns the snapshot of the shared
/// state, as raw bytes; the channel then carries every change after it,
/// and for a window of widgets its list of widgets when one is added. A
/// window that is neither the main window nor an open window of widgets
/// is closed.
///
/// # Errors
///
/// `UnknownWindow`, or a `Defect`.
#[tauri::command]
pub fn subscribe<R: Runtime>(
    window: WebviewWindow<R>,
    on_change: Channel<InvokeResponseBody>,
    session: SessionState<'_>,
    widgets: WidgetsState<'_>,
) -> Result<Response, CommandError> {
    let label = WindowLabel::new(window.label());
    let mut session = lock(&session)?;
    if label.as_str() != WindowLabel::MAIN {
        let subscribed = lock_widgets(&widgets)?
            .subscribe(&label, Box::new(ChannelSubscriber(on_change.clone())));
        if let Err(error) = subscribed {
            drop(session);
            close_later(&window);
            return Err(error);
        }
    }
    let snapshot = session.subscribe(label, Box::new(ChannelSubscriber(on_change)))?;
    Ok(Response::new(snapshot))
}

/// The description of the table: its columns, their types, and the names
/// and colours of the levels. Takes no arguments.
///
/// # Errors
///
/// `NoProject`, or the refusals of [`calls::call`].
#[tauri::command]
pub fn describe_table(
    request: tauri::ipc::Request<'_>,
    session: SessionState<'_>,
) -> Result<TableDescription, CommandError> {
    let mut session = lock(&session)?;
    match calls::call(
        &mut session,
        "describe_table",
        request.body(),
        request.headers(),
    )? {
        calls::Reply::Description(description) => Ok(description),
        calls::Reply::Applied(_) | calls::Reply::Bytes(_) => Err(CommandError::Defect {
            what: "describe_table gave another reply than a description".to_owned(),
        }),
    }
}

/// A page of rows of the table, as raw bytes: `{ first, count, columns,
/// basedOn }`, with `first` the position of the page's first row among the
/// rows the filter shows and the ids of the columns wanted in their order.
/// It changes nothing.
///
/// # Errors
///
/// `MadeBeforeLoad`, `NoProject`, `RowsOutOfRange`, `UnknownColumn`, or
/// the refusals of [`calls::call`].
#[tauri::command]
pub fn fetch_rows(
    request: tauri::ipc::Request<'_>,
    session: SessionState<'_>,
) -> Result<Response, CommandError> {
    let mut session = lock(&session)?;
    match calls::call(
        &mut session,
        "fetch_rows",
        request.body(),
        request.headers(),
    )? {
        calls::Reply::Bytes(bytes) => Ok(Response::new(bytes)),
        calls::Reply::Applied(_) | calls::Reply::Description(_) => Err(CommandError::Defect {
            what: "fetch_rows gave another reply than rows".to_owned(),
        }),
    }
}

/// The values of a numeric column, whole, as raw bytes: `{ column, basedOn
/// }`. It changes nothing.
///
/// # Errors
///
/// `MadeBeforeLoad`, `NoProject`, `UnknownColumn`, `NotNumber`, or the
/// refusals of [`calls::call`].
#[tauri::command]
pub fn fetch_column(
    request: tauri::ipc::Request<'_>,
    session: SessionState<'_>,
) -> Result<Response, CommandError> {
    let mut session = lock(&session)?;
    match calls::call(
        &mut session,
        "fetch_column",
        request.body(),
        request.headers(),
    )? {
        calls::Reply::Bytes(bytes) => Ok(Response::new(bytes)),
        calls::Reply::Applied(_) | calls::Reply::Description(_) => Err(CommandError::Defect {
            what: "fetch_column gave another reply than numbers".to_owned(),
        }),
    }
}

/// One row of the table by its index, as raw bytes: `{ row, columns,
/// basedOn }`, a page of one row at position 0, whatever the filter shows,
/// with its name and the values of `columns` in that order. It changes
/// nothing.
///
/// # Errors
///
/// `MadeBeforeLoad`, `NoProject`, `RowOutOfRange`, `UnknownColumn`, or the
/// refusals of [`calls::call`].
#[tauri::command]
pub fn fetch_row(
    request: tauri::ipc::Request<'_>,
    session: SessionState<'_>,
) -> Result<Response, CommandError> {
    let mut session = lock(&session)?;
    match calls::call(&mut session, "fetch_row", request.body(), request.headers())? {
        calls::Reply::Bytes(bytes) => Ok(Response::new(bytes)),
        calls::Reply::Applied(_) | calls::Reply::Description(_) => Err(CommandError::Defect {
            what: "fetch_row gave another reply than a row".to_owned(),
        }),
    }
}

/// Opens a widget: `{ spec, basedOn }`, `spec` being what it shows, such
/// as `{ kind: "histogram", column }` ([`calls::open_widget`]). Once the
/// locks are released, a new window is made, since it subscribes as it
/// starts ([`windows::open_widget_window`]), or the open window the widget
/// went into, which was sent its new list, is brought to the front. It is
/// `async`, since a window made from a synchronous command deadlocks on
/// Windows (tauri.md).
///
/// # Errors
///
/// `MadeBeforeLoad`, `WindowFailed`, or a `Defect`.
#[tauri::command]
pub async fn open_widget<R: Runtime>(
    app: AppHandle<R>,
    request: tauri::ipc::Request<'_>,
    session: SessionState<'_>,
    widgets: WidgetsState<'_>,
) -> Result<(), CommandError> {
    let (opened, spec) = {
        // The session's lock first, as everywhere, so that a load cannot
        // fall between the check of the revision and the widget added.
        let session = lock(&session)?;
        calls::open_widget(&session, &mut *lock_widgets(&widgets)?, request.body())?
    };
    if let Some(reason) = opened.failed {
        report_dropped(
            &app,
            vec![Dropped {
                label: opened.window.clone(),
                reason,
            }],
        );
    }
    if opened.new_window {
        windows::open_widget_window(&widgets, &mut TauriWindows(&app), &opened.window, &spec)
    } else {
        TauriWindows(&app).raise(&opened.window)
    }
}

/// Forgets one of the calling window's widgets, whose tile was closed or
/// which the window cannot show: `{ widget }`, its number. The window is
/// sent the widgets it has left, or, when it was the last, is closed, its
/// subscriber forgotten first, so that it receives nothing more.
///
/// # Errors
///
/// `UnknownWidget` when the window holds no such widget, or a `Defect`.
#[tauri::command]
pub fn close_widget<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    request: tauri::ipc::Request<'_>,
    session: SessionState<'_>,
    widgets: WidgetsState<'_>,
) -> Result<(), CommandError> {
    let label = WindowLabel::new(window.label());
    let closed = {
        let mut session = lock(&session)?;
        let closed = calls::close_widget(&mut *lock_widgets(&widgets)?, &label, request.body())?;
        if closed == Closed::Window {
            session.unsubscribe(&label);
        }
        closed
    };
    match closed {
        Closed::Kept(None) => Ok(()),
        Closed::Kept(Some(reason)) => {
            report_dropped(&app, vec![Dropped { label, reason }]);
            Ok(())
        }
        Closed::Window => TauriWindows(&app).close(&label),
    }
}

/// The widgets of the calling window, as raw bytes
/// ([`crate::widgets::WidgetList::to_bytes`]), which it asks for as it
/// starts. Takes no arguments.
///
/// # Errors
///
/// `UnknownWindow` for a window that is no open window of widgets, or a
/// `Defect`.
#[tauri::command]
pub fn window_widgets<R: Runtime>(
    window: WebviewWindow<R>,
    request: tauri::ipc::Request<'_>,
    widgets: WidgetsState<'_>,
) -> Result<Response, CommandError> {
    calls::window_widgets(
        &mut *lock_widgets(&widgets)?,
        &WindowLabel::new(window.label()),
        request.body(),
    )
    .map(Response::new)
}

/// Sets the selection: the body is one bit per row, with the headers
/// `based-on` and `sent-at`.
///
/// # Errors
///
/// The refusals of [`calls::call`].
#[tauri::command]
pub fn set_selection<R: Runtime>(
    app: AppHandle<R>,
    request: tauri::ipc::Request<'_>,
    session: SessionState<'_>,
) -> Result<(), CommandError> {
    run(&app, &session, "set_selection", &request)
}

/// Sets the cells of some rows in one column to the value a text gives:
/// the body is one bit per row, with the headers `column`, `text` and
/// `decimal-mark`, percent-encoded, `based-on` and `sent-at`.
///
/// # Errors
///
/// The refusals of [`calls::call`].
#[tauri::command]
pub fn set_cells<R: Runtime>(
    app: AppHandle<R>,
    request: tauri::ipc::Request<'_>,
    session: SessionState<'_>,
) -> Result<(), CommandError> {
    run(&app, &session, "set_cells", &request)
}

/// Assigns the rows of a lasso to what is selected: the body is one bit
/// per row, with the headers `column`, `target` (a code, or `unassigned`),
/// `based-on` and `sent-at`.
///
/// # Errors
///
/// The refusals of [`calls::call`].
#[tauri::command]
pub fn assign_rows<R: Runtime>(
    app: AppHandle<R>,
    request: tauri::ipc::Request<'_>,
    session: SessionState<'_>,
) -> Result<(), CommandError> {
    run(&app, &session, "assign_rows", &request)
}

/// Leaves unassigned the rows of a lasso that are in a selected group:
/// the body is one bit per row, with the headers `column`, `selected`,
/// what is selected as codes and `unassigned` between commas, `based-on`
/// and `sent-at`.
///
/// # Errors
///
/// The refusals of [`calls::call`].
#[tauri::command]
pub fn unassign_rows<R: Runtime>(
    app: AppHandle<R>,
    request: tauri::ipc::Request<'_>,
    session: SessionState<'_>,
) -> Result<(), CommandError> {
    run(&app, &session, "unassign_rows", &request)
}

/// Sets the individual under the pointer, or none: `{ row, basedOn, sentAt }`.
///
/// # Errors
///
/// The refusals of [`calls::call`].
#[tauri::command]
pub fn set_hover<R: Runtime>(
    app: AppHandle<R>,
    request: tauri::ipc::Request<'_>,
    session: SessionState<'_>,
) -> Result<(), CommandError> {
    run(&app, &session, "set_hover", &request)
}

/// Sets the active classification, or none: `{ column, basedOn, sentAt }`.
///
/// # Errors
///
/// The refusals of [`calls::call`].
#[tauri::command]
pub fn set_active_classification<R: Runtime>(
    app: AppHandle<R>,
    request: tauri::ipc::Request<'_>,
    session: SessionState<'_>,
) -> Result<(), CommandError> {
    run(&app, &session, "set_active_classification", &request)
}

/// Selects groups of the active classification, and its unassigned
/// individuals or not: `{ column, selected, basedOn, sentAt }`,
/// `selected` being a list of `{ group: code }` and `"unassigned"`, empty
/// for nothing.
///
/// # Errors
///
/// The refusals of [`calls::call`].
#[tauri::command]
pub fn select_groups<R: Runtime>(
    app: AppHandle<R>,
    request: tauri::ipc::Request<'_>,
    session: SessionState<'_>,
) -> Result<(), CommandError> {
    run(&app, &session, "select_groups", &request)
}

/// Adds a group with no individuals to the active classification, and
/// selects it: `{ column, name, decimalMark, basedOn, sentAt }`, `name`
/// being the text typed and `decimalMark` the one the window writes
/// numbers with.
///
/// # Errors
///
/// The refusals of [`calls::call`].
#[tauri::command]
pub fn add_group<R: Runtime>(
    app: AppHandle<R>,
    request: tauri::ipc::Request<'_>,
    session: SessionState<'_>,
) -> Result<(), CommandError> {
    run(&app, &session, "add_group", &request)
}

/// Deletes a group of the active classification, leaving its
/// individuals unassigned: `{ column, group, basedOn, sentAt }`,
/// `group` being its code.
///
/// # Errors
///
/// The refusals of [`calls::call`].
#[tauri::command]
pub fn delete_group<R: Runtime>(
    app: AppHandle<R>,
    request: tauri::ipc::Request<'_>,
    session: SessionState<'_>,
) -> Result<(), CommandError> {
    run(&app, &session, "delete_group", &request)
}

/// Gives a group of the active classification another name or
/// colour: `{ column, group, name, colour, decimalMark, basedOn,
/// sentAt }`, `group` being its code, `name` the text typed, `colour`
/// one of the list as CSS writes it, `#rrggbb`, and `decimalMark` the one
/// the window writes numbers with.
///
/// # Errors
///
/// The refusals of [`calls::call`].
#[tauri::command]
pub fn edit_group<R: Runtime>(
    app: AppHandle<R>,
    request: tauri::ipc::Request<'_>,
    session: SessionState<'_>,
) -> Result<(), CommandError> {
    run(&app, &session, "edit_group", &request)
}

/// Presses + or − on what is selected for editing, or releases it: `{
/// column, target, mode, basedOn, sentAt }`, `target` being `{ group:
/// code }` or `"unassigned"`, and `mode` `"add"`, `"remove"` or `null`.
///
/// # Errors
///
/// The refusals of [`calls::call`].
#[tauri::command]
pub fn set_edit_mode<R: Runtime>(
    app: AppHandle<R>,
    request: tauri::ipc::Request<'_>,
    session: SessionState<'_>,
) -> Result<(), CommandError> {
    run(&app, &session, "set_edit_mode", &request)
}

/// Sets the role of a column: `{ column, role, basedOn, sentAt }`, `role`
/// being `"number"`, `"latitude"`, `"longitude"`, `"category"`,
/// `"country"` or `"text"`.
///
/// # Errors
///
/// The refusals of [`calls::call`].
#[tauri::command]
pub fn set_role<R: Runtime>(
    app: AppHandle<R>,
    request: tauri::ipc::Request<'_>,
    session: SessionState<'_>,
) -> Result<(), CommandError> {
    run(&app, &session, "set_role", &request)
}

/// Sets the filter of the find bar: `{ text, column, cell, showing,
/// decimalMark, basedOn, sentAt }`, with `column` an id or `null` for any
/// column, `cell` `part` or `whole`, `showing` `matching` or
/// `notMatching`, and `decimalMark` the one the window writes numbers
/// with.
///
/// # Errors
///
/// The refusals of [`calls::call`].
#[tauri::command]
pub fn set_filter<R: Runtime>(
    app: AppHandle<R>,
    request: tauri::ipc::Request<'_>,
    session: SessionState<'_>,
) -> Result<(), CommandError> {
    run(&app, &session, "set_filter", &request)
}

/// Undoes the last edit of the document: `{ basedOn, sentAt }`.
///
/// # Errors
///
/// The refusals of [`calls::call`].
#[tauri::command]
pub fn undo<R: Runtime>(
    app: AppHandle<R>,
    request: tauri::ipc::Request<'_>,
    session: SessionState<'_>,
) -> Result<(), CommandError> {
    run(&app, &session, "undo", &request)
}

/// Redoes the last edit undone: `{ basedOn, sentAt }`.
///
/// # Errors
///
/// The refusals of [`calls::call`].
#[tauri::command]
pub fn redo<R: Runtime>(
    app: AppHandle<R>,
    request: tauri::ipc::Request<'_>,
    session: SessionState<'_>,
) -> Result<(), CommandError> {
    run(&app, &session, "redo", &request)
}

/// Imports a table: asks the user for a file with the system's Open
/// dialog over the calling window, reads and imports it, and loads its
/// table, which replaces the one there was: `{ sentAt }`. The file is read
/// before the session's lock is taken.
///
/// # Errors
///
/// `ImportRefused`, `ImportUnreadable` and `FileNotRead`, with the file's
/// name; the refusals of a load; or a `Defect`.
#[tauri::command]
pub async fn import_table<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    request: tauri::ipc::Request<'_>,
    session: SessionState<'_>,
    widgets: WidgetsState<'_>,
) -> Result<ImportAnswer, CommandError> {
    let args: transfer::ImportArgs = calls::json_args("import_table", request.body())?;
    let Some(path) = dialogs::open(&window).await? else {
        return Ok(ImportAnswer::Cancelled);
    };
    read_and_load(&app, &session, &widgets, &path, args)
}

/// Imports the example table installed with the app, as `import_table`
/// does a file the user chose, File > Open Example Table: `{ sentAt }`.
/// It takes no path: the file is the app's own (`example.rs`).
///
/// # Errors
///
/// The refusals of `import_table`, and a `Defect` when the app's resources
/// cannot be found.
#[tauri::command]
pub async fn open_example<R: Runtime>(
    app: AppHandle<R>,
    request: tauri::ipc::Request<'_>,
    session: SessionState<'_>,
    widgets: WidgetsState<'_>,
) -> Result<ImportAnswer, CommandError> {
    let args: transfer::ImportArgs = calls::json_args("open_example", request.body())?;
    let path = example::path(&app)?;
    read_and_load(&app, &session, &widgets, &path, args)
}

/// Reads and imports the file at `path`, before the session's lock is
/// taken, and loads its table, which replaces the one there was; then
/// closes every window of widgets, which showed the table before, and sets
/// the menu for a table with no history.
fn read_and_load<R: Runtime>(
    app: &AppHandle<R>,
    session: &SessionState<'_>,
    widgets: &WidgetsState<'_>,
    path: &std::path::Path,
    args: transfer::ImportArgs,
) -> Result<ImportAnswer, CommandError> {
    let (file_name, imported) = transfer::read(path)?;
    let (answer, outcome, undo_redo, closed) = {
        let mut session = lock(session)?;
        let (answer, outcome) = transfer::load(&mut session, file_name, imported, args)?;
        // Under the session's lock, so that no widget of the table before
        // is added between the load and the closing, and their windows
        // receive nothing more.
        let closed = lock_widgets(widgets)?.close_all();
        for label in &closed {
            session.unsubscribe(label);
        }
        (answer, outcome, session.undo_redo(), closed)
    };
    report_dropped(app, outcome.dropped);
    windows::close_all(&mut TauriWindows(app), &closed);
    menu::enable_table_items(app);
    // A table loaded has no history.
    menu::show_undo_redo(app, undo_redo);
    Ok(answer)
}

/// Exports the table of the window's copy: `{ format, basedOn }`. It
/// writes the bytes of the file, refused before anything is asked when a
/// value would not read back as itself, then asks the user where to save
/// it with the system's Save dialog over the calling window, and writes it
/// there.
///
/// # Errors
///
/// `ExportRefused` and `FileNotWritten`, `MadeBeforeLoad` and `NoProject`,
/// or a `Defect`.
#[tauri::command]
pub async fn export_table<R: Runtime>(
    window: WebviewWindow<R>,
    request: tauri::ipc::Request<'_>,
    session: SessionState<'_>,
) -> Result<ExportAnswer, CommandError> {
    let args: transfer::ExportArgs = calls::json_args("export_table", request.body())?;
    let table = lock(&session)?.table_to_export(args.based_on())?;
    let bytes = export_bytes(&table, args.format())?;
    let Some(path) = dialogs::save(&window, args.format()).await? else {
        return Ok(ExportAnswer::Cancelled);
    };
    transfer::write(&path, &bytes)
}

/// Forgets a window that was closed: its subscriber, and its widgets when
/// it has any.
pub(crate) fn window_closed(session: &Mutex<Session>, widgets: &Mutex<Widgets>, label: &str) {
    let label = WindowLabel::new(label);
    match session.lock() {
        Ok(mut session) => session.unsubscribe(&label),
        Err(_) => eprintln!(
            "Vavilov Explorer defect: the session's lock is poisoned; window {label} was not forgotten"
        ),
    }
    match widgets.lock() {
        Ok(mut widgets) => widgets.window_closed(&label),
        Err(_) => eprintln!(
            "Vavilov Explorer defect: the widgets' lock is poisoned; window {label} was not forgotten"
        ),
    }
}

/// Calls `command` under the session's lock, then reports the windows
/// whose channel failed, once the lock is released.
fn run<R: Runtime>(
    app: &AppHandle<R>,
    session: &SessionState<'_>,
    command: &str,
    request: &tauri::ipc::Request<'_>,
) -> Result<(), CommandError> {
    let mut session = lock(session)?;
    let reply = calls::call(&mut session, command, request.body(), request.headers())?;
    let undo_redo = session.undo_redo();
    drop(session);
    match reply {
        calls::Reply::Applied(outcome) => {
            report_dropped(app, outcome.dropped);
            menu::show_undo_redo(app, undo_redo);
            Ok(())
        }
        calls::Reply::Description(_) | calls::Reply::Bytes(_) => Err(CommandError::Defect {
            what: format!("the command {command} gave a reply of a read, not an outcome"),
        }),
    }
}

/// Takes the widgets' lock; a poisoned lock is a defect.
pub(crate) fn lock_widgets(
    widgets: &Mutex<Widgets>,
) -> Result<MutexGuard<'_, Widgets>, CommandError> {
    widgets.lock().map_err(|_| CommandError::Defect {
        what: "the widgets' lock is poisoned".to_owned(),
    })
}

/// Takes the session's lock; a poisoned lock is a defect.
pub(crate) fn lock(session: &Mutex<Session>) -> Result<MutexGuard<'_, Session>, CommandError> {
    session.lock().map_err(|_| CommandError::Defect {
        what: "the session's lock is poisoned".to_owned(),
    })
}

/// A window whose channel failed receives nothing more until it
/// subscribes again: reported as a defect, and reloaded when it is still
/// open, so that it subscribes. Called once the lock is released.
pub(crate) fn report_dropped<R: Runtime>(app: &AppHandle<R>, dropped: Vec<Dropped>) {
    for Dropped { label, reason } in dropped {
        eprintln!(
            "Vavilov Explorer defect: the channel of window {label} failed and was dropped: {}",
            reason.reason
        );
        if let Some(window) = app.get_webview_window(label.as_str())
            && let Err(error) = window.reload()
        {
            eprintln!("Vavilov Explorer: window {label} could not be reloaded: {error}");
        }
    }
}

/// Closes a window once the call it made has returned: destroying a web
/// view from inside its own call may hang on Windows, as creating one from
/// a synchronous command does (tauri.md).
fn close_later<R: Runtime>(window: &WebviewWindow<R>) {
    let closing = window.clone();
    let queued = window.run_on_main_thread(move || {
        if let Err(error) = closing.destroy() {
            eprintln!(
                "Vavilov Explorer: window {} that the session does not know could not be closed: {error}",
                closing.label()
            );
        }
    });
    if let Err(error) = queued {
        eprintln!(
            "Vavilov Explorer: the closing of window {} could not be queued: {error}",
            window.label()
        );
    }
}

/// The core's subscriber over a Tauri channel: each message arrives in the
/// window as an `ArrayBuffer`.
struct ChannelSubscriber(Channel<InvokeResponseBody>);

impl Subscriber for ChannelSubscriber {
    fn send(&self, message: Vec<u8>) -> Result<(), SendFailed> {
        self.0
            .send(InvokeResponseBody::Raw(message))
            .map_err(|error| SendFailed {
                reason: error.to_string(),
            })
    }
}

#[cfg(test)]
mod tests;

/// The decimal mark of the system's region, `,` or `.` or another the user
/// set, which the export of a CSV starts from (`docs/design.md`,
/// section 7). It needs no table.
///
/// # Errors
///
/// A `Defect` when the system cannot give it.
#[tauri::command]
pub fn region_decimal_mark() -> Result<String, CommandError> {
    region::decimal_mark()
}
