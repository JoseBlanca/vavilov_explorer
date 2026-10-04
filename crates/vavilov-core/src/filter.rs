//! The filter of the find bar above the table (`docs/design.md`, section
//! 2.1): a condition on one column or on any, and which rows of the table
//! it shows. "contains" and "is" match a cell by the text the table shows
//! of it, case ignored and accents not, and a cell of a country also by
//! any of its ISO names and codes; "is" a group matches the group's
//! individuals; a comparison matches the numbers that compare so with the
//! one typed; "is missing" matches the missing cells, and apart from it a
//! missing cell never matches. The filter hides rows of the table only, and
//! is part of the interaction, not undone.

pub(crate) mod texts;

use std::cmp::Ordering;

use serde::Deserialize;

use crate::cells::decimal_number;
use crate::convert::usize_from;
use crate::countries;
use crate::error::CommandError;
use crate::ids::{ColumnId, LevelCode, RowIndex};
use crate::table::{Categorical, Column, ColumnValues, LevelValues, Numbers, Table};
use crate::text::nfc;

/// How a number of a column compares with the one typed.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Comparison {
    /// "<".
    Less,
    /// "≤".
    AtMost,
    /// "=".
    Equal,
    /// "≥".
    AtLeast,
    /// ">".
    Greater,
}

impl Comparison {
    /// Whether a cell whose number stands so to the one typed matches.
    const fn holds(self, ordering: Ordering) -> bool {
        match self {
            Self::Less => matches!(ordering, Ordering::Less),
            Self::AtMost => matches!(ordering, Ordering::Less | Ordering::Equal),
            Self::Equal => matches!(ordering, Ordering::Equal),
            Self::AtLeast => matches!(ordering, Ordering::Greater | Ordering::Equal),
            Self::Greater => matches!(ordering, Ordering::Greater),
        }
    }
}

/// What a cell must be to match, the operator of the find bar and its
/// value.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Condition {
    /// "contains": the text is part of the cell's.
    Contains {
        /// The text; empty for none, which matches every row.
        text: String,
    },
    /// "is": the text is the cell's whole text.
    Is {
        /// The text; empty for none, which matches every row.
        text: String,
    },
    /// "is" a group, chosen from the list of a category or a column of
    /// countries.
    Group {
        /// The group's code, or `None` before one is chosen, which matches
        /// every row. It must be given, `null` for none: a window that left
        /// it out would otherwise filter nothing without a word.
        #[serde(deserialize_with = "Option::deserialize")]
        code: Option<LevelCode>,
    },
    /// "=", "<", "≤", ">" or "≥" a number, on a column of numbers.
    Compare {
        /// How the cell's number must compare with the one typed.
        comparison: Comparison,
        /// The number as typed, with the window's decimal mark; empty for
        /// none, and one that is no number, both of which match every row.
        text: String,
    },
    /// "is missing", an empty variant with braces, so that a field sent
    /// with it is refused as for the others.
    Missing {},
}

/// Which rows the filter shows.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Showing {
    /// The rows that match.
    Matching,
    /// The rows that do not: "Show rows that don't match".
    NotMatching,
}

/// The filter of the find bar. With an empty text, no group chosen, or a
/// number it cannot read, it shows every row, and keeps its column and its
/// choices for when the user types; "is missing" filters with no value.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Filter {
    /// The column searched, or `None` for any column, the first included.
    pub column: Option<ColumnId>,
    /// What a cell must be to match.
    pub condition: Condition,
    /// Whether it shows the rows that match or those that do not.
    pub showing: Showing,
}

/// The most characters the text of a filter may have, the limit of the
/// find bar's field, whose `maxlength` counts UTF-16 units, never fewer
/// than the characters counted here. A text is sent back in every message
/// that changes the filter, to every window, so a limit keeps one pasted
/// by mistake from being echoed at length.
pub const MAX_FILTER_TEXT: usize = 1_000;

