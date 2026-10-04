//! What a text typed in a cell of the table gives for its column
//! (`docs/design.md`, section 2.1): a value of the column's storage type,
//! which never changes, that passes the check of its role, or a value of
//! a category; an empty text is a missing value. The first column, the
//! names of the individuals, is read by [`name_of`], and the name of a new
//! group by [`new_level`].

use crate::convert::usize_from;
use crate::countries::country_code;
use crate::edit::CellValue;
use crate::error::{CellRefusal, GroupRefusal};
use crate::ids::LevelCode;
use crate::table::{
    Categorical, ColumnValues, LATITUDE, LONGITUDE, Level, LevelValues, MAX_GROUP_NAME, Numbers,
    Role,
};

/// What a text typed gives for a column other than the first.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Typed {
    /// The value of a cell of a column of numbers or text.
    Value(CellValue),
    /// The code of a category's value, `None` for a missing value.
    Code(Option<LevelCode>),
}

/// What `text` gives for a column of `values`, a decimal number read with
/// `decimal_mark`. Spaces around a number, a yes or no, a value of a
/// category and a country are ignored; a text is taken as typed. An empty
/// text, once those spaces are taken away, is a missing value.
///
/// # Errors
///
/// The refusal of a text that does not fit: not a whole number, not a
/// decimal number with the window's decimal mark, a latitude or a
/// longitude out of its range, neither `TRUE` nor `FALSE`, no country,
/// or none of a category's values.
pub(crate) fn typed(
    values: &ColumnValues,
    text: &str,
    decimal_mark: &str,
) -> Result<Typed, CellRefusal> {
    let trimmed = text.trim();
    match values {
        ColumnValues::Number(numbers) => number(numbers, trimmed, decimal_mark).map(Typed::Value),
        ColumnValues::Latitude(numbers) => in_range(
            number(numbers, trimmed, decimal_mark)?,
            &LATITUDE,
            CellRefusal::NotLatitude,
        ),
        ColumnValues::Longitude(numbers) => in_range(
            number(numbers, trimmed, decimal_mark)?,
            &LONGITUDE,
            CellRefusal::NotLongitude,
        ),
        ColumnValues::Text(_) => Ok(Typed::Value(CellValue::Text(
            (!text.is_empty()).then(|| text.to_owned()),
        ))),
        ColumnValues::Category(categorical) => {
            level(categorical, trimmed, decimal_mark).map(Typed::Code)
        }
        ColumnValues::Country(categorical) => {
            if trimmed.is_empty() {
                return Ok(Typed::Code(None));
            }
            let code = country_code(trimmed).ok_or(CellRefusal::NotACountry)?;
            level(categorical, code, decimal_mark).map(Typed::Code)
        }
    }
}

/// The name `text` gives the individual of `row` among `names`, the first
/// column's, taken as typed.
///
/// # Errors
///
/// `EmptyId` for an empty text, and `IdTaken` for the name of another
/// individual.
pub(crate) fn name_of(names: &[String], row: usize, text: &str) -> Result<String, CellRefusal> {
    if text.is_empty() {
        return Err(CellRefusal::EmptyId);
    }
    let taken = names
        .iter()
        .enumerate()
        .any(|(other, name)| other != row && name == text);
    if taken {
        return Err(CellRefusal::IdTaken);
    }
    Ok(text.to_owned())
}

/// The level `text` names for a new group of `categorical`, of the
/// role `role`, a decimal number read with `decimal_mark`: spaces around
/// it are ignored, a country is its code, `TRUE` or `FALSE` in any case is
/// yes or no, and −0 is 0. Whether the category has that level already is
/// the caller's to check.
///
/// # Errors
///
/// The refusal of a name that is empty, has a control character, is not of
/// the column's storage type, or, in a category of countries, is no
/// country; and of a name of text longer than [`MAX_GROUP_NAME`]
/// characters.
pub(crate) fn new_level(
    categorical: &Categorical,
    role: Role,
    text: &str,
    decimal_mark: &str,
) -> Result<Level, GroupRefusal> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(GroupRefusal::EmptyName);
    }
    if trimmed.chars().any(is_control) {
        return Err(GroupRefusal::ControlCharacter);
    }
    match categorical.levels() {
        LevelValues::Boolean(_) => yes_or_no(trimmed)
            .map(Level::Boolean)
            .ok_or(GroupRefusal::NotYesOrNo),
        LevelValues::Integer(_) => whole_number(trimmed)
            .map(Level::Integer)
            .map_err(|_| GroupRefusal::NotWholeNumber),
        LevelValues::Float(_) => decimal_number(trimmed, decimal_mark)
            .map(|value| Level::Float(if value == 0.0 { 0.0 } else { value }))
            .map_err(|_| GroupRefusal::NotDecimalNumber {
                decimal_mark: decimal_mark.to_owned(),
            }),
        LevelValues::Text(_) if role == Role::Country => country_code(trimmed)
            .map(|code| Level::Text(code.to_owned()))
            .ok_or(GroupRefusal::NotACountry),
        LevelValues::Text(_) => {
            if trimmed.chars().count() > usize_from(MAX_GROUP_NAME) {
                return Err(GroupRefusal::TooLong {
                    max_chars: MAX_GROUP_NAME,
                });
            }
            Ok(Level::Text(trimmed.to_owned()))
        }
    }
}

