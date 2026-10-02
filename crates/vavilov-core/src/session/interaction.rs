//! The interaction: the state every window shares that is not undone.

use serde::{Deserialize, Serialize};

use crate::ids::{ColumnId, LevelCode, RowIndex};
use crate::row_set::RowSet;

/// What is selected for editing in the active classification: one of its
/// populations, or its unassigned individuals, which the populations panel
/// lists as one more row (`docs/design.md`, section 2.1).
///
/// It crosses to a window as `{"population": 2}` or `"unassigned"`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Selected {
    /// The population of this code.
    Population(LevelCode),
    /// The individuals of no population.
    Unassigned,
}

/// The active classification, the categorical column that colours every
/// view, and the population selected in it for editing, if any. They are
/// one value, so that a selected population cannot exist without the
/// classification it belongs to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Active {
    /// The column of the active classification.
    pub column: ColumnId,
    /// What is selected for editing, if anything.
    pub selected: Option<Selected>,
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
