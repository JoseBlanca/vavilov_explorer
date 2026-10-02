//! The interaction: the state every window shares that is not undone.

use crate::ids::{ColumnId, LevelCode, RowIndex};
use crate::row_set::RowSet;

/// The active classification, the categorical column that colours every
/// view, and the population selected in it for editing, if any. They are
/// one value, so that a selected population cannot exist without the
/// classification it belongs to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Active {
    /// The column of the active classification.
    pub column: ColumnId,
    /// The code of the selected population.
    pub selected: Option<LevelCode>,
}

/// The interaction tier of `docs/design.md`, section 3.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Interaction {
    pub(crate) active: Option<Active>,
    /// One bit per row of the table.
    pub(crate) selection: RowSet,
    /// The individual under the pointer.
    pub(crate) hover: Option<RowIndex>,
}
