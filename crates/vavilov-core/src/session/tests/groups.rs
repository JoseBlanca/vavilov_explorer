//! A group added to the active classification, its undo and redo,
//! and the refusal of a command that names a level made before the levels
//! changed (`docs/design.md`, section 2.1; `docs/core.md`, section 4).

use super::*;
use crate::error::GroupRefusal;
use crate::fixtures::{BLUE, VERMILLION, column as new_column, names};
use crate::table::{Categorical, Colour, MAX_LEVELS, PALETTE};

const SEEDS: ColumnId = ColumnId::new(4);
const FERTILE: ColumnId = ColumnId::new(5);
const CHINA: LevelCode = LevelCode::new(2);
/// The first colour of the list that neither Spain, vermillion, nor Peru,
/// blue, has: orange.
const ORANGE: Colour = Colour {
    red: 230,
    green: 159,
    blue: 0,
};

fn add(session: &Session, column: ColumnId, name: &str, decimal_mark: &str) -> Request {
    at(
        session,
        Command::AddGroup {
            column,
            name: name.to_owned(),
            decimal_mark: decimal_mark.to_owned(),
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

fn levels_at(session: &Session, column: ColumnId) -> u64 {
    session
        .table()
        .unwrap()
        .column(column)
        .unwrap()
        .levels_at
        .get()
}

fn texts(levels: &[&str]) -> LevelValues {
    LevelValues::Text(levels.iter().map(|level| (*level).to_owned()).collect())
}

fn refused(column_name: &str, text: &str, refusal: GroupRefusal) -> CommandError {
    CommandError::GroupRefused {
        column_name: column_name.to_owned(),
        text: text.to_owned(),
        refusal,
    }
}

/// `loaded`, with `column` made a category, of whole or decimal numbers,
/// and active.
fn numbers_active(column: ColumnId) -> Session {
    let (mut session, _recorder) = loaded();
    apply(&mut session, set_role(column, Role::Category));
    apply(
        &mut session,
        Command::SetActiveClassification {
            column: Some(column),
        },
    );
    session
}

#[test]
fn a_group_added_goes_last_with_the_first_unused_colour_and_is_selected() {
    let (mut session, recorder) = editing_spain();
    let request = add(&session, ORIGIN, "  China ", ".");
    assert_eq!(
        session.dispatch(request).unwrap().changed,
        Changed::State(Revision::new(3))
    );
    let origin = categorical_of(&session, ORIGIN);
    assert_eq!(origin.levels(), &texts(&["Spain", "Peru", "China"]));
    assert_eq!(origin.colours(), [VERMILLION, BLUE, ORANGE]);
    assert_eq!(origin.codes(), [code(0), code(1), None, code(0)]);
    assert_eq!(
        session.active(),
        Some(Active {
            column: ORIGIN,
            selected: Some(Selected::Group(CHINA)),
            mode: None,
        })
    );
    assert_eq!(revision_of(&session, ORIGIN), 3);
    assert_eq!(session.state.project.open().unwrap().shape_at.get(), 3);
    // A group added last changes the meaning of no code.
    assert_eq!(levels_at(&session, ORIGIN), 1);
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
            (SHAPE, vec![3, 0, 0, 0, 0, 0, 0, 0]),
            (ACTIVE, vec![2, 0, 0, 0, 2, 0, 1, 0]),
            (
                CODES,
                vec![
                    2, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 255, 255, 0, 0
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
fn a_group_is_added_with_no_group_selected_and_rows_selected_alike() {
    let (mut session, _recorder) = loaded();
    let selection = rows(&session, &[1, 2]);
    apply(&mut session, Command::SetSelection { rows: selection });
    let request = add(&session, ORIGIN, "China", ".");
    session.dispatch(request).unwrap();
    // Nothing is assigned: the selection's rows keep their codes.
    assert_eq!(
        codes_of(&session, ORIGIN),
        [code(0), code(1), None, code(0)]
    );
    assert_eq!(
        session.active(),
        Some(Active {
            column: ORIGIN,
            selected: Some(Selected::Group(CHINA)),
            mode: None,
        })
    );
}

#[test]
fn a_name_that_is_empty_or_another_groups_is_refused() {
    let (mut session, _recorder) = editing_spain();
    let request = add(&session, ORIGIN, "  ", ".");
    assert_refused(
        &mut session,
        request,
        refused("origin", "  ", GroupRefusal::EmptyName),
    );
    let request = add(&session, ORIGIN, " Peru", ".");
    assert_refused(
        &mut session,
        request,
        refused("origin", " Peru", GroupRefusal::Taken { code: PERU }),
    );
    // A text is compared as typed, case and all: "spain" is another.
    let request = add(&session, ORIGIN, "spain", ".");
    session.dispatch(request).unwrap();
    assert_eq!(
        categorical_of(&session, ORIGIN).levels(),
        &texts(&["Spain", "Peru", "spain"])
    );
}

#[test]
fn a_group_is_added_to_the_active_classification_only() {
    let (mut session, _recorder) = loaded();
    let request = add(&session, CLUSTER, "D", ".");
    assert_refused(
        &mut session,
        request,
        CommandError::NotActiveClassification { column: CLUSTER },
    );
    apply(
        &mut session,
        Command::SetActiveClassification { column: None },
    );
    let request = add(&session, ORIGIN, "China", ".");
    assert_refused(
        &mut session,
        request,
        CommandError::NotActiveClassification { column: ORIGIN },
    );
}

#[test]
fn a_decimal_mark_no_region_has_is_a_defect() {
    let (mut session, _recorder) = loaded();
    let request = add(&session, ORIGIN, "China", "");
    assert_refused(
        &mut session,
        request,
        CommandError::Defect {
            what: "a group's name with the decimal mark \"\"".to_owned(),
        },
    );
}

#[test]
fn a_classification_of_whole_numbers_takes_a_whole_number_compared_by_its_value() {
    // seeds as a category: 7, 10, 12.
    let mut session = numbers_active(SEEDS);
    let request = add(&session, SEEDS, "1,5", ",");
    assert_refused(
        &mut session,
        request,
        refused("seeds", "1,5", GroupRefusal::NotWholeNumber),
    );
    let request = add(&session, SEEDS, "010", ",");
    assert_refused(
        &mut session,
        request,
        refused(
            "seeds",
            "010",
            GroupRefusal::Taken {
                code: LevelCode::new(1),
            },
        ),
    );
    let request = add(&session, SEEDS, " -3 ", ",");
    session.dispatch(request).unwrap();
    assert_eq!(
        categorical_of(&session, SEEDS).levels(),
        &LevelValues::Integer(vec![7, 10, 12, -3])
    );
}

#[test]
fn a_classification_of_decimal_numbers_reads_the_name_with_the_regions_mark() {
    // height as a category: 1.5, 2, 3.25.
    let mut session = numbers_active(HEIGHT);
    let request = add(&session, HEIGHT, "2.5", ",");
    assert_refused(
        &mut session,
        request,
        refused(
            "height",
            "2.5",
            GroupRefusal::NotDecimalNumber {
                decimal_mark: ",".to_owned(),
            },
        ),
    );
    let request = add(&session, HEIGHT, "1,50", ",");
    assert_refused(
        &mut session,
        request,
        refused("height", "1,50", GroupRefusal::Taken { code: SPAIN }),
    );
    let request = add(&session, HEIGHT, "-0", ",");
    session.dispatch(request).unwrap();
    let LevelValues::Float(levels) = categorical_of(&session, HEIGHT).levels().clone() else {
        panic!("height is not of decimal numbers");
    };
    // −0 is kept as 0, so that it is the level a later 0 is compared with.
    assert_eq!(
        levels
            .iter()
            .map(|level| level.to_bits())
            .collect::<Vec<_>>(),
        [1.5_f64, 2.0, 3.25, 0.0].map(f64::to_bits)
    );
    let request = add(&session, HEIGHT, "0", ",");
    assert_refused(
        &mut session,
        request,
        refused(
            "height",
            "0",
            GroupRefusal::Taken {
                code: LevelCode::new(3),
            },
        ),
    );
}

#[test]
fn a_classification_of_yes_or_no_takes_the_one_of_true_or_false_it_lacks() {
    let (mut session, _recorder) = loaded();
    apply(
        &mut session,
        Command::SetActiveClassification {
            column: Some(FERTILE),
        },
    );
    // fertile has FALSE and TRUE already.
    let request = add(&session, FERTILE, "true", ".");
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
    let request = add(&session, FERTILE, "maybe", ".");
    assert_refused(
        &mut session,
        request,
        refused("fertile", "maybe", GroupRefusal::NotYesOrNo),
    );
    let request = add(&session, FERTILE, "", ".");
    assert_refused(
        &mut session,
        request,
        refused("fertile", "", GroupRefusal::EmptyName),
    );

    // A column of TRUE alone takes FALSE.
    let table = Table::new(
        "IndividualID",
        names(&["p1", "p2"]),
        vec![new_column(
            "fertile",
            crate::fixtures::boolean(vec![Some(true), None]),
        )],
    )
    .unwrap();
    let mut session = Session::new();
    apply(
        &mut session,
        Command::LoadTable {
            table,
            active_classification: Some(ColumnId::new(1)),
        },
    );
    let request = add(&session, ColumnId::new(1), " False ", ".");
    session.dispatch(request).unwrap();
    assert_eq!(
        categorical_of(&session, ColumnId::new(1)).levels(),
        &LevelValues::Boolean(vec![true, false])
    );
}

#[test]
fn a_name_of_text_has_at_most_30_characters_and_no_control_character() {
    let (mut session, _recorder) = loaded();
    let thirty = "Kingdom of the Netherlands, th";
    assert_eq!(thirty.chars().count(), 30);
    let request = add(&session, ORIGIN, "Kingdom of the Netherlands, the", ".");
    assert_refused(
        &mut session,
        request,
        refused(
            "origin",
            "Kingdom of the Netherlands, the",
            GroupRefusal::TooLong { max_chars: 30 },
        ),
    );
    // Characters, not bytes: thirty letters with accents fit.
    let accented = "\u{e9}".repeat(30);
    for name in [
        "Peru\nChile",
        "Peru\tChile",
        "Peru\u{202e}Chile",
        "Peru\u{2066}",
    ] {
        let request = add(&session, ORIGIN, name, ".");
        assert_refused(
            &mut session,
            request,
            refused("origin", name, GroupRefusal::ControlCharacter),
        );
    }
    let request = add(&session, ORIGIN, &accented, ".");
    session.dispatch(request).unwrap();
    let request = add(&session, ORIGIN, thirty, ".");
    session.dispatch(request).unwrap();
}

#[test]
fn a_country_named_by_a_name_longer_than_30_characters_is_kept_as_its_code() {
    let (mut session, _recorder) = loaded();
    apply(&mut session, set_role(ORIGIN, Role::Country));
    let request = add(&session, ORIGIN, "Bolivia, Plurinational State of", ".");
    session.dispatch(request).unwrap();
    assert_eq!(
        categorical_of(&session, ORIGIN).levels(),
        &texts(&["ESP", "PER", "BOL"])
    );
}

#[test]
fn a_classification_of_countries_takes_a_country_by_any_name_as_its_code() {
    let (mut session, _recorder) = loaded();
    // origin as countries: ESP, PER.
    apply(&mut session, set_role(ORIGIN, Role::Country));
    let request = add(&session, ORIGIN, "Kingdom of Spain", ".");
    assert_refused(
        &mut session,
        request,
        refused(
            "origin",
            "Kingdom of Spain",
            GroupRefusal::Taken { code: SPAIN },
        ),
    );
    let request = add(&session, ORIGIN, "Atlantis", ".");
    assert_refused(
        &mut session,
        request,
        refused("origin", "Atlantis", GroupRefusal::NotACountry),
    );
    let request = add(&session, ORIGIN, " china", ".");
    session.dispatch(request).unwrap();
    assert_eq!(
        categorical_of(&session, ORIGIN).levels(),
        &texts(&["ESP", "PER", "CHN"])
    );
}

#[test]
fn the_last_group_a_classification_takes_has_the_last_code_and_no_more_is_taken() {
    const GROUP: ColumnId = ColumnId::new(1);
    // One fewer than the most, so that the last one is added here.
    let levels: Vec<String> = (1..MAX_LEVELS).map(|level| format!("g{level}")).collect();
    let colours = PALETTE.iter().copied().cycle().take(levels.len()).collect();
    let table = Table::new(
        "IndividualID",
        names(&["p1"]),
        vec![new_column(
            "group",
            ColumnValues::Category(Categorical::new(
                LevelValues::Text(levels),
                colours,
                vec![None],
            )),
        )],
    )
    .unwrap();
    let mut session = Session::new();
    apply(
        &mut session,
        Command::LoadTable {
            table,
            active_classification: Some(GROUP),
        },
    );
    let request = add(&session, GROUP, "the last", ".");
    session.dispatch(request).unwrap();
    assert_eq!(
        session.active(),
        Some(Active {
            column: GROUP,
            selected: Some(Selected::Group(LevelCode::new(65_534))),
            mode: None,
        })
    );
    let request = add(&session, GROUP, "one more", ".");
    assert_refused(
        &mut session,
        request,
        refused(
            "group",
            "one more",
            GroupRefusal::TooMany { max_levels: 65_535 },
        ),
    );
}

#[test]
fn undo_removes_the_group_added_and_its_selection_and_redo_adds_it_unselected() {
    let (mut session, recorder) = editing_spain();
    let before = categorical_of(&session, ORIGIN);
    let request = add(&session, ORIGIN, "China", ".");
    session.dispatch(request).unwrap();
    let after = categorical_of(&session, ORIGIN);
    recorder.take();

    assert_eq!(
        apply(&mut session, Command::Undo),
        Changed::State(Revision::new(4))
    );
    assert_eq!(categorical_of(&session, ORIGIN), before);
    assert_eq!(
        session.active(),
        Some(Active {
            column: ORIGIN,
            selected: None,
            mode: None,
        })
    );
    // A code may now mean another group: the levels take the undo's
    // revision.
    assert_eq!(levels_at(&session, ORIGIN), 4);
    assert_eq!(revision_of(&session, ORIGIN), 4);
    let messages = recorder.take();
    assert_eq!(
        decode(&messages[0]).parts,
        [
            (SHAPE, vec![4, 0, 0, 0, 0, 0, 0, 0]),
            (ACTIVE, vec![2, 0, 0, 0, 255, 255, 0, 0]),
            (
                CODES,
                vec![
                    2, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 255, 255, 0, 0
                ]
            ),
            (
                COLUMNS,
                vec![
                    1, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0
                ]
            ),
            (UNDO, vec![0, 1]),
        ]
    );

    assert_eq!(
        apply(&mut session, Command::Redo),
        Changed::State(Revision::new(5))
    );
    assert_eq!(categorical_of(&session, ORIGIN), after);
    assert_eq!(
        session.active(),
        Some(Active {
            column: ORIGIN,
            selected: None,
            mode: None,
        })
    );
    assert_eq!(levels_at(&session, ORIGIN), 4);
    assert_eq!(
        part_kinds(&recorder.take()[0]),
        [SHAPE, CODES, COLUMNS, UNDO]
    );
}

#[test]
fn undoing_a_group_added_keeps_another_selected_group() {
    let (mut session, recorder) = loaded();
    let request = add(&session, ORIGIN, "China", ".");
    session.dispatch(request).unwrap();
    apply(
        &mut session,
        Command::SelectGroup {
            column: ORIGIN,
            selected: Some(Selected::Group(PERU)),
        },
    );
    recorder.take();
    apply(&mut session, Command::Undo);
    assert_eq!(
        session.active(),
        Some(Active {
            column: ORIGIN,
            selected: Some(Selected::Group(PERU)),
            mode: None,
        })
    );
    assert_eq!(
        part_kinds(&recorder.take()[0]),
        [SHAPE, CODES, COLUMNS, UNDO]
    );
}

#[test]
fn undoing_an_assignment_to_a_group_added_and_then_the_group_gives_the_table_back() {
    let (mut session, _recorder) = loaded();
    let before = categorical_of(&session, ORIGIN);
    let request = add(&session, ORIGIN, "China", ".");
    session.dispatch(request).unwrap();
    let request = assign(&session, CHINA, &[0, 2]);
    session.dispatch(request).unwrap();
    assert_eq!(
        codes_of(&session, ORIGIN),
        [code(2), code(1), code(2), code(0)]
    );
    apply(&mut session, Command::Undo);
    apply(&mut session, Command::Undo);
    assert_eq!(categorical_of(&session, ORIGIN), before);
    assert_eq!(
        session.undo_redo(),
        UndoRedo {
            can_undo: false,
            can_redo: true
        }
    );
    apply(&mut session, Command::Redo);
    apply(&mut session, Command::Redo);
    assert_eq!(
        codes_of(&session, ORIGIN),
        [code(2), code(1), code(2), code(0)]
    );
}

#[test]
fn a_command_on_a_level_made_before_a_group_added_last_still_applies() {
    let (mut session, _recorder) = editing_spain();
    // A window adds Spain's rows before another adds China and selects
    // Spain again.
    let lasso = assign(&session, SPAIN, &[1]);
    let request = add(&session, ORIGIN, "China", ".");
    session.dispatch(request).unwrap();
    apply(
        &mut session,
        Command::SelectGroup {
            column: ORIGIN,
            selected: Some(Selected::Group(SPAIN)),
        },
    );
    session.dispatch(lasso).unwrap();
    assert_eq!(
        codes_of(&session, ORIGIN),
        [code(0), code(0), None, code(0)]
    );
}

#[test]
fn a_command_on_a_level_made_before_that_level_was_removed_is_refused() {
    let (mut session, _recorder) = loaded();
    let request = add(&session, ORIGIN, "China", ".");
    session.dispatch(request).unwrap();
    // A window makes these at revision 2, while China is code 2 and
    // selected; then China is undone, at 3, and Japan added as code 2, and
    // selected, at 4.
    let lasso = assign(&session, CHINA, &[1]);
    let removal = at(
        &session,
        Command::UnassignRows {
            column: ORIGIN,
            group: CHINA,
            rows: rows(&session, &[1]),
        },
    );
    let selection = at(
        &session,
        Command::SelectGroup {
            column: ORIGIN,
            selected: Some(Selected::Group(CHINA)),
        },
    );
    apply(&mut session, Command::Undo);
    let request = add(&session, ORIGIN, "Japan", ".");
    session.dispatch(request).unwrap();
    let changed = CommandError::LevelsChanged {
        column: ORIGIN,
        based_on: Revision::new(2),
        levels_at: Revision::new(3),
    };
    assert_refused(&mut session, lasso, changed.clone());
    assert_refused(&mut session, removal, changed.clone());
    apply(
        &mut session,
        Command::SelectGroup {
            column: ORIGIN,
            selected: None,
        },
    );
    assert_refused(&mut session, selection, changed);
}

#[test]
fn a_command_on_a_level_made_before_a_change_of_role_is_refused() {
    let (mut session, _recorder) = loaded();
    let selection = at(
        &session,
        Command::SelectGroup {
            column: ORIGIN,
            selected: Some(Selected::Group(SPAIN)),
        },
    );
    apply(&mut session, set_role(ORIGIN, Role::Country));
    assert_eq!(levels_at(&session, ORIGIN), 2);
    assert_refused(
        &mut session,
        selection,
        CommandError::LevelsChanged {
            column: ORIGIN,
            based_on: Revision::new(1),
            levels_at: Revision::new(2),
        },
    );
    // The unassigned individuals name no level, and are selected all the
    // same.
    let mut request = at(
        &session,
        Command::SelectGroup {
            column: ORIGIN,
            selected: Some(Selected::Unassigned),
        },
    );
    request.based_on = Revision::new(1);
    assert_eq!(
        session.dispatch(request).unwrap().changed,
        Changed::State(Revision::new(3))
    );
}

#[test]
fn a_command_on_a_group_undone_and_not_added_again_is_refused_as_made_before() {
    let (mut session, _recorder) = loaded();
    let request = add(&session, ORIGIN, "China", ".");
    session.dispatch(request).unwrap();
    // A window makes these at revision 2, while China is code 2 and
    // selected; China is then undone at 3, and no group takes code 2.
    let selection = at(
        &session,
        Command::SelectGroup {
            column: ORIGIN,
            selected: Some(Selected::Group(CHINA)),
        },
    );
    let pressed = at(
        &session,
        Command::SetEditMode {
            column: ORIGIN,
            target: Selected::Group(CHINA),
            mode: Some(crate::session::EditMode::Add),
        },
    );
    let lasso = assign(&session, CHINA, &[1]);
    let removal = at(
        &session,
        Command::UnassignRows {
            column: ORIGIN,
            group: CHINA,
            rows: rows(&session, &[1]),
        },
    );
    apply(&mut session, Command::Undo);
    let changed = CommandError::LevelsChanged {
        column: ORIGIN,
        based_on: Revision::new(2),
        levels_at: Revision::new(3),
    };
    for stale in [selection, pressed, lasso, removal] {
        assert_refused(&mut session, stale, changed.clone());
    }
}

#[test]
fn a_name_typed_with_an_accent_written_apart_is_kept_composed() {
    let (mut session, _recorder) = loaded();
    let request = add(&session, ORIGIN, "Peru\u{301}", ".");
    session.dispatch(request).unwrap();
    assert_eq!(
        categorical_of(&session, ORIGIN).levels(),
        &texts(&["Spain", "Peru", "Per\u{fa}"])
    );
    let request = add(&session, ORIGIN, "Per\u{fa}", ".");
    assert_refused(
        &mut session,
        request,
        refused("origin", "Per\u{fa}", GroupRefusal::Taken { code: CHINA }),
    );
}

#[test]
fn a_text_typed_in_a_cell_with_an_accent_written_apart_is_kept_composed() {
    let (mut session, _recorder) = loaded();
    // note, column 6, is text; its row 1 is missing.
    let request = at(
        &session,
        Command::SetCells {
            column: ColumnId::new(6),
            rows: rows(&session, &[1]),
            text: "Jose\u{301}".to_owned(),
            decimal_mark: ".".to_owned(),
        },
    );
    session.dispatch(request).unwrap();
    assert_eq!(
        session
            .table()
            .unwrap()
            .column(ColumnId::new(6))
            .unwrap()
            .values()
            .to_stored()
            .unwrap(),
        crate::table::Stored::Text(vec![
            Some("NA".to_owned()),
            Some("Jos\u{e9}".to_owned()),
            None,
            Some("tall".to_owned())
        ])
    );
}
