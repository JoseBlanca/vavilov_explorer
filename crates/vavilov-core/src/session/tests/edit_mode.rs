//! The buttons + and − of the groups panel, pressed on the selected
//! group: what they do to the rows selected when pressed and to those
//! that enter the selection after, their undo, and what releases them
//! (`docs/design.md`, section 2.1).

use super::*;
use crate::session::EditMode;

/// Sets the button pressed on what is selected in `origin`.
fn press(session: &Session, target: Selected, mode: Option<EditMode>) -> Request {
    at(
        session,
        Command::SetEditMode {
            column: ORIGIN,
            selected: SelectedGroups::one(target),
            mode,
        },
    )
}

fn select_rows(session: &mut Session, selected: &[u32]) -> Changed {
    let selection = rows(session, selected);
    apply(session, Command::SetSelection { rows: selection })
}

fn mode_of(session: &Session) -> Option<EditMode> {
    session.active().and_then(|active| active.mode)
}

/// `editing_spain`, with + pressed and nothing selected, at revision 3.
fn adding_to_spain() -> (Session, Recorder) {
    let (mut session, recorder) = editing_spain();
    let request = press(&session, Selected::Group(SPAIN), Some(EditMode::Add));
    session.dispatch(request).unwrap();
    recorder.take();
    (session, recorder)
}

#[test]
fn pressing_plus_with_nothing_selected_changes_the_button_alone() {
    let (mut session, recorder) = editing_spain();
    let request = press(&session, Selected::Group(SPAIN), Some(EditMode::Add));
    assert_eq!(
        session.dispatch(request).unwrap().changed,
        Changed::State(Revision::new(3))
    );
    assert_eq!(mode_of(&session), Some(EditMode::Add));
    assert_eq!(
        decode(&recorder.take()[0]).parts,
        [(ACTIVE, vec![2, 0, 0, 0, 1, 0, 1, 0, 0, 0])]
    );
    assert_eq!(
        session.undo_redo(),
        UndoRedo {
            can_undo: false,
            can_redo: false
        }
    );
    // Pressed again as it is, nothing changes.
    let request = press(&session, Selected::Group(SPAIN), Some(EditMode::Add));
    assert_eq!(session.dispatch(request).unwrap().changed, Changed::Nothing);
}

#[test]
fn pressing_plus_assigns_the_rows_selected_in_the_same_command() {
    let (mut session, recorder) = editing_spain();
    // origin is Spain, Peru, missing, Spain; rows 1 and 2 are selected.
    select_rows(&mut session, &[1, 2]);
    recorder.take();
    let request = press(&session, Selected::Group(SPAIN), Some(EditMode::Add));
    assert_eq!(
        session.dispatch(request).unwrap().changed,
        Changed::State(Revision::new(4))
    );
    assert_eq!(
        codes_of(&session, ORIGIN),
        [code(0), code(0), code(0), code(0)]
    );
    assert_eq!(mode_of(&session), Some(EditMode::Add));
    let messages = recorder.take();
    assert_eq!(messages.len(), 1);
    assert_eq!(part_kinds(&messages[0]), [ACTIVE, CODES, COLUMNS, UNDO]);
    // One undo gives the codes back, and leaves the button pressed.
    apply(&mut session, Command::Undo);
    assert_eq!(
        codes_of(&session, ORIGIN),
        [code(0), code(1), None, code(0)]
    );
    assert_eq!(mode_of(&session), Some(EditMode::Add));
}

