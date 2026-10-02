use super::*;

fn rows(set: &RowSet) -> Vec<u32> {
    set.rows().map(RowIndex::get).collect()
}

#[test]
fn a_set_of_8_rows_is_one_byte_and_of_9_rows_two() {
    assert_eq!(RowSet::empty(8).as_bytes(), [0]);
    assert_eq!(RowSet::empty(9).as_bytes(), [0, 0]);
    assert_eq!(RowSet::empty(0).as_bytes(), [] as [u8; 0]);
}

#[test]
fn row_i_is_bit_i_mod_8_of_byte_i_div_8() {
    let set = RowSet::from_bytes(&[0b1000_0101, 0b0000_0001], 9).unwrap();
    assert_eq!(rows(&set), [0, 2, 7, 8]);
    assert!(set.contains(RowIndex::new(8)));
    assert!(!set.contains(RowIndex::new(1)));
    assert!(!set.contains(RowIndex::new(9)));
    assert!(!set.contains(RowIndex::new(u32::MAX)));
}

#[test]
fn a_set_built_from_rows_has_their_bits() {
    let set = RowSet::from_rows(9, [8, 0, 2, 7].map(RowIndex::new)).unwrap();
    assert_eq!(set.as_bytes(), [0b1000_0101, 0b0000_0001]);
    assert_eq!(set.num_rows(), 9);
}

#[test]
fn a_row_beyond_the_table_is_refused() {
    assert_eq!(
        RowSet::from_rows(9, [RowIndex::new(9)]),
        Err(CommandError::RowOutOfRange {
            row: RowIndex::new(9),
            num_rows: 9
        })
    );
}

#[test]
fn bytes_of_the_wrong_length_are_refused() {
    assert_eq!(
        RowSet::from_bytes(&[0], 9),
        Err(CommandError::RowSetLength {
            num_rows: 9,
            num_bytes: 1
        })
    );
    assert_eq!(
        RowSet::from_bytes(&[0, 0], 8),
        Err(CommandError::RowSetLength {
            num_rows: 8,
            num_bytes: 2
        })
    );
    assert_eq!(
        RowSet::from_bytes(&[0], 0),
        Err(CommandError::RowSetLength {
            num_rows: 0,
            num_bytes: 1
        })
    );
    assert_eq!(RowSet::from_bytes(&[], 0).map(|set| set.num_rows()), Ok(0));
}

#[test]
fn a_bit_set_beyond_the_last_row_is_refused() {
    assert_eq!(
        RowSet::from_bytes(&[0, 0b0000_0010], 9),
        Err(CommandError::RowSetUnusedBits { num_rows: 9 })
    );
    assert_eq!(
        RowSet::from_bytes(&[0, 0b1000_0000], 15),
        Err(CommandError::RowSetUnusedBits { num_rows: 15 })
    );
    assert_eq!(
        RowSet::from_bytes(&[0, 0b0100_0000], 15).map(|set| rows(&set)),
        Ok(vec![14])
    );
    assert_eq!(
        RowSet::from_bytes(&[0b1111_1111], 8).map(|set| rows(&set).len()),
        Ok(8)
    );
}
