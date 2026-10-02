//! The filter of the find bar above the table (`docs/design.md`, section
//! 2.1): a text searched for in one column or in any, and which rows of the
//! table it shows. A cell matches by the text the table shows of it, case
//! ignored and accents not; a cell of a country also by any of its ISO
//! names and codes; a missing cell never matches. The filter hides rows of
//! the table only, and is part of the interaction, not undone.

use serde::Deserialize;

use crate::convert::usize_from;
use crate::countries;
use crate::error::CommandError;
use crate::ids::{ColumnId, LevelCode, RowIndex};
use crate::table::{Categorical, ColumnValues, LevelValues, Numbers, Table};

/// How the text must match a cell.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CellMatch {
    /// The text is part of the cell's.
    Part,
    /// The text is the cell's whole text: "Whole cell".
    Whole,
}

/// Which rows the filter shows.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShownRows {
    /// The rows that match.
    Matching,
    /// The rows that do not: "Show rows that don't match".
    NotMatching,
}

/// The filter of the find bar. With no text it shows every row, and keeps
/// its column and its choices for when the user types.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Filter {
    /// The text searched for; empty for none.
    pub text: String,
    /// The column searched, or `None` for any column, the first included.
    pub column: Option<ColumnId>,
    /// How the text must match a cell.
    pub cell: CellMatch,
    /// Which rows are shown.
    pub shown: ShownRows,
    /// The decimal mark the table writes decimal numbers with, the
    /// system's region's, so that a number matches by the text shown.
    pub decimal_mark: String,
}

impl Filter {
    /// The filter of a table just loaded: no text, any column, part of a
    /// cell and the matching rows, the defaults of the find bar (decided by
    /// the owner on 2 October 2026).
    #[must_use]
    pub fn none() -> Self {
        Self {
            text: String::new(),
            column: None,
            cell: CellMatch::Part,
            shown: ShownRows::Matching,
            decimal_mark: ".".to_owned(),
        }
    }
}

/// A column's values as an edit not yet applied leaves them, so that the
/// rows shown after it are found before anything is changed.
#[derive(Clone, Copy)]
pub(crate) enum Replaced<'a> {
    /// The new values of a column.
    Values(ColumnId, &'a ColumnValues),
    /// The new codes of a category.
    Codes(ColumnId, &'a [Option<LevelCode>]),
}

/// The rows `filter` shows of `table`, in order, with `replaced` in the
/// place of what it replaces; `None` when the filter has no text and shows
/// every row.
///
/// # Errors
///
/// `UnknownColumn` for a column the table does not have, and a `Defect`
/// for a column whose length is not the table's.
pub(crate) fn shown_rows(
    filter: &Filter,
    table: &Table,
    replaced: Option<Replaced<'_>>,
) -> Result<Option<Vec<RowIndex>>, CommandError> {
    if filter.text.is_empty() {
        return Ok(None);
    }
    let search = Search {
        text: filter.text.to_lowercase(),
        cell: filter.cell,
        decimal_mark: &filter.decimal_mark,
    };
    let num_rows = usize_from(table.num_rows());
    let names = table.names();
    let matches = match filter.column {
        Some(column) if column == names.id() => texts(names.names().iter().map(Some), &search),
        Some(column) => {
            let found = table
                .column(column)
                .ok_or(CommandError::UnknownColumn { column })?;
            column_matches(found.id(), found.values(), replaced, &search)?
        }
        None => {
            let mut any = texts(names.names().iter().map(Some), &search);
            for column in table.columns() {
                let one = column_matches(column.id(), column.values(), replaced, &search)?;
                if one.len() != num_rows {
                    return Err(length_defect(column.id(), one.len(), num_rows));
                }
                for (row, matched) in any.iter_mut().zip(one) {
                    *row |= matched;
                }
            }
            any
        }
    };
    if matches.len() != num_rows {
        return Err(CommandError::Defect {
            what: format!(
                "a filter that matched {} rows of a table of {num_rows}",
                matches.len()
            ),
        });
    }
    let wanted = match filter.shown {
        ShownRows::Matching => true,
        ShownRows::NotMatching => false,
    };
    Ok(Some(
        (0..=u32::MAX)
            .zip(matches)
            .filter(|(_, matched)| *matched == wanted)
            .map(|(row, _)| RowIndex::new(row))
            .collect(),
    ))
}

/// The text searched for, in lower case, and how it must match.
struct Search<'a> {
    text: String,
    cell: CellMatch,
    decimal_mark: &'a str,
}

impl Search<'_> {
    /// Whether the cell whose shown text is `shown` matches.
    fn matches(&self, shown: &str) -> bool {
        let shown = shown.to_lowercase();
        match self.cell {
            CellMatch::Part => shown.contains(&self.text),
            CellMatch::Whole => shown == self.text,
        }
    }
}

fn length_defect(column: ColumnId, len: usize, num_rows: usize) -> CommandError {
    CommandError::Defect {
        what: format!("column {column} has {len} values in a table of {num_rows} rows"),
    }
}

