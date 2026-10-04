//! A line of the harness, read and answered.

use serde::Deserialize;
use serde_json::{Value, json};
use tauri::http::{HeaderMap, HeaderName, HeaderValue};
use tauri::ipc::InvokeBody;
use vavilov_core::{CommandError, Session, Subscriber, WindowLabel, export_table};
use vavilov_explorer_lib::actions::send_action;
use vavilov_explorer_lib::calls::ClosedWidget;
use vavilov_explorer_lib::error::AppError;
use vavilov_explorer_lib::widgets::{Widgets, WindowHost};
use vavilov_explorer_lib::{calls, menu, transfer, windows};

use crate::load;

/// A line from the harness.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Line {
    id: u64,
    command: String,
    window: Option<String>,
    json: Option<Value>,
    raw: Option<Vec<u8>>,
    headers: Option<serde_json::Map<String, Value>>,
    table: Option<load::TableSpec>,
    /// For `e2e:pick`: the file the next dialog gives.
    path: Option<String>,
    /// For `e2e:pick`: `true` for a dialog the user closed, in the place of
    /// a path.
    cancel: Option<bool>,
    /// For `e2e:action`: the item of the menu the user chose, as the window
    /// names it, `importTable`, `exportCsv` or `exportXlsx`.
    action: Option<String>,
    /// For `e2e:region`: the decimal mark of the system's region.
    #[serde(rename = "decimalMark")]
    decimal_mark: Option<String>,
}

/// The file the next dialog of an import or an export gives, as the test
/// set it with `e2e:pick`, the user's choice in the app; `None` until set,
/// `Some(None)` for a dialog the user closed.
pub(crate) type Picked = Option<Option<std::path::PathBuf>>;

/// What the test stands in for, in the place of the user and the system.
#[derive(Default)]
pub(crate) struct StandIns {
    /// The file the next dialog gives.
    picked: Picked,
    /// The decimal mark of the system's region, as the test set it with
    /// `e2e:region`, so that a test does not depend on the region of the
    /// machine it runs on; `None` until set.
    decimal_mark: Option<String>,
}

/// The answer to one line of the harness. A line that is not one the
/// harness writes is answered with an `e2e` error, which fails the test.
pub(crate) fn answer(
    session: &mut Session,
    widgets: &mut Widgets,
    stand_ins: &mut StandIns,
    line: &str,
    subscriber: impl Fn(WindowLabel) -> Box<dyn Subscriber>,
    host: &mut impl WindowHost,
) -> Value {
    let line: Line = match serde_json::from_str(line) {
        Ok(line) => line,
        Err(error) => {
            return json!({ "e2e": format!("a line the harness should not write: {error}") });
        }
    };
    let id = line.id;
    match outcome(session, widgets, stand_ins, line, subscriber, host) {
        Ok(Answer::Bytes(bytes)) => json!({ "id": id, "bytes": bytes }),
        Ok(Answer::Done) => json!({ "id": id, "ok": null }),
        Ok(Answer::Value(value)) => json!({ "id": id, "ok": value }),
        Err(Failure::Refused(error)) => match serde_json::to_value(&error) {
            Ok(error) => json!({ "id": id, "error": error }),
            Err(serialised) => json!({ "id": id, "e2e": serialised.to_string() }),
        },
        Err(Failure::Harness(what)) => json!({ "id": id, "e2e": what }),
    }
}

enum Answer {
    Bytes(Vec<u8>),
    Value(Value),
    Done,
}

enum Failure {
    /// A refusal of the app, as a window receives it.
    Refused(AppError),
    /// A line the harness should not have written.
    Harness(String),
}

impl From<CommandError> for Failure {
    fn from(error: CommandError) -> Self {
        Self::Refused(error.into())
    }
}

impl From<AppError> for Failure {
    fn from(error: AppError) -> Self {
        Self::Refused(error)
    }
}

