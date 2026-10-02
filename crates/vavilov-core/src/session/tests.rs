use std::sync::{Arc, Mutex};

use super::*;
use crate::command::{Command, Request};
use crate::dispatch::{Changed, Dropped};
use crate::fixtures::{code, decode, float, part_kinds, plants};
use crate::ids::{ColumnId, LevelCode, MAX_EXACT_IN_JAVASCRIPT, SentAt};
use crate::session::Selected;
use crate::table::{LevelValues, Role, StorageType, Table};

const PROJECT: u16 = 1;
const ACTIVE: u16 = 2;
const SELECTION: u16 = 3;
const CODES: u16 = 4;
const UNDO: u16 = 5;
const COLUMNS: u16 = 6;
const HOVER: u16 = 7;
const SHAPE: u16 = 11;

const ORIGIN: ColumnId = ColumnId::new(2);
const CLUSTER: ColumnId = ColumnId::new(3);
const HEIGHT: ColumnId = ColumnId::new(1);
const SPAIN: LevelCode = LevelCode::new(0);
const PERU: LevelCode = LevelCode::new(1);

/// A subscriber that keeps every message it is sent.
#[derive(Clone, Default)]
struct Recorder(Arc<Mutex<Vec<Vec<u8>>>>);

impl Recorder {
    fn take(&self) -> Vec<Vec<u8>> {
        std::mem::take(&mut *self.0.lock().unwrap())
    }
}

impl Subscriber for Recorder {
    fn send(&self, message: Vec<u8>) -> Result<(), SendFailed> {
        self.0.lock().unwrap().push(message);
        Ok(())
    }
}

/// A subscriber whose window has gone.
struct Failing;

impl Subscriber for Failing {
    fn send(&self, _message: Vec<u8>) -> Result<(), SendFailed> {
        Err(SendFailed {
            reason: "the channel is closed".to_owned(),
        })
    }
}

fn at(session: &Session, command: Command) -> Request {
    Request {
        command,
        based_on: session.revision(),
        sent_at: None,
    }
}

fn apply(session: &mut Session, command: Command) -> Changed {
    let request = at(session, command);
    session.dispatch(request).unwrap().changed
}

/// Dispatches `request`, checks it is refused with `expected`, and that
/// every field of the session but the subscribers is as it was.
fn assert_refused(session: &mut Session, request: Request, expected: CommandError) {
    let before = session.state.clone();
    assert_eq!(session.dispatch(request), Err(expected));
    assert_eq!(session.state, before);
}

fn rows(session: &Session, rows: &[u32]) -> RowSet {
    let num_rows = session.table().unwrap().num_rows();
    RowSet::from_rows(num_rows, rows.iter().copied().map(RowIndex::new)).unwrap()
}

fn load(session: &mut Session, active_classification: Option<ColumnId>) -> Changed {
    apply(
        session,
        Command::LoadTable {
            table: plants(),
            active_classification,
        },
    )
}

/// A session with the plants loaded at revision 1, `origin` active, and a
/// main window subscribed after the load.
fn loaded() -> (Session, Recorder) {
    let mut session = Session::new();
    load(&mut session, Some(ORIGIN));
    let recorder = Recorder::default();
    session
        .subscribe(WindowLabel::main(), Box::new(recorder.clone()))
        .unwrap();
    (session, recorder)
}

/// `loaded`, with Spain selected for editing at revision 2.
fn editing_spain() -> (Session, Recorder) {
    let (mut session, recorder) = loaded();
    apply(
        &mut session,
        Command::SelectPopulation {
            column: ORIGIN,
            selected: Some(Selected::Population(SPAIN)),
        },
    );
    recorder.take();
    (session, recorder)
}

fn codes_of(session: &Session, column: ColumnId) -> Vec<Option<LevelCode>> {
    session
        .table()
        .unwrap()
        .column(column)
        .unwrap()
        .categorical()
        .unwrap()
        .codes()
        .to_vec()
}

fn revision_of(session: &Session, column: ColumnId) -> u64 {
    session
        .table()
        .unwrap()
        .column(column)
        .unwrap()
        .revision()
        .get()
}

fn assign(session: &Session, population: LevelCode, lasso: &[u32]) -> Request {
    at(
        session,
        Command::AssignRows {
            column: ORIGIN,
            target: Selected::Population(population),
            rows: rows(session, lasso),
        },
    )
}

#[test]
fn a_new_session_has_no_project_at_revision_0() {
    let session = Session::new();
    assert_eq!(session.revision(), Revision::ZERO);
    assert!(session.table().is_none());
    assert_eq!(
        session.undo_redo(),
        UndoRedo {
            can_undo: false,
            can_redo: false
        }
    );
}

#[test]
fn a_command_on_the_table_with_no_project_is_refused() {
    let mut session = Session::new();
    let request = at(
        &session,
        Command::SetSelection {
            rows: RowSet::empty(4),
        },
    );
    assert_refused(&mut session, request, CommandError::NoProject);
    let request = at(&session, Command::Undo);
    assert_refused(&mut session, request, CommandError::NoProject);
}

