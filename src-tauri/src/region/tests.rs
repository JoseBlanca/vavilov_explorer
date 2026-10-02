use super::*;

#[test]
fn the_decimal_mark_of_the_region_is_one_short_mark() {
    // What the mark is depends on the machine's region; that it is read,
    // and is one to three characters, as every system allows, does not.
    let mark = decimal_mark().unwrap();
    assert!((1..=3).contains(&mark.chars().count()), "{mark:?}");
}
