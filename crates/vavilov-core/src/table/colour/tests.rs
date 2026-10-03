use super::*;

#[test]
fn the_list_of_colours_is_the_shared_file_a_window_reads_it_from() {
    let expected: Vec<String> = serde_json::from_str(include_str!("../palette.json")).unwrap();
    let written: Vec<String> = PALETTE
        .iter()
        .map(|colour| format!("#{:02x}{:02x}{:02x}", colour.red, colour.green, colour.blue))
        .collect();
    assert_eq!(written, expected);
}

#[test]
fn a_colour_is_read_as_css_writes_it_in_either_case() {
    assert_eq!(Colour::from_css("#e69F00"), Some(rgb(230, 159, 0)));
    for text in [
        "e69f00", "#e69f0", "#e69f000", "#e69f0g", "#+69f00", "", "#",
    ] {
        assert_eq!(Colour::from_css(text), None, "{text:?}");
    }
}