#[test]
fn loading_a_table_takes_a_revision_that_every_column_takes_too() {
    let mut session = Session::new();
    assert_eq!(
        load(&mut session, Some(ORIGIN)),
        Changed::State(Revision::new(1))
    );
    assert_eq!(session.revision(), Revision::new(1));
    assert_eq!(session.state.loaded_at, Revision::new(1));
    let table = session.table().unwrap();
    assert!(
        table
            .columns()
            .iter()
            .all(|column| column.revision() == Revision::new(1))
    );
    assert_eq!(
        session.active(),
        Some(Active {
            column: ORIGIN,
            selected: None
        })
    );
    assert_eq!(session.selection().unwrap(), &RowSet::empty(4));
    assert_eq!(session.hover(), None);
}

#[test]
fn loading_a_table_sends_every_part_of_the_state() {
    let mut session = Session::new();
    let recorder = Recorder::default();
    session
        .subscribe(WindowLabel::main(), Box::new(recorder.clone()))
        .unwrap();
    load(&mut session, None);
    let messages = recorder.take();
    assert_eq!(messages.len(), 1);
    let decoded = decode(&messages[0]);
    assert_eq!((decoded.kind, decoded.revision), (1, 1));
    assert_eq!(
        part_kinds(&messages[0]),
        [
            PROJECT, SHAPE, ACTIVE, SELECTION, UNDO, COLUMNS, CODES, CODES, CODES, HOVER
        ]
    );
    assert_eq!(
        decoded.parts[0].1,
        [
            1, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0
        ]
    );
    // The shape of the new table, at its load.
    assert_eq!(decoded.parts[1].1, [1, 0, 0, 0, 0, 0, 0, 0]);
    // The hover of the new table: a new sequence number and no row.
    assert_eq!(
        decoded.parts[9].1,
        [1, 0, 0, 0, 0, 0, 0, 0, 255, 255, 255, 255]
    );
}

#[test]
fn a_table_is_loaded_only_with_a_categorical_active_classification() {
    let mut session = Session::new();
    let request = at(
        &session,
        Command::LoadTable {
            table: plants(),
            active_classification: Some(HEIGHT),
        },
    );
    assert_refused(
        &mut session,
        request,
        CommandError::NotClassification { column: HEIGHT },
    );
    let request = at(
        &session,
        Command::LoadTable {
            table: plants(),
            active_classification: Some(ColumnId::new(9)),
        },
    );
    assert_refused(
        &mut session,
        request,
        CommandError::UnknownColumn {
            column: ColumnId::new(9),
        },
    );
}

#[test]
fn setting_the_selection_takes_a_revision_and_sends_the_selection_alone() {
    let (mut session, recorder) = loaded();
    let selection = rows(&session, &[1, 3]);
    let request = Request {
        command: Command::SetSelection {
            rows: selection.clone(),
        },
        based_on: session.revision(),
        sent_at: Some(SentAt::new(1.5).unwrap()),
    };
    assert_eq!(
        session.dispatch(request).unwrap().changed,
        Changed::State(Revision::new(2))
    );
    assert_eq!(session.selection(), Some(&selection));
    let messages = recorder.take();
    assert_eq!(messages.len(), 1);
    assert_eq!(&messages[0][..2], [1, 1]);
    assert_eq!(&messages[0][16..24], 1.5_f64.to_le_bytes());
    let decoded = decode(&messages[0]);
    assert_eq!(decoded.revision, 2);
    assert_eq!(
        decoded.parts,
        [(SELECTION, vec![4, 0, 0, 0, 0, 0, 0, 0, 0b1010])]
    );
}

#[test]
fn a_command_that_changes_nothing_takes_no_revision_and_sends_nothing() {
    let (mut session, recorder) = loaded();
    let request = at(
        &session,
        Command::SetSelection {
            rows: RowSet::empty(4),
        },
    );
    let before = session.state.clone();
    assert_eq!(session.dispatch(request).unwrap().changed, Changed::Nothing);
    assert_eq!(session.state, before);
    assert!(recorder.take().is_empty());
}

#[test]
fn a_selection_for_a_table_of_other_rows_is_refused() {
    let (mut session, _recorder) = loaded();
    let request = at(
        &session,
        Command::SetSelection {
            rows: RowSet::empty(9),
        },
    );
    assert_refused(
        &mut session,
        request,
        CommandError::RowSetLength {
            num_rows: 4,
            num_bytes: 2,
        },
    );
}

#[test]
fn a_hover_takes_no_revision_and_carries_its_sequence_number() {
    let (mut session, recorder) = loaded();
    assert_eq!(
        apply(
            &mut session,
            Command::SetHover {
                row: Some(RowIndex::new(3))
            }
        ),
        Changed::Hover(HoverSeq::new(2))
    );
    assert_eq!(session.revision(), Revision::new(1));
    assert_eq!(session.hover(), Some(RowIndex::new(3)));
    let messages = recorder.take();
    let decoded = decode(&messages[0]);
    assert_eq!((decoded.kind, decoded.revision), (2, 1));
    assert_eq!(
        decoded.parts,
        [(HOVER, vec![2, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0])]
    );
    assert_eq!(
        apply(
            &mut session,
            Command::SetHover {
                row: Some(RowIndex::new(3))
            }
        ),
        Changed::Nothing
    );
    assert_eq!(
        apply(&mut session, Command::SetHover { row: None }),
        Changed::Hover(HoverSeq::new(3))
    );
}

