//! The tables the tests build, small enough to work out by hand.

use crate::ids::LevelCode;
use crate::table::{
    Categorical, Colour, ColumnValues, LevelValues, NewColumn, Numbers, Stored, Table,
};

pub(crate) const VERMILLION: Colour = Colour {
    red: 213,
    green: 94,
    blue: 0,
};
pub(crate) const BLUE: Colour = Colour {
    red: 0,
    green: 114,
    blue: 178,
};
pub(crate) const GREEN: Colour = Colour {
    red: 0,
    green: 158,
    blue: 115,
};

pub(crate) fn code(code: u16) -> Option<LevelCode> {
    Some(LevelCode::new(code))
}

pub(crate) fn names(names: &[&str]) -> Vec<String> {
    names.iter().map(|name| (*name).to_owned()).collect()
}

pub(crate) fn column(name: &str, values: ColumnValues) -> NewColumn {
    NewColumn {
        name: name.to_owned(),
        values,
    }
}

/// A classification of text levels, each with its colour.
pub(crate) fn categorical(
    levels: &[(&str, Colour)],
    codes: Vec<Option<LevelCode>>,
) -> ColumnValues {
    let (names, colours) = levels
        .iter()
        .map(|(name, colour)| ((*name).to_owned(), *colour))
        .unzip();
    ColumnValues::Classification(Categorical::new(LevelValues::Text(names), colours, codes))
}

/// A number of decimal numbers.
pub(crate) fn float(values: Vec<Option<f64>>) -> ColumnValues {
    ColumnValues::Number(Numbers::Float(values))
}

/// A number of whole numbers.
pub(crate) fn integer(values: Vec<Option<i64>>) -> ColumnValues {
    ColumnValues::Number(Numbers::Integer(values))
}

/// A category of yes or no, FALSE before TRUE, as the import makes one.
pub(crate) fn boolean(values: Vec<Option<bool>>) -> ColumnValues {
    ColumnValues::Category(Categorical::from_stored(&Stored::Boolean(values), "a test").unwrap())
}

/// Four plants, with ids 0 for the names and, in order, 1 `height`, a
/// number; 2 `origin` (Spain, Peru) and 3 `cluster` (A, B, C),
/// classifications; 4 `seeds`, a number; 5 `fertile`, a category of yes or
/// no; and 6 `note`, text.
pub(crate) fn plants() -> Table {
    Table::new(
        "IndividualID",
        names(&["p1", "p2", "p3", "p4"]),
        vec![
            column(
                "height",
                float(vec![Some(1.5), None, Some(2.0), Some(3.25)]),
            ),
            column(
                "origin",
                categorical(
                    &[("Spain", VERMILLION), ("Peru", BLUE)],
                    vec![code(0), code(1), None, code(0)],
                ),
            ),
            column(
                "cluster",
                categorical(
                    &[("A", VERMILLION), ("B", BLUE), ("C", GREEN)],
                    vec![None, code(2), code(2), code(0)],
                ),
            ),
            column("seeds", integer(vec![Some(10), Some(12), None, Some(7)])),
            column(
                "fertile",
                boolean(vec![Some(true), Some(false), None, Some(true)]),
            ),
            column(
                "note",
                ColumnValues::Text(vec![
                    Some("NA".to_owned()),
                    None,
                    Some(String::new()),
                    Some("tall".to_owned()),
                ]),
            ),
        ],
    )
    .unwrap()
}

/// A message as a window reads it: its kind, its revision, and each part
/// with its kind and payload. It checks what a window checks: the zero
/// bytes, every length against the bytes there are, and that each payload
/// starts at a multiple of 8 and is padded with zeros.
#[derive(Debug, PartialEq)]
pub(crate) struct Decoded {
    pub(crate) kind: u8,
    pub(crate) revision: u64,
    pub(crate) parts: Vec<(u16, Vec<u8>)>,
}

#[expect(
    clippy::arithmetic_side_effects,
    reason = "a test's offsets into a message of a few hundred bytes, which a wrong length fails by a panic of the test"
)]
pub(crate) fn decode(message: &[u8]) -> Decoded {
    assert!(message.len() >= 24, "a message of {} bytes", message.len());
    assert_eq!(message.len() % 8, 0);
    assert_eq!(message[1] & 0b1111_1110, 0, "flags");
    assert_eq!(&message[2..8], [0; 6]);
    let revision = u64::from_le_bytes(message[8..16].try_into().unwrap());
    let mut parts = Vec::new();
    let mut at = 24;
    while at < message.len() {
        let kind = u16::from_le_bytes(message[at..at + 2].try_into().unwrap());
        assert_eq!(&message[at + 2..at + 4], [0, 0]);
        let length = usize::try_from(u32::from_le_bytes(
            message[at + 4..at + 8].try_into().unwrap(),
        ))
        .unwrap();
        let start = at + 8;
        assert_eq!(start % 8, 0);
        let end = start + length;
        let padded = end.next_multiple_of(8);
        assert!(padded <= message.len(), "a part beyond the message");
        assert!(
            message[end..padded].iter().all(|byte| *byte == 0),
            "padding"
        );
        parts.push((kind, message[start..end].to_vec()));
        at = padded;
    }
    Decoded {
        kind: message[0],
        revision,
        parts,
    }
}

/// The kinds of the parts of a message, in order.
pub(crate) fn part_kinds(message: &[u8]) -> Vec<u16> {
    decode(message)
        .parts
        .into_iter()
        .map(|(kind, _)| kind)
        .collect()
}
