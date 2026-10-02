use super::*;
use serde_json::json;

#[test]
fn an_error_crosses_to_a_window_as_its_kind_and_its_fields_in_camel_case() {
    let error = CommandError::UnknownLevel {
        column: ColumnId::new(3),
        code: LevelCode::new(7),
        num_levels: 2,
    };
    assert_eq!(
        serde_json::to_value(&error).unwrap(),
        json!({ "kind": "unknownLevel", "column": 3, "code": 7, "numLevels": 2 })
    );
}

#[test]
fn a_case_with_no_field_is_its_kind_alone() {
    assert_eq!(
        serde_json::to_value(CommandError::NoProject).unwrap(),
        json!({ "kind": "noProject" })
    );
}

#[test]
fn revisions_rows_and_labels_cross_as_plain_values() {
    assert_eq!(
        serde_json::to_value(CommandError::MadeBeforeLoad {
            based_on: Revision::new(4),
            loaded_at: Revision::new(9),
        })
        .unwrap(),
        json!({ "kind": "madeBeforeLoad", "basedOn": 4, "loadedAt": 9 })
    );
    assert_eq!(
        serde_json::to_value(CommandError::DuplicateIndividual {
            name: "p2".to_owned(),
            first_row: RowIndex::new(1),
            second_row: RowIndex::new(3),
        })
        .unwrap(),
        json!({ "kind": "duplicateIndividual", "name": "p2", "firstRow": 1, "secondRow": 3 })
    );
    assert_eq!(
        serde_json::to_value(CommandError::UnknownWindow {
            label: WindowLabel::new("scatter3d-1")
        })
        .unwrap(),
        json!({ "kind": "unknownWindow", "label": "scatter3d-1" })
    );
}

#[test]
fn a_target_crosses_as_its_population_or_as_unassigned() {
    assert_eq!(
        serde_json::to_value(CommandError::NotSelected {
            target: Selected::Population(LevelCode::new(2))
        })
        .unwrap(),
        json!({ "kind": "notSelected", "target": { "population": 2 } })
    );
    assert_eq!(
        serde_json::to_value(CommandError::NotSelected {
            target: Selected::Unassigned
        })
        .unwrap(),
        json!({ "kind": "notSelected", "target": "unassigned" })
    );
}

#[test]
fn the_refusal_of_a_file_crosses_with_the_refusal_inside_it() {
    use crate::error::{ExportRefusal, ImportRefusal, IoFailure};
    use crate::formats::Separator;
    let cases = [
        (
            CommandError::ImportRefused {
                file_name: "plants.csv".to_owned(),
                refusal: ImportRefusal::RaggedRow {
                    line: 3,
                    expected: 2,
                    found: 1,
                    separator: Separator::Comma,
                },
            },
            r#"{"kind":"importRefused","fileName":"plants.csv","refusal":{"kind":"raggedRow","line":3,"expected":2,"found":1,"separator":"comma"}}"#,
        ),
        (
            CommandError::ExportRefused {
                refusal: ExportRefusal::CannotCarry {
                    column_name: "IndividualID".to_owned(),
                    individual: Some("Ősz".to_owned()),
                    character: 'Ő',
                },
            },
            r#"{"kind":"exportRefused","refusal":{"kind":"cannotCarry","columnName":"IndividualID","individual":"Ősz","character":"Ő"}}"#,
        ),
        (
            CommandError::ExportRefused {
                refusal: ExportRefusal::SpacesAtEnds {
                    column_name: "height ".to_owned(),
                    individual: None,
                },
            },
            r#"{"kind":"exportRefused","refusal":{"kind":"spacesAtEnds","columnName":"height ","individual":null}}"#,
        ),
        (
            CommandError::FileNotRead {
                file_name: "gone.csv".to_owned(),
                io: IoFailure::NotFound,
                message: "No such file".to_owned(),
            },
            r#"{"kind":"fileNotRead","fileName":"gone.csv","io":"notFound","message":"No such file"}"#,
        ),
    ];
    for (error, expected) in cases {
        assert_eq!(serde_json::to_string(&error).unwrap(), expected);
    }
}