/// Whether `c` is a control character, such as a line break or a tab, or
/// one of the marks that set the direction of the text, which would show
/// the name otherwise than it is kept.
fn is_control(c: char) -> bool {
    c.is_control()
        || matches!(
            c,
            '\u{200e}' | '\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}'
        )
}

/// Yes or no, from `TRUE` or `FALSE` in any case.
fn yes_or_no(text: &str) -> Option<bool> {
    if text.eq_ignore_ascii_case("TRUE") {
        Some(true)
    } else if text.eq_ignore_ascii_case("FALSE") {
        Some(false)
    } else {
        None
    }
}

/// A whole or a decimal number, as the column holds them, or missing.
fn number(numbers: &Numbers, text: &str, decimal_mark: &str) -> Result<CellValue, CellRefusal> {
    match numbers {
        Numbers::Integer(_) => whole(text).map(CellValue::Integer),
        Numbers::Float(_) => decimal(text, decimal_mark).map(CellValue::Float),
    }
}

/// A whole number of 64 bits, or `None` for an empty text.
fn whole(text: &str) -> Result<Option<i64>, CellRefusal> {
    if text.is_empty() {
        return Ok(None);
    }
    whole_number(text).map(Some)
}

/// A whole number of 64 bits, from a text that is not empty.
fn whole_number(text: &str) -> Result<i64, CellRefusal> {
    text.parse::<i64>().map_err(|_| CellRefusal::NotWholeNumber)
}

/// A finite decimal number written with `decimal_mark`, or `None` for an
/// empty text. A point is refused where the mark is another, so that
/// `1.500` typed in Spain is not taken for one and a half.
fn decimal(text: &str, decimal_mark: &str) -> Result<Option<f64>, CellRefusal> {
    if text.is_empty() {
        return Ok(None);
    }
    decimal_number(text, decimal_mark).map(Some)
}

/// A finite decimal number written with `decimal_mark`, from a text that
/// is not empty.
pub(crate) fn decimal_number(text: &str, decimal_mark: &str) -> Result<f64, CellRefusal> {
    let refused = || CellRefusal::NotDecimalNumber {
        decimal_mark: decimal_mark.to_owned(),
    };
    if decimal_mark != "." && text.contains('.') {
        return Err(refused());
    }
    let value = text
        .replacen(decimal_mark, ".", 1)
        .parse::<f64>()
        .map_err(|_| refused())?;
    if !value.is_finite() {
        return Err(refused());
    }
    Ok(value)
}

/// `value` when it is missing or inside `range`; `refusal` otherwise.
fn in_range(
    value: CellValue,
    range: &std::ops::RangeInclusive<f64>,
    refusal: CellRefusal,
) -> Result<Typed, CellRefusal> {
    let inside = match &value {
        CellValue::Integer(number) => number.is_none_or(|number| {
            i32::try_from(number).is_ok_and(|number| range.contains(&f64::from(number)))
        }),
        CellValue::Float(number) => number.is_none_or(|number| range.contains(&number)),
        CellValue::Text(_) => false,
    };
    if inside {
        Ok(Typed::Value(value))
    } else {
        Err(refusal)
    }
}

/// The code of the value of `categorical` that `text` names, or `None` for
/// an empty text: a number by its value, so that `05` is the level 5, a
/// yes or no by `TRUE` or `FALSE` in any case, a text exactly.
fn level(
    categorical: &Categorical,
    text: &str,
    decimal_mark: &str,
) -> Result<Option<LevelCode>, CellRefusal> {
    if text.is_empty() {
        return Ok(None);
    }
    // Codes counted from 0 with the levels, a closed range: a category has
    // at most MAX_LEVELS levels, each with its code.
    let code = |found: Option<usize>| {
        found
            .and_then(|index| (0..=u16::MAX).nth(index))
            .map(LevelCode::new)
    };
    let found = match categorical.levels() {
        LevelValues::Integer(levels) => {
            let wanted = whole(text)?;
            code(levels.iter().position(|level| Some(*level) == wanted))
        }
        LevelValues::Float(levels) => {
            // −0 and 0 are one level (docs/design.md, section 6).
            let bits = |value: f64| if value == 0.0 { 0.0_f64 } else { value }.to_bits();
            let wanted = decimal(text, decimal_mark)?.map(bits);
            code(levels.iter().position(|level| Some(bits(*level)) == wanted))
        }
        LevelValues::Boolean(levels) => {
            let wanted = yes_or_no(text).ok_or(CellRefusal::NotYesOrNo)?;
            code(levels.iter().position(|level| *level == wanted))
        }
        LevelValues::Text(levels) => code(levels.iter().position(|level| level == text)),
    };
    found.map(Some).ok_or(CellRefusal::NotALevel)
}

#[cfg(test)]
mod tests;
