use super::*;
use crate::command::{Command, Request};
use crate::fixtures::{column, decode, integer, names, plants};
use crate::table::Table;

/// A session with `table` loaded at revision 1.
fn loaded(table: Table) -> Session {
    let mut session = Session::new();
    load(&mut session, table);
    session
}

fn load(session: &mut Session, table: Table) {
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
        .unwrap();
}

fn request(first: u32, count: u32, columns: &[u32], based_on: u64) -> RowsRequest {
    RowsRequest {
        first: Position::new(first),
        count,
        columns: columns.iter().copied().map(ColumnId::new).collect(),
        based_on: Revision::new(based_on),
    }
}

#[test]
fn a_page_carries_the_names_and_the_values_of_the_columns_asked_for_in_their_order() {
    let session = loaded(plants());
    // Rows 1 to 3 of note, height, seeds, fertile and origin.
    let message = session.rows(&request(1, 3, &[6, 1, 4, 5, 2], 1)).unwrap();
    #[rustfmt::skip]
    let expected: Vec<u8> = vec![
        3, 0, 0, 0, 0, 0, 0, 0, // rows, no time
        1, 0, 0, 0, 0, 0, 0, 0, // revision 1
        0, 0, 0, 0, 0, 0, 0, 0, // no time
        // page: loaded at 1, rows shown since 1, names since 1, from
        // position 1, 3 rows, which are the rows 1, 2 and 3; 44 bytes,
        // padded
        8, 0, 0, 0, 44, 0, 0, 0,
        1, 0, 0, 0, 0, 0, 0, 0,
        1, 0, 0, 0, 0, 0, 0, 0,
        1, 0, 0, 0, 0, 0, 0, 0,
        1, 0, 0, 0, 3, 0, 0, 0,
        1, 0, 0, 0, 2, 0, 0, 0,
        3, 0, 0, 0, 0, 0, 0, 0,
        // names: offsets 0, 2, 4, 6, then p2p3p4, padded
        9, 0, 0, 0, 22, 0, 0, 0,
        0, 0, 0, 0, 2, 0, 0, 0,
        4, 0, 0, 0, 6, 0, 0, 0,
        b'p', b'2', b'p', b'3', b'p', b'4', 0, 0,
        // note, column 6, text, revision 1: rows 1 and 2 missing; "", "", "tall"
        10, 0, 0, 0, 44, 0, 0, 0,
        6, 0, 0, 0, 2, 0, 0, 0,
        1, 0, 0, 0, 0, 0, 0, 0,
        0b011, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 4, 0, 0, 0,
        b't', b'a', b'l', b'l', 0, 0, 0, 0,
        // height, column 1, numeric: row 1 missing; 0, 2.0, 3.25
        10, 0, 0, 0, 48, 0, 0, 0,
        1, 0, 0, 0, 0, 0, 0, 0,
        1, 0, 0, 0, 0, 0, 0, 0,
        0b001, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0x40,
        0, 0, 0, 0, 0, 0, 0x0A, 0x40,
        // seeds, column 4, integer: row 2 missing; 12, 0, 7
        10, 0, 0, 0, 48, 0, 0, 0,
        4, 0, 0, 0, 1, 0, 0, 0,
        1, 0, 0, 0, 0, 0, 0, 0,
        0b010, 0, 0, 0, 0, 0, 0, 0,
        12, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0,
        7, 0, 0, 0, 0, 0, 0, 0,
        // fertile, column 5, a category of FALSE and TRUE: FALSE, missing, TRUE
        10, 0, 0, 0, 22, 0, 0, 0,
        5, 0, 0, 0, 4, 0, 0, 0,
        1, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0xFF, 0xFF, 1, 0, 0, 0,
        // origin, column 2, categorical: Peru, missing, Spain
        10, 0, 0, 0, 22, 0, 0, 0,
        2, 0, 0, 0, 4, 0, 0, 0,
        1, 0, 0, 0, 0, 0, 0, 0,
        1, 0, 0xFF, 0xFF, 0, 0, 0, 0,
    ];
    assert_eq!(message, expected);
}