/// One error of each case about a file, with every case of the refusals
/// and every value of `IoFailure`, `FileFormat` and `Separator`, in the
/// order of `file-errors.json`.
fn file_errors() -> Vec<CommandError> {
    use crate::error::{ExportRefusal as E, ImportRefusal as I, IoFailure};
    use crate::formats::{FileFormat, Separator};
    let refused = |file_name: &str, refusal: I| CommandError::ImportRefused {
        file_name: file_name.to_owned(),
        refusal,
    };
    let not_exported = |refusal: E| CommandError::ExportRefused { refusal };
    vec![
        refused(
            "plants.csv",
            I::TooLarge {
                size: 20_000_001,
                max_bytes: 20_000_000,
            },
        ),
        refused("plants.xls", I::OldExcel),
        refused("plants.xlsx", I::Encrypted),
        refused("notes.docx", I::NotWorkbook),
        refused(
            "plants.xlsx",
            I::EmptySheet {
                sheet: "Hoja1".to_owned(),
            },
        ),
        refused(
            "plants.xlsx",
            I::CellError {
                error: "#GETTING_DATA".to_owned(),
            },
        ),
        refused(
            "plants.xlsx",
            I::SheetTooLarge {
                sheet: "Sheet1".to_owned(),
                first_row: 2,
                first_column: 3,
                num_rows: 1_000_001,
                num_columns: 4,
                max_cells: 2_000_000,
            },
        ),
        refused("plants.txt", I::CutShort),
        refused("plants.png", I::NotText),
        refused("calls.vcf", I::VariantsFile),
        refused(
            "plants.tsv",
            I::UnclosedQuote {
                line: 7,
                separator: Separator::Tab,
            },
        ),
        refused(
            "plants.xlsx",
            I::HeaderError {
                row: 1,
                column: 5,
                error: "#VALUE!".to_owned(),
            },
        ),
        refused("plants.csv", I::Empty),
        refused(
            "plants.csv",
            I::UnnamedColumn {
                format: FileFormat::Text,
                column: 4,
            },
        ),
        refused(
            "plants.csv",
            I::RaggedRow {
                line: 3,
                expected: 3,
                found: 2,
                separator: Separator::Semicolon,
            },
        ),
        refused(
            "plants.csv",
            I::RaggedRow {
                line: 9,
                expected: 2,
                found: 5,
                separator: Separator::Comma,
            },
        ),
        refused(
            "plants.xlsx",
            I::DuplicateColumn {
                format: FileFormat::Xlsx,
                name: "height".to_owned(),
                first_column: 2,
                second_column: 6,
            },
        ),
        refused(
            "plants.xlsx",
            I::EmptyIndividual {
                format: FileFormat::Xlsx,
                row: 8,
            },
        ),
        refused(
            "plants.csv",
            I::DuplicateIndividual {
                format: FileFormat::Text,
                name: "p2".to_owned(),
                first_row: 3,
                second_row: 11,
            },
        ),
        refused(
            "plants.csv",
            I::NotIndividualId {
                header: "accession".to_owned(),
            },
        ),
        refused(
            "plants.csv",
            I::NamedIndividualId {
                format: FileFormat::Text,
                column: 3,
            },
        ),
        CommandError::ImportUnreadable {
            file_name: "plants.xlsx".to_owned(),
            message: "invalid Zip archive: Could not find EOCD".to_owned(),
        },
        CommandError::FileNotRead {
            file_name: "gone.csv".to_owned(),
            io: IoFailure::NotFound,
            message: "No such file".to_owned(),
        },
        not_exported(E::NoIndividual),
        not_exported(E::ReadsAsMissing {
            column_name: "note".to_owned(),
            individual: "p2".to_owned(),
        }),
        not_exported(E::ErrorAsName {
            column_name: "#N/A".to_owned(),
        }),
        not_exported(E::SpacesAtEnds {
            column_name: "height ".to_owned(),
            individual: None,
        }),
        not_exported(E::IntegerTooLarge {
            column_name: "seeds".to_owned(),
            individual: "p3".to_owned(),
        }),
        not_exported(E::CannotCarry {
            column_name: "IndividualID".to_owned(),
            individual: Some("Ősz".to_owned()),
            character: 'Ő',
        }),
        not_exported(E::TextTooLong {
            column_name: "note".to_owned(),
            individual: Some("p1".to_owned()),
            length: 40_000,
        }),
        not_exported(E::TooLargeForSheet {
            rows: 1_048_577,
            columns: 3,
        }),
        not_exported(E::ReadsAsVariantsFile),
        CommandError::FileNotWritten {
            file_name: "plants.csv".to_owned(),
            io: IoFailure::PermissionDenied,
            message: "Permission denied".to_owned(),
        },
        CommandError::FileNotWritten {
            file_name: "plants.csv".to_owned(),
            io: IoFailure::Other,
            message: "Disk full".to_owned(),
        },
    ]
}

/// Every case of `file_errors`, as the window's tests of the same file
/// read them (`src/state/fileRefusal.test.ts`), so that a field renamed on
/// one side fails a test.
#[test]
fn every_error_about_a_file_crosses_as_the_shared_file_of_literals_says() {
    let expected: Vec<serde_json::Value> =
        serde_json::from_str(include_str!("file-errors.json")).unwrap();
    let errors = file_errors();
    assert_eq!(errors.len(), expected.len());
    for (error, expected) in errors.iter().zip(expected) {
        assert_eq!(serde_json::to_value(error).unwrap(), expected);
    }
}
