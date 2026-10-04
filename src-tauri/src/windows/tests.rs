use std::sync::Mutex;

use vavilov_core::{
    ColumnId, ColumnValues, Command, CommandError, NewColumn, Numbers, Request, Revision, Session,
    Table, WidgetSpec, WindowHost, WindowLabel,
};

use super::{accepts_first_mouse, open_widget_window};

const HEIGHT: u32 = 1;

/// A session with two plants and `height`, a number, as column 1.
fn session_with_height() -> Mutex<Session> {
    let table = Table::new(
        "IndividualID",
        vec!["p1".to_owned(), "p2".to_owned()],
        vec![NewColumn {
            name: "height".to_owned(),
            values: ColumnValues::Number(Numbers::Float(vec![Some(1.5), Some(2.0)])),
        }],
    )
    .unwrap();
    let mut session = Session::new();
    session
        .dispatch(Request {
            command: Command::LoadTable {
                table,
                active_classification: None,
            },
            based_on: Revision::ZERO,
            sent_at: None,
        })
        .unwrap();
    Mutex::new(session)
}

fn load_again(session: &Mutex<Session>) -> Vec<WindowLabel> {
    let mut session = session.lock().unwrap();
    let table = Table::new(
        "IndividualID",
        vec!["p9".to_owned()],
        vec![NewColumn {
            name: "height".to_owned(),
            values: ColumnValues::Number(Numbers::Float(vec![Some(3.0)])),
        }],
    )
    .unwrap();
    let based_on = session.revision();
    session
        .dispatch(Request {
            command: Command::LoadTable {
                table,
                active_classification: None,
            },
            based_on,
            sent_at: None,
        })
        .unwrap()
        .closed
}

/// The windows as the app makes them, where another command, a load, runs
/// while the window is being made, as it can on the main thread while an
/// `async` command builds a window.
struct LoadWhileOpening<'a> {
    session: &'a Mutex<Session>,
    closed_by_the_load: Vec<WindowLabel>,
    open: Vec<WindowLabel>,
}

impl WindowHost for LoadWhileOpening<'_> {
    fn open(&mut self, label: &WindowLabel, _widget: &WidgetSpec) -> Result<(), CommandError> {
        self.closed_by_the_load = load_again(self.session);
        // The load's close finds no window yet, as Tauri's does.
        self.open.push(label.clone());
        Ok(())
    }

    fn close(&mut self, label: &WindowLabel) -> Result<(), CommandError> {
        self.open.retain(|open| open != label);
        Ok(())
    }
}

#[test]
fn a_widget_closed_while_its_window_was_being_made_has_its_window_closed() {
    let session = session_with_height();
    let spec = WidgetSpec::Scatter3d {
        axes: [ColumnId::new(HEIGHT); 3],
    };
    let label = session
        .lock()
        .unwrap()
        .open_widget(spec.clone(), Revision::new(1))
        .unwrap();
    let mut host = LoadWhileOpening {
        session: &session,
        closed_by_the_load: Vec::new(),
        open: Vec::new(),
    };
    open_widget_window(&session, &mut host, &label, &spec).unwrap();
    assert_eq!(
        host.closed_by_the_load,
        vec![WindowLabel::new("scatter3d-1")]
    );
    assert_eq!(host.open, Vec::<WindowLabel>::new());
}

/// The windows when the system cannot make one.
struct Failing;

impl WindowHost for Failing {
    fn open(&mut self, label: &WindowLabel, _widget: &WidgetSpec) -> Result<(), CommandError> {
        Err(CommandError::WindowFailed {
            label: label.clone(),
            message: "no window today".to_owned(),
        })
    }

    fn close(&mut self, _label: &WindowLabel) -> Result<(), CommandError> {
        Ok(())
    }
}

#[test]
fn a_widget_whose_window_could_not_be_made_is_taken_out_of_the_session() {
    let session = session_with_height();
    let spec = WidgetSpec::Scatter3d {
        axes: [ColumnId::new(HEIGHT); 3],
    };
    let label = session
        .lock()
        .unwrap()
        .open_widget(spec.clone(), Revision::new(1))
        .unwrap();
    assert_eq!(
        open_widget_window(&session, &mut Failing, &label, &spec),
        Err(CommandError::WindowFailed {
            label: WindowLabel::new("scatter3d-1"),
            message: "no window today".to_owned(),
        })
    );
    assert_eq!(session.lock().unwrap().widget(&label), None);
}

#[test]
fn the_point_views_take_the_first_click_and_the_map_of_countries_does_not() {
    let column = ColumnId::new(HEIGHT);
    assert!(accepts_first_mouse(&WidgetSpec::Scatter3d {
        axes: [column, column, column]
    }));
    assert!(accepts_first_mouse(&WidgetSpec::Map {
        latitude: column,
        longitude: column,
    }));
    assert!(!accepts_first_mouse(&WidgetSpec::CountryMap {
        country: column
    }));
}
