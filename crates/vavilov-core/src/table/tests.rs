use super::*;
use crate::fixtures::{BLUE, VERMILLION, categorical, code, column, float, integer, names, plants};
use crate::ids::{LevelCode, RowIndex};

fn refusal(header: &str, rows: &[&str], columns: Vec<NewColumn>) -> CommandError {
    Table::new(header, names(rows), columns).unwrap_err()
}

#[test]
fn a_table_gives_the_first_column_id_0_and_the_others_ids_in_their_order() {
    let table = plants();
    assert_eq!(table.num_rows(), 4);
    assert_eq!(table.names().id(), ColumnId::new(0));
    assert_eq!(table.names().header(), "IndividualID");
    assert_eq!(table.names().names(), ["p1", "p2", "p3", "p4"]);
    let ids: Vec<(u32, &str)> = table
        .columns()
        .iter()
        .map(|c| (c.id().get(), c.name()))
        .collect();
    assert_eq!(
        ids,
        [
            (1, "height"),
            (2, "origin"),
            (3, "cluster"),
            (4, "seeds"),
            (5, "fertile"),
            (6, "note")
        ]
    );
    assert_eq!(table.next_column_id(), ColumnId::new(7));
    assert_eq!(table.column(ColumnId::new(3)).unwrap().name(), "cluster");
    assert!(table.column(ColumnId::new(0)).is_none());
    assert!(table.column(ColumnId::new(7)).is_none());
}

#[test]
fn a_table_of_no_row_is_accepted() {
    let table = Table::new(
        "IndividualID",
        Vec::new(),
        vec![
            column("height", float(Vec::new())),
            column("origin", categorical(&[], Vec::new())),
        ],
    )
    .unwrap();
    assert_eq!(table.num_rows(), 0);
    assert_eq!(table.columns().len(), 2);
}

#[test]
fn an_individual_with_no_name_is_refused() {
    assert_eq!(
        refusal("IndividualID", &["p1", "", "p3"], Vec::new()),
        CommandError::EmptyIndividual {
            row: RowIndex::new(1)
        }
    );
}

#[test]
fn two_individuals_of_one_name_are_refused_with_both_rows() {
    assert_eq!(
        refusal("IndividualID", &["p1", "p2", "p3", "p2"], Vec::new()),
        CommandError::DuplicateIndividual {
            name: "p2".to_owned(),
            first_row: RowIndex::new(1),
            second_row: RowIndex::new(3),
        }
    );
}

#[test]
fn names_of_individuals_are_compared_exactly() {
    let table = Table::new("IndividualID", names(&["P1", "p1", "p1 "]), Vec::new()).unwrap();
    assert_eq!(table.num_rows(), 3);
}

#[test]
fn a_column_with_no_name_is_refused_with_its_place() {
    assert_eq!(
        refusal(
            "IndividualID",
            &["p1"],
            vec![
                column("height", float(vec![Some(1.0)])),
                column("", integer(vec![Some(1)])),
            ],
        ),
        CommandError::EmptyColumnName { position: 2 }
    );
}

#[test]
fn two_columns_of_one_name_are_refused() {
    assert_eq!(
        refusal(
            "IndividualID",
            &["p1"],
            vec![
                column("height", float(vec![Some(1.0)])),
                column("height", integer(vec![Some(1)])),
            ],
        ),
        CommandError::DuplicateColumnName {
            name: "height".to_owned()
        }
    );
}

#[test]
fn the_header_of_the_first_column_is_individual_id_with_case_spaces_and_underscores_ignored() {
    for header in [
        "IndividualID",
        "Individual ID",
        "individual_id",
        "INDIVIDUALID",
        " Individual_ ID ",
    ] {
        assert!(is_individual_id(header), "{header:?}");
    }
    for header in ["accession", "", "Individual IDs", "Individual-ID", "ID"] {
        assert!(!is_individual_id(header), "{header:?}");
    }
}

#[test]
fn a_first_column_of_another_header_is_refused_with_it() {
    assert_eq!(
        refusal("accession", &["p1"], Vec::new()),
        CommandError::NotIndividualId {
            header: "accession".to_owned()
        }
    );
}

#[test]
fn a_table_shows_its_first_column_as_individual_id_whatever_the_file_wrote() {
    let table = Table::new("individual_id", names(&["p1"]), Vec::new()).unwrap();
    assert_eq!(table.names().header(), "IndividualID");
}