impl Filter {
    /// The filter of a table just loaded: any column, "contains" with no
    /// text, and the matching rows, the defaults of the find bar.
    #[must_use]
    pub fn none() -> Self {
        Self {
            column: None,
            condition: Condition::Contains {
                text: String::new(),
            },
            showing: Showing::Matching,
        }
    }

    /// The text of its condition, typed or a number, or `None` for a
    /// condition with none.
    #[must_use]
    pub fn text(&self) -> Option<&str> {
        match &self.condition {
            Condition::Contains { text }
            | Condition::Is { text }
            | Condition::Compare { text, .. } => Some(text),
            Condition::Group { .. } | Condition::Missing {} => None,
        }
    }

    /// Whether it may read the texts of decimal numbers, with a text that
    /// is part or the whole of a cell's.
    pub(crate) fn reads_number_texts(&self) -> bool {
        match &self.condition {
            Condition::Contains { text } | Condition::Is { text } => !text.is_empty(),
            Condition::Group { .. } | Condition::Compare { .. } | Condition::Missing {} => false,
        }
    }

    /// Whether its condition is a comparison whose text, not empty, is no
    /// number written with `decimal_mark`, so that it filters nothing and
    /// the find bar says so.
    #[must_use]
    pub fn unreadable_number(&self, decimal_mark: Option<&str>) -> bool {
        match (&self.condition, decimal_mark) {
            (Condition::Compare { text, .. }, Some(mark)) => {
                !text.trim().is_empty() && decimal_number(text.trim(), mark).is_err()
            }
            (Condition::Compare { text, .. }, None) => !text.trim().is_empty(),
            (
                Condition::Contains { .. }
                | Condition::Is { .. }
                | Condition::Group { .. }
                | Condition::Missing {},
                _,
            ) => false,
        }
    }
}

/// What the values of a column searched are, which sets the conditions
/// that fit it, as the find bar offers its operators.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Searched {
    /// Texts: a column of text, or the IDs.
    Texts,
    /// The groups of a category or a column of countries, so many of them.
    Groups(usize),
    /// Numbers: a number, a latitude or a longitude.
    Numbers,
}

impl Searched {
    /// What `values` are.
    pub(crate) fn of(values: &ColumnValues) -> Self {
        match values {
            ColumnValues::Number(_) | ColumnValues::Latitude(_) | ColumnValues::Longitude(_) => {
                Self::Numbers
            }
            ColumnValues::Text(_) => Self::Texts,
            ColumnValues::Category(categorical) | ColumnValues::Country(categorical) => {
                Self::Groups(categorical.levels().len())
            }
        }
    }
}

impl Condition {
    /// Whether it fits a column of `searched`, or any column for `None`.
    pub(crate) fn fits(&self, searched: Option<Searched>) -> bool {
        match (self, searched) {
            (Self::Missing {}, _)
            | (Self::Contains { .. }, None | Some(Searched::Texts | Searched::Groups(_)))
            | (Self::Is { .. }, None | Some(Searched::Texts))
            | (Self::Compare { .. }, Some(Searched::Numbers)) => true,
            (Self::Group { code }, Some(Searched::Groups(levels))) => {
                code.is_none_or(|code| usize::from(code.get()) < levels)
            }
            (Self::Contains { .. } | Self::Is { .. }, Some(Searched::Numbers))
            | (Self::Is { .. }, Some(Searched::Groups(_)))
            | (Self::Group { .. }, None | Some(Searched::Texts | Searched::Numbers))
            | (Self::Compare { .. }, None | Some(Searched::Texts | Searched::Groups(_))) => false,
        }
    }

