//! The system's Open and Save dialogs of an import and an export, opened
//! by the backend so that no window sends a path (`docs/design.md`,
//! section 2.1). Each is given the window that asked for it as its parent:
//! on macOS the dialog is a sheet of that window, and on Windows it keeps
//! the window and its menu from taking input while it is open. On Linux
//! rfd 0.16's GTK dialog takes no parent
//! (`rfd-0.16.0/src/backend/gtk3/file_dialog/dialog_ffi.rs`), and the
//! window stays live.

use std::path::PathBuf;

use tauri::async_runtime::{Sender, channel};
use tauri::{Runtime, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, FilePath};
use vavilov_core::{CommandError, ExportFormat};

/// The title of the Open dialog of an import.
pub const IMPORT_TITLE: &str = "Import table";

/// The title of the Save dialog of an export.
pub const EXPORT_TITLE: &str = "Export table";

/// The name of the Open dialog's filter.
pub const TABLES_FILTER: &str = "Tables";

/// The extensions the Open dialog shows: CSV, TSV, text and xlsx, chosen by
/// the assistant on 2 October 2026 and still to be answered by the owner.
/// Each comes in capitals too, since the patterns of GTK's dialog, on
/// Linux, tell case, and a file `DATOS.CSV` would not be shown.
pub const TABLE_EXTENSIONS: [&str; 8] = ["csv", "tsv", "txt", "xlsx", "CSV", "TSV", "TXT", "XLSX"];

/// The name of the Save dialog's filter of a CSV.
pub const CSV_FILTER: &str = "CSV";

/// The name of the Save dialog's filter of an xlsx.
pub const XLSX_FILTER: &str = "Excel workbook";

/// The name the Save dialog offers, before the format's extension:
/// `table.csv`, `table.xlsx`; chosen by the assistant on 2 October 2026
/// and still to be answered by the owner.
pub const EXPORT_FILE_STEM: &str = "table";

/// Asks the user for the file of an import, with the Open dialog over
/// `window`; `None` when they closed it.
///
/// # Errors
///
/// A `Defect` when the dialog ends without an answer, as when the app
/// quits while it opens, or gives what is not a path.
pub async fn open<R: Runtime>(window: &WebviewWindow<R>) -> Result<Option<PathBuf>, CommandError> {
    let dialog = window
        .dialog()
        .file()
        .set_parent(window)
        .set_title(IMPORT_TITLE)
        .add_filter(TABLES_FILTER, &TABLE_EXTENSIONS);
    answer(|reply| dialog.pick_file(move |chosen| reply.give(chosen))).await
}

/// Asks the user where to save an export in `format`, with the Save
/// dialog over `window`; `None` when they closed it. A name typed without
/// an extension gets the format's, which GTK's dialog does not add.
///
/// # Errors
///
/// A `Defect` when the dialog ends without an answer, as when the app
/// quits while it opens, or gives what is not a path.
pub async fn save<R: Runtime>(
    window: &WebviewWindow<R>,
    format: ExportFormat,
) -> Result<Option<PathBuf>, CommandError> {
    let extension = format.extension();
    let filter = match format {
        ExportFormat::Csv { .. } => CSV_FILTER,
        ExportFormat::Xlsx => XLSX_FILTER,
    };
    let dialog = window
        .dialog()
        .file()
        .set_parent(window)
        .set_title(EXPORT_TITLE)
        .set_file_name(format!("{EXPORT_FILE_STEM}.{extension}"))
        .add_filter(filter, &[extension]);
    // A name typed without an extension is written as typed: adding one
    // here could replace a file of that name the dialog never asked about,
    // which GTK asks about only for the name typed.
    answer(|reply| dialog.save_file(move |chosen| reply.give(chosen))).await
}

/// Where a dialog gives its answer: the plugin calls back with it from
/// another thread, or drops the callback when it cannot show the dialog.
struct Reply(Sender<Option<FilePath>>);

impl Reply {
    /// Gives the user's choice to the command waiting for it.
    fn give(self, chosen: Option<FilePath>) {
        if let Err(error) = self.0.try_send(chosen) {
            eprintln!(
                "Vavilov Explorer: the answer of a dialog came after its command ended: {error}"
            );
        }
    }
}

/// The answer of the dialog that `show` opens with the `Reply` it is
/// given. The plugin's blocking calls unwrap a channel whose sender is
/// dropped when the event loop is gone, a panic that ends the app; here
/// that is a defect.
async fn answer(show: impl FnOnce(Reply)) -> Result<Option<PathBuf>, CommandError> {
    let (sender, mut receiver) = channel(1);
    show(Reply(sender));
    let chosen = receiver.recv().await.ok_or_else(|| CommandError::Defect {
        what: "a dialog that ended without an answer, as when the app quits while it opens"
            .to_owned(),
    })?;
    chosen
        .map(|chosen| {
            chosen.into_path().map_err(|error| CommandError::Defect {
                what: format!("a file chosen in the dialog that is not a path: {error}"),
            })
        })
        .transpose()
}

#[cfg(test)]
mod tests;
