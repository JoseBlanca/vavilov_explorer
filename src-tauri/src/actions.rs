//! What the user chose in the app's menu, handed by the app layer to the
//! main window as a message of the kind action, so that the window sends
//! the command and shows its answer, a refusal among them, as it does for
//! a control of its own (`docs/core.md`, section 8). An action changes no
//! state, and takes no revision. The core knows nothing of the menu: the
//! app layer writes the message, and the session hands it to the window as
//! bytes it does not read (`docs/design.md`, section 3).

use vavilov_core::{Delivery, Dropped, Session, WindowLabel};

use crate::error::{AppError, WindowError};

/// An item of the menu that a window carries out.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MenuAction {
    /// File, Import table….
    ImportTable,
    /// File, Export as CSV….
    ExportCsv,
    /// File, Export as Excel….
    ExportXlsx,
    /// Edit, Undo.
    Undo,
    /// Edit, Redo.
    Redo,
    /// Plot, 3D scatter….
    Scatter3d,
    /// Plot, Map….
    Map,
    /// Plot, Map of countries….
    CountryMap,
    /// Plot, Histogram….
    Histogram,
    /// Edit, Select None.
    SelectNone,
    /// File, Open Example Table.
    OpenExample,
}

impl MenuAction {
    /// Its code in the action part of a message.
    pub const fn code(self) -> u16 {
        match self {
            Self::ImportTable => 1,
            Self::ExportCsv => 2,
            Self::ExportXlsx => 3,
            Self::Undo => 4,
            Self::Redo => 5,
            Self::Scatter3d => 6,
            Self::Map => 7,
            Self::CountryMap => 8,
            Self::Histogram => 9,
            Self::SelectNone => 10,
            Self::OpenExample => 11,
        }
    }

    /// Whether the main window shows something for it, a dialog or a
    /// message in its information bar, so that it is brought to the front
    /// when another window is (`docs/design.md`, section 2.2).
    #[must_use]
    pub const fn shows_in_main_window(self) -> bool {
        match self {
            Self::ImportTable
            | Self::ExportCsv
            | Self::ExportXlsx
            | Self::Scatter3d
            | Self::Map
            | Self::CountryMap
            | Self::Histogram
            | Self::OpenExample => true,
            Self::Undo | Self::Redo | Self::SelectNone => false,
        }
    }
}

/// The kind of a message of an action, its byte 0, after the core's
/// kinds of message 0 to 3 and 5 (`docs/core.md`, section 5).
const ACTION_MESSAGE: u8 = 4;
/// The kind of its one part.
const ACTION_PART: u16 = 12;

/// The message of `action`, with the core's header of 24 bytes, the
/// session's current revision `revision`, which takes no part in the order,
/// and no time; then one part of 8 bytes, the action's code as a `u16` and
/// six zero bytes, every number little-endian.
#[must_use]
pub fn action_message(revision: u64, action: MenuAction) -> Vec<u8> {
    let mut bytes = vec![ACTION_MESSAGE, 0, 0, 0, 0, 0, 0, 0];
    bytes.extend_from_slice(&revision.to_le_bytes());
    bytes.extend_from_slice(&[0; 8]);
    bytes.extend_from_slice(&ACTION_PART.to_le_bytes());
    bytes.extend_from_slice(&[0; 2]);
    bytes.extend_from_slice(&8_u32.to_le_bytes());
    bytes.extend_from_slice(&action.code().to_le_bytes());
    bytes.extend_from_slice(&[0; 6]);
    bytes
}

/// Sends `action` to the main window, as a message of the kind action at
/// the session's current revision; it changes nothing.
///
/// # Errors
///
/// `UnknownWindow` when the main window has not subscribed, as while it
/// is loading. A main window whose channel failed is removed and returned,
/// as the dispatcher returns it.
pub fn send_action(session: &mut Session, action: MenuAction) -> Result<Option<Dropped>, AppError> {
    let message = action_message(session.revision().get(), action);
    match session.send_to(&WindowLabel::main(), message) {
        Delivery::Sent => Ok(None),
        Delivery::Dropped(dropped) => Ok(Some(dropped)),
        Delivery::NoSubscriber => Err(WindowError::UnknownWindow {
            label: WindowLabel::main(),
        }
        .into()),
    }
}

#[cfg(test)]
mod tests;
