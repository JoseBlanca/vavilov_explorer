//! The test-only program behind the e2e harness (`e2e/harness.mjs`): it
//! runs the real core, and reads every call of a page with the app's own
//! `calls::call`, so that only Tauri's IPC is replaced (`docs/design.md`,
//! section 11). It is never part of the app.
//!
//! It reads one JSON object a line on its standard input and writes one a
//! line on its standard output:
//!
//! - `{"id", "window", "command": "subscribe"}` registers the window and
//!   answers `{"id", "bytes": [...]}` with the snapshot;
//! - `{"id", "window", "command", "json": {...}}`, or `"raw": [...]` with
//!   `"headers": {...}`, is a call of a page, answered `{"id", "ok": null}`
//!   for a command applied, `{"id", "ok": value}` with the description of
//!   the table, `{"id", "bytes": [...]}` with a page of rows, or `{"id",
//!   "error": {...}}` with the refusal as a window receives it;
//! - `{"id", "command": "e2e:load", "table": {...}}` loads a table the test
//!   describes;
//! - `{"id", "command": "e2e:pick", "path": "..."}` gives the file the next
//!   dialog of `import_table` or `export_table` gives, or with `"cancel":
//!   true` in the place of the path, a dialog the user closed;
//! - `{"id", "command": "e2e:picking"}` answers whether a pick waits for
//!   its dialog, so that a test knows the window took it;
//! - `{"id", "command": "e2e:action", "action": "importTable"}` hands an
//!   item of the menu to the main window, as a click in the app's menu;
//! - `{"id", "command": "e2e:region", "decimalMark": ","}` sets the decimal
//!   mark of the system's region, which `region_decimal_mark` gives;
//! - `{"id", "window", "command": "e2e:closed"}` tells the session that the
//!   page of the window was closed, as Tauri tells the app that a window
//!   was destroyed;
//! - `{"window", "message": [...]}` is a message of the window's channel;
//! - `{"open": label, "widget": {...}}` asks the harness for the page of a
//!   window of widgets, with its first widget, `{"raise": label}` to bring
//!   an open one to the front, and `{"close": label}` to close one; each
//!   comes before the answer of the call that opened, raised or closed it.

mod load;
mod wire;

use std::io::{BufRead, Write};
use std::process::ExitCode;

use vavilov_core::{SendFailed, Session, Subscriber, WindowLabel};
use vavilov_explorer_lib::error::{AppError, WindowError};
use vavilov_explorer_lib::widgets::{WidgetSpec, Widgets, WindowHost};

fn main() -> ExitCode {
    let mut session = Session::new();
    let mut widgets = Widgets::default();
    let mut stand_ins = wire::StandIns::default();
    let mut host = Pages;
    for line in std::io::stdin().lock().lines() {
        let line = match line {
            Ok(line) => line,
            Err(error) => {
                eprintln!("vavilov-e2e-backend: reading the harness: {error}");
                return ExitCode::FAILURE;
            }
        };
        let answer = wire::answer(
            &mut session,
            &mut widgets,
            &mut stand_ins,
            &line,
            |label| Box::new(Stdout { label }),
            &mut host,
        );
        if let Err(error) = write_line(&answer) {
            eprintln!("vavilov-e2e-backend: writing to the harness: {error}");
            return ExitCode::FAILURE;
        }
    }
    ExitCode::SUCCESS
}

/// A window's channel: its messages go to the harness, which delivers them
/// to the window's page.
struct Stdout {
    label: WindowLabel,
}

impl Subscriber for Stdout {
    fn send(&self, message: Vec<u8>) -> Result<(), SendFailed> {
        let line = serde_json::json!({ "window": self.label.as_str(), "message": message });
        write_line(&line).map_err(|error| SendFailed {
            reason: error.to_string(),
        })
    }
}

/// The windows of the widgets, as pages the harness opens, brings to the
/// front and closes.
struct Pages;

impl WindowHost for Pages {
    fn open(&mut self, label: &WindowLabel, widget: &WidgetSpec) -> Result<(), AppError> {
        let line = serde_json::json!({ "open": label.as_str(), "widget": widget });
        write_line(&line).map_err(|error| failed(label, &error))
    }

    fn raise(&mut self, label: &WindowLabel) -> Result<(), AppError> {
        let line = serde_json::json!({ "raise": label.as_str() });
        write_line(&line).map_err(|error| failed(label, &error))
    }

    fn close(&mut self, label: &WindowLabel) -> Result<(), AppError> {
        let line = serde_json::json!({ "close": label.as_str() });
        write_line(&line).map_err(|error| failed(label, &error))
    }
}

fn failed(label: &WindowLabel, error: &std::io::Error) -> AppError {
    WindowError::WindowFailed {
        label: label.clone(),
        message: error.to_string(),
    }
    .into()
}

fn write_line(value: &serde_json::Value) -> std::io::Result<()> {
    let mut stdout = std::io::stdout().lock();
    writeln!(stdout, "{value}")?;
    stdout.flush()
}
