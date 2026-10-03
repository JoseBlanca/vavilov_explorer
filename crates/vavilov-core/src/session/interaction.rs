//! The interaction: the state every window shares that is not undone.

use serde::{Deserialize, Serialize};

use crate::error::CommandError;
use crate::filter::Filter;
use crate::ids::{ColumnId, LevelCode, Revision, RowIndex};
use crate::row_set::RowSet;

/// One row of the groups panel: a group of the active classification, or
/// its unassigned individuals, which the panel lists as one more row
/// (`docs/design.md`, section 2.1).
///
/// It crosses to a window as `{"group": 2}` or `"unassigned"`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Selected {
    /// The group of this code.
    Group(LevelCode),
    /// The individuals of no group.
    Unassigned,
}

/// What happens to the individuals that enter the selection while a
/// group is selected for editing: the button + or − of the groups
/// panel, pressed (`docs/design.md`, section 2.1).
///
/// It crosses to a window as `"add"` or `"remove"`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EditMode {
    /// They go into what is selected: the group, or none for the
    /// unassigned individuals.
    Add,
    /// Those in the selected group become unassigned.
    Remove,
}

/// What is selected in the active classification: none, one or several
/// of its groups, and its unassigned individuals or not. Nothing selected
/// is every individual. The groups are kept in the order of their codes,
/// each once, so that two selections of the same rows are equal.
///
/// It crosses to a window as a list of [`Selected`].
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "Vec<Selected>", into = "Vec<Selected>")]
pub struct SelectedGroups {
    groups: Vec<LevelCode>,
    unassigned: bool,
}

impl SelectedGroups {
    /// Nothing selected.
    #[must_use]
    pub const fn none() -> Self {
        Self {
            groups: Vec::new(),
            unassigned: false,
        }
    }

    /// `selected` alone.
    #[must_use]
    pub fn one(selected: Selected) -> Self {
        match selected {
            Selected::Group(code) => Self {
                groups: vec![code],
                unassigned: false,
            },
            Selected::Unassigned => Self {
                groups: Vec::new(),
                unassigned: true,
            },
        }
    }

    /// The selection of `list`, in any order.
    ///
    /// # Errors
    ///
    /// A `Defect` when a row is in the list twice, which a window never
    /// sends.
    pub fn from_list(list: impl IntoIterator<Item = Selected>) -> Result<Self, CommandError> {
        let mut groups = Vec::new();
        let mut unassigned = false;
        let twice = |what: String| CommandError::Defect {
            what: format!("{what} selected twice"),
        };
        for selected in list {
            match selected {
                Selected::Group(code) => {
                    if groups.contains(&code) {
                        return Err(twice(format!("the group {code}")));
                    }
                    groups.push(code);
                }
                Selected::Unassigned => {
                    if unassigned {
                        return Err(twice("the unassigned individuals".to_owned()));
                    }
                    unassigned = true;
                }
            }
        }
        groups.sort_unstable();
        Ok(Self { groups, unassigned })
    }

    /// Whether nothing is selected, which is every individual.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.groups.is_empty() && !self.unassigned
    }

    /// The one row selected, when exactly one is: what + acts on.
    #[must_use]
    pub fn single(&self) -> Option<Selected> {
        match (self.groups.as_slice(), self.unassigned) {
            ([code], false) => Some(Selected::Group(*code)),
            ([], true) => Some(Selected::Unassigned),
            _ => None,
        }
    }

    /// The codes of the groups selected, in their order.
    #[must_use]
    pub fn groups(&self) -> &[LevelCode] {
        &self.groups
    }

    /// Whether the unassigned individuals are selected.
    #[must_use]
    pub const fn unassigned(&self) -> bool {
        self.unassigned
    }

    /// Whether an individual of `code`, `None` for an unassigned one, is in
    /// what is selected.
    #[must_use]
    pub fn holds(&self, code: Option<LevelCode>) -> bool {
        match code {
            Some(code) => self.groups.binary_search(&code).is_ok(),
            None => self.unassigned,
        }
    }

    /// The rows selected, each group in the order of its code and then the
    /// unassigned individuals.
    pub fn list(&self) -> impl Iterator<Item = Selected> + '_ {
        self.groups
            .iter()
            .copied()
            .map(Selected::Group)
            .chain(self.unassigned.then_some(Selected::Unassigned))
    }

    /// The selection once each code moves as `moved` says: a code it takes
    /// away leaves the selection. The order of the codes is kept, since a
    /// level inserted or deleted moves every code after it alike.
    pub(crate) fn moved(&self, moved: impl Fn(LevelCode) -> Option<LevelCode>) -> Self {
        Self {
            groups: self.groups.iter().copied().filter_map(moved).collect(),
            unassigned: self.unassigned,
        }
    }
}

impl TryFrom<Vec<Selected>> for SelectedGroups {
    type Error = CommandError;

    fn try_from(list: Vec<Selected>) -> Result<Self, CommandError> {
        Self::from_list(list)
    }
}

impl From<SelectedGroups> for Vec<Selected> {
    fn from(selected: SelectedGroups) -> Self {
        selected.list().collect()
    }
}

/// The active classification, the categorical column that colours every
/// view, what is selected in it, and the button pressed, if any. They are
/// one value, so that a selected group cannot exist without the
/// classification it belongs to.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Active {
    /// The column of the active classification.
    pub column: ColumnId,
    /// What is selected.
    pub selected: SelectedGroups,
    /// The button pressed, which the dispatcher keeps to what it can act
    /// on: + only with exactly one row selected, and − only with a group
    /// among them; `None` with nothing selected.
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
