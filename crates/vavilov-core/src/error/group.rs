//! Why the name of a new group was refused, as a window receives it
//! inside a `CommandError` (`docs/design.md`, section 2.1). A refused name
//! adds nothing.

use serde::Serialize;

use crate::ids::LevelCode;

/// Why a name typed for a new group of the active classification
/// does not fit it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum GroupRefusal {
    /// The name is empty, once the spaces around it are taken away.
    EmptyName,
    /// A group of the classification has this name already, or names
    /// the same number or country: `05` is the group 5, and `Spain`
    /// the group `ESP`.
    Taken {
        /// The code of that group.
        code: LevelCode,
    },
    /// A classification of whole numbers, and the name is not one, or one
    /// beyond the 64 bits of the column.
    NotWholeNumber,
    /// A classification of decimal numbers, and the name is not a finite
    /// one written with the decimal mark of the window's region.
    NotDecimalNumber {
        /// The decimal mark the window writes numbers with.
        decimal_mark: String,
    },
    /// A classification of countries, and the name names no country of
    /// ISO 3166.
    NotACountry,
    /// A classification of yes or no, and the name is neither `TRUE` nor
    /// `FALSE`, in any case.
    NotYesOrNo,
    /// A name of text longer than [`crate::MAX_GROUP_NAME`]
    /// characters.
    TooLong {
        /// [`crate::MAX_GROUP_NAME`].
        max_chars: u32,
    },
    /// A name with a control character, such as a line break or a mark
    /// that turns the text right to left.
    ControlCharacter,
    /// The classification has [`crate::MAX_LEVELS`] groups already.
    TooMany {
        /// [`crate::MAX_LEVELS`].
        max_levels: u32,
    },
}
