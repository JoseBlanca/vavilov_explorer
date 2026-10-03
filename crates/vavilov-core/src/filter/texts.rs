//! The text of every decimal number of the table, as a search reads it,
//! kept so that a key typed in the find bar does not write them all again
//! (`docs/core.md`, section 5, "The filter"): written once per column and
//! decimal mark, and again when the column changes.

use std::collections::HashMap;

use crate::convert::usize_from;
use crate::error::CommandError;
use crate::ids::{ColumnId, Revision};
use crate::table::{Numbers, Table};

use super::number_text;

/// The texts of the decimal columns of a table, each in lower case, as
/// [`super::number_text`] writes them with one decimal mark.
#[derive(Clone, Debug, Default)]
pub(crate) struct NumberTexts {
    /// The decimal mark they were written with.
    decimal_mark: String,
    /// For each column, its revision when written, and its texts.
    columns: HashMap<ColumnId, ColumnTexts>,
}

/// The texts of one column's rows, one after the other, with the end of
/// each; a missing value is an empty text, which no number has.
#[derive(Clone, Debug)]
struct ColumnTexts {
    revision: Revision,
    texts: String,
    ends: Vec<u32>,
}

impl NumberTexts {
    /// Writes the texts of every decimal column of `table` that are not
    /// kept for its revision and `decimal_mark`, and drops those of a column
    /// that is no longer one.
    ///
    /// # Errors
    ///
    /// The defect of [`super::number_text`].
    pub(crate) fn refresh(
        &mut self,
        table: &Table,
        decimal_mark: &str,
    ) -> Result<(), CommandError> {
        if self.decimal_mark != decimal_mark {
            self.decimal_mark = decimal_mark.to_owned();
            self.columns.clear();
        }
        let decimal: Vec<(ColumnId, Revision, &[Option<f64>])> = table
            .columns()
            .iter()
            .filter_map(|column| match column.values().numbers() {
                Some(Numbers::Float(values)) => Some((column.id(), column.revision(), &values[..])),
                Some(Numbers::Integer(_)) | None => None,
            })
            .collect();
        self.columns
            .retain(|id, _| decimal.iter().any(|(column, _, _)| column == id));
        for (id, revision, values) in decimal {
            if self
                .columns
                .get(&id)
                .is_some_and(|kept| kept.revision == revision)
            {
                continue;
            }
            let mut texts = String::new();
            let mut ends = Vec::with_capacity(values.len());
            for value in values {
                if let Some(value) = value {
                    texts.push_str(&number_text(*value, decimal_mark)?.to_lowercase());
                }
                ends.push(
                    u32::try_from(texts.len()).map_err(|_| CommandError::Defect {
                        what: format!("the texts of column {id} beyond 4 GB"),
                    })?,
                );
            }
            self.columns.insert(
                id,
                ColumnTexts {
                    revision,
                    texts,
                    ends,
                },
            );
        }
        Ok(())
    }

    /// The text of each row of `column`, `None` for a missing value, when
    /// they are kept for `revision` and `decimal_mark`; a defect for a
    /// text whose end is not where a text ends.
    pub(crate) fn column(
        &self,
        column: ColumnId,
        revision: Revision,
        decimal_mark: &str,
    ) -> Option<impl Iterator<Item = Result<Option<&str>, CommandError>>> {
        if self.decimal_mark != decimal_mark {
            return None;
        }
        let kept = self
            .columns
            .get(&column)
            .filter(|kept| kept.revision == revision)?;
        let starts = std::iter::once(0).chain(kept.ends.iter().copied());
        Some(starts.zip(&kept.ends).map(move |(start, end)| {
            let text = kept
                .texts
                .get(usize_from(start)..usize_from(*end))
                .ok_or_else(|| CommandError::Defect {
                    what: format!("a kept text of column {column} from byte {start} to {end}"),
                })?;
            // Every number has a text, so an empty one is a missing value.
            Ok((!text.is_empty()).then_some(text))
        }))
    }
}

/// Kept texts are equal to any others: they are written from the table,
/// which a comparison of two sessions compares, and keeping them or not
/// changes no row a search finds.
impl PartialEq for NumberTexts {
    fn eq(&self, _other: &Self) -> bool {
        true
    }
}
