//! The example table installed with the app, which File > Open Example
//! Table imports, so that a new user can try every window before preparing
//! a file of their own (`docs/design.md`, section 2.1). It is the demo
//! table of `demo.rs`, written by the core's export.

use std::path::PathBuf;

use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager, Runtime};
use vavilov_core::CommandError;

/// The example table's file among the app's resources, as `tauri.conf.json`
/// bundles it, and as it is in the repository, beside this crate.
pub const FILE: &str = "resources/example-plants.csv";

/// The path of the example table installed with the app.
///
/// # Errors
///
/// A `Defect` when the app's resources cannot be found, which an app
/// installed whole never meets.
pub fn path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, CommandError> {
    app.path()
        .resolve(FILE, BaseDirectory::Resource)
        .map_err(|error| CommandError::Defect {
            what: format!("the example table installed with the app could not be found: {error}"),
        })
}

#[cfg(test)]
mod tests;
