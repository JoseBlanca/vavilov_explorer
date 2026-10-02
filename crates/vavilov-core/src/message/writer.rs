//! The writer of one message: its header, then its parts.

use crate::error::CommandError;
use crate::ids::{ColumnId, HoverSeq, LevelCode, Revision, RowIndex, SentAt};
use crate::message::{MessageKind, NO_CODE, NO_COLUMN, NO_ROW, PartKind};
use crate::row_set::RowSet;
use crate::session::{Active, Selected, UndoRedo};

/// Every payload, and so every message, is padded to a multiple of this.
const ALIGNMENT: usize = 8;

/// A message being written.
pub(crate) struct MessageWriter {
    bytes: Vec<u8>,
}

impl MessageWriter {
    /// A message of `kind` at `revision`: bytes 0 to 23.
    pub(crate) fn new(kind: MessageKind, revision: Revision, sent_at: Option<SentAt>) -> Self {
        let mut bytes = Vec::new();
        bytes.push(kind.byte());
        bytes.push(u8::from(sent_at.is_some()));
        bytes.extend_from_slice(&[0; 6]);
        bytes.extend_from_slice(&revision.get().to_le_bytes());
        // The layout's zero when no time was given, which byte 1 says.
        bytes.extend_from_slice(&sent_at.map_or(0.0, SentAt::get).to_le_bytes());
        Self { bytes }
    }

    /// The message, written.
    pub(crate) fn finish(self) -> Vec<u8> {
        self.bytes
    }

    /// Whether a project is open, and its number of rows and the revision
    /// of its load.
    pub(crate) fn project(&mut self, open: Option<(u32, Revision)>) -> Result<(), CommandError> {
        self.part(PartKind::Project, |payload| {
            payload.push(u8::from(open.is_some()));
            payload.extend_from_slice(&[0; 7]);
            if let Some((num_rows, loaded_at)) = open {
                payload.extend_from_slice(&num_rows.to_le_bytes());
                payload.extend_from_slice(&[0; 4]);
                payload.extend_from_slice(&loaded_at.get().to_le_bytes());
            }
            Ok(())
        })
    }

    /// The revision at which the columns, their names or their roles last
    /// changed.
    pub(crate) fn shape(&mut self, shape_at: Revision) -> Result<(), CommandError> {
        self.part(PartKind::Shape, |payload| {
            payload.extend_from_slice(&shape_at.get().to_le_bytes());
            Ok(())
        })
    }

    /// The active classification and the selected population.
    pub(crate) fn active(&mut self, active: Option<Active>) -> Result<(), CommandError> {
        self.part(PartKind::Active, |payload| {
            let column = active.map_or(NO_COLUMN, |active| active.column.get());
            // The kind of the selection, 0 nothing, 1 a population, 2 the
            // unassigned individuals; the code only for a population.
            let (kind, code) = match active.and_then(|active| active.selected) {
                None => (0_u8, NO_CODE),
                Some(Selected::Population(code)) => (1, code.get()),
                Some(Selected::Unassigned) => (2, NO_CODE),
            };
            payload.extend_from_slice(&column.to_le_bytes());
            payload.extend_from_slice(&code.to_le_bytes());
            payload.push(kind);
            Ok(())
        })
    }

    /// The selection, one bit per row.
    pub(crate) fn selection(&mut self, rows: &RowSet) -> Result<(), CommandError> {
        self.part(PartKind::Selection, |payload| {
            payload.extend_from_slice(&rows.num_rows().to_le_bytes());
            payload.extend_from_slice(&[0; 4]);
            payload.extend_from_slice(rows.as_bytes());
            Ok(())
        })
    }

    /// The codes of a categorical column, one `u16` per row.
    pub(crate) fn codes(
        &mut self,
        column: ColumnId,
        revision: Revision,
        codes: &[Option<LevelCode>],
    ) -> Result<(), CommandError> {
        self.part(PartKind::Codes, |payload| {
            payload.extend_from_slice(&column.get().to_le_bytes());
            payload.extend_from_slice(&[0; 4]);
            payload.extend_from_slice(&revision.get().to_le_bytes());
            for code in codes {
                payload.extend_from_slice(&code.map_or(NO_CODE, LevelCode::get).to_le_bytes());
            }
            Ok(())
        })
    }

