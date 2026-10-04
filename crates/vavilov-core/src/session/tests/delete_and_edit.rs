//! A group of the active classification deleted, or given another
//! name or colour, with undo and redo, the filter, and the refusal of a
//! command made before the levels changed (`docs/design.md`, section 2.1;
//! `docs/core.md`, section 4).

use super::*;
use crate::error::GroupRefusal;
use crate::filter::Filter;
use crate::fixtures::{BLUE, VERMILLION};
use crate::table::{Categorical, Colour, PALETTE};

const FERTILE: ColumnId = ColumnId::new(5);

fn delete(session: &Session, group: LevelCode) -> Request {
    at(
        session,
        Command::DeleteGroup {
            column: ORIGIN,
            group,
        },
    )
}

fn edit(session: &Session, group: LevelCode, name: &str, colour: Colour) -> Request {
    edit_in(session, ORIGIN, group, name, colour)
}

fn edit_in(
    session: &Session,
    column: ColumnId,
    group: LevelCode,
    name: &str,
    colour: Colour,
) -> Request {
    at(
        session,
        Command::EditGroup {
            column,
            group,
            name: name.to_owned(),
            colour,
            decimal_mark: ".".to_owned(),
        },
    )
}

fn categorical_of(session: &Session, column: ColumnId) -> Categorical {
    session
        .table()
        .unwrap()
        .column(column)
        .unwrap()
        .categorical()
        .unwrap()
        .clone()
}

fn levels_at(session: &Session) -> u64 {
    session
        .table()
        .unwrap()
        .column(ORIGIN)
        .unwrap()
        .levels_at
        .get()
}

fn texts(levels: &[&str]) -> LevelValues {
    LevelValues::Text(levels.iter().map(|level| (*level).to_owned()).collect())
}

fn select(session: &mut Session, selected: Option<Selected>) {
    apply(
        session,
        Command::SelectGroups {
            column: ORIGIN,
            selected: selected.map_or_else(SelectedGroups::none, SelectedGroups::one),
        },
    );
}

fn filter(session: &mut Session, text: &str) {
    apply(
        session,
        Command::SetFilter {
            filter: Filter {
                condition: crate::filter::Condition::Contains {
                    text: text.to_owned(),
                },
                ..Filter::none()
            },
            decimal_mark: ".".to_owned(),
        },
    );
}

fn shown(session: &Session) -> Vec<u32> {
    let open = session.state.project.as_open().unwrap();
    open.interaction
        .shown
        .rows
        .as_ref()
        .unwrap()
        .iter()
        .map(|row| row.get())
        .collect()
}

fn refused(column_name: &str, text: &str, refusal: GroupRefusal) -> CommandError {
    CommandError::GroupRefused {
        column_name: column_name.to_owned(),
        text: text.to_owned(),
        refusal,
    }
}

