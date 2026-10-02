use super::*;
use crate::fixtures::{BLUE, VERMILLION, categorical, code, column, names, plants};
use crate::ids::{LevelCode, RowIndex};

fn refusal(header: &str, rows: &[&str], columns: Vec<NewColumn>) -> CommandError {
    Table::new(header, names(rows), columns).unwrap_err()
}

#[test]
fn a_table_gives_the_first_column_id_0_and_the_others_ids_in_their_order() {
    let table = plants();
    assert_eq!(table.num_rows(), 4);
    assert_eq!(table.names().id(), ColumnId::new(0));
    assert_eq!(table.names().header(), "accession");
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
        "",
        Vec::new(),
        vec![
            column("height", ColumnValues::Numeric(Vec::new())),
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
        refusal("accession", &["p1", "", "p3"], Vec::new()),
        CommandError::EmptyIndividual {
            row: RowIndex::new(1)
        }
    );
}

#[test]
fn two_individuals_of_one_name_are_refused_with_both_rows() {
    assert_eq!(
        refusal("accession", &["p1", "p2", "p3", "p2"], Vec::new()),
        CommandError::DuplicateIndividual {
            name: "p2".to_owned(),
            first_row: RowIndex::new(1),
            second_row: RowIndex::new(3),
        }
    );
}

#[test]
fn names_of_individuals_are_compared_exactly() {
    let table = Table::new("", names(&["P1", "p1", "p1 "]), Vec::new()).unwrap();
    assert_eq!(table.num_rows(), 3);
}

#[test]
fn a_column_with_no_name_is_refused_with_its_place() {
    assert_eq!(
        refusal(
            "accession",
            &["p1"],
            vec![
                column("height", ColumnValues::Numeric(vec![Some(1.0)])),
                column("", ColumnValues::Integer(vec![Some(1)])),
            ],
        ),
        CommandError::EmptyColumnName { position: 2 }
    );
}

#[test]
fn two_columns_of_one_name_are_refused() {
    assert_eq!(
        refusal(
            "accession",
            &["p1"],
            vec![
                column("height", ColumnValues::Numeric(vec![Some(1.0)])),
                column("height", ColumnValues::Integer(vec![Some(1)])),
            ],
        ),
        CommandError::DuplicateColumnName {
            name: "height".to_owned()
        }
    );
}

#[test]
fn a_column_named_as_the_header_of_the_first_is_refused() {
    assert_eq!(
        refusal(
            "height",
            &["p1"],
            vec![column("height", ColumnValues::Numeric(vec![Some(1.0)]))]
        ),
        CommandError::DuplicateColumnName {
            name: "height".to_owned()
        }
    );
}

#[test]
fn an_empty_header_of_the_first_column_is_not_compared() {
    let table = Table::new(
        "",
        names(&["p1"]),
        vec![column("height", ColumnValues::Numeric(vec![Some(1.0)]))],
    )
    .unwrap();
    assert_eq!(table.names().header(), "");
}

#[test]
fn a_column_of_another_length_than_the_names_is_refused() {
    assert_eq!(
        refusal(
            "accession",
            &["p1", "p2"],
            vec![
                column("height", ColumnValues::Numeric(vec![Some(1.0), None])),
                column("seeds", ColumnValues::Integer(vec![Some(1), None, Some(3)])),
            ],
        ),
        CommandError::ColumnLength {
            column: "seeds".to_owned(),
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
                "accession",
                &["p1", "p2"],
                vec![column(
                    "height",
                    ColumnValues::Numeric(vec![None, Some(value)])
                )],
            ),
            CommandError::NonFiniteNumber {
                column: "height".to_owned(),
                row: RowIndex::new(1)
            }
        );
    }
}

#[test]
fn a_code_with_no_level_is_refused() {
    assert_eq!(
        refusal(
            "accession",
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
            column: "origin".to_owned(),
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
            "accession",
            &["p1"],
            vec![column(
                "origin",
                categorical(&[("Spain", VERMILLION), ("", BLUE)], vec![None])
            )]
        ),
        CommandError::EmptyLevelName {
            column: "origin".to_owned(),
            code: LevelCode::new(1)
        }
    );
}

#[test]
fn two_levels_of_one_name_are_refused() {
    assert_eq!(
        refusal(
            "accession",
            &["p1"],
            vec![column(
                "origin",
                categorical(&[("Spain", VERMILLION), ("Spain", BLUE)], vec![code(0)])
            )],
        ),
        CommandError::DuplicateLevel {
            column: "origin".to_owned(),
            level: "Spain".to_owned()
        }
    );
}

fn levels(count: u32) -> Vec<Level> {
    (0..count)
        .map(|i| Level::new(format!("population {i}"), VERMILLION))
        .collect()
}

#[test]
fn a_column_of_65535_levels_is_accepted_and_one_of_65536_refused() {
    let largest = u16::try_from(MAX_LEVELS - 1).unwrap();
    let table = Table::new(
        "",
        names(&["p1"]),
        vec![column(
            "origin",
            ColumnValues::Categorical(Categorical::new(levels(MAX_LEVELS), vec![code(largest)])),
        )],
    )
    .unwrap();
    assert_eq!(table.columns().len(), 1);
    assert_eq!(
        refusal(
            "",
            &["p1"],
            vec![column(
                "origin",
                ColumnValues::Categorical(Categorical::new(levels(MAX_LEVELS + 1), vec![None]))
            )],
        ),
        CommandError::TooManyLevels {
            column: "origin".to_owned(),
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
