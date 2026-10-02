//! A set of rows of the table, as one bit per row: the selection, and the
//! rows a lasso takes.

use crate::convert::{u64_from, usize_from};
use crate::error::CommandError;
use crate::ids::RowIndex;

/// A set of rows of a table of `num_rows` rows, as one bit per row: row
/// `i` is bit `i % 8` of byte `i / 8`, and the bits beyond the last row
/// are zero. It is the layout a window sends and receives (`docs/core.md`,
/// section 5), so a set from a window is taken as it is, once checked.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RowSet {
    num_rows: u32,
    bytes: Vec<u8>,
}

impl RowSet {
    /// The set of no row of a table of `num_rows` rows.
    #[must_use]
    pub fn empty(num_rows: u32) -> Self {
        Self {
            num_rows,
            bytes: vec![0; num_bytes(num_rows)],
        }
    }

    /// The set a window sent, for a table of `num_rows` rows.
    ///
    /// # Errors
    ///
    /// `RowSetLength` when `bytes` is not one bit per row, rounded up to a
    /// whole byte, and `RowSetUnusedBits` when a bit beyond the last row
    /// is set.
    pub fn from_bytes(bytes: &[u8], num_rows: u32) -> Result<Self, CommandError> {
        if bytes.len() != num_bytes(num_rows) {
            return Err(CommandError::RowSetLength {
                num_rows,
                num_bytes: u64_from(bytes.len()),
            });
        }
        // The bits of the last byte at or beyond `num_rows % 8`, which must
        // be zero; none when the rows fill the last byte.
        let used = num_rows % 8;
        if used != 0 {
            let unused = u8::MAX
                .checked_shl(used)
                .ok_or_else(|| CommandError::Defect {
                    what: format!("a shift by {used} bits"),
                })?;
            if bytes.last().is_some_and(|last| last & unused != 0) {
                return Err(CommandError::RowSetUnusedBits { num_rows });
            }
        }
        Ok(Self {
            num_rows,
            bytes: bytes.to_vec(),
        })
    }

    /// The set of these rows of a table of `num_rows` rows.
    ///
    /// # Errors
    ///
    /// `RowOutOfRange` for a row beyond the table.
    pub fn from_rows(
        num_rows: u32,
        rows: impl IntoIterator<Item = RowIndex>,
    ) -> Result<Self, CommandError> {
        let mut set = Self::empty(num_rows);
        for row in rows {
            let (byte, mask) = set
                .place(row)
                .ok_or(CommandError::RowOutOfRange { row, num_rows })?;
            *byte |= mask;
        }
        Ok(set)
    }

    /// The number of rows of the table the set is for.
    #[must_use]
    pub const fn num_rows(&self) -> u32 {
        self.num_rows
    }

    /// Whether the set holds `row`; a row beyond the table is in no set.
    #[must_use]
    pub fn contains(&self, row: RowIndex) -> bool {
        if row.get() >= self.num_rows {
            return false;
        }
        self.bytes
            .get(usize_from(row.get() / 8))
            .is_some_and(|byte| byte & mask(row) != 0)
    }

    /// The rows of the set, in order.
    pub fn rows(&self) -> impl Iterator<Item = RowIndex> + '_ {
        (0..self.num_rows)
            .map(RowIndex::new)
            .filter(|row| self.contains(*row))
    }

    /// The bytes of the set, one bit per row.
    #[must_use]
    pub fn as_bytes(&self) -> &[u8] {
        &self.bytes
    }
}

impl RowSet {
    /// The byte that holds `row` and the mask of its bit, or `None` for a
    /// row beyond the table.
    fn place(&mut self, row: RowIndex) -> Option<(&mut u8, u8)> {
        if row.get() >= self.num_rows {
            return None;
        }
        self.bytes
            .get_mut(usize_from(row.get() / 8))
            .map(|byte| (byte, mask(row)))
    }
}

/// The number of bytes of a set of `num_rows` rows, one bit per row.
fn num_bytes(num_rows: u32) -> usize {
    usize_from(num_rows.div_ceil(8))
}

/// The mask of the bit of `row` in its byte.
fn mask(row: RowIndex) -> u8 {
    1_u8.rotate_left(row.get() % 8)
}

#[cfg(test)]
mod tests;