    /// The first operator of a column of `searched`, or of any column for
    /// `None`, with no value: "=" for numbers, "contains" for the others.
    pub(crate) fn first_of(searched: Option<Searched>) -> Self {
        match searched {
            Some(Searched::Numbers) => Self::Compare {
                comparison: Comparison::Equal,
                text: String::new(),
            },
            None | Some(Searched::Texts | Searched::Groups(_)) => Self::Contains {
                text: String::new(),
            },
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
    /// The new names of the individuals, the first column.
    Names(&'a [String]),
}

/// What the column searched of `filter` is, with `replaced` in the place of
/// what it replaces; `None` for any column.
///
/// # Errors
///
/// `UnknownColumn` for a column the table does not have.
fn searched_of(
    filter: &Filter,
    table: &Table,
    replaced: Option<Replaced<'_>>,
) -> Result<Option<Searched>, CommandError> {
    let Some(column) = filter.column else {
        return Ok(None);
    };
    if column == table.names().id() {
        return Ok(Some(Searched::Texts));
    }
    if let Some(Replaced::Values(replaced, values)) = replaced
        && replaced == column
    {
        return Ok(Some(Searched::of(values)));
    }
    let found = table
        .column(column)
        .ok_or(CommandError::UnknownColumn { column })?;
    Ok(Some(Searched::of(found.values())))
}

/// Whether `filter` fits its column of `table` as it is.
///
/// # Errors
///
/// `UnknownColumn` for a column the table does not have.
pub(crate) fn fits(filter: &Filter, table: &Table) -> Result<bool, CommandError> {
    Ok(filter.condition.fits(searched_of(filter, table, None)?))
}

/// A column whose groups are renumbered, and the new code of each, `None`
/// for a group deleted.
pub(crate) type MovedCodes<'a> = (ColumnId, &'a dyn Fn(LevelCode) -> Option<LevelCode>);

/// `filter` as an edit with `replaced` leaves it: its group moved to its
/// new code by `moved`, when the groups of `moved`'s column are renumbered,
/// and cleared to the column's first operator with no value when it no
/// longer fits its column, a group deleted or the column of another role
/// (`docs/design.md`, section 2.1).
///
/// # Errors
///
/// `UnknownColumn` for a column the table does not have.
pub(crate) fn fitted(
    filter: &Filter,
    table: &Table,
    replaced: Option<Replaced<'_>>,
    moved: Option<MovedCodes<'_>>,
) -> Result<Filter, CommandError> {
    let searched = searched_of(filter, table, replaced)?;
    let condition = match (&filter.condition, moved) {
        (Condition::Group { code: Some(code) }, Some((column, moved)))
            if filter.column == Some(column) =>
        {
            match moved(*code) {
                Some(code) => Condition::Group { code: Some(code) },
                None => Condition::first_of(searched),
            }
        }
        (condition, _) => condition.clone(),
    };
    let condition = if condition.fits(searched) {
        condition
    } else {
        Condition::first_of(searched)
    };
    Ok(Filter {
        column: filter.column,
        condition,
        showing: filter.showing,
    })
}

/// The rows `filter` shows of `table`, in order, with `replaced` in the
/// place of what it replaces; `None` when it shows every row, with no
/// text, number or group, or a number it cannot read. A decimal number
/// matches a text by its text with `decimal_mark`, the one the window that
/// set the filter writes numbers with, read from `kept` where they are kept
/// for the column as it is; a comparison reads its number with it.
///
/// # Errors
///
/// `UnknownColumn` for a column the table does not have; a `Defect` for a
/// text with no decimal mark, a condition that does not fit its column, and
/// a column whose length is not the table's.
pub(crate) fn shown_rows(
    filter: &Filter,
    decimal_mark: Option<&str>,
    table: &Table,
    replaced: Option<Replaced<'_>>,
    kept: &texts::NumberTexts,
) -> Result<Option<Vec<RowIndex>>, CommandError> {
    let searched = searched_of(filter, table, replaced)?;
    if !filter.condition.fits(searched) {
        return Err(CommandError::Defect {
            what: format!(
                "a filter {:?} on column {:?}, which does not fit it",
                filter.condition, filter.column
            ),
        });
    }
    let num_rows = usize_from(table.num_rows());
    let matches = match &filter.condition {
        Condition::Contains { text } | Condition::Is { text } if text.is_empty() => {
            return Ok(None);
        }
        Condition::Contains { text } | Condition::Is { text } => {
            let decimal_mark = decimal_mark.ok_or_else(|| CommandError::Defect {
                what: "a filter with a text and no decimal mark".to_owned(),
            })?;
            let search = Search {
                // In the composed form of the table's texts (`crate::text`).
                text: nfc(text).to_lowercase(),
                cell: if matches!(filter.condition, Condition::Is { .. }) {
                    CellMatch::Whole
                } else {
                    CellMatch::Part
                },
                decimal_mark,
            };
            text_matches(filter.column, table, replaced, &search, kept)?
        }
        Condition::Group { code: None } => return Ok(None),
        Condition::Group { code: Some(code) } => {
            let codes = codes_of(searched_column(filter, table)?, replaced)?;
            codes.iter().map(|each| *each == Some(*code)).collect()
        }
        Condition::Compare { text, .. } if text.trim().is_empty() => return Ok(None),
        Condition::Compare { comparison, text } => {
            // Spaces around the number are left out, as a cell typed in does.
            let text = text.trim();
            let decimal_mark = decimal_mark.ok_or_else(|| CommandError::Defect {
                what: "a filter with a number and no decimal mark".to_owned(),
            })?;
            let Ok(number) = decimal_number(text, decimal_mark) else {
                return Ok(None);
            };
            let values = values_of(searched_column(filter, table)?, replaced);
            compared(values, *comparison, text, number)?
        }
        Condition::Missing {} => missing_matches(filter.column, table, replaced)?,
    };
    if matches.len() != num_rows {
        return Err(CommandError::Defect {
            what: format!(
                "a filter that matched {} rows of a table of {num_rows}",
                matches.len()
            ),
        });
    }
    let wanted = match filter.showing {
        Showing::Matching => true,
        Showing::NotMatching => false,
    };
    Ok(Some(
        (0..=u32::MAX)
            .zip(matches)
            .filter(|(_, matched)| *matched == wanted)
            .map(|(row, _)| RowIndex::new(row))
            .collect(),
    ))
}

/// The column of `filter`, which is one of the table's other than the IDs,
/// as a group or a comparison asks.
fn searched_column<'a>(filter: &Filter, table: &'a Table) -> Result<&'a Column, CommandError> {
    let column = filter.column.ok_or_else(|| CommandError::Defect {
        what: format!("a filter {:?} on any column", filter.condition),
    })?;
    table
        .column(column)
        .ok_or(CommandError::UnknownColumn { column })
}