#[test]
fn a_hover_beyond_the_table_is_refused() {
    let (mut session, _recorder) = loaded();
    let request = at(
        &session,
        Command::SetHover {
            row: Some(RowIndex::new(4)),
        },
    );
    assert_refused(
        &mut session,
        request,
        CommandError::RowOutOfRange {
            row: RowIndex::new(4),
            num_rows: 4,
        },
    );
}

#[test]
fn hovers_between_two_changes_leave_the_revisions_without_a_gap() {
    let (mut session, recorder) = loaded();
    let selection = rows(&session, &[0]);
    apply(&mut session, Command::SetSelection { rows: selection });
    apply(
        &mut session,
        Command::SetHover {
            row: Some(RowIndex::new(1)),
        },
    );
    apply(
        &mut session,
        Command::SetHover {
            row: Some(RowIndex::new(2)),
        },
    );
    apply(
        &mut session,
        Command::SetSelection {
            rows: RowSet::empty(4),
        },
    );
    let decoded: Vec<_> = recorder
        .take()
        .iter()
        .map(|message| decode(message))
        .collect();
    let kinds_and_revisions: Vec<(u8, u64)> =
        decoded.iter().map(|d| (d.kind, d.revision)).collect();
    assert_eq!(kinds_and_revisions, [(1, 2), (2, 2), (2, 2), (1, 3)]);
    assert_eq!(&decoded[1].parts[0].1[..8], 2_u64.to_le_bytes());
    assert_eq!(&decoded[2].parts[0].1[..8], 3_u64.to_le_bytes());
}

#[test]
fn changing_the_active_classification_clears_the_selected_population() {
    let (mut session, recorder) = editing_spain();
    assert_eq!(
        apply(
            &mut session,
            Command::SetActiveClassification {
                column: Some(CLUSTER)
            }
        ),
        Changed::State(Revision::new(3))
    );
    assert_eq!(
        session.active(),
        Some(Active {
            column: CLUSTER,
            selected: None
        })
    );
    assert_eq!(
        decode(&recorder.take()[0]).parts,
        [(ACTIVE, vec![3, 0, 0, 0, 255, 255, 0])]
    );
    assert_eq!(
        apply(
            &mut session,
            Command::SetActiveClassification {
                column: Some(CLUSTER)
            }
        ),
        Changed::Nothing
    );
    apply(
        &mut session,
        Command::SetActiveClassification { column: None },
    );
    assert_eq!(session.active(), None);
}

#[test]
fn only_a_categorical_column_of_the_table_can_be_the_active_classification() {
    let (mut session, _recorder) = loaded();
    let request = at(
        &session,
        Command::SetActiveClassification {
            column: Some(HEIGHT),
        },
    );
    assert_refused(
        &mut session,
        request,
        CommandError::NotClassification { column: HEIGHT },
    );
    let request = at(
        &session,
        Command::SetActiveClassification {
            column: Some(ColumnId::new(0)),
        },
    );
    assert_refused(
        &mut session,
        request,
        CommandError::NotClassification {
            column: ColumnId::new(0),
        },
    );
    let request = at(
        &session,
        Command::SetActiveClassification {
            column: Some(ColumnId::new(9)),
        },
    );
    assert_refused(
        &mut session,
        request,
        CommandError::UnknownColumn {
            column: ColumnId::new(9),
        },
    );
}

#[test]
fn a_population_is_selected_in_the_active_classification_only() {
    let (mut session, recorder) = loaded();
    assert_eq!(
        apply(
            &mut session,
            Command::SelectPopulation {
                column: ORIGIN,
                selected: Some(Selected::Population(PERU))
            }
        ),
        Changed::State(Revision::new(2))
    );
    assert_eq!(
        session.active(),
        Some(Active {
            column: ORIGIN,
            selected: Some(Selected::Population(PERU))
        })
    );
    assert_eq!(
        decode(&recorder.take()[0]).parts,
        [(ACTIVE, vec![2, 0, 0, 0, 1, 0, 1])]
    );
    let request = at(
        &session,
        Command::SelectPopulation {
            column: CLUSTER,
            selected: Some(Selected::Population(PERU)),
        },
    );
    assert_refused(
        &mut session,
        request,
        CommandError::NotActiveClassification { column: CLUSTER },
    );
    let request = at(
        &session,
        Command::SelectPopulation {
            column: ORIGIN,
            selected: Some(Selected::Population(LevelCode::new(2))),
        },
    );
    assert_refused(
        &mut session,
        request,
        CommandError::UnknownLevel {
            column: ORIGIN,
            code: LevelCode::new(2),
            num_levels: 2,
        },
    );
}

#[test]
fn a_lasso_assigns_its_rows_to_the_selected_population_and_sends_their_codes() {
    let (mut session, recorder) = editing_spain();
    // origin is Spain, Peru, missing, Spain; the lasso takes rows 1 and 2.
    let request = assign(&session, SPAIN, &[1, 2]);
    assert_eq!(
        session.dispatch(request).unwrap().changed,
        Changed::State(Revision::new(3))
    );
    assert_eq!(
        codes_of(&session, ORIGIN),
        [code(0), code(0), code(0), code(0)]
    );
    assert_eq!(revision_of(&session, ORIGIN), 3);
    assert_eq!(revision_of(&session, CLUSTER), 1);
    assert_eq!(
        session.undo_redo(),
        UndoRedo {
            can_undo: true,
            can_redo: false
        }
    );
    let messages = recorder.take();
    assert_eq!(messages.len(), 1);
    let decoded = decode(&messages[0]);
    assert_eq!(decoded.revision, 3);
    assert_eq!(
        decoded.parts,
        [
            (
                CODES,
                vec![
                    2, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
                ]
            ),
            (
                COLUMNS,
                vec![
                    1, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0
                ]
            ),
            (UNDO, vec![1, 0]),
        ]
    );
}

