use std::sync::Mutex;

use vavilov_core::{ColumnId, WindowLabel};

use super::{accepts_first_mouse, open_widget_window};
use crate::error::{AppError, WindowError};
use crate::widgets::{WidgetSpec, Widgets, WindowHost, WindowKind};

const HEIGHT: ColumnId = ColumnId::new(1);
const WEIGHT: ColumnId = ColumnId::new(2);

/// The windows as the app makes them, where a load runs while the window
/// is being made, as it can on the main thread while an `async` command
/// builds a window: it forgets every window of widgets.
struct LoadWhileOpening<'a> {
    widgets: &'a Mutex<Widgets>,
    closed_by_the_load: Vec<WindowLabel>,
    open: Vec<WindowLabel>,
}

impl WindowHost for LoadWhileOpening<'_> {
    fn open(&mut self, label: &WindowLabel, _widget: &WidgetSpec) -> Result<(), AppError> {
        self.closed_by_the_load = self.widgets.lock().unwrap().close_all();
        // The load's close finds no window yet, as Tauri's does.
        self.open.push(label.clone());
        Ok(())
    }

    fn raise(&mut self, _label: &WindowLabel) -> Result<(), AppError> {
        Ok(())
    }

    fn close(&mut self, label: &WindowLabel) -> Result<(), AppError> {
        self.open.retain(|open| open != label);
        Ok(())
    }
}

#[test]
fn a_window_forgotten_while_it_was_being_made_is_closed() {
    let widgets = Mutex::new(Widgets::default());
    let spec = WidgetSpec::Scatter3d { axes: [HEIGHT; 3] };
    let label = widgets.lock().unwrap().open(spec.clone()).unwrap().window;
    let mut host = LoadWhileOpening {
        widgets: &widgets,
        closed_by_the_load: Vec::new(),
        open: Vec::new(),
    };
    open_widget_window(&widgets, &mut host, &label, &spec).unwrap();
    assert_eq!(
        host.closed_by_the_load,
        vec![WindowLabel::new("scatter3d-1")]
    );
    assert_eq!(host.open, Vec::<WindowLabel>::new());
}

/// The windows when the system cannot make one.
struct Failing;

impl WindowHost for Failing {
    fn open(&mut self, label: &WindowLabel, _widget: &WidgetSpec) -> Result<(), AppError> {
        Err(WindowError::WindowFailed {
            label: label.clone(),
            message: "no window today".to_owned(),
            others_not_opened: 0,
        }
        .into())
    }

    fn raise(&mut self, _label: &WindowLabel) -> Result<(), AppError> {
        Ok(())
    }

    fn close(&mut self, _label: &WindowLabel) -> Result<(), AppError> {
        Ok(())
    }
}

#[test]
fn a_window_that_could_not_be_made_is_forgotten_with_its_widgets() {
    let widgets = Mutex::new(Widgets::default());
    let spec = WidgetSpec::Histogram { column: HEIGHT };
    let label = widgets.lock().unwrap().open(spec.clone()).unwrap().window;
    assert_eq!(
        open_widget_window(&widgets, &mut Failing, &label, &spec),
        Err(AppError::Window(WindowError::WindowFailed {
            label: WindowLabel::new("plots-1"),
            message: "no window today".to_owned(),
            others_not_opened: 0,
        }))
    );
    assert!(!widgets.lock().unwrap().is_open(&label));
}

/// The windows when the system cannot make one, and two more widgets
/// join it while it is being made, as from a second and a third Plot item
/// chosen meanwhile.
struct FailingWhileOthersJoin<'a> {
    widgets: &'a Mutex<Widgets>,
}

impl WindowHost for FailingWhileOthersJoin<'_> {
    fn open(&mut self, label: &WindowLabel, _widget: &WidgetSpec) -> Result<(), AppError> {
        let mut widgets = self.widgets.lock().unwrap();
        widgets
            .open(WidgetSpec::Histogram { column: WEIGHT })
            .unwrap();
        widgets
            .open(WidgetSpec::Histogram { column: HEIGHT })
            .unwrap();
        Failing.open(label, _widget)
    }

    fn raise(&mut self, _label: &WindowLabel) -> Result<(), AppError> {
        Ok(())
    }

    fn close(&mut self, _label: &WindowLabel) -> Result<(), AppError> {
        Ok(())
    }
}

#[test]
fn a_window_that_could_not_be_made_counts_the_other_widgets_forgotten_with_it() {
    let widgets = Mutex::new(Widgets::default());
    let spec = WidgetSpec::Histogram { column: HEIGHT };
    let label = widgets.lock().unwrap().open(spec.clone()).unwrap().window;
    let mut host = FailingWhileOthersJoin { widgets: &widgets };
    assert_eq!(
        open_widget_window(&widgets, &mut host, &label, &spec),
        Err(AppError::Window(WindowError::WindowFailed {
            label: WindowLabel::new("plots-1"),
            message: "no window today".to_owned(),
            others_not_opened: 2,
        }))
    );
    assert!(!widgets.lock().unwrap().is_open(&label));
}

#[test]
fn the_3d_scatter_takes_the_first_click_and_the_plots_and_the_maps_do_not() {
    assert!(accepts_first_mouse(WindowKind::Scatter3d));
    assert!(!accepts_first_mouse(WindowKind::Plots));
    assert!(!accepts_first_mouse(WindowKind::Maps));
}
