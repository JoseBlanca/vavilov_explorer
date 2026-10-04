//! The session: the one owner of the state that more than one window
//! needs (`docs/core.md`, section 3).

mod history;
mod interaction;
mod subscribers;

pub use history::UndoRedo;
pub use interaction::{Active, EditMode, Selected, SelectedGroups};
pub use subscribers::{SendFailed, Subscriber};

pub(crate) use history::{History, HistoryStep};
pub(crate) use interaction::{Interaction, Shown};
pub(crate) use subscribers::Subscribers;

use crate::dispatch::Dropped;
use crate::error::CommandError;
use crate::filter::texts::NumberTexts;
use crate::ids::{HoverSeq, Revision, RowIndex, WindowLabel};
use crate::message::{MessageKind, whole_state};
use crate::row_set::RowSet;
use crate::table::Table;

/// What became of bytes sent to one subscriber with [`Session::send_to`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Delivery {
    /// They were handed to the subscriber.
    Sent,
    /// No subscriber has that name, as a window that has not subscribed yet.
    NoSubscriber,
    /// The subscriber failed, and was removed: the caller reports it, as
    /// the dispatcher's caller reports a window dropped.
    Dropped(Dropped),
}

/// The session of the app. The app holds it once, behind a lock, and
/// every change goes through [`Session::dispatch`].
pub struct Session {
    pub(crate) state: SharedState,
    pub(crate) subscribers: Subscribers,
}

/// Everything the session holds but the subscribers, in one value, so
/// that a test can compare all of it before and after a refused command.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct SharedState {
    pub(crate) project: Project,
    pub(crate) revision: Revision,
    pub(crate) hover_seq: HoverSeq,
    /// The revision at which the current table was loaded: a command made
    /// before it is refused.
    pub(crate) loaded_at: Revision,
}

/// Whether a project is open.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Project {
    None,
    Open(Box<OpenProject>),
}

/// An open project: the document, its history and the interaction, all
/// replaced together when another table is loaded.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct OpenProject {
    pub(crate) table: Table,
    /// The revision at which the columns, their names or their roles last
    /// changed: the load, or a change of role. A window asks for the
    /// description of the table again when it grows.
    pub(crate) shape_at: Revision,
    pub(crate) history: History,
    pub(crate) interaction: Interaction,
    /// The texts of the table's decimal numbers as a search reads them,
    /// kept between searches; written from the table, and equal to any
    /// other, so that a test that compares a session before and after a
    /// command compares what the session holds.
    pub(crate) number_texts: NumberTexts,
}

impl Project {
    pub(crate) const fn as_open(&self) -> Option<&OpenProject> {
        match self {
            Self::Open(open) => Some(open),
            Self::None => None,
        }
    }

    pub(crate) fn open(&self) -> Result<&OpenProject, CommandError> {
        match self {
            Self::Open(open) => Ok(open),
            Self::None => Err(CommandError::NoProject),
        }
    }

    pub(crate) fn open_mut(&mut self) -> Result<&mut OpenProject, CommandError> {
        match self {
            Self::Open(open) => Ok(open),
            Self::None => Err(CommandError::NoProject),
        }
    }
}

impl Default for Session {
    fn default() -> Self {
        Self::new()
    }
}

impl Session {
    /// A session with no project open, at revision 0.
    #[must_use]
    pub fn new() -> Self {
        Self {
            state: SharedState {
                project: Project::None,
                revision: Revision::ZERO,
                hover_seq: HoverSeq::ZERO,
                loaded_at: Revision::ZERO,
            },
            subscribers: Subscribers::default(),
        }
    }

    /// Registers the window's subscriber and returns the snapshot of the
    /// shared state at the current revision, in one call, so that no change
    /// falls between the two: the subscriber receives every change after
    /// the snapshot's revision. A window that subscribes again replaces its
    /// subscriber. The label names the subscriber and is not read: which
    /// windows may subscribe is the app layer's (`docs/design.md`, section
    /// 3).
    ///
    /// # Errors
    ///
    /// A `Defect` when the snapshot cannot be encoded.
    pub fn subscribe(
        &mut self,
        label: WindowLabel,
        subscriber: Box<dyn Subscriber>,
    ) -> Result<Vec<u8>, CommandError> {
        let state = &self.state;
        let snapshot = whole_state(
            MessageKind::Snapshot,
            state.revision,
            None,
            state.project.as_open(),
            state.loaded_at,
            state.hover_seq,
        )?;
        self.subscribers.register(label, subscriber);
        Ok(snapshot)
    }

    /// Sends `message`, bytes the core does not read, to the subscriber
    /// `label` alone, as the app layer sends a window an item of the menu
    /// or its list of widgets (`docs/core.md`, section 7). It changes
    /// nothing in the session; a subscriber that fails is removed, as the
    /// dispatcher removes one.
    pub fn send_to(&mut self, label: &WindowLabel, message: Vec<u8>) -> Delivery {
        match self.subscribers.send_to(label, &message) {
            None => Delivery::NoSubscriber,
            Some(None) => Delivery::Sent,
            Some(Some(reason)) => Delivery::Dropped(Dropped {
                label: label.clone(),
                reason,
            }),
        }
    }

    /// Forgets the subscriber `label`, whose window was closed; nothing for
    /// a label that has none.
    pub fn unsubscribe(&mut self, label: &WindowLabel) {
        self.subscribers.unregister(label);
    }

    /// The current revision.
    #[must_use]
    pub const fn revision(&self) -> Revision {
        self.state.revision
    }

    /// The table, when a project is open.
    #[must_use]
    pub fn table(&self) -> Option<&Table> {
        self.state.project.as_open().map(|open| &open.table)
    }

    /// The active classification and the selected group.
    #[must_use]
    pub fn active(&self) -> Option<Active> {
        self.state
            .project
            .as_open()
            .and_then(|open| open.interaction.active.clone())
    }

    /// The selection, when a project is open.
    #[must_use]
    pub fn selection(&self) -> Option<&RowSet> {
        self.state
            .project
            .as_open()
            .map(|open| &open.interaction.selection)
    }

    /// The individual under the pointer.
    #[must_use]
    pub fn hover(&self) -> Option<RowIndex> {
        self.state
            .project
            .as_open()
            .and_then(|open| open.interaction.hover)
    }

    /// Whether there is something to undo and something to redo; nothing
    /// when no project is open.
    #[must_use]
    pub fn undo_redo(&self) -> UndoRedo {
        self.state.project.as_open().map_or(
            UndoRedo {
                can_undo: false,
                can_redo: false,
            },
            |open| open.history.undo_redo(),
        )
    }
}

#[cfg(test)]
mod tests;