#[test]
fn a_lasso_that_changes_no_code_leaves_nothing_to_undo() {
    let (mut session, recorder) = editing_spain();
    let request = assign(&session, SPAIN, &[0, 3]);
    assert_eq!(session.dispatch(request).unwrap().changed, Changed::Nothing);
    assert_eq!(
        session.undo_redo(),
        UndoRedo {
            can_undo: false,
            can_redo: false
        }
    );
    assert!(recorder.take().is_empty());
}

#[test]
fn a_lasso_in_remove_mode_unassigns_only_the_rows_of_the_selected_population() {
    let (mut session, _recorder) = editing_spain();
    let request = at(
        &session,
        Command::UnassignRows {
            column: ORIGIN,
            population: SPAIN,
            rows: rows(&session, &[0, 1, 2]),
        },
    );
    session.dispatch(request).unwrap();
    assert_eq!(codes_of(&session, ORIGIN), [None, code(1), None, code(0)]);
}

#[test]
fn a_lasso_needs_the_active_classification_and_its_selected_population() {
    let (mut session, _recorder) = loaded();
    let request = assign(&session, SPAIN, &[1]);
    assert_refused(&mut session, request, CommandError::NoPopulationSelected);
    apply(
        &mut session,
        Command::SelectPopulation {
            column: ORIGIN,
            selected: Some(Selected::Population(SPAIN)),
        },
    );
    let request = assign(&session, PERU, &[1]);
    assert_refused(
        &mut session,
        request,
        CommandError::NotSelected {
            target: Selected::Population(PERU),
        },
    );
    let request = at(
        &session,
        Command::AssignRows {
            column: CLUSTER,
            target: Selected::Population(SPAIN),
            rows: rows(&session, &[1]),
        },
    );
    assert_refused(
        &mut session,
        request,
        CommandError::NotActiveClassification { column: CLUSTER },
    );
    let request = at(
        &session,
        Command::AssignRows {
            column: ORIGIN,
            target: Selected::Population(SPAIN),
            rows: RowSet::empty(8),
        },
    );
    assert_refused(
        &mut session,
        request,
        CommandError::RowSetLength {
            num_rows: 4,
            num_bytes: 1,
        },
    );
}

#[test]
fn a_lasso_made_before_another_population_was_selected_is_refused() {
    let (mut session, _recorder) = editing_spain();
    // A window draws a lasso for Spain; another selects Peru before it
    // arrives.
    let lasso = assign(&session, SPAIN, &[1, 2]);
    apply(
        &mut session,
        Command::SelectPopulation {
            column: ORIGIN,
            selected: Some(Selected::Population(PERU)),
        },
    );
    assert_refused(
        &mut session,
        lasso,
        CommandError::NotSelected {
            target: Selected::Population(SPAIN),
        },
    );
    assert_eq!(
        codes_of(&session, ORIGIN),
        [code(0), code(1), None, code(0)]
    );
}

#[test]
fn undo_gives_back_the_codes_at_a_new_revision_and_redo_the_edited_ones() {
    let (mut session, recorder) = editing_spain();
    let request = assign(&session, SPAIN, &[1, 2]);
    session.dispatch(request).unwrap();
    let before = vec![code(0), code(1), None, code(0)];
    let after = vec![code(0), code(0), code(0), code(0)];
    recorder.take();

    assert_eq!(
        apply(&mut session, Command::Undo),
        Changed::State(Revision::new(4))
    );
    assert_eq!(codes_of(&session, ORIGIN), before);
    assert_eq!(revision_of(&session, ORIGIN), 4);
    assert_eq!(
        session.undo_redo(),
        UndoRedo {
            can_undo: false,
            can_redo: true
        }
    );
    let decoded = decode(&recorder.take()[0]);
    assert_eq!(
        decoded
            .parts
            .iter()
            .map(|(kind, _)| *kind)
            .collect::<Vec<_>>(),
        [CODES, COLUMNS, UNDO]
    );
    assert_eq!(decoded.parts[2].1, [0, 1]);

    assert_eq!(
        apply(&mut session, Command::Redo),
        Changed::State(Revision::new(5))
    );
    assert_eq!(codes_of(&session, ORIGIN), after);
    assert_eq!(
        session.undo_redo(),
        UndoRedo {
            can_undo: true,
            can_redo: false
        }
    );

    apply(&mut session, Command::Undo);
    let request = assign(&session, SPAIN, &[2]);
    session.dispatch(request).unwrap();
    assert_eq!(
        codes_of(&session, ORIGIN),
        [code(0), code(1), code(0), code(0)]
    );
    assert_eq!(
        session.undo_redo(),
        UndoRedo {
            can_undo: true,
            can_redo: false
        }
    );
}