/// Nine individuals, the first with a name of letters beyond ASCII, and
/// an integer column, 1 `x`, with values beyond what a JavaScript number
/// holds exactly.
fn nine() -> Table {
    let mut individuals = vec!["Ñandú"];
    individuals.extend(["p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9"]);
    Table::new(
        "IndividualID",
        names(&individuals),
        vec![column(
            "x",
            integer(vec![
                Some(-2),
                Some(9_007_199_254_740_993),
                None,
                Some(0),
                Some(1),
                Some(2),
                Some(3),
                Some(4),
                None,
            ]),
        )],
    )
    .unwrap()
}

#[test]
fn a_page_of_nine_rows_takes_two_bytes_of_missing_rows_and_names_in_utf8() {
    let session = loaded(nine());
    let parts = decode(&session.rows(&request(0, 9, &[1], 1)).unwrap()).parts;
    #[rustfmt::skip]
    let names: Vec<u8> = vec![
        0, 0, 0, 0, 7, 0, 0, 0, 9, 0, 0, 0, 11, 0, 0, 0, 13, 0, 0, 0,
        15, 0, 0, 0, 17, 0, 0, 0, 19, 0, 0, 0, 21, 0, 0, 0, 23, 0, 0, 0,
        0xC3, 0x91, b'a', b'n', b'd', 0xC3, 0xBA,
        b'p', b'2', b'p', b'3', b'p', b'4', b'p', b'5',
        b'p', b'6', b'p', b'7', b'p', b'8', b'p', b'9',
    ];
    #[rustfmt::skip]
    let values: Vec<u8> = vec![
        1, 0, 0, 0, 1, 0, 0, 0,
        1, 0, 0, 0, 0, 0, 0, 0,
        0b100, 0b1, 0, 0, 0, 0, 0, 0,
        0xFE, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
        1, 0, 0, 0, 0, 0, 0x20, 0,
        0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0,
        1, 0, 0, 0, 0, 0, 0, 0,
        2, 0, 0, 0, 0, 0, 0, 0,
        3, 0, 0, 0, 0, 0, 0, 0,
        4, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0,
    ];
    assert_eq!(
        parts,
        [
            (
                8,
                vec![
                    1, 0, 0, 0, 0, 0, 0, 0, // loaded at 1
                    1, 0, 0, 0, 0, 0, 0, 0, // rows shown since 1
                    1, 0, 0, 0, 0, 0, 0, 0, // names since 1
                    0, 0, 0, 0, 9, 0, 0, 0, // from position 0, 9 rows
                    0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0, //
                    5, 0, 0, 0, 6, 0, 0, 0, 7, 0, 0, 0, 8, 0, 0, 0, // rows 0 to 8
                ]
            ),
            (9, names),
            (10, values),
        ]
    );
}

