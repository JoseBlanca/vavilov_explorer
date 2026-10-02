//! The one module of the core that touches the file system
//! (`.claude/skills/coding/SKILL.md`, the layers): it reads the file the
//! user chose to import, and writes the file of an export. Every failure
//! is a `CommandError` with the file's name and what the system refused.

use std::fs::{File, OpenOptions};
use std::io::{ErrorKind, Read, Write};
use std::path::{Path, PathBuf};

use crate::error::{CommandError, ImportRefusal, IoFailure};
use crate::import::MAX_IMPORT_BYTES;

/// The name of the file at `path`, without its folder, as a message names
/// it.
#[must_use]
pub fn file_name(path: &Path) -> String {
    path.file_name().map_or_else(
        || path.display().to_string(),
        |name| name.to_string_lossy().into_owned(),
    )
}

/// The bytes of the file at `path`, of at most [`MAX_IMPORT_BYTES`]:
/// a larger one is refused from its size, before it is read.
///
/// # Errors
///
/// `ImportRefused` as too large, or `FileNotRead`.
pub fn read_for_import(path: &Path) -> Result<Vec<u8>, CommandError> {
    let name = file_name(path);
    let not_read = |error: &std::io::Error| CommandError::FileNotRead {
        file_name: name.clone(),
        io: failure(error),
        message: error.to_string(),
    };
    let file = std::fs::File::open(path).map_err(|error| not_read(&error))?;
    let size = file.metadata().map_err(|error| not_read(&error))?.len();
    if size > MAX_IMPORT_BYTES {
        return Err(CommandError::ImportRefused {
            file_name: name,
            refusal: ImportRefusal::TooLarge {
                size,
                max_bytes: MAX_IMPORT_BYTES,
            },
        });
    }
    // One byte past the limit is read, so that a file that grew since its
    // size was taken is refused by the import as too large.
    let mut bytes = Vec::new();
    file.take(MAX_IMPORT_BYTES.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|error| not_read(&error))?;
    Ok(bytes)
}

/// The most names an export tries for its temporary file before it gives
/// up, each taken by a file of the user's or of another export.
const MAX_TEMPORARY_NAMES: u32 = 100;

/// Writes `bytes` as the file at `path`: to a temporary file of its own
/// beside it, then renamed over it, so that a failure leaves a file that
/// was there whole. The temporary file is new, `.vavilov-<process>-<n>.tmp`
/// with the first `n` no file has, so that no file of the user's is
/// written or removed, and a link at that name is not followed. A file
/// replaced keeps its permissions.
///
/// # Errors
///
/// `FileNotWritten`.
pub fn write_export(path: &Path, bytes: &[u8]) -> Result<(), CommandError> {
    let name = file_name(path);
    let not_written = |error: &std::io::Error| CommandError::FileNotWritten {
        file_name: name.clone(),
        io: failure(error),
        message: error.to_string(),
    };
    let folder = path.parent().ok_or_else(|| {
        not_written(&std::io::Error::new(
            ErrorKind::InvalidInput,
            "the path names no file in a folder",
        ))
    })?;
    let (temporary, mut file) = create_temporary(folder).map_err(|error| not_written(&error))?;
    let written = copy_permissions(path, &file)
        .and_then(|()| file.write_all(bytes))
        .and_then(|()| file.sync_all())
        .and_then(|()| {
            drop(file);
            std::fs::rename(&temporary, path)
        });
    if let Err(error) = written {
        // The temporary file is this call's; a failure to remove it is not
        // the user's error, which is the one reported.
        if let Err(removing) = std::fs::remove_file(&temporary)
            && removing.kind() != ErrorKind::NotFound
        {
            eprintln!(
                "Vavilov Explorer: the temporary file {} was left: {removing}",
                temporary.display()
            );
        }
        return Err(not_written(&error));
    }
    Ok(())
}

/// A new file in `folder`, of the first name of this process no file has.
/// It is opened with `create_new`, which fails on any file at that name, a
/// link among them, and so neither writes nor follows one.
fn create_temporary(folder: &Path) -> std::io::Result<(PathBuf, File)> {
    for attempt in 0..MAX_TEMPORARY_NAMES {
        let candidate = folder.join(format!(".vavilov-{}-{attempt}.tmp", std::process::id()));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(file) => return Ok((candidate, file)),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error),
        }
    }
    Err(std::io::Error::new(
        ErrorKind::AlreadyExists,
        format!("the {MAX_TEMPORARY_NAMES} names of a temporary file are all taken"),
    ))
}

/// Gives `file` the permissions of the file at `path`, when there is one,
/// so that a file only its owner may read stays so once it is replaced.
#[cfg(unix)]
fn copy_permissions(path: &Path, file: &File) -> std::io::Result<()> {
    match std::fs::metadata(path) {
        Ok(metadata) => file.set_permissions(metadata.permissions()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

/// On Windows a new file takes the permissions of its folder, and the one
/// flag of a file's own, read-only, copied to the temporary file would
/// make it one that cannot be renamed or removed.
#[cfg(not(unix))]
fn copy_permissions(_path: &Path, _file: &File) -> std::io::Result<()> {
    Ok(())
}

/// The kind of a failure of the system the message distinguishes; the
/// standard library's other kinds, dozens, are all `Other`, with the
/// system's message beside it.
fn failure(error: &std::io::Error) -> IoFailure {
    let kind = error.kind();
    if kind == ErrorKind::NotFound {
        IoFailure::NotFound
    } else if kind == ErrorKind::PermissionDenied {
        IoFailure::PermissionDenied
    } else {
        IoFailure::Other
    }
}

#[cfg(test)]
mod tests;