#[test]
fn undo_and_redo_with_nothing_to_undo_or_redo_are_refused() {
    let (mut session, _recorder) = loaded();
    let request = at(&session, Command::Undo);
    assert_refused(&mut session, request, CommandError::NothingToUndo);
    let request = at(&session, Command::Redo);
    assert_refused(&mut session, request, CommandError::NothingToRedo);
}

#[test]
fn undoing_a_lasso_on_a_column_no_longer_active_still_sends_its_codes() {
    let (mut session, recorder) = editing_spain();
    let request = assign(&session, SPAIN, &[1]);
    session.dispatch(request).unwrap();
    apply(
        &mut session,
        Command::SetActiveClassification {
            column: Some(CLUSTER),
        },
    );
    recorder.take();
    apply(&mut session, Command::Undo);
    let decoded = decode(&recorder.take()[0]);
    assert_eq!(decoded.revision, 5);
    assert_eq!(
        decoded.parts[0],
        (
            CODES,
            vec![
                2, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 255, 255, 0, 0
            ]
        )
    );
    assert_eq!(
        decoded.parts[1],
        (
            COLUMNS,
            vec![
                1, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0
            ]
        )
    );
}

#[test]
fn after_a_load_there_is_nothing_to_undo() {
    let (mut session, _recorder) = editing_spain();
    let request = assign(&session, SPAIN, &[1]);
    session.dispatch(request).unwrap();
    load(&mut session, Some(ORIGIN));
    assert_eq!(
        session.undo_redo(),
        UndoRedo {
            can_undo: false,
            can_redo: false
        }
    );
    let request = at(&session, Command::Undo);
    assert_refused(&mut session, request, CommandError::NothingToUndo);
    assert_eq!(
        codes_of(&session, ORIGIN),
        [code(0), code(1), None, code(0)]
    );
}

#[test]
fn a_command_made_before_the_table_was_loaded_is_refused() {
    let (mut session, _recorder) = loaded();
    let selection = rows(&session, &[0]);
    apply(
        &mut session,
        Command::SetSelection {
            rows: selection.clone(),
        },
    );
    // A window makes a command at revision 2; the table is loaded again at 3.
    let stale = at(
        &session,
        Command::SetSelection {
            rows: RowSet::empty(4),
        },
    );
    load(&mut session, Some(ORIGIN));
    assert_refused(
        &mut session,
        stale,
        CommandError::MadeBeforeLoad {
            based_on: Revision::new(2),
            loaded_at: Revision::new(3),
        },
    );
    let current = at(&session, Command::SetSelection { rows: selection });
    assert_eq!(
        session.dispatch(current).unwrap().changed,
        Changed::State(Revision::new(4))
    );
}

#[test]
fn a_command_from_a_revision_still_to_come_is_a_defect() {
    let (mut session, _recorder) = loaded();
    let request = Request {
        command: Command::SetSelection {
            rows: RowSet::empty(4),
        },
        based_on: Revision::new(2),
        sent_at: None,
    };
    let before = session.state.clone();
    assert!(matches!(
        session.dispatch(request),
        Err(CommandError::Defect { .. })
    ));
    assert_eq!(session.state, before);
}

#[test]
fn a_change_at_the_largest_revision_is_refused_as_a_defect() {
    let (mut session, recorder) = loaded();
    session.state.revision = Revision::new(MAX_EXACT_IN_JAVASCRIPT);
    let selection = rows(&session, &[0]);
    let request = at(&session, Command::SetSelection { rows: selection });
    assert_refused(
        &mut session,
        request,
        CommandError::Defect {
            what: "the revision would pass 9007199254740991".to_owned(),
        },
    );
    assert!(recorder.take().is_empty());
}

#[test]
fn a_subscriber_gets_the_snapshot_at_r_and_then_every_revision_after_r() {
    let (mut session, _first) = loaded();
    let selection = rows(&session, &[2]);
    apply(&mut session, Command::SetSelection { rows: selection });
    let recorder = Recorder::default();
    let snapshot = session
        .subscribe(WindowLabel::new("main"), Box::new(recorder.clone()))
        .unwrap();
    let decoded = decode(&snapshot);
    assert_eq!((decoded.kind, decoded.revision), (0, 2));
    assert_eq!(
        part_kinds(&snapshot),
        [
            PROJECT, SHAPE, ACTIVE, SELECTION, UNDO, COLUMNS, CODES, CODES, CODES, HOVER
        ]
    );
    assert_eq!(decoded.parts[3].1, [4, 0, 0, 0, 0, 0, 0, 0, 0b0100]);
    apply(
        &mut session,
        Command::SetSelection {
            rows: RowSet::empty(4),
        },
    );
    let messages = recorder.take();
    assert_eq!(
        messages
            .iter()
            .map(|message| decode(message).revision)
            .collect::<Vec<_>>(),
        [3]
    );
}

#[test]
fn a_snapshot_with_no_project_says_so() {
    let mut session = Session::new();
    let snapshot = session
        .subscribe(WindowLabel::main(), Box::new(Recorder::default()))
        .unwrap();
    let decoded = decode(&snapshot);
    assert_eq!((decoded.kind, decoded.revision), (0, 0));
    assert_eq!(
        decoded.parts,
        [
            (PROJECT, vec![0, 0, 0, 0, 0, 0, 0, 0]),
            (HOVER, vec![0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 255, 255])
        ]
    );
}

