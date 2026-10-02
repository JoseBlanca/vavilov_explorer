//! The Tauri commands: each takes the session's lock, turns its arguments
//! into a request of the core, and calls the dispatcher, which sends the
//! change to every window before it returns (`docs/core.md`, section 4).
//! No rule about the data is here.

use std::str::FromStr;
use std::sync::{Mutex, MutexGuard};

use tauri::ipc::{Channel, InvokeBody, InvokeResponseBody, Response};
use tauri::{AppHandle, Manager, Runtime, State, WebviewWindow};
use vavilov_core::{
    ColumnId, Command, CommandError, Dropped, LevelCode, Request, Revision, RowIndex, SendFailed,
    SentAt, Session, Subscriber, WindowLabel,
};

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

/// Sets the selection: the body is one bit per row, and the headers
/// `based-on` and, when given, `sent-at`.
///
/// # Errors
///
/// The refusals of the dispatcher and of the bits.
#[tauri::command]
pub fn set_selection<R: Runtime>(
    app: AppHandle<R>,
    request: tauri::ipc::Request<'_>,
    session: SessionState<'_>,
) -> Result<(), CommandError> {
    let based_on = Revision::new(header(&request, "based-on")?);
    let sent_at = sent_at_header(&request)?;
    let mut session = lock(&session)?;
    let rows = session.rows_from_window(raw_body(&request)?, based_on)?;
    let dropped = session
        .dispatch(Request {
            command: Command::SetSelection { rows },
            based_on,
            sent_at,
        })?
        .dropped;
    drop(session);
    report_dropped(&app, dropped);
    Ok(())
}

/// Assigns the rows of a lasso to the selected population: the body is
/// one bit per row, and the headers `column`, `population`, `based-on`
/// and, when given, `sent-at`.
///
/// # Errors
///
/// The refusals of the dispatcher and of the bits.
#[tauri::command]
pub fn assign_rows<R: Runtime>(
    app: AppHandle<R>,
    request: tauri::ipc::Request<'_>,
    session: SessionState<'_>,
) -> Result<(), CommandError> {
    lasso(&app, &request, &session, Lasso::Add)
}

/// Leaves unassigned the rows of a lasso that are in the selected
/// population, with the body and the headers of [`assign_rows`].
///
/// # Errors
///
/// The refusals of the dispatcher and of the bits.
#[tauri::command]
pub fn unassign_rows<R: Runtime>(
    app: AppHandle<R>,
    request: tauri::ipc::Request<'_>,
    session: SessionState<'_>,
) -> Result<(), CommandError> {
    lasso(&app, &request, &session, Lasso::Remove)
}

/// Sets the individual under the pointer, or none.
///
/// # Errors
///
/// The refusals of the dispatcher.
#[tauri::command]
pub fn set_hover<R: Runtime>(
    app: AppHandle<R>,
    row: Option<u32>,
    based_on: u64,
    sent_at: Option<f64>,
    session: SessionState<'_>,
) -> Result<(), CommandError> {
    let command = Command::SetHover {
        row: row.map(RowIndex::new),
    };
    dispatch(&app, &session, command, based_on, sent_at)
}

/// Sets the active classification, or none.
///
/// # Errors
///
/// The refusals of the dispatcher.
#[tauri::command]
pub fn set_active_classification<R: Runtime>(
    app: AppHandle<R>,
    column: Option<u32>,
    based_on: u64,
    sent_at: Option<f64>,
    session: SessionState<'_>,
) -> Result<(), CommandError> {
    let command = Command::SetActiveClassification {
        column: column.map(ColumnId::new),
    };
    dispatch(&app, &session, command, based_on, sent_at)
}

/// Selects a population of the active classification for editing, or none.
///
/// # Errors
///
/// The refusals of the dispatcher.
#[tauri::command]
pub fn select_population<R: Runtime>(
    app: AppHandle<R>,
    column: u32,
    population: Option<u16>,
    based_on: u64,
    sent_at: Option<f64>,
    session: SessionState<'_>,
) -> Result<(), CommandError> {
    let command = Command::SelectPopulation {
        column: ColumnId::new(column),
        population: population.map(LevelCode::new),
    };
    dispatch(&app, &session, command, based_on, sent_at)
}

