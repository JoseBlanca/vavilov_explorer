//! The undo and redo history of the document.

use crate::edit::Edit;

/// The edits that undo and redo the document's changes, the latest last.
/// Each is the reverse of an edit applied, ready to be applied itself.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct History {
    pub(crate) undo: Vec<Edit>,
    pub(crate) redo: Vec<Edit>,
}

/// Whether there is something to undo and something to redo, which the
/// menu and the windows show.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct UndoRedo {
    /// Whether there is an edit to undo.
    pub can_undo: bool,
    /// Whether there is an edit to redo.
    pub can_redo: bool,
}

/// What a change does to the history, with the reverse of the edit it
/// applies.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum HistoryStep {
    /// A new edit: its reverse goes on the undo history, and the redo
    /// history is cleared.
    Record(Edit),
    /// An undo: the edit undone leaves the undo history, and its reverse
    /// goes on the redo history.
    Undo(Edit),
    /// A redo: the edit redone leaves the redo history, and its reverse
    /// goes on the undo history.
    Redo(Edit),
}

impl History {
    /// Whether there is something to undo and to redo.
    pub(crate) fn undo_redo(&self) -> UndoRedo {
        UndoRedo {
            can_undo: !self.undo.is_empty(),
            can_redo: !self.redo.is_empty(),
        }
    }

    /// Whether there would be something to undo and to redo after `step`.
    pub(crate) fn after(&self, step: &HistoryStep) -> UndoRedo {
        match step {
            HistoryStep::Record(_) => UndoRedo {
                can_undo: true,
                can_redo: false,
            },
            HistoryStep::Undo(_) => UndoRedo {
                can_undo: self.undo.len() > 1,
                can_redo: true,
            },
            HistoryStep::Redo(_) => UndoRedo {
                can_undo: true,
                can_redo: self.redo.len() > 1,
            },
        }
    }

    /// Takes `step`. Nothing here can fail: the plan read the edit to
    /// undo or redo from the end of its history.
    pub(crate) fn take(&mut self, step: HistoryStep) {
        match step {
            HistoryStep::Record(reverse) => {
                self.undo.push(reverse);
                self.redo.clear();
            }
            HistoryStep::Undo(reverse) => {
                drop(self.undo.pop());
                self.redo.push(reverse);
            }
            HistoryStep::Redo(reverse) => {
                drop(self.redo.pop());
                self.undo.push(reverse);
            }
        }
    }
}