#[test]
fn a_window_that_subscribes_again_replaces_its_subscriber() {
    let (mut session, first) = loaded();
    let second = Recorder::default();
    session
        .subscribe(WindowLabel::main(), Box::new(second.clone()))
        .unwrap();
    apply(
        &mut session,
        Command::SetHover {
            row: Some(RowIndex::new(0)),
        },
    );
    assert!(first.take().is_empty());
    assert_eq!(second.take().len(), 1);
}

#[test]
fn a_window_the_session_does_not_know_cannot_subscribe() {
    let (mut session, _main) = loaded();
    let stray = Recorder::default();
    assert_eq!(
        session.subscribe(WindowLabel::new("scatter3d-1"), Box::new(stray.clone())),
        Err(CommandError::UnknownWindow {
            label: WindowLabel::new("scatter3d-1")
        })
    );
    apply(
        &mut session,
        Command::SetHover {
            row: Some(RowIndex::new(0)),
        },
    );
    assert!(stray.take().is_empty());
}

#[test]
fn a_subscriber_that_fails_is_removed_and_reported_and_the_command_still_applies() {
    let (mut session, _main) = loaded();
    session.unsubscribe(&WindowLabel::main());
    session
        .subscribe(WindowLabel::main(), Box::new(Failing))
        .unwrap();
    let selection = rows(&session, &[1]);
    let request = at(
        &session,
        Command::SetSelection {
            rows: selection.clone(),
        },
    );
    let outcome = session.dispatch(request).unwrap();
    assert_eq!(outcome.changed, Changed::State(Revision::new(2)));
    assert_eq!(
        outcome.dropped,
        [Dropped {
            label: WindowLabel::main(),
            reason: SendFailed {
                reason: "the channel is closed".to_owned()
            },
        }]
    );
    assert_eq!(session.selection(), Some(&selection));
    let request = at(
        &session,
        Command::SetSelection {
            rows: RowSet::empty(4),
        },
    );
    assert!(session.dispatch(request).unwrap().dropped.is_empty());
}

#[test]
fn an_unsubscribed_window_receives_nothing() {
    let (mut session, main) = loaded();
    session.unsubscribe(&WindowLabel::main());
    apply(
        &mut session,
        Command::SetHover {
            row: Some(RowIndex::new(0)),
        },
    );
    assert!(main.take().is_empty());
}

#[test]
fn every_value_of_the_plants_is_kept_through_a_load() {
    let mut session = Session::new();
    load(&mut session, None);
    let table = session.table().unwrap();
    assert_eq!(table.names().names(), ["p1", "p2", "p3", "p4"]);
    assert_eq!(
        table.column(HEIGHT).unwrap().values(),
        &float(vec![Some(1.5), None, Some(2.0), Some(3.25)])
    );
}

#[test]
fn the_rows_of_a_lasso_made_before_a_load_are_refused_as_made_before_it() {
    let (mut session, _recorder) = loaded();
    let before = session.revision();
    let other = Table::new(
        "",
        crate::fixtures::names(&["a", "b", "c", "d", "e", "f", "g", "h", "i"]),
        Vec::new(),
    )
    .unwrap();
    apply(
        &mut session,
        Command::LoadTable {
            table: other,
            active_classification: None,
        },
    );
    // Four rows' worth of bits, made for the old table, against a table of nine.
    assert_eq!(
        session.rows_from_window(&[0b0110], before),
        Err(CommandError::MadeBeforeLoad {
            based_on: Revision::new(1),
            loaded_at: Revision::new(2)
        })
    );
    assert_eq!(
        session.rows_from_window(&[0b0110], session.revision()),
        Err(CommandError::RowSetLength {
            num_rows: 9,
            num_bytes: 1
        })
    );
    assert_eq!(
        session
            .rows_from_window(&[0b0110, 0], session.revision())
            .map(|rows| rows.num_rows()),
        Ok(9)
    );
}

#[test]
fn the_rows_from_a_window_need_a_project() {
    let session = Session::new();
    assert_eq!(
        session.rows_from_window(&[], Revision::ZERO),
        Err(CommandError::NoProject)
    );
}

/// The snapshot after a load at 1, Spain selected at 2, a lasso of rows 1
/// and 2 into Spain at 3, a hover on row 2 (sequence number 2), and
/// `cluster` made active at 4, as docs/core.md, section 5, lays it out. The
/// same bytes are decoded in src/backend/decodeMessage.test.ts.
#[rustfmt::skip]
const SNAPSHOT_AFTER_EDITS: [u8; 376] = [
    0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, // snapshot at 4
    0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 24, 0, 0, 0, // no time; project part
    1, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, // open, 4 rows
    1, 0, 0, 0, 0, 0, 0, 0, 11, 0, 0, 0, 8, 0, 0, 0, // loaded at 1; shape part
    1, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 7, 0, 0, 0, // shape at 1; active part
    3, 0, 0, 0, 255, 255, 0, 0, 3, 0, 0, 0, 9, 0, 0, 0, // cluster, none; selection part
    4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 4 rows, none selected
    5, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, // undo part: can undo
    6, 0, 0, 0, 120, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0, // columns part: 7 columns
    0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, // the names, at 1
    1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, // height at 1
    2, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, // origin at 3
    3, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, // cluster at 1
    4, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, // seeds at 1
    5, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, // fertile at 1
    6, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, // note at 1
    4, 0, 0, 0, 24, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, // codes of origin
    3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // at 3: Spain four times
    4, 0, 0, 0, 24, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, // codes of cluster
    1, 0, 0, 0, 0, 0, 0, 0, 255, 255, 2, 0, 2, 0, 0, 0, // at 1: missing, C, C, A
    4, 0, 0, 0, 24, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, // codes of fertile
    1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 255, 255, 1, 0, // at 1: TRUE, FALSE, missing, TRUE
    7, 0, 0, 0, 12, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, // hover part, sequence 2
    2, 0, 0, 0, 0, 0, 0, 0, // row 2
];