#[test]
fn with_plus_pressed_only_the_rows_entering_the_selection_are_assigned() {
    let (mut session, recorder) = adding_to_spain();
    // Peru's row enters: it goes to Spain, with the selection, in one
    // command.
    assert_eq!(
        select_rows(&mut session, &[1]),
        Changed::State(Revision::new(4))
    );
    assert_eq!(
        codes_of(&session, ORIGIN),
        [code(0), code(0), None, code(0)]
    );
    assert_eq!(
        part_kinds(&recorder.take()[0]),
        [SELECTION, CODES, COLUMNS, UNDO]
    );
    // The missing row enters with row 1, already Spain.
    select_rows(&mut session, &[1, 2]);
    assert_eq!(
        codes_of(&session, ORIGIN),
        [code(0), code(0), code(0), code(0)]
    );
    // Rows that leave the selection, or enter it in Spain already, change
    // nothing but the selection, and leave nothing to undo of it.
    let before = session.state.project.open().unwrap().history.undo.len();
    select_rows(&mut session, &[3]);
    recorder.take();
    assert_eq!(
        session.state.project.open().unwrap().history.undo.len(),
        before
    );
    // Each assignment is its own undo.
    apply(&mut session, Command::Undo);
    assert_eq!(
        codes_of(&session, ORIGIN),
        [code(0), code(0), None, code(0)]
    );
    apply(&mut session, Command::Undo);
    assert_eq!(
        codes_of(&session, ORIGIN),
        [code(0), code(1), None, code(0)]
    );
    assert_eq!(session.selection().unwrap(), &rows(&session, &[3]));
}

#[test]
fn a_row_that_stays_selected_is_not_assigned_again() {
    let (mut session, _recorder) = adding_to_spain();
    select_rows(&mut session, &[1]);
    // Undo puts row 1 back in Peru, and it stays selected.
    apply(&mut session, Command::Undo);
    select_rows(&mut session, &[1, 2]);
    // Only row 2, which entered, goes to Spain.
    assert_eq!(
        codes_of(&session, ORIGIN),
        [code(0), code(1), code(0), code(0)]
    );
}

#[test]
fn with_minus_pressed_only_the_rows_entering_that_are_in_the_group_are_unassigned() {
    let (mut session, recorder) = editing_spain();
    let request = press(&session, Selected::Group(SPAIN), Some(EditMode::Remove));
    session.dispatch(request).unwrap();
    assert_eq!(
        decode(&recorder.take()[0]).parts,
        [(ACTIVE, vec![2, 0, 0, 0, 2, 0, 1, 0, 0, 0])]
    );
    select_rows(&mut session, &[0, 1, 2]);
    // Spain's row 0 is unassigned; Peru's row 1 and the missing row 2 stay.
    assert_eq!(codes_of(&session, ORIGIN), [None, code(1), None, code(0)]);
}

#[test]
fn pressing_minus_unassigns_the_rows_selected_that_are_in_the_group() {
    let (mut session, _recorder) = editing_spain();
    select_rows(&mut session, &[1, 3]);
    let request = press(&session, Selected::Group(SPAIN), Some(EditMode::Remove));
    session.dispatch(request).unwrap();
    assert_eq!(codes_of(&session, ORIGIN), [code(0), code(1), None, None]);
}

#[test]
fn plus_on_the_unassigned_individuals_unassigns_the_rows_entering() {
    let (mut session, _recorder) = loaded();
    apply(
        &mut session,
        Command::SelectGroups {
            column: ORIGIN,
            selected: SelectedGroups::one(Selected::Unassigned),
        },
    );
    let request = press(&session, Selected::Unassigned, Some(EditMode::Add));
    session.dispatch(request).unwrap();
    select_rows(&mut session, &[0, 1]);
    assert_eq!(codes_of(&session, ORIGIN), [None, None, None, code(0)]);
}

#[test]
fn a_button_pressed_on_what_is_not_selected_or_minus_on_the_unassigned_is_refused() {
    let (mut session, _recorder) = loaded();
    let nothing = at(
        &session,
        Command::SetEditMode {
            column: ORIGIN,
            selected: SelectedGroups::none(),
            mode: Some(EditMode::Add),
        },
    );
    assert_refused(&mut session, nothing, CommandError::NoGroupSelected);
    // Made while Spain was selected, which it no longer is.
    let request = press(&session, Selected::Group(SPAIN), Some(EditMode::Add));
    assert_refused(&mut session, request, CommandError::NotSelected);
    apply(
        &mut session,
        Command::SelectGroups {
            column: ORIGIN,
            selected: SelectedGroups::one(Selected::Unassigned),
        },
    );
    let request = press(&session, Selected::Group(PERU), Some(EditMode::Add));
    assert_refused(&mut session, request, CommandError::NotSelected);
    // − on the unassigned individuals, who are in no group, is never
    // offered by a window.
    let request = press(&session, Selected::Unassigned, Some(EditMode::Remove));
    let before = session.state.clone();
    assert!(matches!(
        session.dispatch(request),
        Err(CommandError::Defect { .. })
    ));
    assert_eq!(session.state, before);
    let request = at(
        &session,
        Command::SetEditMode {
            column: CLUSTER,
            selected: SelectedGroups::one(Selected::Unassigned),
            mode: Some(EditMode::Add),
        },
    );
    assert_refused(
        &mut session,
        request,
        CommandError::NotActiveClassification { column: CLUSTER },
    );
}

