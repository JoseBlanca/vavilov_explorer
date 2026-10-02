//! The Tauri commands: each takes the session's lock and hands its call to
//! [`calls::call`], which reads its arguments and calls the dispatcher;
//! the dispatcher sends the change to every window before it returns
//! (`docs/core.md`, section 4). No rule about the data is here.

use std::sync::{Mutex, MutexGuard};

use tauri::ipc::{Channel, InvokeResponseBody, Response};
use tauri::{AppHandle, Manager, Runtime, State, WebviewWindow};
use vavilov_core::{
    CommandError, Dropped, SendFailed, Session, Subscriber, TableDescription, WindowLabel,
};

use crate::calls;

/// The session, as every command takes it.
pub type SessionState<'a> = State<'a, Mutex<Session>>;

/// Registers the window's channel and returns the snapshot of the shared
/// state, as raw bytes; the channel then carries every change after it.
/// A window the session does not know is closed.
///
/// # Errors
///
/// `UnknownWindow`, or a `Defect`.
#[tauri::command]
pub fn subscribe<R: Runtime>(
    window: WebviewWindow<R>,
    on_change: Channel<InvokeResponseBody>,
    session: SessionState<'_>,
) -> Result<Response, CommandError> {
    let label = WindowLabel::new(window.label());
    let subscribed = lock(&session)?.subscribe(label, Box::new(ChannelSubscriber(on_change)));
    match subscribed {
        Ok(snapshot) => Ok(Response::new(snapshot)),
        Err(error) => {
            if let CommandError::UnknownWindow { .. } = error {
                close_later(&window);
            }
            Err(error)
        }
    }
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
        calls::Reply::Applied(_) | calls::Reply::Rows(_) => Err(CommandError::Defect {
            what: "describe_table gave another reply than a description".to_owned(),
        }),
    }
}

/// A page of rows of the table, as raw bytes: `{ first, count, columns,
/// basedOn }`, with the ids of the columns wanted in their order. It
/// changes nothing.
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
        calls::Reply::Rows(bytes) => Ok(Response::new(bytes)),
        calls::Reply::Applied(_) | calls::Reply::Description(_) => Err(CommandError::Defect {
            what: "fetch_rows gave another reply than rows".to_owned(),
        }),
    }
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

/// Leaves unassigned the rows of a lasso that are in the selected
/// population: the body is one bit per row, with the headers `column`,
/// `population`, `based-on` and `sent-at`.
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

/// Selects a population of the active classification, or its unassigned
/// individuals, for editing, or nothing: `{ column, selected, basedOn,
/// sentAt }`, `selected` being `{ population: code }`, `"unassigned"` or
/// `null`.
///
/// # Errors
///
/// The refusals of [`calls::call`].
#[tauri::command]
pub fn select_population<R: Runtime>(
    app: AppHandle<R>,
    request: tauri::ipc::Request<'_>,
    session: SessionState<'_>,
) -> Result<(), CommandError> {
    run(&app, &session, "select_population", &request)
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

/// Forgets the subscriber of a window that was closed.
pub(crate) fn unsubscribe(session: &Mutex<Session>, label: &str) {
    match session.lock() {
        Ok(mut session) => session.unsubscribe(&WindowLabel::new(label)),
        Err(_) => eprintln!(
            "Vavilov Explorer defect: the session's lock is poisoned; window {label} was not unsubscribed"
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
    drop(session);
    match reply {
        calls::Reply::Applied(outcome) => {
            report_dropped(app, outcome.dropped);
            Ok(())
        }
        calls::Reply::Description(_) | calls::Reply::Rows(_) => Err(CommandError::Defect {
            what: format!("the command {command} gave a reply of a read, not an outcome"),
        }),
    }
}

fn lock<'a>(session: &'a SessionState<'_>) -> Result<MutexGuard<'a, Session>, CommandError> {
    session.lock().map_err(|_| CommandError::Defect {
        what: "the session's lock is poisoned".to_owned(),
    })
}

/// A window whose channel failed receives nothing more until it
/// subscribes again: reported as a defect, and reloaded when it is still
/// open, so that it subscribes. Called once the lock is released.
fn report_dropped<R: Runtime>(app: &AppHandle<R>, dropped: Vec<Dropped>) {
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
