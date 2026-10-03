//! Why a value typed in a cell of the table was refused, as a window
//! receives it inside a `CommandError` (`docs/design.md`, section 2.1). A
//! value must fit the column's storage type, which never changes, and the
//! check of its role; a refused value leaves every cell as it was.

use serde::Serialize;

/// Why a value typed in a cell does not fit its column.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum CellRefusal {
    /// A column of whole numbers, and the text is not one, or one beyond
    /// the 64 bits of the column.
    NotWholeNumber,
    /// A column of decimal numbers, and the text is not a finite one
    /// written with the decimal mark of the window's region.
    NotDecimalNumber {
        /// The decimal mark the window writes numbers with.
        decimal_mark: String,
    },
    /// A latitude out of −90 to 90.
    NotLatitude,
    /// A longitude out of −180 to 180.
    NotLongitude,
    /// A category of yes or no, and the text is neither `TRUE` nor `FALSE`.
    NotYesOrNo,
    /// A category of countries, and the text names no country of ISO 3166.
    NotACountry,
    /// A category, and the text is none of its values: a new population is
    /// made another way, not by typing it in a cell (decided by the owner on
    /// 3 October 2026).
    NotALevel,
    /// The first column, and the text is empty: every individual has an ID.
    EmptyId,
    /// The first column, and another individual has this ID.
    IdTaken,
}
