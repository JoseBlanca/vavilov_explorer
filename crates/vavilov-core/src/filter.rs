//! The filter of the find bar above the table (`docs/design.md`, section
//! 2.1): a text searched for in one column or in any, and which rows of the
//! table it shows. A cell matches by the text the table shows of it, case
//! ignored and accents not; a cell of a country also by any of its ISO
//! names and codes; a missing cell never matches. The filter hides rows of
//! the table only, and is part of the interaction, not undone.

pub(crate) mod texts;

use serde::Deserialize;

use crate::convert::usize_from;
use crate::countries;
use crate::error::CommandError;
use crate::ids::{ColumnId, LevelCode, RowIndex};
use crate::table::{Categorical, Column, ColumnValues, LevelValues, Numbers, Table};
use crate::text::nfc;

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
pub enum Showing {
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
    /// The filter of a table just loaded: no text, any column, part of a
    /// cell and the matching rows, the defaults of the find bar (decided by
    /// the owner on 2 October 2026).
    #[must_use]
    pub fn none() -> Self {
        Self {
            text: String::new(),
            column: None,
            cell: CellMatch::Part,
            showing: Showing::Matching,
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

/// The rows `filter` shows of `table`, in order, with `replaced` in the
/// place of what it replaces; `None` when the filter has no text and shows
/// every row. A decimal number matches by its text with `decimal_mark`,
/// the one the window that set the filter writes numbers with, read from
/// `kept` where they are kept for the column as it is.
///
/// # Errors
///
/// `UnknownColumn` for a column the table does not have, with a text or
/// not; a `Defect` for a text with no decimal mark, and for a column whose
/// length is not the table's.
pub(crate) fn shown_rows(
    filter: &Filter,
    decimal_mark: Option<&str>,
    table: &Table,
    replaced: Option<Replaced<'_>>,
    kept: &texts::NumberTexts,
) -> Result<Option<Vec<RowIndex>>, CommandError> {
    let names = table.names();
    if let Some(column) = filter.column
        && column != names.id()
        && table.column(column).is_none()
    {
        return Err(CommandError::UnknownColumn { column });
    }
    if filter.text.is_empty() {
        return Ok(None);
    }
    let decimal_mark = decimal_mark.ok_or_else(|| CommandError::Defect {
        what: "a filter with a text and no decimal mark".to_owned(),
    })?;
    let search = Search {
        // In the composed form of the table's texts (`crate::text`).
        text: nfc(&filter.text).to_lowercase(),
        cell: filter.cell,
        decimal_mark,
    };
    let num_rows = usize_from(table.num_rows());
    let individuals = match replaced {
        Some(Replaced::Names(new)) => new,
        Some(Replaced::Values(..) | Replaced::Codes(..)) | None => names.names(),
    };
    let matches = match filter.column {
        Some(column) if column == names.id() => texts(individuals.iter().map(Some), &search),
        Some(column) => {
            let found = table
                .column(column)
                .ok_or(CommandError::UnknownColumn { column })?;
            column_matches(found, replaced, &search, kept)?
        }
        None => {
            let mut any = texts(individuals.iter().map(Some), &search);
            for column in table.columns() {
                let one = column_matches(column, replaced, &search, kept)?;
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
