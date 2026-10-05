//! The refusals of the app layer, about its windows, beside the core's
//! (`docs/design.md`, section 3). A command of the app returns an
//! [`AppError`], which crosses to a window as the core's errors do, its
//! kind and its fields in camelCase, so that the window reads both in one
//! table (`src/state/commandError.ts`).

use serde::Serialize;
use vavilov_core::{CommandError, WindowLabel};

use crate::widgets::WidgetId;

/// Why a command of the app was refused: by the core, about the data, or by
/// the app layer, about a window.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error, Serialize)]
#[serde(untagged)]
pub enum AppError {
    /// The core refused it, or met a defect.
    #[error(transparent)]
    Core(#[from] CommandError),
    /// The app layer refused it, about a window.
    #[error(transparent)]
    Window(#[from] WindowError),
}

/// What the app layer refuses about its windows.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum WindowError {
    /// A window subscribed or asked for its widgets with a label that is
    /// neither the main window nor an open window of widgets, as one closed
    /// before it subscribed; or the main window was sent an item of the
    /// menu before it subscribed.
    #[error("no window {label} is open")]
    UnknownWindow {
        /// The label the window gave, or the main window's.
        label: WindowLabel,
    },
    /// A window asked to forget a widget it does not hold: one it asked to
    /// forget a moment before, or another window's.
    #[error("window {label} holds no widget {widget}")]
    UnknownWidget {
        /// The window that asked.
        label: WindowLabel,
        /// The widget it gave.
        widget: WidgetId,
    },
    /// A window could not be opened or closed by the system.
    #[error("window {label} could not be opened or closed: {message}")]
    WindowFailed {
        /// The window's label.
        label: WindowLabel,
        /// The system's message, for the technical details.
        message: String,
        /// How many other widgets, opened while the window was being made,
        /// were to be drawn in it and were forgotten with it; 0 for a
        /// window that could not be closed.
        others_not_opened: u32,
    },
    /// A widget was added to the open window of its kind, which the system
    /// could not bring to the front: the widget is open, as a tile.
    #[error("window {label} could not be brought to the front: {message}")]
    WindowNotRaised {
        /// The window's label.
        label: WindowLabel,
        /// The system's message, for the technical details.
        message: String,
    },
    /// The open window of the widget's kind holds as many tiles as a
    /// window may, [`crate::widgets::MAX_TILES`]; nothing was opened.
    #[error("window {label} holds {most} widgets, as many as it may")]
    TooManyTiles {
        /// The window's label.
        label: WindowLabel,
        /// The most tiles a window holds.
        most: usize,
    },
    /// As many widgets drawn with WebGL are open, 3D scatters and maps, as
    /// the app allows, [`crate::widgets::MAX_WEBGL_VIEWS`]; nothing was
    /// opened.
    #[error("{most} widgets drawn with WebGL are open, as many as the app allows")]
    TooManyWebGlViews {
        /// The most widgets drawn with WebGL open at once.
        most: usize,
    },
}

/// A defect of the app layer, as the core's are written: a state the code
/// makes impossible, which the window reports as a defect of the app.
pub(crate) fn defect(what: &str) -> AppError {
    AppError::Core(CommandError::Defect {
        what: what.to_owned(),
    })
}

#[cfg(test)]
mod tests;