/// The values of `column`, or those `replaced` gives it.
fn values_of<'a>(column: &'a Column, replaced: Option<Replaced<'a>>) -> &'a ColumnValues {
    match replaced {
        Some(Replaced::Values(replaced, values)) if replaced == column.id() => values,
        Some(Replaced::Values(..) | Replaced::Codes(..) | Replaced::Names(..)) | None => {
            column.values()
        }
    }
}

/// The codes of the category `column`, or those `replaced` gives it.
fn codes_of<'a>(
    column: &'a Column,
    replaced: Option<Replaced<'a>>,
) -> Result<&'a [Option<LevelCode>], CommandError> {
    if let Some(Replaced::Codes(replaced, codes)) = replaced
        && replaced == column.id()
    {
        return Ok(codes);
    }
    values_of(column, replaced)
        .categorical()
        .map(Categorical::codes)
        .ok_or_else(|| CommandError::Defect {
            what: format!("a filter by a group of column {}, no category", column.id()),
        })
}

/// Whether each row of `values`, a column of numbers, compares with the
/// number `text`, read as `number`, as `comparison` asks; a missing value
/// never does. A whole number compares exactly, past 2^53 too, where a
/// float holds no odd number: with the text read as a whole number when it
/// is one, else against the float exactly.
fn compared(
    values: &ColumnValues,
    comparison: Comparison,
    text: &str,
    number: f64,
) -> Result<Vec<bool>, CommandError> {
    let holds =
        |ordering: Option<Ordering>| ordering.is_some_and(|ordering| comparison.holds(ordering));
    let whole = text.parse::<i64>().ok();
    match values {
        ColumnValues::Number(numbers)
        | ColumnValues::Latitude(numbers)
        | ColumnValues::Longitude(numbers) => Ok(match numbers {
            Numbers::Integer(values) => values
                .iter()
                .map(|value| {
                    value.is_some_and(|value| {
                        holds(match whole {
                            Some(whole) => Some(value.cmp(&whole)),
                            None => whole_against(value, number),
                        })
                    })
                })
                .collect(),
            Numbers::Float(values) => values
                .iter()
                .map(|value| value.is_some_and(|value| holds(value.partial_cmp(&number))))
                .collect(),
        }),
        ColumnValues::Text(_) | ColumnValues::Category(_) | ColumnValues::Country(_) => {
            Err(CommandError::Defect {
                what: "a comparison of a column that holds no numbers".to_owned(),
            })
        }
    }
}