#[test]
fn a_snapshot_after_edits_holds_every_value_of_the_session() {
    let (mut session, _recorder) = editing_spain();
    let request = assign(&session, SPAIN, &[1, 2]);
    session.dispatch(request).unwrap();
    apply(
        &mut session,
        Command::SetHover {
            row: Some(RowIndex::new(2)),
        },
    );
    apply(
        &mut session,
        Command::SetActiveClassification {
            column: Some(CLUSTER),
        },
    );
    let snapshot = session
        .subscribe(WindowLabel::main(), Box::new(Recorder::default()))
        .unwrap();
    assert_eq!(snapshot, SNAPSHOT_AFTER_EDITS);
}

#[test]
fn selecting_the_population_already_selected_changes_nothing() {
    let (mut session, recorder) = editing_spain();
    assert_eq!(
        apply(
            &mut session,
            Command::SelectPopulation {
                column: ORIGIN,
                selected: Some(Selected::Population(SPAIN))
            }
        ),
        Changed::Nothing
    );
    assert!(recorder.take().is_empty());
}

/// The undo part of the only message `recorder` received.
fn undo_part(recorder: &Recorder) -> Vec<u8> {
    let messages = recorder.take();
    assert_eq!(messages.len(), 1);
    decode(&messages[0])
        .parts
        .into_iter()
        .find(|(kind, _)| *kind == UNDO)
        .unwrap()
        .1
}

#[test]
fn the_undo_part_says_what_can_be_undone_and_redone_after_two_lassos() {
    let (mut session, recorder) = editing_spain();
    let request = assign(&session, SPAIN, &[1]);
    session.dispatch(request).unwrap();
    let request = assign(&session, SPAIN, &[2]);
    session.dispatch(request).unwrap();
    recorder.take();
    for (command, expected) in [
        (Command::Undo, [1, 1]),
        (Command::Undo, [0, 1]),
        (Command::Redo, [1, 1]),
        (Command::Redo, [1, 0]),
    ] {
        apply(&mut session, command);
        let undo_redo = session.undo_redo();
        assert_eq!(undo_part(&recorder), expected);
        assert_eq!(
            [u8::from(undo_redo.can_undo), u8::from(undo_redo.can_redo)],
            expected
        );
    }
}

#[test]
fn the_unassigned_individuals_can_be_selected_like_a_population() {
    let (mut session, recorder) = loaded();
    assert_eq!(
        apply(
            &mut session,
            Command::SelectPopulation {
                column: ORIGIN,
                selected: Some(Selected::Unassigned)
            }
        ),
        Changed::State(Revision::new(2))
    );
    assert_eq!(
        session.active(),
        Some(Active {
            column: ORIGIN,
            selected: Some(Selected::Unassigned)
        })
    );
    assert_eq!(
        decode(&recorder.take()[0]).parts,
        [(ACTIVE, vec![2, 0, 0, 0, 255, 255, 2])]
    );
}

#[test]
fn a_lasso_with_the_unassigned_selected_unassigns_its_rows_from_every_population() {
    let (mut session, _recorder) = loaded();
    apply(
        &mut session,
        Command::SelectPopulation {
            column: ORIGIN,
            selected: Some(Selected::Unassigned),
        },
    );
    // origin is Spain, Peru, missing, Spain; the lasso takes rows 0 to 2.
    let request = at(
        &session,
        Command::AssignRows {
            column: ORIGIN,
            target: Selected::Unassigned,
            rows: rows(&session, &[0, 1, 2]),
        },
    );
    assert_eq!(
        session.dispatch(request).unwrap().changed,
        Changed::State(Revision::new(3))
    );
    assert_eq!(codes_of(&session, ORIGIN), [None, None, None, code(0)]);
    apply(&mut session, Command::Undo);
    assert_eq!(
        codes_of(&session, ORIGIN),
        [code(0), code(1), None, code(0)]
    );
}

#[test]
fn a_lasso_whose_target_is_not_what_is_selected_is_refused() {
    let (mut session, _recorder) = editing_spain();
    let request = at(
        &session,
        Command::AssignRows {
            column: ORIGIN,
            target: Selected::Unassigned,
            rows: rows(&session, &[1]),
        },
    );
    assert_refused(
        &mut session,
        request,
        CommandError::NotSelected {
            target: Selected::Unassigned,
        },
    );
    apply(
        &mut session,
        Command::SelectPopulation {
            column: ORIGIN,
            selected: Some(Selected::Unassigned),
        },
    );
    // Remove mode is disabled with the unassigned selected: a window that
    // sends it all the same is refused.
    let request = at(
        &session,
        Command::UnassignRows {
            column: ORIGIN,
            population: SPAIN,
            rows: rows(&session, &[0]),
        },
    );
    assert_refused(
        &mut session,
        request,
        CommandError::NotSelected {
            target: Selected::Population(SPAIN),
        },
    );
}