    /// Whether there is something to undo and to redo.
    pub(crate) fn undo(&mut self, undo_redo: UndoRedo) -> Result<(), CommandError> {
        self.part(PartKind::Undo, |payload| {
            payload.push(u8::from(undo_redo.can_undo));
            payload.push(u8::from(undo_redo.can_redo));
            Ok(())
        })
    }

    /// The revisions of some columns.
    pub(crate) fn columns(&mut self, columns: &[(ColumnId, Revision)]) -> Result<(), CommandError> {
        let num_columns = u32::try_from(columns.len()).map_err(|_| CommandError::Defect {
            what: format!("a message about {} columns", columns.len()),
        })?;
        self.part(PartKind::Columns, |payload| {
            payload.extend_from_slice(&num_columns.to_le_bytes());
            payload.extend_from_slice(&[0; 4]);
            for (column, revision) in columns.iter().copied() {
                payload.extend_from_slice(&column.get().to_le_bytes());
                payload.extend_from_slice(&[0; 4]);
                payload.extend_from_slice(&revision.get().to_le_bytes());
            }
            Ok(())
        })
    }

    /// The hover and its sequence number.
    pub(crate) fn hover(
        &mut self,
        seq: HoverSeq,
        row: Option<RowIndex>,
    ) -> Result<(), CommandError> {
        self.part(PartKind::Hover, |payload| {
            payload.extend_from_slice(&seq.get().to_le_bytes());
            payload.extend_from_slice(&row.map_or(NO_ROW, RowIndex::get).to_le_bytes());
            Ok(())
        })
    }

    /// The first part of a message of rows: the load of the table, the
    /// first row of the page and its number of rows.
    pub(crate) fn page(
        &mut self,
        loaded_at: Revision,
        first: RowIndex,
        count: u32,
    ) -> Result<(), CommandError> {
        self.part(PartKind::Page, |payload| {
            payload.extend_from_slice(&loaded_at.get().to_le_bytes());
            payload.extend_from_slice(&first.get().to_le_bytes());
            payload.extend_from_slice(&count.to_le_bytes());
            Ok(())
        })
    }

    /// The names of the rows of a page, as a text list.
    pub(crate) fn names(&mut self, names: &[String]) -> Result<(), CommandError> {
        self.part(PartKind::Names, |payload| {
            text_list(payload, names.iter().map(String::as_str))
        })
    }

    /// The values of one column in the rows of a page.
    pub(crate) fn values(
        &mut self,
        column: ColumnId,
        revision: Revision,
        values: PageValues<'_>,
    ) -> Result<(), CommandError> {
        self.part(PartKind::Values, |payload| {
            payload.extend_from_slice(&column.get().to_le_bytes());
            payload.push(values.type_byte());
            payload.extend_from_slice(&[0; 3]);
            payload.extend_from_slice(&revision.get().to_le_bytes());
            // A missing row holds zero, which the layout asks for and the
            // window checks; the bits before say which rows are missing.
            match values {
                PageValues::Float(values) => {
                    missing(payload, values)?;
                    for value in values {
                        payload.extend_from_slice(&value.unwrap_or(0.0).to_le_bytes());
                    }
                }
                PageValues::Integer(values) => {
                    missing(payload, values)?;
                    for value in values {
                        payload.extend_from_slice(&value.unwrap_or(0).to_le_bytes());
                    }
                }
                PageValues::Text(values) => {
                    missing(payload, values)?;
                    text_list(
                        payload,
                        values.iter().map(|value| value.as_deref().unwrap_or("")),
                    )?;
                }
                PageValues::Categorical(codes) => {
                    for code in codes {
                        payload
                            .extend_from_slice(&code.map_or(NO_CODE, LevelCode::get).to_le_bytes());
                    }
                }
            }
            Ok(())
        })
    }