#[test]
fn a_column_named_as_the_first_is_refused() {
    assert_eq!(
        refusal(
            "Individual ID",
            &["p1"],
            vec![column("IndividualID", float(vec![Some(1.0)]))]
        ),
        CommandError::DuplicateColumnName {
            name: "IndividualID".to_owned()
        }
    );
}

#[test]
fn a_column_of_another_length_than_the_names_is_refused() {
    assert_eq!(
        refusal(
            "IndividualID",
            &["p1", "p2"],
            vec![
                column("height", float(vec![Some(1.0), None])),
                column("seeds", integer(vec![Some(1), None, Some(3)])),
            ],
        ),
        CommandError::ColumnLength {
            column_name: "seeds".to_owned(),
            num_values: 3,
            num_rows: 2
        }
    );
}

#[test]
fn a_number_that_is_not_finite_is_refused() {
    for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert_eq!(
            refusal(
                "IndividualID",
                &["p1", "p2"],
                vec![column("height", float(vec![None, Some(value)]))],
            ),
            CommandError::NonFiniteNumber {
                column_name: "height".to_owned(),
                row: RowIndex::new(1)
            }
        );
    }
}

#[test]
fn an_empty_text_is_refused_as_it_would_be_a_level_with_no_name() {
    assert_eq!(
        refusal(
            "IndividualID",
            &["p1", "p2", "p3"],
            vec![column(
                "note",
                ColumnValues::Text(vec![Some("landrace".to_owned()), None, Some(String::new())])
            )],
        ),
        CommandError::EmptyText {
            column_name: "note".to_owned(),
            row: RowIndex::new(2)
        }
    );
}

#[test]
fn a_code_with_no_level_is_refused() {
    assert_eq!(
        refusal(
            "IndividualID",
            &["p1", "p2"],
            vec![column(
                "origin",
                categorical(
                    &[("Spain", VERMILLION), ("Peru", BLUE)],
                    vec![code(1), code(2)]
                )
            )],
        ),
        CommandError::CodeWithoutLevel {
            column_name: "origin".to_owned(),
            row: RowIndex::new(1),
            code: LevelCode::new(2),
            num_levels: 2,
        }
    );
}

#[test]
fn a_level_with_no_name_is_refused() {
    assert_eq!(
        refusal(
            "IndividualID",
            &["p1"],
            vec![column(
                "origin",
                categorical(&[("Spain", VERMILLION), ("", BLUE)], vec![None])
            )]
        ),
        CommandError::EmptyLevelName {
            column_name: "origin".to_owned(),
            code: LevelCode::new(1)
        }
    );
}

#[test]
fn two_levels_of_one_name_are_refused() {
    assert_eq!(
        refusal(
            "IndividualID",
            &["p1"],
            vec![column(
                "origin",
                categorical(&[("Spain", VERMILLION), ("Spain", BLUE)], vec![code(0)])
            )],
        ),
        CommandError::DuplicateLevel {
            column_name: "origin".to_owned(),
            level: "Spain".to_owned()
        }
    );
}

fn levels(count: u32) -> LevelValues {
    LevelValues::Text((0..count).map(|i| format!("population {i}")).collect())
}

fn colours(count: u32) -> Vec<Colour> {
    vec![VERMILLION; usize::try_from(count).unwrap()]
}

#[test]
fn a_column_of_65535_levels_is_accepted_and_one_of_65536_refused() {
    let largest = u16::try_from(MAX_LEVELS - 1).unwrap();
    let table = Table::new(
        "IndividualID",
        names(&["p1"]),
        vec![column(
            "origin",
            ColumnValues::Category(Categorical::new(
                levels(MAX_LEVELS),
                colours(MAX_LEVELS),
                vec![code(largest)],
            )),
        )],
    )
    .unwrap();
    assert_eq!(table.columns().len(), 1);
    assert_eq!(
        refusal(
            "IndividualID",
            &["p1"],
            vec![column(
                "origin",
                ColumnValues::Category(Categorical::new(
                    levels(MAX_LEVELS + 1),
                    colours(MAX_LEVELS + 1),
                    vec![None],
                ))
            )],
        ),
        CommandError::TooManyLevels {
            column_name: "origin".to_owned(),
            num_levels: 65_536,
            max_levels: 65_535
        }
    );
}

