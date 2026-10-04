//! The widgets, the plots of some columns the user opened, and the windows
//! that show them: a 3D scatter alone in its own, the histograms together
//! as tiles of the Plots window, and the maps as tiles of the Maps window
//! (`docs/design.md`, sections 2.2 and 3).
//!
//! The core knows nothing of them: this module keeps which widgets are
//! open in which window, and the trait through which a caller opens,
//! brings forward and closes the windows. It does not depend on Tauri, so
//! that the test program of the e2e harness runs it too. Which column a
//! widget can show is the windows' rule: a window draws the widgets its
//! copy of the table can show and asks to forget the others.

use std::fmt;

use serde::{Deserialize, Serialize};
use vavilov_core::{ColumnId, MAX_EXACT_IN_JAVASCRIPT, WindowLabel};

use crate::error::{AppError, WindowError, defect};

/// The number of a widget, given when it is opened from a counter that
/// only grows, so that a number is never given twice.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct WidgetId(u32);

impl WidgetId {
    /// The widget with this number, which may not be open: a window's
    /// number is checked when a command uses it.
    #[must_use]
    pub const fn new(id: u32) -> Self {
        Self(id)
    }

    /// The number.
    #[must_use]
    pub const fn get(self) -> u32 {
        self.0
    }
}

impl fmt::Display for WidgetId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

/// What a widget shows: its kind and its columns.
///
/// The main window asks for it in `open_widget` as
/// `{"kind": "scatter3d", "axes": [4, 5, 6]}`,
/// `{"kind": "map", "latitude": 4, "longitude": 5}`,
/// `{"kind": "countryMap", "country": 3}` or
/// `{"kind": "histogram", "column": 4}`; a window receives it in its list,
/// in binary ([`WidgetList::to_bytes`]).
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
    /// A map of the individuals, each placed by its latitude and longitude.
    Map {
        /// The column of the latitudes.
        latitude: ColumnId,
        /// The column of the longitudes.
        longitude: ColumnId,
    },
    /// A map of the countries, each filled by how many individuals the
    /// column puts in it.
    CountryMap {
        /// The column of the countries.
        country: ColumnId,
    },
    /// A histogram of a numeric column, its bars stacked by group.
    Histogram {
        /// The column.
        column: ColumnId,
    },
}

impl WidgetSpec {
    /// The kind of window the widget is drawn in.
    #[must_use]
    pub const fn window_kind(&self) -> WindowKind {
        match self {
            Self::Scatter3d { .. } => WindowKind::Scatter3d,
            Self::Map { .. } | Self::CountryMap { .. } => WindowKind::Maps,
            Self::Histogram { .. } => WindowKind::Plots,
        }
    }

    /// The widget as a list carries it: the code of its kind, and its
    /// columns, `None` past those it has.
    const fn wire(&self) -> (u16, [Option<ColumnId>; 3]) {
        match self {
            Self::Scatter3d { axes: [x, y, z] } => (1, [Some(*x), Some(*y), Some(*z)]),
            Self::Map {
                latitude,
                longitude,
            } => (2, [Some(*latitude), Some(*longitude), None]),
            Self::CountryMap { country } => (3, [Some(*country), None, None]),
            Self::Histogram { column } => (4, [Some(*column), None, None]),
        }
    }
}

/// The kinds of window the widgets are drawn in (`docs/design.md`,
/// section 2.2): a 3D scatter in a window of its own, the histograms as
/// tiles of one Plots window, and the maps as tiles of one Maps window.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WindowKind {
    /// The window of one 3D scatter.
    Scatter3d,
    /// The Plots window, of every histogram.
    Plots,
    /// The Maps window, of every map of the individuals and of countries.
    Maps,
}

impl WindowKind {
    /// The start of the labels of its windows, before their number.
    #[must_use]
    pub const fn label_prefix(self) -> &'static str {
        match self {
            Self::Scatter3d => "scatter3d",
            Self::Plots => "plots",
            Self::Maps => "maps",
        }
    }

    /// Whether one window of the kind holds every widget of its kind, each
    /// in a tile, rather than one widget alone.
    const fn holds_many(self) -> bool {
        match self {
            Self::Plots | Self::Maps => true,
            Self::Scatter3d => false,
        }
    }
}

/// An open widget: its number, and what it shows.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Widget {
    /// Its number, given from a counter that only grows.
    pub id: WidgetId,
    /// What it shows.
    pub spec: WidgetSpec,
}

/// The widgets of a window, in the order they were opened, with a sequence
/// number that only grows, so that a window keeps the newest of a list it
/// asked for and one sent on its channel, which can arrive in either order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WidgetList {
    /// The sequence number of the list.
    pub seq: u64,
    /// The widgets.
    pub widgets: Vec<Widget>,
}

/// The first byte of a message of a window's list of widgets on its channel,
/// one of the kinds the core keeps for the app layer,
/// `vavilov_core::APP_MESSAGE_KINDS` (`docs/core.md`, section 5).
pub const WIDGETS_MESSAGE: u8 = 6;

