use super::*;
use crate::table::PALETTE;

const COLUMN: ColumnId = ColumnId::new(3);

fn code(code: u16) -> Option<LevelCode> {
    Some(LevelCode::new(code))
}

fn texts(values: &[Option<&str>]) -> Stored {
    Stored::Text(
        values
            .iter()
            .map(|value| value.map(str::to_owned))
            .collect(),
    )
}

#[test]
fn levels_of_text_are_in_the_order_of_their_names_with_case_ignored() {
    // Ordered by their bytes, Beta and Pop1 would come before alpha.
    let values = texts(&[
        Some("pop2"),
        Some("Pop1"),
        Some("pop10"),
        None,
        Some("pop2"),
        Some("Beta"),
        Some("alpha"),
    ]);
    let built = Categorical::from_stored(&values, "origin").unwrap();
    let names = ["alpha", "Beta", "Pop1", "pop10", "pop2"];
    assert_eq!(
        built.levels(),
        &LevelValues::Text(names.iter().map(|name| (*name).to_owned()).collect())
    );
    assert_eq!(
        built.codes(),
        [code(4), code(2), code(3), None, code(4), code(1), code(0)]
    );
    assert_eq!(built.colours(), &PALETTE[..5]);
}

#[test]
fn two_texts_that_differ_only_in_case_are_two_levels_the_lower_case_after() {
    let built = Categorical::from_stored(&texts(&[Some("a"), Some("A")]), "x").unwrap();
    assert_eq!(
        built.levels(),
        &LevelValues::Text(vec!["A".to_owned(), "a".to_owned()])
    );
}

#[test]
fn levels_of_whole_numbers_are_in_the_order_of_the_numbers() {
    let built = Categorical::from_stored(
        &Stored::Integer(vec![Some(10), Some(2), Some(-1), Some(2)]),
        "x",
    )
    .unwrap();
    assert_eq!(built.levels(), &LevelValues::Integer(vec![-1, 2, 10]));
    assert_eq!(built.codes(), [code(2), code(1), code(0), code(1)]);
}

#[test]
fn levels_of_decimal_numbers_make_one_level_of_0_and_minus_0() {
    let built =
        Categorical::from_stored(&Stored::Float(vec![Some(1.5), Some(-0.0), Some(0.0)]), "x")
            .unwrap();
    assert_eq!(built.levels().len(), 2);
    assert_eq!(built.codes(), [code(1), code(0), code(0)]);
}

#[test]
fn levels_of_yes_or_no_are_false_then_true() {
    let built =
        Categorical::from_stored(&Stored::Boolean(vec![Some(true), None, Some(false)]), "x")
            .unwrap();
    assert_eq!(built.levels(), &LevelValues::Boolean(vec![false, true]));
    assert_eq!(built.codes(), [code(1), None, code(0)]);
}

#[test]
fn more_distinct_values_than_a_code_holds_are_refused() {
    let values = (0..=65_535).map(Some).collect();
    assert_eq!(
        Categorical::from_stored(&Stored::Integer(values), "seeds"),
        Err(CommandError::TooManyLevels {
            column_name: "seeds".to_owned(),
            num_levels: 65_536,
            max_levels: 65_535,
        })
    );
}

#[test]
fn past_the_21_colours_the_list_starts_again() {
    let colours = palette(23);
    assert_eq!(colours[20], PALETTE[20]);
    assert_eq!(colours[21], PALETTE[0]);
    assert_eq!(colours[22], PALETTE[1]);
}

#[test]
fn the_palette_is_okabe_and_ito_then_lighter_then_darker() {
    let hex: Vec<String> = PALETTE
        .iter()
        .map(|c| format!("#{:02x}{:02x}{:02x}", c.red, c.green, c.blue))
        .collect();
    assert_eq!(
        hex,
        [
            "#e69f00", "#56b4e9", "#009e73", "#f0e442", "#0072b2", "#d55e00", "#cc79a7", "#f0c566",
            "#9ad2f2", "#66c5ab", "#f6ef8e", "#66aad1", "#e69e66", "#e0afca", "#8a5f00", "#346c8c",
            "#005f45", "#908928", "#00446b", "#803800", "#7a4964",
        ]
    );
}

#[test]
fn a_number_needs_numbers_and_text_needs_text() {
    for (stored, role) in [
        (texts(&[Some("1")]), Role::Number),
        (Stored::Boolean(vec![Some(true)]), Role::Number),
        (Stored::Integer(vec![Some(1)]), Role::Text),
        (Stored::Float(vec![Some(1.0)]), Role::Text),
        (Stored::Boolean(vec![Some(true)]), Role::Text),
    ] {
        let storage = stored.storage_type();
        assert_eq!(
            ColumnValues::from_stored(stored, role, COLUMN, "x"),
            Err(CommandError::RoleNotPossible {
                column: COLUMN,
                storage,
                role,
            })
        );
    }
}

#[test]
fn every_storage_type_can_be_a_category() {
    for stored in [
        texts(&[Some("a")]),
        Stored::Boolean(vec![Some(true)]),
        Stored::Integer(vec![Some(1)]),
        Stored::Float(vec![Some(1.0)]),
    ] {
        let storage = stored.storage_type();
        let values =
            ColumnValues::from_stored(stored.clone(), Role::Category, COLUMN, "x").unwrap();
        assert_eq!(
            (values.role(), values.storage_type()),
            (Role::Category, storage)
        );
    }
}