/// How the whole number `value` stands to the float `number`, exactly;
/// `None` for a number that is not one.
fn whole_against(value: i64, number: f64) -> Option<Ordering> {
    /// 2^63, the first float past every whole number of 64 bits.
    const PAST_I64: f64 = 9_223_372_036_854_775_808.0;
    if number.is_nan() {
        return None;
    }
    if number >= PAST_I64 {
        return Some(Ordering::Less);
    }
    if number < -PAST_I64 {
        return Some(Ordering::Greater);
    }
    let whole_part = number.trunc();
    #[expect(
        clippy::cast_possible_truncation,
        reason = "a float from -2^63 to below 2^63 with no fraction is a whole number of 64 bits"
    )]
    let truncated = whole_part as i64;
    Some(value.cmp(&truncated).then_with(|| {
        // The fraction the whole part leaves decides a tie.
        if number > whole_part {
            Ordering::Less
        } else if number < whole_part {
            Ordering::Greater
        } else {
            Ordering::Equal
        }
    }))
}

/// Whether each row of `values` is missing.
fn missing_of(values: &ColumnValues, replaced_codes: Option<&[Option<LevelCode>]>) -> Vec<bool> {
    match values {
        ColumnValues::Number(numbers)
        | ColumnValues::Latitude(numbers)
        | ColumnValues::Longitude(numbers) => match numbers {
            Numbers::Integer(values) => values.iter().map(Option::is_none).collect(),
            Numbers::Float(values) => values.iter().map(Option::is_none).collect(),
        },
        ColumnValues::Text(values) => values.iter().map(Option::is_none).collect(),
        ColumnValues::Category(categorical) | ColumnValues::Country(categorical) => replaced_codes
            .unwrap_or(categorical.codes())
            .iter()
            .map(Option::is_none)
            .collect(),
    }
}

/// Whether each row is missing in the column `column`, or in any for
/// `None`; the IDs are never missing.
fn missing_matches(
    column: Option<ColumnId>,
    table: &Table,
    replaced: Option<Replaced<'_>>,
) -> Result<Vec<bool>, CommandError> {
    let num_rows = usize_from(table.num_rows());
    let missing_in = |found: &Column| -> Vec<bool> {
        let codes = match replaced {
            Some(Replaced::Codes(replaced, codes)) if replaced == found.id() => Some(codes),
            Some(Replaced::Values(..) | Replaced::Codes(..) | Replaced::Names(..)) | None => None,
        };
        missing_of(values_of(found, replaced), codes)
    };
    match column {
        Some(column) if column == table.names().id() => Ok(vec![false; num_rows]),
        Some(column) => Ok(missing_in(
            table
                .column(column)
                .ok_or(CommandError::UnknownColumn { column })?,
        )),
        None => {
            let mut any = vec![false; num_rows];
            for found in table.columns() {
                let one = missing_in(found);
                if one.len() != num_rows {
                    return Err(length_defect(found.id(), one.len(), num_rows));
                }
                for (row, missing) in any.iter_mut().zip(one) {
                    *row |= missing;
                }
            }
            Ok(any)
        }
    }
}