/// A window of widgets: its label, its kind and its widgets.
struct WidgetWindow {
    label: WindowLabel,
    kind: WindowKind,
    widgets: Vec<Widget>,
}

/// A widget added by [`Widgets::open`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Opened {
    /// The label of its window.
    pub window: WindowLabel,
    /// Its number.
    pub widget: WidgetId,
    /// Whether it went into a new window or the open one of its kind.
    pub placed: Placed,
}

/// Where [`Widgets::open`] put a widget.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Placed {
    /// Into a new window, for the caller to open, which asks for its list
    /// as it starts.
    NewWindow,
    /// Into the open window of its kind, whose new list it gives, for the
    /// caller to send it and bring the window to the front.
    Added(WidgetList),
}

/// What closing a widget left.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Closed {
    /// The window has widgets left: its new list, for the caller to send it.
    Kept(WidgetList),
    /// The window has none left, and is forgotten: the caller closes it.
    Window,
}

/// The open widgets and their windows, kept by the app layer.
#[derive(Default)]
pub struct Widgets {
    windows: Vec<WidgetWindow>,
    /// The number of the last widget, 0 before the first.
    widgets_given: u32,
    /// The number of the last window's label, 0 before the first.
    windows_given: u32,
    /// The sequence number of the last list given.
    lists_given: u64,
}

impl Widgets {
    /// Adds a widget that shows `spec`, with the next number of a counter
    /// that only grows. A widget whose kind of window holds many goes into
    /// the open window of its kind, whose new list it gives; any other,
    /// or the first of its kind, into a new window, labelled with its kind
    /// and the next number of another counter that only grows, `plots-2`,
    /// so that a label is never given twice.
    ///
    /// # Errors
    ///
    /// A `Defect` for a column `u32::MAX`, which a list sends for "no
    /// column", or when a counter would pass its type.
    pub fn open(&mut self, spec: WidgetSpec) -> Result<Opened, AppError> {
        let (_, columns) = spec.wire();
        if columns.contains(&Some(ColumnId::new(u32::MAX))) {
            return Err(defect(&format!(
                "a widget {spec:?} of the column {}, which means none",
                u32::MAX
            )));
        }
        let kind = spec.window_kind();
        let id = self
            .widgets_given
            .checked_add(1)
            .ok_or_else(|| defect("more widgets than a u32 counts"))?;
        let shared = if kind.holds_many() {
            self.windows.iter().position(|window| window.kind == kind)
        } else {
            None
        };
        let widget = Widget {
            id: WidgetId::new(id),
            spec,
        };
        let opened = if let Some(index) = shared {
            let seq = self.next_list()?;
            let window = self
                .windows
                .get_mut(index)
                .ok_or_else(|| defect("a window found and gone"))?;
            window.widgets.push(widget);
            self.widgets_given = id;
            Opened {
                window: window.label.clone(),
                widget: WidgetId::new(id),
                placed: Placed::Added(WidgetList {
                    seq,
                    widgets: window.widgets.clone(),
                }),
            }
        } else {
            let number = self
                .windows_given
                .checked_add(1)
                .ok_or_else(|| defect("more windows than a u32 counts"))?;
            let label = WindowLabel::new(format!("{}-{number}", kind.label_prefix()));
            self.windows.push(WidgetWindow {
                label: label.clone(),
                kind,
                widgets: vec![widget],
            });
            self.widgets_given = id;
            self.windows_given = number;
            Opened {
                window: label,
                widget: WidgetId::new(id),
                placed: Placed::NewWindow,
            }
        };
        Ok(opened)
    }

    /// Forgets the widget `widget` of the window `label`, whose tile was
    /// closed or which the window cannot show: it gives the list the window
    /// has left, or, when it was its last, forgets the window, for the
    /// caller to close.
    ///
    /// # Errors
    ///
    /// `UnknownWidget` when the window holds no such widget, as one closed
    /// a moment before, or a `Defect` when the sequence number would pass
    /// the largest integer a window reads exactly.
    pub fn close(&mut self, label: &WindowLabel, widget: WidgetId) -> Result<Closed, AppError> {
        let unknown = || {
            AppError::from(WindowError::UnknownWidget {
                label: label.clone(),
                widget,
            })
        };
        let index = self
            .windows
            .iter()
            .position(|window| window.label == *label)
            .ok_or_else(unknown)?;
        let window = self.windows.get(index).ok_or_else(unknown)?;
        if !window.widgets.iter().any(|each| each.id == widget) {
            return Err(unknown());
        }
        if window.widgets.len() == 1 {
            self.windows.remove(index);
            return Ok(Closed::Window);
        }
        let seq = self.next_list()?;
        let window = self.windows.get_mut(index).ok_or_else(unknown)?;
        window.widgets.retain(|each| each.id != widget);
        Ok(Closed::Kept(WidgetList {
            seq,
            widgets: window.widgets.clone(),
        }))
    }

