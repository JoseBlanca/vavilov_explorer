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
//!   describes, as the import will;
//! - `{"window", "message": [...]}` is a message of the window's channel.

mod load;
mod wire;

use std::io::{BufRead, Write};
use std::process::ExitCode;

use vavilov_core::{SendFailed, Session, Subscriber, WindowLabel};

fn main() -> ExitCode {
    let mut session = Session::new();
    for line in std::io::stdin().lock().lines() {
        let line = match line {
            Ok(line) => line,
            Err(error) => {
                eprintln!("vavilov-e2e-backend: reading the harness: {error}");
                return ExitCode::FAILURE;
            }
        };
        let answer = wire::answer(&mut session, &line, |label| Box::new(Stdout { label }));
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

fn write_line(value: &serde_json::Value) -> std::io::Result<()> {
    let mut stdout = std::io::stdout().lock();
    writeln!(stdout, "{value}")?;
    stdout.flush()
}