const SEEDS: ColumnId = ColumnId::new(4);
const FERTILE: ColumnId = ColumnId::new(5);
const NOTE: ColumnId = ColumnId::new(6);

fn set_role(column: ColumnId, role: Role) -> Command {
    Command::SetRole { column, role }
}

#[test]
fn a_number_made_a_category_takes_a_revision_and_sends_its_codes_and_the_shape() {
    let (mut session, recorder) = loaded();
    assert_eq!(
        apply(&mut session, set_role(SEEDS, Role::Category)),
        Changed::State(Revision::new(2))
    );
    // The seeds, 10, 12, missing, 7, as levels 7, 10, 12.
    assert_eq!(codes_of(&session, SEEDS), [code(1), code(2), None, code(0)]);
    let messages = recorder.take();
    assert_eq!(messages.len(), 1);
    assert_eq!(part_kinds(&messages[0]), [SHAPE, CODES, COLUMNS, UNDO]);
    let decoded = decode(&messages[0]);
    assert_eq!(decoded.parts[0].1, [2, 0, 0, 0, 0, 0, 0, 0]);
    assert_eq!(
        decoded.parts[1].1,
        [
            4, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 1, 0, 2, 0, 255, 255, 0, 0
        ]
    );
    assert_eq!(session.describe().unwrap().shape_at, Revision::new(2));
}

#[test]
fn a_column_given_the_role_it_has_changes_nothing() {
    let (mut session, recorder) = loaded();
    assert_eq!(
        apply(&mut session, set_role(HEIGHT, Role::Number)),
        Changed::Nothing
    );
    assert!(recorder.take().is_empty());
    assert!(!session.undo_redo().can_undo);
}

#[test]
fn the_active_classification_made_a_category_is_no_longer_active() {
    let (mut session, recorder) = editing_spain();
    apply(&mut session, set_role(ORIGIN, Role::Category));
    assert_eq!(session.active(), None);
    let messages = recorder.take();
    assert_eq!(
        part_kinds(&messages[0]),
        [SHAPE, ACTIVE, CODES, COLUMNS, UNDO]
    );
    // A category cannot be made the active classification, nor lassoed.
    let request = at(
        &session,
        Command::SetActiveClassification {
            column: Some(ORIGIN),
        },
    );
    assert_refused(
        &mut session,
        request,
        CommandError::NotClassification { column: ORIGIN },
    );
    let request = at(
        &session,
        Command::SetActiveClassification {
            column: Some(FERTILE),
        },
    );
    assert_refused(
        &mut session,
        request,
        CommandError::NotClassification { column: FERTILE },
    );
}

#[test]
fn undoing_a_change_of_role_gives_back_the_levels_their_colours_and_the_empty_ones() {
    let (mut session, _recorder) = loaded();
    // cluster has three levels; row 1 and 2 are in C, row 3 in A, B is empty.
    let before = session.table().unwrap().column(CLUSTER).unwrap().clone();
    apply(&mut session, set_role(CLUSTER, Role::Text));
    apply(&mut session, set_role(CLUSTER, Role::Classification));
    // Built again from the text: B is gone, and the colours start again.
    let rebuilt = session.table().unwrap().column(CLUSTER).unwrap();
    assert_eq!(
        rebuilt.categorical().unwrap().levels(),
        &LevelValues::Text(vec!["A".to_owned(), "C".to_owned()])
    );
    apply(&mut session, Command::Undo);
    apply(&mut session, Command::Undo);
    let after = session.table().unwrap().column(CLUSTER).unwrap();
    assert_eq!(after.values(), before.values());
    assert_eq!(after.revision(), Revision::new(5));
    apply(&mut session, Command::Redo);
    assert_eq!(
        session
            .table()
            .unwrap()
            .column(CLUSTER)
            .unwrap()
            .values()
            .role(),
        Role::Text
    );
}

#[test]
fn a_role_the_storage_type_cannot_take_and_the_first_column_are_refused() {
    let (mut session, _recorder) = loaded();
    for (column, role, expected) in [
        (
            NOTE,
            Role::Number,
            CommandError::RoleNotPossible {
                column: NOTE,
                storage: StorageType::Text,
                role: Role::Number,
            },
        ),
        (
            FERTILE,
            Role::Number,
            CommandError::RoleNotPossible {
                column: FERTILE,
                storage: StorageType::Boolean,
                role: Role::Number,
            },
        ),
        (
            SEEDS,
            Role::Text,
            CommandError::RoleNotPossible {
                column: SEEDS,
                storage: StorageType::Integer,
                role: Role::Text,
            },
        ),
        (
            ColumnId::new(0),
            Role::Category,
            CommandError::UnknownColumn {
                column: ColumnId::new(0),
            },
        ),
        (
            ColumnId::new(9),
            Role::Category,
            CommandError::UnknownColumn {
                column: ColumnId::new(9),
            },
        ),
    ] {
        let request = at(&session, set_role(column, role));
        assert_refused(&mut session, request, expected);
    }
}
