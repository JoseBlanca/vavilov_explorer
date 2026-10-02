//! What the user chose in the app's menu, handed by the backend to the
//! main window as a message of the kind action, so that the window sends
//! the command and shows its answer, a refusal among them, as it does for
//! a control of its own (`docs/core.md`, section 5). An action changes no
//! state, and takes no revision.

use crate::dispatch::Dropped;
use crate::error::CommandError;
use crate::ids::WindowLabel;
use crate::message::{MessageKind, MessageWriter};
use crate::session::Session;

/// An item of the menu that a window carries out.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MenuAction {
    /// File, Import table….
    ImportTable,
    /// File, Export as CSV….
    ExportCsv,
    /// File, Export as Excel….
    ExportXlsx,
}

impl MenuAction {
    /// Its code in the action part of a message.
    pub(crate) const fn code(self) -> u16 {
        match self {
            Self::ImportTable => 1,
            Self::ExportCsv => 2,
            Self::ExportXlsx => 3,
        }
    }
}

impl Session {
    /// Sends `action` to the window `label`, as a message of the kind
    /// action at the current revision; it changes nothing.
    ///
    /// # Errors
    ///
    /// `UnknownWindow` when no window of that label is subscribed, as
    /// while the main window is loading; a `Defect` when the message cannot
    /// be encoded. A window whose channel failed is removed and returned,
    /// as the dispatcher returns it.
    pub fn send_action(
        &mut self,
        label: &WindowLabel,
        action: MenuAction,
    ) -> Result<Option<Dropped>, CommandError> {
        let mut message = MessageWriter::new(MessageKind::Action, self.state.revision, None);
        message.action(action.code())?;
        self.subscribers
            .send_to(label, &message.finish())
            .ok_or_else(|| CommandError::UnknownWindow {
                label: label.clone(),
            })
            .map(|failed| {
                failed.map(|reason| Dropped {
                    label: label.clone(),
                    reason,
                })
            })
    }
}

#[cfg(test)]
mod tests;
