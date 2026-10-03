use super::*;

#[test]
fn an_accent_written_as_a_second_character_becomes_one_with_its_letter() {
    let decomposed = "Peru\u{301}";
    assert_eq!(decomposed.chars().count(), 5);
    assert_eq!(nfc(decomposed), "Per\u{fa}");
    assert_eq!(nfc(decomposed).chars().count(), 4);
}

#[test]
fn a_text_already_composed_is_kept_as_it_is() {
    for text in ["Perú", "Côte d'Ivoire", "plain", "", "Ñandú 1,5%"] {
        assert_eq!(nfc(text), text);
    }
}
