use super::*;
use crate::command::{Command, Request};
use crate::fixtures::{column, float, names, plants};
use crate::table::Table;

const HEIGHT: ColumnId = ColumnId::new(1);
const ORIGIN: ColumnId = ColumnId::new(2);
const SEEDS: ColumnId = ColumnId::new(4);

fn loaded(table: Table) -> Session {
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
    session
}

/// The 24 bytes of the header of a message of numbers at revision 1.
const HEADER: [u8; 24] = [
    5, 0, 0, 0, 0, 0, 0, 0, // kind 5, no time
    1, 0, 0, 0, 0, 0, 0, 0, // revision 1
    0, 0, 0, 0, 0, 0, 0, 0, // no time
];

#[test]
fn a_column_of_decimal_numbers_is_sent_as_32_bit_distances_from_its_middle() {
    let session = loaded(plants());
    // 1.5, missing, 2 and 3.25: the middle of 1.5 and 3.25 is 2.375.
    #[rustfmt::skip]
    let part: [u8; 64] = [
        14, 0, 0, 0, 56, 0, 0, 0, // the numbers part, 56 bytes
        1, 0, 0, 0, 0, 0, 0, 0, // column 1
        1, 0, 0, 0, 0, 0, 0, 0, // its revision, 1
        4, 0, 0, 0, 0, 0, 0, 0, // 4 rows
        0, 0, 0, 0, 0, 0, 3, 0x40, // the middle, 2.375
        0b0000_0010, 0, 0, 0, 0, 0, 0, 0, // row 1 missing
        0, 0, 0x60, 0xBF, // 1.5 is -0.875
        0, 0, 0, 0, // missing, 0
        0, 0, 0xC0, 0xBE, // 2 is -0.375
        0, 0, 0x60, 0x3F, // 3.25 is 0.875
    ];
    let mut expected = HEADER.to_vec();
    expected.extend_from_slice(&part);
    assert_eq!(session.numbers(HEIGHT, Revision::new(1)).unwrap(), expected);
}

#[test]
fn a_column_of_whole_numbers_is_sent_as_32_bit_distances_too() {
    let session = loaded(plants());
    // 10, 12, missing and 7: the middle of 7 and 12 is 9.5.
    #[rustfmt::skip]
    let payload: [u8; 56] = [
        4, 0, 0, 0, 0, 0, 0, 0, // column 4
        1, 0, 0, 0, 0, 0, 0, 0, // its revision, 1
        4, 0, 0, 0, 0, 0, 0, 0, // 4 rows
        0, 0, 0, 0, 0, 0, 0x23, 0x40, // the middle, 9.5
        0b0000_0100, 0, 0, 0, 0, 0, 0, 0, // row 2 missing
        0, 0, 0, 0x3F, // 10 is 0.5
        0, 0, 0x20, 0x40, // 12 is 2.5
        0, 0, 0, 0, // missing, 0
        0, 0, 0x20, 0xC0, // 7 is -2.5
    ];
    let message = session.numbers(SEEDS, Revision::new(1)).unwrap();
    assert_eq!(message.get(32..).unwrap(), payload);
}

#[test]
fn the_message_carries_the_session_s_revision_and_the_part_the_column_s() {
    let mut session = loaded(plants());
    // An edit of seeds moves the session to 2, and leaves height at 1.
    session
        .dispatch(Request {
            command: Command::SetCells {
                column: SEEDS,
                rows: crate::row_set::RowSet::from_bytes(&[0b0001], 4).unwrap(),
                text: "11".to_owned(),
                decimal_mark: ".".to_owned(),
            },
            based_on: Revision::new(1),
            sent_at: None,
        })
        .unwrap();
    let message = session.numbers(HEIGHT, Revision::new(2)).unwrap();
    assert_eq!(message.get(8..16).unwrap(), [2, 0, 0, 0, 0, 0, 0, 0]);
    assert_eq!(message.get(40..48).unwrap(), [1, 0, 0, 0, 0, 0, 0, 0]);
    let message = session.numbers(SEEDS, Revision::new(2)).unwrap();
    assert_eq!(message.get(40..48).unwrap(), [2, 0, 0, 0, 0, 0, 0, 0]);
}

#[test]
fn a_value_past_the_largest_32_bit_float_is_sent_as_an_infinity() {
    let table = Table::new(
        "IndividualID",
        names(&["p1", "p2"]),
        vec![column("distance", float(vec![Some(1e39), Some(-1e39)]))],
    )
    .unwrap();
    let message = loaded(table)
        .numbers(ColumnId::new(1), Revision::new(1))
        .unwrap();
    // The middle is 0, and each is 10^39 from it.
    assert_eq!(
        message.get(72..).unwrap(),
        [0, 0, 0x80, 0x7F, 0, 0, 0x80, 0xFF]
    );
}

#[test]
fn values_far_from_zero_and_close_together_keep_their_differences() {
    // As 32-bit floats, whose steps are 0.5 there, the three would be one,
    // 4,500,000.
    let table = Table::new(
        "IndividualID",
        names(&["p1", "p2", "p3"]),
        vec![column(
            "position",
            float(vec![
                Some(4_500_000.062_5),
                Some(4_500_000.125),
                Some(4_500_000.187_5),
            ]),
        )],
    )
    .unwrap();
    let message = loaded(table)
        .numbers(ColumnId::new(1), Revision::new(1))
        .unwrap();
    #[rustfmt::skip]
    let expected: [u8; 32] = [
        0, 0, 0, 8, 136, 42, 81, 65, // the middle, 4,500,000.125
        0, 0, 0, 0, 0, 0, 0, 0, // no row missing
        0, 0, 0x80, 0xBD, // -0.0625
        0, 0, 0, 0, // 0
        0, 0, 0x80, 0x3D, // 0.0625
        0, 0, 0, 0, // the padding to 8 bytes
    ];
    assert_eq!(message.get(56..).unwrap(), expected);
}

#[test]
fn a_column_with_every_row_missing_has_the_middle_0() {
    let table = Table::new(
        "IndividualID",
        names(&["p1"]),
        vec![column("position", float(vec![None]))],
    )
    .unwrap();
    let message = loaded(table)
        .numbers(ColumnId::new(1), Revision::new(1))
        .unwrap();
    assert_eq!(message.get(56..64).unwrap(), [0; 8]);
}

#[test]
fn a_category_text_or_the_names_are_refused() {
    let session = loaded(plants());
    let at = Revision::new(1);
    assert_eq!(
        session.numbers(ORIGIN, at),
        Err(CommandError::NotNumber { column: ORIGIN })
    );
    assert_eq!(
        session.numbers(ColumnId::new(6), at),
        Err(CommandError::NotNumber {
            column: ColumnId::new(6)
        })
    );
    assert_eq!(
        session.numbers(ColumnId::new(0), at),
        Err(CommandError::UnknownColumn {
            column: ColumnId::new(0)
        })
    );
    assert_eq!(
        session.numbers(ColumnId::new(99), at),
        Err(CommandError::UnknownColumn {
            column: ColumnId::new(99)
        })
    );
}

#[test]
fn a_request_made_before_the_load_or_with_no_project_is_refused() {
    assert_eq!(
        Session::new().numbers(HEIGHT, Revision::ZERO),
        Err(CommandError::NoProject)
    );
    let session = loaded(plants());
    assert_eq!(
        session.numbers(HEIGHT, Revision::ZERO),
        Err(CommandError::MadeBeforeLoad {
            based_on: Revision::ZERO,
            loaded_at: Revision::new(1),
        })
    );
}