/// Whether each row matches the text of `search` in the column `column`,
/// or in any for `None`, the IDs included.
fn text_matches(
    column: Option<ColumnId>,
    table: &Table,
    replaced: Option<Replaced<'_>>,
    search: &Search<'_>,
    kept: &texts::NumberTexts,
) -> Result<Vec<bool>, CommandError> {
    let names = table.names();
    let num_rows = usize_from(table.num_rows());
    let individuals = match replaced {
        Some(Replaced::Names(new)) => new,
        Some(Replaced::Values(..) | Replaced::Codes(..)) | None => names.names(),
    };
    match column {
        Some(column) if column == names.id() => Ok(texts(individuals.iter().map(Some), search)),
        Some(column) => {
            let found = table
                .column(column)
                .ok_or(CommandError::UnknownColumn { column })?;
            column_matches(found, replaced, search, kept)
        }
        None => {
            let mut any = texts(individuals.iter().map(Some), search);
            for column in table.columns() {
                let one = column_matches(column, replaced, search, kept)?;
                if one.len() != num_rows {
                    return Err(length_defect(column.id(), one.len(), num_rows));
                }
                for (row, matched) in any.iter_mut().zip(one) {
                    *row |= matched;
                }
            }
            Ok(any)
        }
    }
}

/// How the text must match a cell: as part of it, "contains", or as its
/// whole text, "is".
#[derive(Clone, Copy)]
enum CellMatch {
    Part,
    Whole,
}

/// The text searched for, in lower case, and how it must match.
struct Search<'a> {
    text: String,
    cell: CellMatch,
    decimal_mark: &'a str,
}

impl Search<'_> {
    /// Whether the text could be found in a number as the table writes it,
    /// whose characters are digits, the signs, the `e` of an exponent and
    /// the decimal mark, since a column holds only finite numbers: a text
    /// of any other character matches none, and the numbers need not be
    /// written, which take most of a search of every column.
    fn can_match_a_number(&self) -> bool {
        let mark = self.decimal_mark.to_lowercase();
        self.text
            .chars()
            .all(|char| char.is_ascii_digit() || "+-e".contains(char) || mark.contains(char))
    }

    /// Whether the cell whose shown text is `shown` matches.
    fn matches(&self, shown: &str) -> bool {
        self.matches_lower(&shown.to_lowercase())
    }

    /// Whether the cell whose shown text, in lower case, is `lower` matches.
    fn matches_lower(&self, lower: &str) -> bool {
        match self.cell {
            CellMatch::Part => lower.contains(&self.text),
            CellMatch::Whole => lower == self.text,
        }
    }
}

fn length_defect(column: ColumnId, len: usize, num_rows: usize) -> CommandError {
    CommandError::Defect {
        what: format!("column {column} has {len} values in a table of {num_rows} rows"),
    }
}

