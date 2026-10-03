//! The binary layout of the messages to the windows (`docs/core.md`,
//! section 5): a header of 24 bytes, then parts, each a header of 8 bytes
//! and a payload padded to a multiple of 8 bytes, so that a window reads
//! every payload with a typed array, without a copy. Every number is
//! little-endian. The TypeScript decoder in `src/backend/` is tested
//! against the same literal bytes as the tests here.

mod writer;

pub(crate) use writer::{MessageWriter, PageValues};

use crate::error::CommandError;
use crate::ids::{ColumnId, HoverSeq, Revision, SentAt};
use crate::session::OpenProject;

/// The column id that means no column, in the active part.
pub(crate) const NO_COLUMN: u32 = u32::MAX;
/// The code that means a missing value, or no selected group.
pub(crate) const NO_CODE: u16 = u16::MAX;
/// The row that means no row, in the hover part.
pub(crate) const NO_ROW: u32 = u32::MAX;

/// The kind of a message, its byte 0.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum MessageKind {
    /// The whole shared state, the response of a subscribe.
    Snapshot,
    /// What one command changed, at the revision in the header.
    Change,
    /// A hover, which takes no revision: the header has the current one.
    Hover,
    /// A page of rows a window asked for, at the current revision.
    Rows,
    /// An item of the menu for the window to carry out, which takes no
    /// revision: the header has the current one.
    Action,
}

impl MessageKind {
    const fn byte(self) -> u8 {
        match self {
            Self::Snapshot => 0,
            Self::Change => 1,
            Self::Hover => 2,
            Self::Rows => 3,
            Self::Action => 4,
        }
    }
}

/// The kind of a part, the `u16` at the start of its header.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PartKind {
    Project,
    Active,
    Selection,
    Codes,
    Undo,
    Columns,
    Hover,
    Page,
    Names,
    Values,
    Shape,
    Action,
    Filter,
}

impl PartKind {
    const fn code(self) -> u16 {
        match self {
            Self::Project => 1,
            Self::Active => 2,
            Self::Selection => 3,
            Self::Codes => 4,
            Self::Undo => 5,
            Self::Columns => 6,
            Self::Hover => 7,
            Self::Page => 8,
            Self::Names => 9,
            Self::Values => 10,
            Self::Shape => 11,
            Self::Action => 12,
            Self::Filter => 13,
        }
    }
}

/// A message with every part of the shared state: the snapshot of a
/// subscribe, and the change of a load, which replaces everything.
pub(crate) fn whole_state(
    kind: MessageKind,
    revision: Revision,
    sent_at: Option<SentAt>,
    project: Option<&OpenProject>,
    loaded_at: Revision,
    hover_seq: HoverSeq,
) -> Result<Vec<u8>, CommandError> {
    let mut message = MessageWriter::new(kind, revision, sent_at);
    message.project(project.map(|open| (open.table.num_rows(), loaded_at)))?;
    if let Some(open) = project {
        message.shape(open.shape_at)?;
        message.active(open.interaction.active)?;
        message.selection(&open.interaction.selection)?;
        message.undo(open.history.undo_redo())?;
        message.filter(
            &open.interaction.filter,
            &open.interaction.shown,
            open.table.num_rows(),
        )?;
        let columns = open.table.columns();
        let names = open.table.names();
        let revisions: Vec<(ColumnId, Revision)> = std::iter::once((names.id(), names.revision()))
            .chain(
                columns
                    .iter()
                    .map(|column| (column.id(), column.revision())),
            )
            .collect();
        message.columns(&revisions)?;
        for column in columns {
            if let Some(categorical) = column.categorical() {
                message.codes(column.id(), column.revision(), categorical.codes())?;
            }
        }
    }
    message.hover(hover_seq, project.and_then(|open| open.interaction.hover))?;
    Ok(message.finish())
}

#[cfg(test)]
mod tests;
