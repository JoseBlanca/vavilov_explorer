//! Several groups selected at once: how the selection crosses to a
//! window, the buttons it allows, − and a lasso on all of them, and what a
//! group deleted or given back does to it (`docs/design.md`, section 2.1).

use super::*;
use crate::session::EditMode;

fn both() -> SelectedGroups {
    SelectedGroups::from_list([Selected::Group(PERU), Selected::Group(SPAIN)]).unwrap()
}

fn select(session: &mut Session, selected: SelectedGroups) -> Changed {
    apply(
        session,
        Command::SelectGroups {
            column: ORIGIN,
            selected,
        },
    )
}

fn press(session: &Session, selected: SelectedGroups, mode: Option<EditMode>) -> Request {
    at(
        session,
        Command::SetEditMode {
            column: ORIGIN,
            selected,
            mode,
        },
    )
}

#[test]
fn several_groups_are_selected_in_the_order_of_their_codes_and_sent_so() {
    let (mut session, recorder) = loaded();
    let selected = SelectedGroups::from_list([
        Selected::Unassigned,
        Selected::Group(PERU),
        Selected::Group(SPAIN),
    ])
    .unwrap();
    assert_eq!(
        select(&mut session, selected.clone()),
        Changed::State(Revision::new(2))
    );
    assert_eq!(session.active().unwrap().selected, selected);
    assert_eq!(
        decode(&recorder.take()[0]).parts,
        // origin, no button, the unassigned, two groups: 0 and 1.
        [(ACTIVE, vec![2, 0, 0, 0, 0, 1, 2, 0, 0, 0, 1, 0])]
    );
    // The same groups, given in another order, change nothing.
    let again = SelectedGroups::from_list([
        Selected::Group(SPAIN),
        Selected::Group(PERU),
        Selected::Unassigned,
    ])
    .unwrap();
    assert_eq!(select(&mut session, again), Changed::Nothing);
}

#[test]
fn a_selection_crosses_as_a_list_and_one_with_a_row_twice_is_refused() {
    let selected =
        SelectedGroups::from_list([Selected::Unassigned, Selected::Group(PERU)]).unwrap();
    assert_eq!(
        serde_json::to_value(&selected).unwrap(),
        serde_json::json!([{ "group": 1 }, "unassigned"])
    );
    let read: SelectedGroups =
        serde_json::from_value(serde_json::json!(["unassigned", { "group": 1 }])).unwrap();
    assert_eq!(read, selected);
    assert!(
        serde_json::from_value::<SelectedGroups>(
            serde_json::json!([{ "group": 1 }, { "group": 1 }])
        )
        .is_err()
    );
    assert!(matches!(
        SelectedGroups::from_list([Selected::Unassigned, Selected::Unassigned]),
        Err(CommandError::Defect { .. })
    ));
}

#[test]
fn a_selection_with_a_group_the_classification_does_not_have_is_refused() {
    let (mut session, _recorder) = loaded();
    let request = at(
        &session,
        Command::SelectGroups {
            column: ORIGIN,
            selected: SelectedGroups::from_list([
                Selected::Group(SPAIN),
                Selected::Group(LevelCode::new(2)),
            ])
            .unwrap(),
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
fn with_several_groups_selected_plus_is_a_defect_and_minus_takes_from_any_of_them() {
    let (mut session, recorder) = loaded();
    select(&mut session, both());
    let plus = press(&session, both(), Some(EditMode::Add));
    let before = session.state.clone();
    assert!(matches!(
        session.dispatch(plus),
        Err(CommandError::Defect { .. })
    ));
    assert_eq!(session.state, before);
    let minus = press(&session, both(), Some(EditMode::Remove));
    session.dispatch(minus).unwrap();
    recorder.take();
    // p1 of Spain, p2 of Peru and p3, unassigned already, enter the
    // selection: the first two leave their groups.
    let selection = rows(&session, &[0, 1, 2]);
    apply(&mut session, Command::SetSelection { rows: selection });
    assert_eq!(codes_of(&session, ORIGIN), [None, None, None, code(0)]);
    apply(&mut session, Command::Undo);
    assert_eq!(
        codes_of(&session, ORIGIN),
        [code(0), code(1), None, code(0)]
    );
}

#[test]
fn a_lasso_with_minus_on_several_groups_unassigns_the_rows_of_any_of_them() {
    let (mut session, _recorder) = loaded();
    let selected = SelectedGroups::from_list([
        Selected::Group(PERU),
        Selected::Group(SPAIN),
        Selected::Unassigned,
    ])
    .unwrap();
    select(&mut session, selected.clone());
    let lasso = at(
        &session,
        Command::UnassignRows {
            column: ORIGIN,
            selected,
            rows: rows(&session, &[1, 2, 3]),
        },
    );
    session.dispatch(lasso).unwrap();
    assert_eq!(codes_of(&session, ORIGIN), [code(0), None, None, None]);
    // A lasso made with another selection is refused.
    let stale = at(
        &session,
        Command::UnassignRows {
            column: ORIGIN,
            selected: both(),
            rows: rows(&session, &[0]),
        },
    );
    assert_refused(&mut session, stale, CommandError::NotSelected);
}

#[test]
fn another_selection_releases_the_button_pressed() {
    let (mut session, _recorder) = loaded();
    select(&mut session, both());
    let minus = press(&session, both(), Some(EditMode::Remove));
    session.dispatch(minus).unwrap();
    select(&mut session, SelectedGroups::one(Selected::Group(PERU)));
    assert_eq!(session.active().unwrap().mode, None);
}

#[test]
fn a_selected_group_deleted_leaves_the_selection_and_releases_minus_and_undo_moves_it_back() {
    let (mut session, _recorder) = loaded();
    select(&mut session, both());
    let minus = press(&session, both(), Some(EditMode::Remove));
    session.dispatch(minus).unwrap();
    let delete = at(
        &session,
        Command::DeleteGroup {
            column: ORIGIN,
            group: SPAIN,
        },
    );
    session.dispatch(delete).unwrap();
    // Peru is code 0 now, and still selected.
    let peru_now = SelectedGroups::one(Selected::Group(LevelCode::new(0)));
    assert_eq!(
        session.active(),
        Some(Active {
            column: ORIGIN,
            selected: peru_now,
            mode: None,
        })
    );
    // Spain given back before it, Peru is code 1 again, and Spain is not
    // selected.
    apply(&mut session, Command::Undo);
    assert_eq!(
        session.active().unwrap().selected,
        SelectedGroups::one(Selected::Group(PERU))
    );
}
