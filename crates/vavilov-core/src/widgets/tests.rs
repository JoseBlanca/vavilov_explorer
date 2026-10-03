use std::sync::{Arc, Mutex};

use super::*;
use crate::command::{Command, Request};
use crate::dispatch::Outcome;
use crate::fixtures::plants;
use crate::session::{SendFailed, Subscriber};
use crate::table::Role;

const HEIGHT: ColumnId = ColumnId::new(1);
const ORIGIN: ColumnId = ColumnId::new(2);
const SEEDS: ColumnId = ColumnId::new(4);

/// A subscriber that counts the messages it is sent.
#[derive(Clone, Default)]
struct Counter(Arc<Mutex<usize>>);

impl Counter {
    fn count(&self) -> usize {
        *self.0.lock().unwrap()
    }
}

impl Subscriber for Counter {
    fn send(&self, _message: Vec<u8>) -> Result<(), SendFailed> {
        let mut count = self.0.lock().unwrap();
        *count = count.checked_add(1).unwrap();
        Ok(())
    }
}

fn dispatch(session: &mut Session, command: Command) -> Outcome {
    let based_on = session.revision();
    session
        .dispatch(Request {
            command,
            based_on,
            sent_at: None,
        })
        .unwrap()
}

fn load(session: &mut Session) -> Outcome {
    dispatch(
        session,
        Command::LoadTable {
            table: plants(),
            active_classification: Some(ORIGIN),
        },
    )
}

fn loaded() -> Session {
    let mut session = Session::new();
    load(&mut session);
    session
}

fn scatter(x: ColumnId, y: ColumnId, z: ColumnId) -> WidgetSpec {
    WidgetSpec::Scatter3d { axes: [x, y, z] }
}

fn open(session: &mut Session, spec: WidgetSpec) -> WindowLabel {
    let based_on = session.revision();
    session.open_widget(spec, based_on).unwrap()
}

fn label(text: &str) -> WindowLabel {
    WindowLabel::new(text)
}

#[test]
fn widgets_take_labels_from_one_counter_that_never_gives_a_label_twice() {
    let mut session = loaded();
    let first = open(&mut session, scatter(HEIGHT, SEEDS, HEIGHT));
    let second = open(&mut session, scatter(SEEDS, HEIGHT, SEEDS));
    assert_eq!(
        (first.as_str(), second.as_str()),
        ("scatter3d-1", "scatter3d-2")
    );
    assert_eq!(
        session.widget(&second),
        Some(&scatter(SEEDS, HEIGHT, SEEDS))
    );
    session.window_closed(&first);
    assert_eq!(session.widget(&first), None);
    assert_eq!(
        open(&mut session, scatter(HEIGHT, HEIGHT, HEIGHT)).as_str(),
        "scatter3d-3"
    );
    // Another project starts no new count.
    load(&mut session);
    assert_eq!(
        open(&mut session, scatter(HEIGHT, HEIGHT, HEIGHT)).as_str(),
        "scatter3d-4"
    );
}

#[test]
fn opening_a_widget_takes_no_revision() {
    let mut session = loaded();
    let main = Counter::default();
    session
        .subscribe(WindowLabel::main(), Box::new(main.clone()))
        .unwrap();
    open(&mut session, scatter(HEIGHT, SEEDS, HEIGHT));
    assert_eq!(session.revision(), Revision::new(1));
    assert_eq!(main.count(), 0);
}

#[test]
fn a_widget_of_a_column_that_is_no_number_is_refused_and_changes_nothing() {
    let mut session = loaded();
    let before = session.state.clone();
    assert_eq!(
        session.open_widget(scatter(HEIGHT, ORIGIN, SEEDS), Revision::new(1)),
        Err(CommandError::NotNumber { column: ORIGIN })
    );
    assert_eq!(
        session.open_widget(scatter(HEIGHT, SEEDS, ColumnId::new(0)), Revision::new(1)),
        Err(CommandError::UnknownColumn {
            column: ColumnId::new(0)
        })
    );
    assert_eq!(session.state, before);
}

#[test]
fn a_widget_asked_for_before_the_load_or_with_no_project_is_refused() {
    assert_eq!(
        Session::new().open_widget(scatter(HEIGHT, SEEDS, HEIGHT), Revision::ZERO),
        Err(CommandError::NoProject)
    );
    let mut session = loaded();
    let before = session.state.clone();
    assert_eq!(
        session.open_widget(scatter(HEIGHT, SEEDS, HEIGHT), Revision::ZERO),
        Err(CommandError::MadeBeforeLoad {
            based_on: Revision::ZERO,
            loaded_at: Revision::new(1),
        })
    );
    assert_eq!(session.state, before);
}