#[test]
fn a_page_of_no_rows_at_the_end_of_the_table_has_its_parts_and_no_values() {
    let session = loaded(plants());
    let parts = decode(&session.rows(&request(4, 0, &[1, 6], 1)).unwrap()).parts;
    assert_eq!(
        parts,
        [
            (
                8,
                vec![
                    1, 0, 0, 0, 0, 0, 0, 0, // loaded at 1
                    1, 0, 0, 0, 0, 0, 0, 0, // rows shown since 1
                    1, 0, 0, 0, 0, 0, 0, 0, // names since 1
                    4, 0, 0, 0, 0, 0, 0, 0, // from position 4, no rows
                ]
            ),
            (9, vec![0, 0, 0, 0]),
            (10, vec![1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]),
            (
                10,
                vec![6, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
            ),
        ]
    );
}

#[test]
fn a_page_after_a_change_carries_the_revision_and_the_column_s_new_one() {
    let mut session = loaded(plants());
    session
        .dispatch(Request {
            command: Command::SetActiveClassification {
                column: Some(ColumnId::new(2)),
            },
            based_on: Revision::new(1),
            sent_at: None,
        })
        .unwrap();
    session
        .dispatch(Request {
            command: Command::SelectPopulation {
                column: ColumnId::new(2),
                selected: Some(crate::session::Selected::Population(
                    crate::ids::LevelCode::new(1),
                )),
            },
            based_on: Revision::new(2),
            sent_at: None,
        })
        .unwrap();
    session
        .dispatch(Request {
            command: Command::AssignRows {
                column: ColumnId::new(2),
                target: crate::session::Selected::Population(crate::ids::LevelCode::new(1)),
                rows: crate::row_set::RowSet::from_bytes(&[0b0100], 4).unwrap(),
            },
            based_on: Revision::new(3),
            sent_at: None,
        })
        .unwrap();
    let message = session.rows(&request(2, 1, &[2, 1], 4)).unwrap();
    let decoded = decode(&message);
    assert_eq!(decoded.kind, 3);
    assert_eq!(decoded.revision, 4);
    assert_eq!(
        decoded.parts[2],
        (
            10,
            vec![2, 0, 0, 0, 4, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 1, 0]
        )
    );
    // height did not change, and keeps the revision of the load.
    assert_eq!(
        &decoded.parts[3].1[..16],
        [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]
    );
}

#[test]
fn a_page_asked_for_before_the_table_was_loaded_is_refused_as_such() {
    let mut session = loaded(plants());
    load(&mut session, nine());
    assert_eq!(
        session.rows(&request(0, 1, &[1], 1)),
        Err(CommandError::MadeBeforeLoad {
            based_on: Revision::new(1),
            loaded_at: Revision::new(2),
        })
    );
}

#[test]
fn with_no_project_there_are_no_rows() {
    assert_eq!(
        Session::new().rows(&request(0, 0, &[], 0)),
        Err(CommandError::NoProject)
    );
}

#[test]
fn a_page_past_the_last_row_is_refused() {
    let session = loaded(plants());
    assert_eq!(
        session.rows(&request(2, 3, &[], 1)),
        Err(CommandError::RowsOutOfRange {
            first: Position::new(2),
            count: 3,
            num_shown: 4,
        })
    );
    assert_eq!(
        session.rows(&request(5, 0, &[], 1)),
        Err(CommandError::RowsOutOfRange {
            first: Position::new(5),
            count: 0,
            num_shown: 4,
        })
    );
    // Past u32 itself.
    assert_eq!(
        session.rows(&request(u32::MAX, 2, &[], 1)),
        Err(CommandError::RowsOutOfRange {
            first: Position::new(u32::MAX),
            count: 2,
            num_shown: 4,
        })
    );
}

#[test]
fn a_column_the_table_does_not_have_is_refused_and_the_first_is_not_asked_for() {
    let session = loaded(plants());
    assert_eq!(
        session.rows(&request(0, 1, &[1, 7], 1)),
        Err(CommandError::UnknownColumn {
            column: ColumnId::new(7),
        })
    );
    assert_eq!(
        session.rows(&request(0, 1, &[0], 1)),
        Err(CommandError::UnknownColumn {
            column: ColumnId::new(0),
        })
    );
}

#[test]
fn a_column_asked_for_twice_is_a_defect_so_that_a_page_is_never_larger_than_the_table() {
    let session = loaded(plants());
    assert_eq!(
        session.rows(&request(0, 4, &[1, 4, 1], 1)),
        Err(CommandError::Defect {
            what: "a page that asks for column 1 twice".to_owned(),
        })
    );
}

#[test]
fn a_page_asked_for_at_a_revision_still_to_come_is_a_defect() {
    let session = loaded(plants());
    assert!(matches!(
        session.rows(&request(0, 1, &[1], 2)),
        Err(CommandError::Defect { .. })
    ));
}

#[test]
fn a_page_after_an_id_was_edited_carries_the_new_name_and_the_revision_of_the_names() {
    let mut session = loaded(plants());
    session
        .dispatch(Request {
            command: Command::SetCells {
                column: ColumnId::new(0),
                rows: crate::row_set::RowSet::from_bytes(&[0b0010], 4).unwrap(),
                text: "Ñ2".to_owned(),
                decimal_mark: ".".to_owned(),
            },
            based_on: Revision::new(1),
            sent_at: None,
        })
        .unwrap();
    let parts = decode(&session.rows(&request(1, 1, &[], 2)).unwrap()).parts;
    assert_eq!(
        parts,
        [
            (
                8,
                vec![
                    1, 0, 0, 0, 0, 0, 0, 0, // loaded at 1
                    1, 0, 0, 0, 0, 0, 0, 0, // rows shown since 1
                    2, 0, 0, 0, 0, 0, 0, 0, // names since 2
                    1, 0, 0, 0, 1, 0, 0, 0, // from position 1, 1 row
                    1, 0, 0, 0, // row 1
                ]
            ),
            (9, vec![0, 0, 0, 0, 3, 0, 0, 0, 0xC3, 0x91, b'2']),
        ]
    );
}