#[test]
fn a_category_of_numbers_made_a_number_gives_back_its_values() {
    let number = ColumnValues::Number(Numbers::Integer(vec![Some(3), None, Some(1), Some(3)]));
    let category = number
        .with_role(Role::Category, COLUMN, "x")
        .unwrap()
        .unwrap();
    assert_eq!(category.storage_type(), StorageType::Integer);
    assert_eq!(
        category.with_role(Role::Number, COLUMN, "x").unwrap(),
        Some(number)
    );
}

#[test]
fn a_column_given_the_role_it_has_is_left_as_it_is() {
    let text = ColumnValues::Text(vec![Some("a".to_owned())]);
    assert_eq!(text.with_role(Role::Text, COLUMN, "x"), Ok(None));
}

fn floats(values: &[Option<f64>]) -> Stored {
    Stored::Float(values.to_vec())
}

#[test]
fn a_latitude_and_a_longitude_take_numbers_in_their_range_their_ends_included() {
    let latitude = ColumnValues::from_stored(
        floats(&[Some(-90.0), None, Some(90.0)]),
        Role::Latitude,
        COLUMN,
        "x",
    )
    .unwrap();
    assert_eq!(latitude.role(), Role::Latitude);
    let longitude = ColumnValues::from_stored(
        Stored::Integer(vec![Some(-180), Some(180)]),
        Role::Longitude,
        COLUMN,
        "x",
    )
    .unwrap();
    assert_eq!(longitude.storage_type(), StorageType::Integer);
}

#[test]
fn a_number_out_of_the_range_of_a_latitude_or_a_longitude_is_refused_with_its_row() {
    assert_eq!(
        ColumnValues::from_stored(
            floats(&[Some(40.0), None, Some(90.5)]),
            Role::Latitude,
            COLUMN,
            "x"
        ),
        Err(CommandError::ValueNotFor {
            column: COLUMN,
            role: Role::Latitude,
            row: crate::ids::RowIndex::new(2),
        })
    );
    assert_eq!(
        ColumnValues::from_stored(
            Stored::Integer(vec![Some(181)]),
            Role::Longitude,
            COLUMN,
            "x"
        ),
        Err(CommandError::ValueNotFor {
            column: COLUMN,
            role: Role::Longitude,
            row: crate::ids::RowIndex::new(0),
        })
    );
}

#[test]
fn a_country_role_writes_each_value_as_its_code_and_two_spellings_are_one_level() {
    let values = texts(&[Some("Spain"), Some("ES"), Some("france"), None, Some("ESP")]);
    let ColumnValues::Country(countries) =
        ColumnValues::from_stored(values, Role::Country, COLUMN, "origin").unwrap()
    else {
        panic!("not a category of countries");
    };
    assert_eq!(
        countries.levels(),
        &LevelValues::Text(vec!["ESP".to_owned(), "FRA".to_owned()])
    );
    assert_eq!(
        countries.codes(),
        [code(0), code(0), code(1), None, code(0)]
    );
}

#[test]
fn a_text_that_names_no_country_is_refused_with_its_row() {
    assert_eq!(
        ColumnValues::from_stored(
            texts(&[Some("Spain"), Some("Atlantis")]),
            Role::Country,
            COLUMN,
            "origin"
        ),
        Err(CommandError::ValueNotFor {
            column: COLUMN,
            role: Role::Country,
            row: crate::ids::RowIndex::new(1),
        })
    );
}

#[test]
fn the_roles_a_column_can_take_follow_its_storage_type_and_its_values() {
    let roles = |stored: Stored| {
        ColumnValues::from_stored(stored.clone(), Role::Category, COLUMN, "x")
            .unwrap()
            .possible_roles()
            .unwrap()
    };
    use Role::*;
    assert_eq!(
        roles(floats(&[Some(45.0), Some(-120.5)])),
        [Number, Longitude, Category]
    );
    assert_eq!(
        roles(floats(&[Some(45.0), Some(12.5)])),
        [Number, Latitude, Longitude, Category]
    );
    assert_eq!(
        roles(texts(&[Some("Peru"), None, Some("CHN")])),
        [Category, Country, Text]
    );
    assert_eq!(
        roles(texts(&[Some("Peru"), Some("unknown")])),
        [Category, Text]
    );
    assert_eq!(roles(Stored::Boolean(vec![Some(true)])), [Category]);
}

#[test]
fn a_column_of_more_distinct_values_than_a_code_holds_cannot_be_a_category() {
    let numbers = ColumnValues::Number(Numbers::Integer((0..=65_535).map(Some).collect()));
    assert_eq!(numbers.possible_roles().unwrap(), [Role::Number]);
}

#[test]
fn a_column_of_as_many_distinct_values_as_a_code_holds_can_be_a_category() {
    let numbers = ColumnValues::Number(Numbers::Integer((0..65_535).map(Some).collect()));
    assert_eq!(
        numbers.possible_roles().unwrap(),
        [Role::Number, Role::Category]
    );
    let category = numbers
        .with_role(Role::Category, COLUMN, "seeds")
        .unwrap()
        .unwrap();
    assert_eq!(category.categorical().unwrap().levels().len(), 65_535);
}

#[test]
fn a_whole_number_beyond_32_bits_is_neither_a_latitude_nor_a_longitude() {
    let numbers = ColumnValues::Number(Numbers::Integer(vec![Some(10), Some(3_000_000_000)]));
    assert_eq!(
        numbers.possible_roles().unwrap(),
        [Role::Number, Role::Category]
    );
    assert_eq!(
        numbers.with_role(Role::Longitude, COLUMN, "x"),
        Err(CommandError::ValueNotFor {
            column: COLUMN,
            role: Role::Longitude,
            row: crate::ids::RowIndex::new(1),
        })
    );
}