/// Whether each row of a column matches.
fn column_matches(
    id: ColumnId,
    values: &ColumnValues,
    replaced: Option<Replaced<'_>>,
    search: &Search<'_>,
) -> Result<Vec<bool>, CommandError> {
    match replaced {
        Some(Replaced::Values(column, new)) if column == id => {
            return values_matches(new, None, search);
        }
        Some(Replaced::Codes(column, codes)) if column == id => {
            return values_matches(values, Some(codes), search);
        }
        Some(Replaced::Values(..) | Replaced::Codes(..)) | None => {}
    }
    values_matches(values, None, search)
}

/// Whether each row of `values` matches, with `codes` in the place of a
/// category's own.
fn values_matches(
    values: &ColumnValues,
    codes: Option<&[Option<LevelCode>]>,
    search: &Search<'_>,
) -> Result<Vec<bool>, CommandError> {
    Ok(match values {
        ColumnValues::Number(numbers)
        | ColumnValues::Latitude(numbers)
        | ColumnValues::Longitude(numbers) => match numbers {
            Numbers::Integer(values) => values
                .iter()
                .map(|value| value.is_some_and(|value| search.matches(&value.to_string())))
                .collect(),
            Numbers::Float(values) => values
                .iter()
                .map(|value| {
                    value.is_some_and(|value| {
                        search.matches(&number_text(value, search.decimal_mark))
                    })
                })
                .collect(),
        },
        ColumnValues::Text(values) => texts(values.iter().map(Option::as_ref), search),
        ColumnValues::Category(categorical) => {
            let levels = level_matches(categorical, search, Synonyms::None);
            by_code(&levels, codes.unwrap_or(categorical.codes()))?
        }
        ColumnValues::Country(categorical) => {
            let levels = level_matches(categorical, search, Synonyms::Countries);
            by_code(&levels, codes.unwrap_or(categorical.codes()))?
        }
    })
}

fn texts<'a>(values: impl Iterator<Item = Option<&'a String>>, search: &Search<'_>) -> Vec<bool> {
    values
        .map(|value| value.is_some_and(|value| search.matches(value)))
        .collect()
}

/// Whether a level matches also by the names of what it stands for.
#[derive(Clone, Copy)]
enum Synonyms {
    None,
    /// Each level is a country's code, which matches by every ISO name and
    /// code of the country.
    Countries,
}

/// Whether each level of a category matches, in the order of its codes.
fn level_matches(categorical: &Categorical, search: &Search<'_>, synonyms: Synonyms) -> Vec<bool> {
    let shown: Vec<String> = match categorical.levels() {
        LevelValues::Integer(values) => values.iter().map(ToString::to_string).collect(),
        LevelValues::Float(values) => values
            .iter()
            .map(|value| number_text(*value, search.decimal_mark))
            .collect(),
        LevelValues::Boolean(values) => values
            .iter()
            .map(|value| if *value { "TRUE" } else { "FALSE" }.to_owned())
            .collect(),
        LevelValues::Text(values) => values.clone(),
    };
    shown
        .iter()
        .map(|level| {
            search.matches(level)
                || match synonyms {
                    Synonyms::None => false,
                    Synonyms::Countries => countries::names_of(level).any(|name| {
                        // A code of two or three letters is compared whole:
                        // as part of a code, "es" would find Estonia (EST)
                        // as well as Spain.
                        if name.chars().count() <= 3 {
                            name == search.text
                        } else {
                            search.matches(name)
                        }
                    }),
                }
        })
        .collect()
}

/// Whether each row matches, by whether its level does.
fn by_code(levels: &[bool], codes: &[Option<LevelCode>]) -> Result<Vec<bool>, CommandError> {
    codes
        .iter()
        .map(|code| match code {
            None => Ok(false),
            Some(code) => {
                levels
                    .get(usize::from(code.get()))
                    .copied()
                    .ok_or_else(|| CommandError::Defect {
                        what: format!("a code {code} of a category of {} levels", levels.len()),
                    })
            }
        })
        .collect()
}

/// A decimal number as the table writes it (`src/state/cellText.ts`): the
/// shortest form that gives back the value, as JavaScript writes it, with
/// `decimal_mark` in the place of the point. JavaScript writes an
/// exponent from 10^21 up and below 10^-6, as `1e+21` and `1.5e-7`, and
/// −0 as `0`.
pub(crate) fn number_text(value: f64, decimal_mark: &str) -> String {
    let magnitude = value.abs();
    let text = if value == 0.0 {
        "0".to_owned()
    } else if (1e-6..1e21).contains(&magnitude) {
        value.to_string()
    } else {
        let exponent = format!("{value:e}");
        match exponent.split_once('e') {
            Some((mantissa, power)) if !power.starts_with('-') => format!("{mantissa}e+{power}"),
            Some(_) | None => exponent,
        }
    };
    text.replacen('.', decimal_mark, 1)
}

#[cfg(test)]
mod tests;