    /// A part: its kind, two zero bytes, the length of its payload as a
    /// `u32`, then the payload written by `write`, padded with zeros.
    fn part(
        &mut self,
        kind: PartKind,
        write: impl FnOnce(&mut Vec<u8>) -> Result<(), CommandError>,
    ) -> Result<(), CommandError> {
        self.bytes.extend_from_slice(&kind.code().to_le_bytes());
        self.bytes.extend_from_slice(&[0; 2]);
        let length_at = self.bytes.len();
        self.bytes.extend_from_slice(&[0; 4]);
        let start = self.bytes.len();
        write(&mut self.bytes)?;
        let length = self
            .bytes
            .len()
            .checked_sub(start)
            .ok_or_else(|| defect("a part shrank"))?;
        let length =
            u32::try_from(length).map_err(|_| defect(&format!("a part of {length} bytes")))?;
        let slot = self
            .bytes
            .get_mut(length_at..start)
            .ok_or_else(|| defect("no slot for a length"))?;
        for (byte, value) in slot.iter_mut().zip(length.to_le_bytes()) {
            *byte = value;
        }
        let padded = self
            .bytes
            .len()
            .checked_next_multiple_of(ALIGNMENT)
            .ok_or_else(|| defect("a message too long to pad"))?;
        self.bytes.resize(padded, 0);
        Ok(())
    }
}

/// The values of one column in the rows of a page, by storage type, or
/// the codes of a category.
#[derive(Clone, Copy, Debug)]
pub(crate) enum PageValues<'a> {
    Float(&'a [Option<f64>]),
    Integer(&'a [Option<i64>]),
    Text(&'a [Option<String>]),
    Categorical(&'a [Option<LevelCode>]),
}

impl PageValues<'_> {
    /// The byte of the type in the header of a values part.
    const fn type_byte(self) -> u8 {
        match self {
            Self::Float(_) => 0,
            Self::Integer(_) => 1,
            Self::Text(_) => 2,
            // 3 was yes or no, which a page no longer carries: a column
            // of yes or no is always a category.
            Self::Categorical(_) => 4,
        }
    }
}

/// The bit of each row within its byte, row `i` in bit `i % 8`.
const BITS: [u8; 8] = [1, 2, 4, 8, 16, 32, 64, 128];

/// Which values are missing, one bit per value, set when missing, padded
/// with zeros to a multiple of 8 bytes of the message.
fn missing<T>(bytes: &mut Vec<u8>, values: &[Option<T>]) -> Result<(), CommandError> {
    for chunk in values.chunks(BITS.len()) {
        let byte = BITS
            .iter()
            .zip(chunk)
            .filter(|(_, value)| value.is_none())
            .fold(0_u8, |byte, (bit, _)| byte | bit);
        bytes.push(byte);
    }
    let padded = bytes
        .len()
        .checked_next_multiple_of(ALIGNMENT)
        .ok_or_else(|| defect("a message too long to pad"))?;
    bytes.resize(padded, 0);
    Ok(())
}

/// A text list: a first offset of 0, then the end of each text as a
/// `u32` offset into the bytes that follow, then the texts in UTF-8.
fn text_list<'a>(
    bytes: &mut Vec<u8>,
    texts: impl Iterator<Item = &'a str> + Clone,
) -> Result<(), CommandError> {
    let mut end: u32 = 0;
    bytes.extend_from_slice(&end.to_le_bytes());
    for text in texts.clone() {
        end = u32::try_from(text.len())
            .ok()
            .and_then(|len| end.checked_add(len))
            .ok_or_else(|| defect("texts of more than 4 GiB in one part"))?;
        bytes.extend_from_slice(&end.to_le_bytes());
    }
    for text in texts {
        bytes.extend_from_slice(text.as_bytes());
    }
    Ok(())
}

fn defect(what: &str) -> CommandError {
    CommandError::Defect {
        what: what.to_owned(),
    }
}