#[test]
fn pressing_the_other_button_releases_the_first_and_acts_on_the_selection() {
    let (mut session, _recorder) = adding_to_spain();
    select_rows(&mut session, &[1]);
    let request = press(&session, Selected::Group(SPAIN), Some(EditMode::Remove));
    session.dispatch(request).unwrap();
    assert_eq!(mode_of(&session), Some(EditMode::Remove));
    // Row 1, put in Spain by +, is taken out by −.
    assert_eq!(codes_of(&session, ORIGIN), [code(0), None, None, code(0)]);
}

#[test]
fn the_button_is_released_by_pressing_it_again_and_by_another_selection_for_editing() {
    let (mut session, recorder) = adding_to_spain();
    let request = press(&session, Selected::Group(SPAIN), None);
    session.dispatch(request).unwrap();
    assert_eq!(mode_of(&session), None);
    assert_eq!(
        decode(&recorder.take()[0]).parts,
        [(ACTIVE, vec![2, 0, 0, 0, 0, 0, 1, 0, 0, 0])]
    );
    select_rows(&mut session, &[1]);
    assert_eq!(
        codes_of(&session, ORIGIN),
        [code(0), code(1), None, code(0)]
    );

    for release in [
        Command::SelectGroups {
            column: ORIGIN,
            selected: SelectedGroups::one(Selected::Group(PERU)),
        },
        Command::SelectGroups {
            column: ORIGIN,
            selected: SelectedGroups::none(),
        },
        Command::SetActiveClassification {
            column: Some(CLUSTER),
        },
        Command::AddGroup {
            column: ORIGIN,
            name: "China".to_owned(),
            decimal_mark: ".".to_owned(),
        },
        set_role(ORIGIN, Role::Country),
        Command::LoadTable {
            table: plants(),
            active_classification: Some(ORIGIN),
        },
    ] {
        let (mut session, _recorder) = adding_to_spain();
        let name = format!("{release:?}");
        apply(&mut session, release);
        assert_eq!(mode_of(&session), None, "{name}");
    }
}

#[test]
fn undoing_a_group_added_releases_the_button_pressed_on_it() {
    let (mut session, _recorder) = loaded();
    let request = at(
        &session,
        Command::AddGroup {
            column: ORIGIN,
            name: "China".to_owned(),
            decimal_mark: ".".to_owned(),
        },
    );
    session.dispatch(request).unwrap();
    let request = press(
        &session,
        Selected::Group(LevelCode::new(2)),
        Some(EditMode::Add),
    );
    session.dispatch(request).unwrap();
    apply(&mut session, Command::Undo);
    assert_eq!(
        session.active(),
        Some(Active {
            column: ORIGIN,
            selected: SelectedGroups::none(),
            mode: None,
        })
    );
}

#[test]
fn a_button_pressed_from_before_the_levels_changed_is_refused() {
    let (mut session, _recorder) = loaded();
    let request = at(
        &session,
        Command::SelectGroups {
            column: ORIGIN,
            selected: SelectedGroups::one(Selected::Group(SPAIN)),
        },
    );
    session.dispatch(request).unwrap();
    // Made at 2, before the role changed at 3 and Spain was selected again
    // at 4, now as ESP.
    let stale = press(&session, Selected::Group(SPAIN), Some(EditMode::Add));
    apply(&mut session, set_role(ORIGIN, Role::Country));
    apply(
        &mut session,
        Command::SelectGroups {
            column: ORIGIN,
            selected: SelectedGroups::one(Selected::Group(SPAIN)),
        },
    );
    assert_refused(
        &mut session,
        stale,
        CommandError::LevelsChanged {
            column: ORIGIN,
            based_on: Revision::new(2),
            levels_at: Revision::new(3),
        },
    );
}