#[test]
fn the_limits_of_rows_and_columns_are_their_largest_accepted_value() {
    assert_eq!(num_rows_of(268_435_456), Ok(268_435_456));
    assert_eq!(
        num_rows_of(268_435_457),
        Err(CommandError::TooManyRows {
            num_rows: 268_435_457,
            max_rows: 268_435_456
        })
    );
    assert_eq!(check_num_columns(16_777_215), Ok(()));
    assert_eq!(
        check_num_columns(16_777_216),
        Err(CommandError::TooManyColumns {
            num_columns: 16_777_217,
            max_columns: 16_777_216
        })
    );
}

#[test]
fn a_category_with_another_number_of_colours_than_levels_is_refused() {
    let values = ColumnValues::Category(Categorical::new(
        LevelValues::Text(vec!["Spain".to_owned(), "Peru".to_owned()]),
        vec![VERMILLION],
        vec![code(0)],
    ));
    assert_eq!(
        refusal("IndividualID", &["p1"], vec![column("origin", values)]),
        CommandError::LevelColours {
            column_name: "origin".to_owned(),
            num_levels: 2,
            num_colours: 1,
        }
    );
}

#[test]
fn levels_of_decimal_numbers_must_be_finite_and_0_and_minus_0_are_one() {
    let levels = |values: Vec<f64>| {
        let colours = vec![VERMILLION; values.len()];
        ColumnValues::Category(Categorical::new(
            LevelValues::Float(values),
            colours,
            vec![None],
        ))
    };
    assert_eq!(
        refusal(
            "IndividualID",
            &["p1"],
            vec![column("dose", levels(vec![1.0, f64::NAN]))]
        ),
        CommandError::NonFiniteLevel {
            column_name: "dose".to_owned(),
            code: LevelCode::new(1),
        }
    );
    assert_eq!(
        refusal(
            "IndividualID",
            &["p1"],
            vec![column("dose", levels(vec![0.0, 2.0, -0.0]))]
        ),
        CommandError::DuplicateLevel {
            column_name: "dose".to_owned(),
            level: "-0".to_owned(),
        }
    );
}

#[test]
fn a_latitude_out_of_its_range_is_refused_when_the_table_is_built() {
    assert_eq!(
        refusal(
            "IndividualID",
            &["p1", "p2"],
            vec![column(
                "lat",
                ColumnValues::Latitude(Numbers::Float(vec![Some(10.0), Some(-91.0)]))
            )]
        ),
        CommandError::ValueNotFor {
            column: ColumnId::new(1),
            role: Role::Latitude,
            row: RowIndex::new(1),
        }
    );
}

#[test]
fn a_level_of_a_country_category_that_is_no_country_s_code_is_refused() {
    let values = |levels: Vec<&str>| {
        let colours = vec![VERMILLION; levels.len()];
        ColumnValues::Country(Categorical::new(
            LevelValues::Text(levels.into_iter().map(str::to_owned).collect()),
            colours,
            vec![None],
        ))
    };
    // Spain names a country, but a country column holds its code.
    assert_eq!(
        refusal(
            "IndividualID",
            &["p1"],
            vec![column("origin", values(vec!["ESP", "Spain"]))]
        ),
        CommandError::NotACountry {
            column_name: "origin".to_owned(),
            level: "Spain".to_owned(),
        }
    );
    assert!(
        Table::new(
            "IndividualID",
            names(&["p1"]),
            vec![column("origin", values(vec!["ESP", "SUN"]))]
        )
        .is_ok()
    );
}

#[test]
fn a_level_added_takes_the_first_colour_of_the_list_its_category_lacks() {
    let orange = PALETTE[0];
    let sky_blue = PALETTE[1];
    let green = PALETTE[2];
    assert_eq!(unused_colour(&[]).unwrap(), orange);
    assert_eq!(unused_colour(&[orange, green]).unwrap(), sky_blue);
    assert_eq!(unused_colour(&[sky_blue, orange]).unwrap(), green);
}

#[test]
fn a_level_added_to_a_category_of_every_colour_takes_the_next_of_the_list_again() {
    let every: Vec<Colour> = palette(21);
    assert_eq!(unused_colour(&every).unwrap(), PALETTE[0]);
    let more: Vec<Colour> = palette(23);
    assert_eq!(unused_colour(&more).unwrap(), PALETTE[2]);
}