#[test]
fn an_open_widget_subscribes_and_a_closed_or_unknown_one_is_refused() {
    let mut session = loaded();
    let widget = open(&mut session, scatter(HEIGHT, SEEDS, HEIGHT));
    assert!(
        session
            .subscribe(widget.clone(), Box::new(Counter::default()))
            .is_ok()
    );
    session.window_closed(&widget);
    assert_eq!(
        session.subscribe(widget.clone(), Box::new(Counter::default())),
        Err(CommandError::UnknownWindow { label: widget })
    );
    assert_eq!(
        session.subscribe(label("scatter3d-9"), Box::new(Counter::default())),
        Err(CommandError::UnknownWindow {
            label: label("scatter3d-9")
        })
    );
}

#[test]
fn a_closed_window_receives_no_more_messages() {
    let mut session = loaded();
    let widget = open(&mut session, scatter(HEIGHT, SEEDS, HEIGHT));
    let counter = Counter::default();
    session
        .subscribe(widget.clone(), Box::new(counter.clone()))
        .unwrap();
    session.window_closed(&widget);
    dispatch(
        &mut session,
        Command::SetActiveClassification { column: None },
    );
    assert_eq!(counter.count(), 0);
}

#[test]
fn a_load_closes_every_widget_before_its_message_is_sent() {
    let mut session = loaded();
    let first = open(&mut session, scatter(HEIGHT, SEEDS, HEIGHT));
    let second = open(&mut session, scatter(SEEDS, SEEDS, SEEDS));
    let widget = Counter::default();
    session
        .subscribe(first.clone(), Box::new(widget.clone()))
        .unwrap();
    let main = Counter::default();
    session
        .subscribe(WindowLabel::main(), Box::new(main.clone()))
        .unwrap();
    let outcome = load(&mut session);
    assert_eq!(outcome.closed, vec![first.clone(), second.clone()]);
    assert_eq!((widget.count(), main.count()), (0, 1));
    assert_eq!(session.widget(&first), None);
    assert_eq!(session.widget(&second), None);
}

#[test]
fn a_change_of_role_that_makes_an_axis_no_number_closes_its_widget_and_undo_does_not_reopen_it() {
    let mut session = loaded();
    let on_height = open(&mut session, scatter(SEEDS, HEIGHT, SEEDS));
    let on_seeds = open(&mut session, scatter(SEEDS, SEEDS, SEEDS));
    let outcome = dispatch(
        &mut session,
        Command::SetRole {
            column: HEIGHT,
            role: Role::Category,
        },
    );
    assert_eq!(outcome.closed, vec![on_height.clone()]);
    assert_eq!(session.widget(&on_height), None);
    assert_eq!(
        session.widget(&on_seeds),
        Some(&scatter(SEEDS, SEEDS, SEEDS))
    );
    let undone = dispatch(&mut session, Command::Undo);
    assert_eq!(undone.closed, Vec::<WindowLabel>::new());
    assert_eq!(session.widget(&on_height), None);
}

#[test]
fn a_change_between_the_roles_of_a_number_keeps_the_widget() {
    let mut session = loaded();
    let widget = open(&mut session, scatter(HEIGHT, SEEDS, HEIGHT));
    let outcome = dispatch(
        &mut session,
        Command::SetRole {
            column: HEIGHT,
            role: Role::Latitude,
        },
    );
    assert_eq!(outcome.closed, Vec::<WindowLabel>::new());
    assert_eq!(
        session.widget(&widget),
        Some(&scatter(HEIGHT, SEEDS, HEIGHT))
    );
}

#[test]
fn a_widget_crosses_to_a_window_as_its_kind_and_its_axes() {
    let spec = scatter(HEIGHT, SEEDS, HEIGHT);
    let json = serde_json::json!({ "kind": "scatter3d", "axes": [1, 4, 1] });
    assert_eq!(serde_json::to_value(&spec).unwrap(), json);
    assert_eq!(serde_json::from_value::<WidgetSpec>(json).unwrap(), spec);
    assert!(
        serde_json::from_value::<WidgetSpec>(
            serde_json::json!({ "kind": "scatter3d", "axes": [1, 4] })
        )
        .is_err()
    );
    assert!(
        serde_json::from_value::<WidgetSpec>(
            serde_json::json!({ "kind": "scatter3d", "axes": [1, 4, 1], "title": "x" })
        )
        .is_err()
    );
}
