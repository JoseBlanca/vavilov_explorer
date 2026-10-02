//! A line of the harness, read and answered.

use serde::Deserialize;
use serde_json::{Value, json};
use tauri::http::{HeaderMap, HeaderName, HeaderValue};
use tauri::ipc::InvokeBody;
use vavilov_core::{CommandError, Session, Subscriber, WindowLabel};
use vavilov_explorer_lib::calls;

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
}

/// The answer to one line of the harness. A line that is not one the
/// harness writes is answered with an `e2e` error, which fails the test.
pub(crate) fn answer(
    session: &mut Session,
    line: &str,
    subscriber: impl FnOnce(WindowLabel) -> Box<dyn Subscriber>,
) -> Value {
    let line: Line = match serde_json::from_str(line) {
        Ok(line) => line,
        Err(error) => {
            return json!({ "e2e": format!("a line the harness should not write: {error}") });
        }
    };
    let id = line.id;
    match outcome(session, line, subscriber) {
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
    Refused(CommandError),
    /// A line the harness should not have written.
    Harness(String),
}

impl From<CommandError> for Failure {
    fn from(error: CommandError) -> Self {
        Self::Refused(error)
    }
}

fn outcome(
    session: &mut Session,
    line: Line,
    subscriber: impl FnOnce(WindowLabel) -> Box<dyn Subscriber>,
) -> Result<Answer, Failure> {
    match line.command.as_str() {
        "e2e:load" => {
            let table = line
                .table
                .ok_or_else(|| Failure::Harness("e2e:load without a table".to_owned()))?;
            load::load(session, table)?;
            Ok(Answer::Done)
        }
        "subscribe" => {
            let label = WindowLabel::new(window(line.window)?);
            let snapshot = session.subscribe(label.clone(), subscriber(label))?;
            Ok(Answer::Bytes(snapshot))
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
                calls::Reply::Applied(_) => Ok(Answer::Done),
                calls::Reply::Rows(bytes) => Ok(Answer::Bytes(bytes)),
                calls::Reply::Description(description) => serde_json::to_value(description)
                    .map(Answer::Value)
                    .map_err(|error| Failure::Harness(error.to_string())),
            }
        }
    }
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