fn outcome(
    session: &mut Session,
    widgets: &mut Widgets,
    stand_ins: &mut StandIns,
    line: Line,
    subscriber: impl Fn(WindowLabel) -> Box<dyn Subscriber>,
    host: &mut impl WindowHost,
) -> Result<Answer, Failure> {
    match line.command.as_str() {
        "e2e:load" => {
            let table = line
                .table
                .ok_or_else(|| Failure::Harness("e2e:load without a table".to_owned()))?;
            let outcome = load::load(session, table)?;
            channels_sent("e2e:load", &outcome)?;
            close_every_widget_window(session, widgets, host);
            Ok(Answer::Done)
        }
        "e2e:action" => {
            let action = line
                .action
                .as_deref()
                .and_then(menu::action_named)
                .ok_or_else(|| Failure::Harness(format!("e2e:action of {:?}", line.action)))?;
            match send_action(session, action)? {
                None => Ok(Answer::Done),
                Some(dropped) => Err(Failure::Harness(format!(
                    "the action {action:?} failed on its channel: {dropped:?}"
                ))),
            }
        }
        "e2e:picking" => Ok(Answer::Value(Value::Bool(stand_ins.picked.is_some()))),
        "e2e:region" => {
            stand_ins.decimal_mark =
                Some(line.decimal_mark.ok_or_else(|| {
                    Failure::Harness("e2e:region without a decimal mark".to_owned())
                })?);
            Ok(Answer::Done)
        }
        "region_decimal_mark" => match &stand_ins.decimal_mark {
            Some(mark) => Ok(Answer::Value(Value::String(mark.clone()))),
            None => Err(Failure::Harness(
                "region_decimal_mark before the test set the region with e2e:region".to_owned(),
            )),
        },
        "e2e:pick" => {
            stand_ins.picked = Some(match (line.path, line.cancel) {
                (Some(path), None) => Some(std::path::PathBuf::from(path)),
                (None, Some(true)) => None,
                _ => {
                    return Err(Failure::Harness(
                        "e2e:pick without exactly one of a path and cancel: true".to_owned(),
                    ));
                }
            });
            Ok(Answer::Done)
        }
        // The app's steps of an import and an export, with the file the
        // test picked in the place of the system's dialog.
        "import_table" => {
            window(line.window)?;
            let args: transfer::ImportArgs =
                calls::json_args("import_table", &json_body(line.json)?)?;
            let Some(path) = take(&mut stand_ins.picked)? else {
                return value(&transfer::ImportAnswer::Cancelled);
            };
            let (file_name, imported) = transfer::read(&path)?;
            let (answer, outcome) = transfer::load(session, file_name, imported, args)?;
            channels_sent("import_table", &outcome)?;
            close_every_widget_window(session, widgets, host);
            value(&answer)
        }
        // The example table, from the repository, where the app reads it from
        // its resources.
        "open_example" => {
            window(line.window)?;
            let args: transfer::ImportArgs =
                calls::json_args("open_example", &json_body(line.json)?)?;
            let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../src-tauri")
                .join(vavilov_explorer_lib::example::FILE);
            let (file_name, imported) = transfer::read(&path)?;
            let (answer, outcome) = transfer::load(session, file_name, imported, args)?;
            channels_sent("open_example", &outcome)?;
            close_every_widget_window(session, widgets, host);
            value(&answer)
        }
        "export_table" => {
            window(line.window)?;
            let args: transfer::ExportArgs =
                calls::json_args("export_table", &json_body(line.json)?)?;
            let table = session.table_to_export(args.based_on())?;
            let bytes = export_table(&table, args.format())?;
            let Some(path) = take(&mut stand_ins.picked)? else {
                return value(&transfer::ExportAnswer::Cancelled);
            };
            value(&transfer::write(&path, &bytes)?)
        }
        // As the app's subscribe: a window of widgets the app does not
        // know is refused.
        "subscribe" => {
            let label = WindowLabel::new(window(line.window)?);
            let snapshot = calls::subscribe(session, widgets, label.clone(), subscriber(label))?;
            Ok(Answer::Bytes(snapshot))
        }
        "open_widget" => {
            window(line.window)?;
            let opened = calls::open_widget(session, widgets, &json_body(line.json)?)?;
            if let Some(dropped) = opened.dropped {
                return Err(Failure::Harness(format!(
                    "open_widget was applied, and a channel failed: {dropped:?}"
                )));
            }
            if !opened.new_window {
                host.raise(&opened.window)?;
            } else if let Err(error) = host.open(&opened.window, &opened.spec) {
                widgets.window_closed(&opened.window);
                return Err(Failure::Refused(error));
            }
            Ok(Answer::Done)
        }
        "close_widget" => {
            let label = WindowLabel::new(window(line.window)?);
            match calls::close_widget(session, widgets, &label, &json_body(line.json)?)? {
                ClosedWidget::Kept(None) => {}
                ClosedWidget::Kept(Some(dropped)) => {
                    return Err(Failure::Harness(format!(
                        "close_widget was applied, and a channel failed: {dropped:?}"
                    )));
                }
                ClosedWidget::Window => windows::close_all(host, &[label]),
            }
            Ok(Answer::Done)
        }
        "window_widgets" => {
            let label = WindowLabel::new(window(line.window)?);
            let bytes = calls::window_widgets(widgets, &label, &json_body(line.json)?)?;
            Ok(Answer::Bytes(bytes))
        }
        // The harness closed the page of a window, as the user closes a
        // window, or as a window the app closed goes.
        "e2e:closed" => {
            let label = WindowLabel::new(window(line.window)?);
            session.unsubscribe(&label);
            widgets.window_closed(&label);
            Ok(Answer::Done)
        }
        command => {
            window(line.window)?;
            let body = match (line.json, line.raw) {
                (Some(json), None) => InvokeBody::Json(json),
                (None, Some(raw)) => InvokeBody::Raw(raw),
                _ => {
                    return Err(Failure::Harness(format!(
                        "{command} without exactly one of json and raw"
                    )));
                }
            };
            let headers = headers(line.headers.unwrap_or_default())?;
            match calls::call(session, command, &body, &headers)? {
                calls::Reply::Applied(outcome) => {
                    channels_sent(command, &outcome)?;
                    Ok(Answer::Done)
                }
                calls::Reply::Bytes(bytes) => Ok(Answer::Bytes(bytes)),
                calls::Reply::Description(description) => serde_json::to_value(description)
                    .map(Answer::Value)
                    .map_err(|error| Failure::Harness(error.to_string())),
            }
        }
    }
}

