use super::*;
use crate::fixtures::{code, decode};
use crate::ids::{ColumnId, LevelCode, RowIndex};
use crate::row_set::RowSet;
use crate::session::{Active, Selected, UndoRedo};

fn written(write: impl FnOnce(&mut MessageWriter)) -> Vec<u8> {
    let mut message = MessageWriter::new(MessageKind::Change, Revision::new(5), None);
    write(&mut message);
    message.finish()
}

/// The bytes after the 24 of the header.
fn after_header(message: &[u8]) -> &[u8] {
    &message[24..]
}

#[test]
fn the_header_has_the_kind_the_flags_the_revision_and_the_time() {
    let with_time = MessageWriter::new(
        MessageKind::Change,
        Revision::new(5),
        Some(SentAt::new(1.5).unwrap()),
    )
    .finish();
    assert_eq!(
        with_time,
        [
            1, 1, 0, 0, 0, 0, 0, 0, // kind, flags, zeros
            5, 0, 0, 0, 0, 0, 0, 0, // revision
            0, 0, 0, 0, 0, 0, 0xF8, 0x3F, // 1.5
        ]
    );
    let without = MessageWriter::new(MessageKind::Hover, Revision::new(0x0102), None).finish();
    assert_eq!(
        without,
        [
            2, 0, 0, 0, 0, 0, 0, 0, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
        ]
    );
    assert_eq!(
        MessageWriter::new(MessageKind::Snapshot, Revision::ZERO, None).finish()[0],
        0
    );
}

#[test]
fn the_project_part_says_whether_one_is_open_and_its_rows_and_load() {
    let none = written(|m| m.project(None).unwrap());
    assert_eq!(
        after_header(&none),
        [1, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    );
    let open = written(|m| m.project(Some((4, Revision::new(3)))).unwrap());
    assert_eq!(
        after_header(&open),
        [
            1, 0, 0, 0, 24, 0, 0, 0, // kind 1, length 24
            1, 0, 0, 0, 0, 0, 0, 0, // open
            4, 0, 0, 0, 0, 0, 0, 0, // rows
            3, 0, 0, 0, 0, 0, 0, 0, // loaded at
        ]
    );
}

#[test]
fn the_active_part_has_the_column_and_the_population_or_their_none() {
    let some = written(|m| {
        m.active(Some(Active {
            column: ColumnId::new(2),
            selected: Some(Selected::Population(LevelCode::new(1))),
        }))
        .unwrap();
    });
    assert_eq!(
        after_header(&some),
        [2, 0, 0, 0, 7, 0, 0, 0, 2, 0, 0, 0, 1, 0, 1, 0]
    );
    let none = written(|m| m.active(None).unwrap());
    assert_eq!(
        after_header(&none),
        [2, 0, 0, 0, 7, 0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0]
    );
    let no_population = written(|m| {
        m.active(Some(Active {
            column: ColumnId::new(3),
            selected: None,
        }))
        .unwrap()
    });
    assert_eq!(
        after_header(&no_population),
        [2, 0, 0, 0, 7, 0, 0, 0, 3, 0, 0, 0, 255, 255, 0, 0]
    );
    let unassigned = written(|m| {
        m.active(Some(Active {
            column: ColumnId::new(3),
            selected: Some(Selected::Unassigned),
        }))
        .unwrap()
    });
    assert_eq!(
        after_header(&unassigned),
        [2, 0, 0, 0, 7, 0, 0, 0, 3, 0, 0, 0, 255, 255, 2, 0]
    );
}

#[test]
fn the_selection_part_has_the_rows_and_one_bit_per_row() {
    let selection = RowSet::from_rows(9, [0, 8].map(RowIndex::new)).unwrap();
    let message = written(|m| m.selection(&selection).unwrap());
    assert_eq!(
        after_header(&message),
        [
            3, 0, 0, 0, 10, 0, 0, 0, 9, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0
        ]
    );
}

#[test]
fn the_codes_part_has_the_column_its_revision_and_a_u16_per_row() {
    let message = written(|m| {
        m.codes(
            ColumnId::new(2),
            Revision::new(7),
            &[code(0), code(1), None, code(0x0102)],
        )
        .unwrap()
    });
    assert_eq!(
        after_header(&message),
        [
            4, 0, 0, 0, 24, 0, 0, 0, // kind 4, length 24
            2, 0, 0, 0, 0, 0, 0, 0, // column
            7, 0, 0, 0, 0, 0, 0, 0, // revision
            0, 0, 1, 0, 255, 255, 2, 1, // codes
        ]
    );
}

#[test]
fn the_undo_part_has_a_byte_for_undo_and_one_for_redo() {
    let message = written(|m| {
        m.undo(UndoRedo {
            can_undo: true,
            can_redo: false,
        })
        .unwrap()
    });
    assert_eq!(
        after_header(&message),
        [5, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]
    );
}

#[test]
fn the_columns_part_lists_each_column_with_its_revision() {
    let message = written(|m| {
        m.columns(&[
            (ColumnId::new(1), Revision::new(3)),
            (ColumnId::new(2), Revision::new(4)),
        ])
        .unwrap();
    });
    assert_eq!(
        after_header(&message),
        [
            6, 0, 0, 0, 40, 0, 0, 0, // kind 6, length 40
            2, 0, 0, 0, 0, 0, 0, 0, // two columns
            1, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, // column 1 at 3
            2, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, // column 2 at 4
        ]
    );
}

#[test]
fn the_hover_part_has_its_sequence_number_and_the_row_or_none() {
    let some = written(|m| m.hover(HoverSeq::new(9), Some(RowIndex::new(3))).unwrap());
    assert_eq!(
        after_header(&some),
        [
            7, 0, 0, 0, 12, 0, 0, 0, 9, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0
        ]
    );
    let none = written(|m| m.hover(HoverSeq::new(9), None).unwrap());
    assert_eq!(&after_header(&none)[16..20], [255, 255, 255, 255]);
}

#[test]
fn parts_follow_one_another_each_at_a_multiple_of_8() {
    let message = written(|m| {
        m.undo(UndoRedo {
            can_undo: false,
            can_redo: true,
        })
        .unwrap();
        m.hover(HoverSeq::new(1), None).unwrap();
        m.active(None).unwrap();
    });
    let decoded = decode(&message);
    assert_eq!(decoded.kind, 1);
    assert_eq!(decoded.revision, 5);
    assert_eq!(
        decoded.parts,
        [
            (5, vec![0, 1]),
            (7, vec![1, 0, 0, 0, 0, 0, 0, 0, 255, 255, 255, 255]),
            (2, vec![255, 255, 255, 255, 255, 255, 0]),
        ]
    );
}