    /// The widgets of the window `label`, with the next sequence number.
    ///
    /// # Errors
    ///
    /// `UnknownWindow` when no window of widgets has that label, or a
    /// `Defect` when the sequence number would pass the largest integer a
    /// window reads exactly.
    pub fn list(&mut self, label: &WindowLabel) -> Result<WidgetList, AppError> {
        if !self.is_open(label) {
            return Err(WindowError::UnknownWindow {
                label: label.clone(),
            }
            .into());
        }
        let seq = self.next_list()?;
        Ok(WidgetList {
            seq,
            widgets: self.widgets_of(label),
        })
    }

    /// Whether a window of widgets has the label `label`.
    #[must_use]
    pub fn is_open(&self, label: &WindowLabel) -> bool {
        self.windows.iter().any(|window| window.label == *label)
    }

    /// The widgets of the window `label`, in the order they were opened;
    /// none for a label of no window of widgets.
    #[must_use]
    pub fn widgets_of(&self, label: &WindowLabel) -> Vec<Widget> {
        self.windows
            .iter()
            .find(|window| window.label == *label)
            .map_or_else(Vec::new, |window| window.widgets.clone())
    }

    /// Forgets the window `label`, which was closed or could not be
    /// opened, with its widgets; nothing for a label of no such window.
    pub fn window_closed(&mut self, label: &WindowLabel) {
        self.windows.retain(|window| window.label != *label);
    }

    /// Forgets every window of widgets, as another table loads, and gives
    /// their labels for the caller to close.
    pub fn close_all(&mut self) -> Vec<WindowLabel> {
        self.windows.drain(..).map(|window| window.label).collect()
    }

    /// The next sequence number of a list, at most the largest integer a
    /// window reads exactly, as the core's revisions.
    fn next_list(&mut self) -> Result<u64, AppError> {
        let seq = self
            .lists_given
            .checked_add(1)
            .filter(|next| *next <= MAX_EXACT_IN_JAVASCRIPT)
            .ok_or_else(|| {
                defect(&format!(
                    "more lists of widgets than {MAX_EXACT_IN_JAVASCRIPT}"
                ))
            })?;
        self.lists_given = seq;
        Ok(seq)
    }
}

impl WidgetList {
    /// The list as a window receives it, the answer of `window_widgets` and
    /// a message on its channel alike: the kind of message,
    /// [`WIDGETS_MESSAGE`], and seven zero bytes; the sequence number, `u64`;
    /// the number of widgets, `u32`, and four zero bytes; then for each its
    /// number, `u32`, the code of its kind, `u16`, 1 a 3D scatter, 2 a map,
    /// 3 a map of countries, 4 a histogram, two zero bytes, its three
    /// columns, `u32` each, `u32::MAX` past those it has, and four zero
    /// bytes; every number little-endian. The core's messages share the
    /// first byte's meaning (`docs/core.md`, section 5).
    ///
    /// # Errors
    ///
    /// A `Defect` for more widgets than a `u32` counts.
    pub fn to_bytes(&self) -> Result<Vec<u8>, AppError> {
        let count = u32::try_from(self.widgets.len())
            .map_err(|_| defect("more widgets in a window than a u32 counts"))?;
        let mut bytes = vec![WIDGETS_MESSAGE, 0, 0, 0, 0, 0, 0, 0];
        bytes.extend_from_slice(&self.seq.to_le_bytes());
        bytes.extend_from_slice(&count.to_le_bytes());
        bytes.extend_from_slice(&[0; 4]);
        for widget in &self.widgets {
            let (kind, columns) = widget.spec.wire();
            bytes.extend_from_slice(&widget.id.get().to_le_bytes());
            bytes.extend_from_slice(&kind.to_le_bytes());
            bytes.extend_from_slice(&[0; 2]);
            for column in columns {
                bytes.extend_from_slice(&column.map_or(u32::MAX, ColumnId::get).to_le_bytes());
            }
            bytes.extend_from_slice(&[0; 4]);
        }
        Ok(bytes)
    }
}

/// How a caller opens and closes the windows of the widgets: the app with
/// Tauri's windows, the test program of the e2e harness by asking the
/// harness for a page. It is called once the locks are released, since a
/// new window subscribes as it starts, which takes them, and since Tauri
/// cannot create a window from a synchronous command on Windows
/// (`docs/core.md`, section 7).
pub trait WindowHost {
    /// Opens the window `label`, of the kind of window of `widget`, its
    /// first widget.
    ///
    /// # Errors
    ///
    /// `WindowFailed`, with the system's message, when the window could not
    /// be made; the caller then forgets it with
    /// [`Widgets::window_closed`].
    fn open(&mut self, label: &WindowLabel, widget: &WidgetSpec) -> Result<(), AppError>;

    /// Brings the open window `label` to the front, when a widget was
    /// added to it; a window that does not exist yet, still being made
    /// for its first widget, is left alone.
    ///
    /// # Errors
    ///
    /// `WindowFailed`, with the system's message, when the window could not
    /// be brought forward.
    fn raise(&mut self, label: &WindowLabel) -> Result<(), AppError>;

    /// Closes the window `label`.
    ///
    /// # Errors
    ///
    /// `WindowFailed`, with the system's message, when the window could not
    /// be closed.
    fn close(&mut self, label: &WindowLabel) -> Result<(), AppError>;
}

#[cfg(test)]
mod tests;
