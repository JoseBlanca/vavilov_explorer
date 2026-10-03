//! The interaction: the state every window shares that is not undone.

use serde::{Deserialize, Serialize};

use crate::filter::Filter;
use crate::ids::{ColumnId, LevelCode, Revision, RowIndex};
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

/// What happens to the individuals that enter the selection while a
/// population is selected for editing: the button + or − of the populations
/// panel, pressed (`docs/design.md`, section 2.1).
///
/// It crosses to a window as `"add"` or `"remove"`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EditMode {
    /// They go into what is selected: the population, or none for the
    /// unassigned individuals.
    Add,
    /// Those in the selected population become unassigned.
    Remove,
}

/// The active classification, the categorical column that colours every
/// view, the population selected in it for editing, if any, and the button
/// pressed on that population, if any. They are one value, so that a
/// selected population cannot exist without the classification it belongs
/// to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Active {
    /// The column of the active classification.
    pub column: ColumnId,
    /// What is selected for editing, if anything.
    pub selected: Option<Selected>,
    /// The button pressed: `None` whenever nothing is selected, and never
    /// `Remove` with the unassigned individuals selected, which the
    /// dispatcher keeps so.
    pub mode: Option<EditMode>,
}

/// The interaction tier of `docs/design.md`, section 3.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Interaction {
    pub(crate) active: Option<Active>,
    /// One bit per row of the table.
    pub(crate) selection: RowSet,
    /// The individual under the pointer.
    pub(crate) hover: Option<RowIndex>,
    /// The filter of the find bar.
    pub(crate) filter: Filter,
    /// The decimal mark the last filter was set with, which an edit finds
    /// the rows shown with; `None` after a load, until a filter is set.
    pub(crate) decimal_mark: Option<String>,
    /// The rows the table shows.
    pub(crate) shown: Shown,
}

/// The rows the filter shows, and the revision at which they last
/// changed, which a page of rows carries, so that a window tells a page
/// of rows shown before from one of the rows shown now.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Shown {
    /// The rows shown, in order, or `None` for every row.
    pub(crate) rows: Option<Vec<RowIndex>>,
    /// The revision at which they last changed: the load, a change of the
    /// filter, or an edit that changed which rows match.
    pub(crate) at: Revision,
}
