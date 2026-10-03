//! The widgets: windows that each show one view of some columns, which
//! the session keeps open, and the trait through which a caller opens and
//! closes their windows (`docs/core.md`, section 7).
//!
//! The session gives each widget its label and keeps it while its window
//! is open; it never opens or closes a window itself. Opening a widget
//! returns the label for the caller to open, and a command that leaves a
//! widget with a column it cannot show returns the labels to close, so
//! that the caller does both once it has released the session's lock.

use serde::{Deserialize, Serialize};

use crate::error::CommandError;
use crate::ids::{ColumnId, Revision, WindowLabel};
use crate::session::Session;
use crate::table::Table;

/// What a widget shows: its kind and its columns.
///
/// It crosses to a window as `{"kind": "scatter3d", "axes": [4, 5, 6]}`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum WidgetSpec {
    /// A 3D scatter of three numeric columns, on its x, y and z axes, in
    /// that order; a column may be on more than one axis.
    Scatter3d {
        /// The columns on the x, y and z axes.
        axes: [ColumnId; 3],
    },
}

impl WidgetSpec {
    /// The start of the labels of the widget's kind, before its number.
    const fn label_prefix(&self) -> &'static str {
        match self {
            Self::Scatter3d { .. } => "scatter3d",
        }
    }

    /// The columns the widget shows.
    fn columns(&self) -> &[ColumnId] {
        match self {
            Self::Scatter3d { axes } => axes,
        }
    }

    /// Whether the table has every column the widget shows, each of a role
    /// it can show.
    ///
    /// # Errors
    ///
    /// `UnknownColumn` for a column the table does not have, and
    /// `NotNumber` for one that is not a number, a latitude or a longitude.
    fn check(&self, table: &Table) -> Result<(), CommandError> {
        for column in self.columns() {
            let found = table
                .column(*column)
                .ok_or(CommandError::UnknownColumn { column: *column })?;
            if found.values().numbers().is_none() {
                return Err(CommandError::NotNumber { column: *column });
            }
        }
        Ok(())
    }
}

/// An open widget: the label of its window, and what it shows.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Widget {
    pub(crate) label: WindowLabel,
    pub(crate) spec: WidgetSpec,
}

/// How a caller opens and closes the windows of the widgets: the app with
/// Tauri's windows, the test program of the e2e harness by asking the
/// harness for a page. It is called once the session's lock is released,
/// since a new window subscribes as it starts, which takes the lock, and
/// since Tauri cannot create a window from a synchronous command on
/// Windows (`docs/core.md`, section 7).
pub trait WindowHost {
    /// Opens the window of the widget `label`, which shows `widget`.
    ///
    /// # Errors
    ///
    /// `WindowFailed`, with the system's message, when the window could not
    /// be made; the caller then tells the session with
    /// [`Session::window_closed`].
    fn open(&mut self, label: &WindowLabel, widget: &WidgetSpec) -> Result<(), CommandError>;

    /// Closes the window `label`.
    ///
    /// # Errors
    ///
    /// `WindowFailed`, with the system's message, when the window could not
    /// be closed.
    fn close(&mut self, label: &WindowLabel) -> Result<(), CommandError>;
}

impl Session {
    /// Adds a widget that shows `spec`, made from a window's copy at
    /// `based_on`, and returns the label of its window, for the caller to
    /// open: the kind and the next number of a counter that only grows,
    /// `scatter3d-1`, so that a label is never given twice. It takes no
    /// revision and sends no message: no window's copy holds the widgets.
    ///
    /// # Errors
    ///
    /// `MadeBeforeLoad`, `NoProject`, `UnknownColumn`, `NotNumber`, or a
    /// `Defect` when the counter would pass `u32::MAX`.
    pub fn open_widget(
        &mut self,
        spec: WidgetSpec,
        based_on: Revision,
    ) -> Result<WindowLabel, CommandError> {
        self.check_based_on(based_on)?;
        let open = self.state.project.open()?;
        spec.check(&open.table)?;
        let number =
            self.state
                .widgets_given
                .checked_add(1)
                .ok_or_else(|| CommandError::Defect {
                    what: "more widgets than a u32 counts".to_owned(),
                })?;
        let label = WindowLabel::new(format!("{}-{number}", spec.label_prefix()));
        self.state.project.open_mut()?.widgets.push(Widget {
            label: label.clone(),
            spec,
        });
        self.state.widgets_given = number;
        Ok(label)
    }

    /// What the widget `label` shows, or `None` when no widget of that
    /// label is open.
    #[must_use]
    pub fn widget(&self, label: &WindowLabel) -> Option<&WidgetSpec> {
        self.state.project.as_open().and_then(|open| {
            open.widgets
                .iter()
                .find(|widget| widget.label == *label)
                .map(|widget| &widget.spec)
        })
    }

    /// Forgets the window `label`, which was closed or could not be
    /// opened: its subscriber, and its widget when it is one.
    pub fn window_closed(&mut self, label: &WindowLabel) {
        self.subscribers.unregister(label);
        if let Some(open) = self.state.project.as_open_mut() {
            open.widgets.retain(|widget| widget.label != *label);
        }
    }

    /// Removes the widgets that the table can no longer show, those that
    /// were open before a load among them, and their subscribers, and
    /// returns their labels for the caller to close. `before` is the
    /// labels of the widgets open before the command.
    pub(crate) fn drop_unfit_widgets(&mut self, before: Vec<WindowLabel>) -> Vec<WindowLabel> {
        if let Some(open) = self.state.project.as_open_mut() {
            let table = &open.table;
            open.widgets
                .retain(|widget| widget.spec.check(table).is_ok());
        }
        let kept = self.widget_labels();
        let closed: Vec<WindowLabel> = before
            .into_iter()
            .filter(|label| !kept.contains(label))
            .collect();
        for label in &closed {
            self.subscribers.unregister(label);
        }
        closed
    }

    /// The labels of the open widgets.
    pub(crate) fn widget_labels(&self) -> Vec<WindowLabel> {
        self.state.project.as_open().map_or_else(Vec::new, |open| {
            open.widgets
                .iter()
                .map(|widget| widget.label.clone())
                .collect()
        })
    }
}

#[cfg(test)]
mod tests;