#[test]
fn a_group_deleted_leaves_its_individuals_unassigned_and_the_codes_after_it_move_down() {
    let (mut session, recorder) = editing_spain();
    let request = delete(&session, SPAIN);
    assert_eq!(
        session.dispatch(request).unwrap().changed,
        Changed::State(Revision::new(3))
    );
    let origin = categorical_of(&session, ORIGIN);
    assert_eq!(origin.levels(), &texts(&["Peru"]));
    assert_eq!(origin.colours(), [BLUE]);
    // Spain's p1 and p4 are unassigned, and Peru's p2 takes code 0.
    assert_eq!(origin.codes(), [None, code(0), None, None]);
    assert_eq!(
        session.active(),
        Some(Active {
            column: ORIGIN,
            selected: SelectedGroups::none(),
            mode: None,
        })
    );
    // Code 0 now means Peru: the levels take the revision of the deletion.
    assert_eq!(levels_at(&session), 3);
    assert_eq!(revision_of(&session, ORIGIN), 3);
    assert_eq!(session.state.project.open().unwrap().shape_at.get(), 3);
    assert_eq!(
        session.undo_redo(),
        UndoRedo {
            can_undo: true,
            can_redo: false
        }
    );
    let messages = recorder.take();
    assert_eq!(messages.len(), 1);
    assert_eq!(
        decode(&messages[0]).parts,
        [
            (SHAPE, vec![3, 0, 0, 0, 0, 0, 0, 0]),
            (ACTIVE, vec![2, 0, 0, 0, 0, 0, 0, 0]),
            (
                CODES,
                vec![
                    2, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 255, 255, 0, 0, 255, 255, 255,
                    255
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
fn undo_gives_a_deleted_group_back_in_its_place_with_its_individuals_and_redo_deletes_it_again() {
    let (mut session, recorder) = editing_spain();
    let before = categorical_of(&session, ORIGIN);
    let request = delete(&session, SPAIN);
    session.dispatch(request).unwrap();
    let after = categorical_of(&session, ORIGIN);
    recorder.take();

    assert_eq!(
        apply(&mut session, Command::Undo),
        Changed::State(Revision::new(4))
    );
    assert_eq!(categorical_of(&session, ORIGIN), before);
    // It comes back unselected, as a group added comes back on redo.
    assert_eq!(
        session.active(),
        Some(Active {
            column: ORIGIN,
            selected: SelectedGroups::none(),
            mode: None,
        })
    );
    assert_eq!(levels_at(&session), 4);
    assert_eq!(
        part_kinds(&recorder.take()[0]),
        [SHAPE, CODES, COLUMNS, UNDO]
    );

    assert_eq!(
        apply(&mut session, Command::Redo),
        Changed::State(Revision::new(5))
    );
    assert_eq!(categorical_of(&session, ORIGIN), after);
    assert_eq!(levels_at(&session), 5);
}

#[test]
fn deleting_the_selected_group_releases_the_button_pressed() {
    let (mut session, _recorder) = editing_spain();
    apply(
        &mut session,
        Command::SetEditMode {
            column: ORIGIN,
            selected: SelectedGroups::one(Selected::Group(SPAIN)),
            mode: Some(EditMode::Add),
        },
    );
    let request = delete(&session, SPAIN);
    session.dispatch(request).unwrap();
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
fn a_group_selected_after_the_one_deleted_stays_selected_at_its_new_code() {
    let (mut session, recorder) = loaded();
    select(&mut session, Some(Selected::Group(PERU)));
    apply(
        &mut session,
        Command::SetEditMode {
            column: ORIGIN,
            selected: SelectedGroups::one(Selected::Group(PERU)),
            mode: Some(EditMode::Remove),
        },
    );
    recorder.take();
    let request = delete(&session, SPAIN);
    session.dispatch(request).unwrap();
    let peru_first = Active {
        column: ORIGIN,
        selected: SelectedGroups::one(Selected::Group(SPAIN)),
        mode: Some(EditMode::Remove),
    };
    assert_eq!(session.active(), Some(peru_first.clone()));
    assert_eq!(
        decode(&recorder.take()[0]).parts[1],
        (ACTIVE, vec![2, 0, 0, 0, 2, 0, 1, 0, 0, 0])
    );
    // Undone, Spain comes back before it, and Peru is code 1 again.
    apply(&mut session, Command::Undo);
    assert_eq!(
        session.active(),
        Some(Active {
            selected: SelectedGroups::one(Selected::Group(PERU)),
            ..peru_first
        })
    );
}

#[test]
fn a_group_before_the_one_deleted_stays_selected_with_no_active_part() {
    let (mut session, recorder) = loaded();
    select(&mut session, Some(Selected::Group(SPAIN)));
    recorder.take();
    let request = delete(&session, PERU);
    session.dispatch(request).unwrap();
    assert_eq!(
        session.active().unwrap().selected,
        SelectedGroups::one(Selected::Group(SPAIN))
    );
    assert_eq!(
        part_kinds(&recorder.take()[0]),
        [SHAPE, CODES, COLUMNS, UNDO]
    );
}

#[test]
fn a_command_made_before_a_group_was_deleted_is_refused() {
    let (mut session, _recorder) = loaded();
    select(&mut session, Some(Selected::Group(PERU)));
    // A window makes these at revision 2, while Peru is code 1; then
    // Spain is deleted, at 3, and Peru becomes code 0.
    let lasso = assign(&session, PERU, &[0]);
    let deletion = delete(&session, PERU);
    let edition = edit(&session, PERU, "Chile", BLUE);
    let request = delete(&session, SPAIN);
    session.dispatch(request).unwrap();
    let changed = CommandError::LevelsChanged {
        column: ORIGIN,
        based_on: Revision::new(2),
        levels_at: Revision::new(3),
    };
    assert_refused(&mut session, lasso, changed.clone());
    assert_refused(&mut session, deletion, changed.clone());
    assert_refused(&mut session, edition, changed);
}

#[test]
fn a_group_is_deleted_or_edited_in_the_active_classification_only_and_if_it_is_there() {
    let (mut session, _recorder) = loaded();
    let request = at(
        &session,
        Command::DeleteGroup {
            column: CLUSTER,
            group: SPAIN,
        },
    );
    assert_refused(
        &mut session,
        request,
        CommandError::NotActiveClassification { column: CLUSTER },
    );
    let request = edit_in(&session, CLUSTER, SPAIN, "D", BLUE);
    assert_refused(
        &mut session,
        request,
        CommandError::NotActiveClassification { column: CLUSTER },
    );
    let unknown = CommandError::UnknownLevel {
        column: ORIGIN,
        code: LevelCode::new(2),
        num_levels: 2,
    };
    let request = delete(&session, LevelCode::new(2));
    assert_refused(&mut session, request, unknown.clone());
    let request = edit(&session, LevelCode::new(2), "Chile", BLUE);
    assert_refused(&mut session, request, unknown);
}

#[test]
fn deleting_a_group_changes_the_rows_the_filter_shows_and_undo_gives_them_back() {
    let (mut session, recorder) = loaded();
    filter(&mut session, "Spain");
    assert_eq!(shown(&session), [0, 3]);
    recorder.take();
    let request = delete(&session, SPAIN);
    session.dispatch(request).unwrap();
    assert_eq!(shown(&session), [] as [u32; 0]);
    assert_eq!(
        part_kinds(&recorder.take()[0]),
        [SHAPE, CODES, COLUMNS, UNDO, FILTER]
    );
    apply(&mut session, Command::Undo);
    assert_eq!(shown(&session), [0, 3]);
}

#[test]
fn a_group_given_another_name_and_colour_keeps_its_code_and_its_individuals() {
    let (mut session, recorder) = editing_spain();
    let before = categorical_of(&session, ORIGIN);
    let request = edit(&session, SPAIN, " España ", PALETTE[9]);
    assert_eq!(
        session.dispatch(request).unwrap().changed,
        Changed::State(Revision::new(3))
    );
    let origin = categorical_of(&session, ORIGIN);
    assert_eq!(origin.levels(), &texts(&["España", "Peru"]));
    assert_eq!(origin.colours(), [PALETTE[9], BLUE]);
    assert_eq!(origin.codes(), before.codes());
    assert_eq!(
        session.active().unwrap().selected,
        SelectedGroups::one(Selected::Group(SPAIN))
    );
    // Every code keeps its meaning.
    assert_eq!(levels_at(&session), 1);
    assert_eq!(session.state.project.open().unwrap().shape_at.get(), 3);
    assert_eq!(
        part_kinds(&recorder.take()[0]),
        [SHAPE, CODES, COLUMNS, UNDO]
    );

    apply(&mut session, Command::Undo);
    assert_eq!(categorical_of(&session, ORIGIN), before);
    apply(&mut session, Command::Redo);
    assert_eq!(categorical_of(&session, ORIGIN), origin);
    assert_eq!(levels_at(&session), 1);
}

#[test]
fn a_group_keeps_its_name_with_another_colour_and_the_same_of_both_changes_nothing() {
    let (mut session, recorder) = editing_spain();
    let request = edit(&session, SPAIN, "Spain", PALETTE[2]);
    session.dispatch(request).unwrap();
    assert_eq!(
        categorical_of(&session, ORIGIN).colours(),
        [PALETTE[2], BLUE]
    );
    recorder.take();
    let request = edit(&session, PERU, "Peru", BLUE);
    assert_eq!(session.dispatch(request).unwrap().changed, Changed::Nothing);
    assert_eq!(recorder.take().len(), 0);
}

#[test]
fn a_name_that_is_another_groups_empty_or_too_long_is_refused() {
    let (mut session, _recorder) = editing_spain();
    let request = edit(&session, SPAIN, "Peru", VERMILLION);
    assert_refused(
        &mut session,
        request,
        refused("origin", "Peru", GroupRefusal::Taken { code: PERU }),
    );
    let request = edit(&session, SPAIN, "  ", VERMILLION);
    assert_refused(
        &mut session,
        request,
        refused("origin", "  ", GroupRefusal::EmptyName),
    );
    let long = "Kingdom of the Netherlands, the";
    let request = edit(&session, SPAIN, long, VERMILLION);
    assert_refused(
        &mut session,
        request,
        refused("origin", long, GroupRefusal::TooLong { max_chars: 30 }),
    );
}

#[test]
fn a_classification_of_yes_or_no_takes_only_the_one_of_true_or_false_it_lacks() {
    let (mut session, _recorder) = loaded();
    apply(
        &mut session,
        Command::SetActiveClassification {
            column: Some(FERTILE),
        },
    );
    // FALSE is code 0 and TRUE code 1.
    let request = edit_in(&session, FERTILE, LevelCode::new(0), "true", PALETTE[0]);
    assert_refused(
        &mut session,
        request,
        refused(
            "fertile",
            "true",
            GroupRefusal::Taken {
                code: LevelCode::new(1),
            },
        ),
    );
    let request = edit_in(&session, FERTILE, LevelCode::new(0), "maybe", PALETTE[0]);
    assert_refused(
        &mut session,
        request,
        refused("fertile", "maybe", GroupRefusal::NotYesOrNo),
    );
}

#[test]
fn a_group_of_countries_renamed_by_any_name_of_a_country_keeps_its_code() {
    let (mut session, _recorder) = loaded();
    apply(&mut session, set_role(ORIGIN, Role::Country));
    let request = edit(&session, SPAIN, "Chile", PALETTE[0]);
    session.dispatch(request).unwrap();
    assert_eq!(
        categorical_of(&session, ORIGIN).levels(),
        &texts(&["CHL", "PER"])
    );
    let request = edit(&session, SPAIN, "Atlantis", PALETTE[0]);
    assert_refused(
        &mut session,
        request,
        refused("origin", "Atlantis", GroupRefusal::NotACountry),
    );
}

#[test]
fn a_colour_not_in_the_list_is_a_defect() {
    let (mut session, _recorder) = editing_spain();
    let request = edit(
        &session,
        SPAIN,
        "Spain",
        Colour {
            red: 1,
            green: 2,
            blue: 3,
        },
    );
    let before = session.state.clone();
    assert!(matches!(
        session.dispatch(request),
        Err(CommandError::Defect { .. })
    ));
    assert_eq!(session.state, before);
}

#[test]
fn renaming_a_group_changes_the_rows_the_filter_shows() {
    let (mut session, recorder) = loaded();
    filter(&mut session, "Spain");
    recorder.take();
    let request = edit(&session, SPAIN, "Chile", VERMILLION);
    session.dispatch(request).unwrap();
    assert_eq!(shown(&session), [] as [u32; 0]);
    assert_eq!(
        part_kinds(&recorder.take()[0]),
        [SHAPE, CODES, COLUMNS, UNDO, FILTER]
    );
    apply(&mut session, Command::Undo);
    assert_eq!(shown(&session), [0, 3]);
}

#[test]
fn a_name_typed_with_an_accent_written_apart_is_kept_composed() {
    let (mut session, _recorder) = editing_spain();
    // "España" with the tilde as a character of its own after the n.
    let request = edit(&session, SPAIN, "Espan\u{303}a", VERMILLION);
    session.dispatch(request).unwrap();
    assert_eq!(
        categorical_of(&session, ORIGIN).levels(),
        &texts(&["Espa\u{f1}a", "Peru"])
    );
}