/// Undoes the last edit of the document.
///
/// # Errors
///
/// The refusals of the dispatcher.
#[tauri::command]
pub fn undo<R: Runtime>(
    app: AppHandle<R>,
    based_on: u64,
    sent_at: Option<f64>,
    session: SessionState<'_>,
) -> Result<(), CommandError> {
    dispatch(&app, &session, Command::Undo, based_on, sent_at)
}

/// Redoes the last edit undone.
///
/// # Errors
///
/// The refusals of the dispatcher.
#[tauri::command]
pub fn redo<R: Runtime>(
    app: AppHandle<R>,
    based_on: u64,
    sent_at: Option<f64>,
    session: SessionState<'_>,
) -> Result<(), CommandError> {
    dispatch(&app, &session, Command::Redo, based_on, sent_at)
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

/// The mode of a lasso.
#[derive(Clone, Copy)]
enum Lasso {
    Add,
    Remove,
}

fn lasso<R: Runtime>(
    app: &AppHandle<R>,
    request: &tauri::ipc::Request<'_>,
    session: &SessionState<'_>,
    mode: Lasso,
) -> Result<(), CommandError> {
    let column = ColumnId::new(header(request, "column")?);
    let population = LevelCode::new(header(request, "population")?);
    let based_on = Revision::new(header(request, "based-on")?);
    let sent_at = sent_at_header(request)?;
    let mut session = lock(session)?;
    let rows = session.rows_from_window(raw_body(request)?, based_on)?;
    let command = match mode {
        Lasso::Add => Command::AssignRows {
            column,
            population,
            rows,
        },
        Lasso::Remove => Command::UnassignRows {
            column,
            population,
            rows,
        },
    };
    let dropped = session
        .dispatch(Request {
            command,
            based_on,
            sent_at,
        })?
        .dropped;
    drop(session);
    report_dropped(app, dropped);
    Ok(())
}

fn dispatch<R: Runtime>(
    app: &AppHandle<R>,
    session: &SessionState<'_>,
    command: Command,
    based_on: u64,
    sent_at: Option<f64>,
) -> Result<(), CommandError> {
    let sent_at = sent_at.map(SentAt::new).transpose()?;
    let request = Request {
        command,
        based_on: Revision::new(based_on),
        sent_at,
    };
    let dropped = lock(session)?.dispatch(request)?.dropped;
    report_dropped(app, dropped);
    Ok(())
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

/// The bytes of a raw body.
fn raw_body<'a>(request: &'a tauri::ipc::Request<'_>) -> Result<&'a [u8], CommandError> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes),
        InvokeBody::Json(_) => Err(CommandError::Defect {
            what: "a command that takes raw bytes was given JSON, as Tauri sends every \
                   body once a window has fallen back from its custom IPC protocol to postMessage"
                .to_owned(),
        }),
    }
}

/// The value of a header the command needs.
fn header<T: FromStr>(request: &tauri::ipc::Request<'_>, name: &str) -> Result<T, CommandError> {
    optional_header(request, name)?.ok_or_else(|| CommandError::Defect {
        what: format!("a command without its header {name}"),
    })
}

fn optional_header<T: FromStr>(
    request: &tauri::ipc::Request<'_>,
    name: &str,
) -> Result<Option<T>, CommandError> {
    let Some(value) = request.headers().get(name) else {
        return Ok(None);
    };
    value
        .to_str()
        .ok()
        .and_then(|text| text.parse().ok())
        .map(Some)
        .ok_or_else(|| CommandError::Defect {
            what: format!("a header {name} that does not parse"),
        })
}

fn sent_at_header(request: &tauri::ipc::Request<'_>) -> Result<Option<SentAt>, CommandError> {
    optional_header::<f64>(request, "sent-at")?
        .map(SentAt::new)
        .transpose()
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
