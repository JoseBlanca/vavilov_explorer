use super::*;

#[test]
fn a_country_is_named_by_its_codes_and_its_iso_names_alone() {
    for name in [
        "ES",
        "ESP",
        "Spain",
        "Kingdom of Spain",
        "spain",
        "  SPAIN ",
    ] {
        assert_eq!(country_code(name), Some("ESP"), "{name:?}");
    }
    // ISO's names, and not the shorter ones of Natural Earth's maps, which
    // the owner left out on 2 October 2026; nor a territory by its
    // sovereign.
    assert_eq!(country_code("Korea, Republic of"), Some("KOR"));
    assert_eq!(country_code("Bolivia, Plurinational State of"), Some("BOL"));
    for name in [
        "South Korea",
        "Bolivia",
        "Russia",
        "Ashmore and Cartier Is.",
    ] {
        assert_eq!(country_code(name), None, "{name:?}");
    }
}

#[test]
fn accents_count_and_what_names_no_country_is_none() {
    assert_eq!(country_code("Côte d'Ivoire"), Some("CIV"));
    assert_eq!(country_code("Cote d'Ivoire"), None);
    for name in ["España", "Espagne", "", "Kosovo", "USSR", "XX"] {
        assert_eq!(country_code(name), None, "{name:?}");
    }
}

#[test]
fn a_code_a_current_country_took_from_a_former_one_means_the_current() {
    // AI was the French Afars and Issas, and is Anguilla.
    assert_eq!(country_code("AI"), Some("AIA"));
    assert_eq!(country_code("AIDJ"), Some("AFI"));
    assert_eq!(country_code("French Afars and Issas"), Some("AFI"));
}

#[test]
fn a_former_country_is_named_by_its_name_and_its_codes_no_current_country_has() {
    for name in [
        "SU",
        "SUN",
        "SUHH",
        "USSR, Union of Soviet Socialist Republics",
    ] {
        assert_eq!(country_code(name), Some("SUN"), "{name:?}");
    }
    // ATF is the French Southern Territories now, so the former French
    // Southern and Antarctic Territories are shown by their four letters.
    assert_eq!(country_code("ATF"), Some("ATF"));
    assert_eq!(country_code("FQHH"), Some("FQHH"));
    // CS was both Czechoslovakia and Serbia and Montenegro.
    assert_eq!(country_code("CS"), None);
    assert_eq!(country_code("CSK"), Some("CSK"));
    assert_eq!(country_code("SCG"), Some("SCG"));
}

#[test]
fn the_table_is_sorted_with_no_name_twice_and_every_name_in_lower_case() {
    for pair in table::NAMES.windows(2) {
        assert!(pair[0].0 < pair[1].0, "{:?} before {:?}", pair[0], pair[1]);
    }
    for (name, _) in table::NAMES {
        assert_eq!(name.trim().to_lowercase(), *name);
    }
}