/// Closes every window of widgets after a load, as the app does: each
/// forgotten, with its subscriber, before its page is asked to close.
fn close_every_widget_window(
    session: &mut Session,
    widgets: &mut Widgets,
    host: &mut impl WindowHost,
) {
    windows::close_all(host, &calls::forget_every_widget_window(session, widgets));
}

/// The program's channels write to its output, so a failed send is a fault
/// of the test run, said rather than lost.
fn channels_sent(command: &str, outcome: &vavilov_core::Outcome) -> Result<(), Failure> {
    if outcome.dropped.is_empty() {
        Ok(())
    } else {
        Err(Failure::Harness(format!(
            "{command} was applied, and these channels failed: {:?}",
            outcome.dropped
        )))
    }
}

/// The file the test picked, taken, so that each dialog needs its own pick.
fn take(picked: &mut Picked) -> Result<Option<std::path::PathBuf>, Failure> {
    picked
        .take()
        .ok_or_else(|| Failure::Harness("a dialog with no e2e:pick before it".to_owned()))
}

fn json_body(json: Option<Value>) -> Result<InvokeBody, Failure> {
    json.map(InvokeBody::Json)
        .ok_or_else(|| Failure::Harness("a call without its JSON arguments".to_owned()))
}

fn value(answer: &impl serde::Serialize) -> Result<Answer, Failure> {
    serde_json::to_value(answer)
        .map(Answer::Value)
        .map_err(|error| Failure::Harness(error.to_string()))
}

fn window(window: Option<String>) -> Result<String, Failure> {
    window.ok_or_else(|| Failure::Harness("a call without its window".to_owned()))
}

fn headers(given: serde_json::Map<String, Value>) -> Result<HeaderMap, Failure> {
    let mut headers = HeaderMap::new();
    for (name, value) in given {
        let Value::String(value) = value else {
            return Err(Failure::Harness(format!(
                "a header {name} that is not text"
            )));
        };
        let name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|error| Failure::Harness(error.to_string()))?;
        let value =
            HeaderValue::from_str(&value).map_err(|error| Failure::Harness(error.to_string()))?;
        headers.insert(name, value);
    }
    Ok(headers)
}