/// Whether each row of `column` matches, its decimal numbers read from
/// `kept` when they are kept for it as it is and nothing replaces it.
fn column_matches(
    column: &Column,
    replaced: Option<Replaced<'_>>,
    search: &Search<'_>,
    kept: &texts::NumberTexts,
) -> Result<Vec<bool>, CommandError> {
    let id = column.id();
    let values = column.values();
    match replaced {
        Some(Replaced::Values(replaced, new)) if replaced == id => {
            return values_matches(new, None, search);
        }
        Some(Replaced::Codes(replaced, codes)) if replaced == id => {
            return values_matches(values, Some(codes), search);
        }
        Some(Replaced::Values(..) | Replaced::Codes(..) | Replaced::Names(..)) | None => {}
    }
    if search.can_match_a_number()
        && let Some(texts) = kept.column(id, column.revision(), search.decimal_mark)
    {
        return texts
            .map(|text| Ok(text?.is_some_and(|text| search.matches_lower(text))))
            .collect();
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
        | ColumnValues::Longitude(numbers)
            if !search.can_match_a_number() =>
        {
            vec![
                false;
                match numbers {
                    Numbers::Integer(values) => values.len(),
                    Numbers::Float(values) => values.len(),
                }
            ]
        }
        ColumnValues::Number(numbers)
        | ColumnValues::Latitude(numbers)
        | ColumnValues::Longitude(numbers) => match numbers {
            Numbers::Integer(values) => values
                .iter()
                .map(|value| value.is_some_and(|value| search.matches(&value.to_string())))
                .collect(),
            Numbers::Float(values) => values
                .iter()
                .map(|value| match value {
                    Some(value) => Ok(search.matches(&number_text(*value, search.decimal_mark)?)),
                    None => Ok(false),
                })
                .collect::<Result<_, _>>()?,
        },
        ColumnValues::Text(values) => texts(values.iter().map(Option::as_ref), search),
        ColumnValues::Category(categorical) => {
            let levels = level_matches(categorical, search, Synonyms::None)?;
            by_code(&levels, codes.unwrap_or(categorical.codes()))?
        }
        ColumnValues::Country(categorical) => {
            let levels = level_matches(categorical, search, Synonyms::Countries)?;
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
fn level_matches(
    categorical: &Categorical,
    search: &Search<'_>,
    synonyms: Synonyms,
) -> Result<Vec<bool>, CommandError> {
    let shown: Vec<String> = match categorical.levels() {
        LevelValues::Integer(values) => values.iter().map(ToString::to_string).collect(),
        LevelValues::Float(values) => values
            .iter()
            .map(|value| number_text(*value, search.decimal_mark))
            .collect::<Result<_, _>>()?,
        LevelValues::Boolean(values) => values
            .iter()
            .map(|value| if *value { "TRUE" } else { "FALSE" }.to_owned())
            .collect(),
        LevelValues::Text(values) => values.clone(),
    };
    Ok(shown
        .iter()
        .map(|level| {
            search.matches(level)
                || match synonyms {
                    Synonyms::None => false,
                    Synonyms::Countries => countries::names_of(level).any(|name| {
                        // An ISO code of two or three letters is compared
                        // whole, so that a one-letter text such as "j" does
                        // not find Benin by its code BJ.
                        if name.chars().count() <= 3 {
                            name == search.text
                        } else {
                            search.matches(name)
                        }
                    }),
                }
        })
        .collect())
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

/// A decimal number as the table writes it (`src/state/cellText.ts`), the
/// text JavaScript's `String(value)` gives, with `decimal_mark` in the
/// place of the point: the fewest digits that give back the value, and of
/// two such forms equally close to it, the one whose last digit is even.
/// JavaScript writes an exponent from 10^21 up and below 10^-6, as `1e+21`
/// and `1.5e-7`, and −0 as `0`.
///
/// # Errors
///
/// A `Defect` when Rust's own formatting of the value is not of the form
/// it always has.
pub(crate) fn number_text(value: f64, decimal_mark: &str) -> Result<String, CommandError> {
    let text = if value == 0.0 {
        "0".to_owned()
    } else if value.is_nan() {
        "NaN".to_owned()
    } else if value.is_infinite() {
        if value > 0.0 { "Infinity" } else { "-Infinity" }.to_owned()
    } else {
        let (digits, exponent) = shortest_digits(value)?;
        let sign = if value < 0.0 { "-" } else { "" };
        format!("{sign}{}", javascript_form(&digits, exponent)?)
    };
    Ok(text.replacen('.', decimal_mark, 1))
}

/// The decimal digits of the magnitude of a finite, nonzero `value` as
/// JavaScript chooses them, the first not zero, and the power of ten of
/// the first: 1.5 is ("15", 0).
fn shortest_digits(value: f64) -> Result<(String, i32), CommandError> {
    let magnitude = value.abs();
    // Rust gives the fewest digits that give back the value, but of two
    // such forms equally close to it it may give the odd one.
    let (digits, exponent) = scientific(&format!("{magnitude:e}"))?;
    let Some((head, last)) = digits
        .split_at_checked(digits.len().saturating_sub(1))
        .and_then(|(head, last)| Some((head, last.parse::<u8>().ok()?)))
    else {
        return Err(number_defect(value));
    };
    if last % 2 == 0 {
        return Ok((digits, exponent));
    }
    // The neighbours of an odd last digit, from 1 to 9, are even. One of
    // 0 would give back the value only if the form one digit shorter did,
    // which Rust would have given; one of 10 is not a digit.
    let below = (last > 1).then(|| format!("{head}{}", last.saturating_sub(1)));
    let above = (last < 9).then(|| format!("{head}{}", last.saturating_add(1)));
    // A neighbour is as close as Rust's digits when the value lies exactly
    // halfway, at the lower of the two followed by a 5.
    let candidates = [
        below.map(|below| (below.clone(), below)),
        above.map(|above| (above, digits.clone())),
    ];
    for (even, lower) in candidates.into_iter().flatten() {
        // The digits are read as "0.ddd", a power of ten above the first.
        let gives_back = format!("0.{even}e{}", exponent.saturating_add(1))
            .parse::<f64>()
            .is_ok_and(|other| other.to_bits() == magnitude.to_bits());
        // The exact digits, 800 of them, are written only for a neighbour
        // that gives back the value, which few do: written for every odd
        // digit, they took 80 ms of a search of a column of 50,000 decimal
        // numbers in a release build (2 October 2026).
        if gives_back && exact_digits(magnitude)? == (format!("{lower}5"), exponent) {
            return Ok((even, exponent));
        }
    }
    Ok((digits, exponent))
}

/// The digits of `magnitude` exactly, with no trailing zero, and the
/// power of ten of the first. A double has at most 767 significant
/// digits, so 800 after the first hold them all.
fn exact_digits(magnitude: f64) -> Result<(String, i32), CommandError> {
    let (digits, exponent) = scientific(&format!("{magnitude:.800e}"))?;
    Ok((digits.trim_end_matches('0').to_owned(), exponent))
}

/// The digits and the exponent of Rust's scientific form of a positive
/// number: `1.5e0` is ("15", 0), and `1.250e-3` is ("1250", -3).
fn scientific(text: &str) -> Result<(String, i32), CommandError> {
    let defect = || CommandError::Defect {
        what: format!("Rust wrote a number as {text}"),
    };
    let (mantissa, exponent) = text.split_once('e').ok_or_else(defect)?;
    let exponent = exponent.parse::<i32>().map_err(|_| defect())?;
    let digits: String = mantissa.chars().filter(|char| *char != '.').collect();
    if digits.is_empty()
        || digits.starts_with('0')
        || !digits.chars().all(|char| char.is_ascii_digit())
    {
        return Err(defect());
    }
    Ok((digits, exponent))
}

fn number_defect(value: f64) -> CommandError {
    CommandError::Defect {
        what: format!("the digits of the number {value:e}"),
    }
}

/// The text of the digits `digits` of a positive number whose first is at
/// the power of ten `exponent`, as ECMAScript's Number::toString writes
/// it, with k the number of digits and n the exponent plus one.
fn javascript_form(digits: &str, exponent: i32) -> Result<String, CommandError> {
    let defect = || CommandError::Defect {
        what: format!("the digits {digits} at the power {exponent}"),
    };
    let num_digits = i32::try_from(digits.len()).map_err(|_| defect())?;
    let point = exponent.checked_add(1).ok_or_else(defect)?;
    let zeros = |count: Option<i32>| {
        count
            .and_then(|count| usize::try_from(count).ok())
            .map(|count| "0".repeat(count))
            .ok_or_else(defect)
    };
    Ok(if num_digits <= point && point <= 21 {
        format!("{digits}{}", zeros(point.checked_sub(num_digits))?)
    } else if 0 < point && point <= 21 {
        let at = usize::try_from(point).map_err(|_| defect())?;
        let (whole, fraction) = digits.split_at_checked(at).ok_or_else(defect)?;
        format!("{whole}.{fraction}")
    } else if -6 < point && point <= 0 {
        format!("0.{}{digits}", zeros(point.checked_neg())?)
    } else {
        let sign = if exponent < 0 { '-' } else { '+' };
        let (first, rest) = digits.split_at_checked(1).ok_or_else(defect)?;
        let point = if rest.is_empty() { "" } else { "." };
        format!("{first}{point}{rest}e{sign}{}", exponent.unsigned_abs())
    })
}

#[cfg(test)]
mod tests;
