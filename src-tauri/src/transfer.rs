//! The import and the export as a window asks for them: the arguments it
//! sends, what it gets back, and the steps between, with the file the user
//! chose given by the caller. The app's commands choose it with the
//! system's dialogs; the test program behind the e2e harness with the
//! path a test gave, so that the harness runs these same steps
//! (`docs/design.md`, section 2.1).

use std::path::Path;

use serde::{Deserialize, Serialize};
use vavilov_core::{
    Command, CommandError, ExportFormat, Imported, Outcome, Revision, Session, file_name,
    import_table, read_for_import, write_export,
};

use crate::calls;

/// What an import gave: nothing when the user closed the dialog, or the
/// table loaded, with what the window tells the user of how it was read.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ImportAnswer {
    /// The user chose no file.
    Cancelled,
    /// The table of the file was loaded.
    Imported {
        /// The name of the file, without its folder.
        file_name: String,
        /// The line of the first character that could not be decoded, or
        /// `None`.
        undecoded_line: Option<u32>,
    },
}

/// What an export gave: nothing when the user closed the dialog, or the
/// file written.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ExportAnswer {
    /// The user chose no file, and none was written.
    Cancelled,
    /// The file was written.
    Exported {
        /// The name of the file, without its folder.
        file_name: String,
    },
}

/// The arguments of `import_table`: the time every JSON call carries. It
/// takes no revision: a load does not depend on the table it replaces, and
/// is applied at the session's current revision, so that one loaded while
/// the user chose the file does not refuse it.
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportArgs {
    sent_at: Option<f64>,
}

/// The arguments of `export_table`: the format, and the revision of the
/// window's copy, whose table is exported.
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportArgs {
    format: ExportFormat,
    based_on: u64,
}

impl ExportArgs {
    /// The format asked for.
    #[must_use]
    pub const fn format(&self) -> ExportFormat {
        self.format
    }

    /// The revision of the window's copy, whose table is exported.
    #[must_use]
    pub const fn based_on(&self) -> Revision {
        Revision::new(self.based_on)
    }
}

/// The table read from the file at `path`, and the file's name: the work
/// of an import done before the session's lock is taken.
///
/// # Errors
///
/// The refusals of the core's `read_for_import` and `import_table`.
pub fn read(path: &Path) -> Result<(String, Imported), CommandError> {
    let name = file_name(path);
    let bytes = read_for_import(path)?;
    let imported = import_table(&name, &bytes)?;
    Ok((name, imported))
}

/// Loads the table read from `file_name` into the session, in one step,
/// at its current revision, and gives what the window tells the user.
///
/// # Errors
///
/// The refusals of the load.
pub fn load(
    session: &mut Session,
    file_name: String,
    imported: Imported,
    args: ImportArgs,
) -> Result<(ImportAnswer, Outcome), CommandError> {
    let command = Command::LoadTable {
        table: imported.table,
        active_classification: imported.active_classification,
    };
    let outcome = session.dispatch(calls::request(
        command,
        session.revision().get(),
        args.sent_at,
    )?)?;
    Ok((
        ImportAnswer::Imported {
            file_name,
            undecoded_line: imported.undecoded_line,
        },
        outcome,
    ))
}

/// Writes the export to the file at `path`.
///
/// # Errors
///
/// `FileNotWritten`.
pub fn write(path: &Path, bytes: &[u8]) -> Result<ExportAnswer, CommandError> {
    write_export(path, bytes)?;
    Ok(ExportAnswer::Exported {
        file_name: file_name(path),
    })
}

#[cfg(test)]
mod tests;
