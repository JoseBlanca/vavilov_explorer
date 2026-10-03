use super::*;
use crate::error::ImportRefusal;
use crate::formats::{FileFormat, Separator};
use crate::ids::{ColumnId, LevelCode};
use crate::table::{Categorical, ColumnValues, LevelValues, Numbers, Role, palette};

fn code(code: u16) -> Option<LevelCode> {
    Some(LevelCode::new(code))
}

fn refusal(bytes: &[u8]) -> ImportRefusal {
    refusal_of_file("plants.csv", bytes)
}

fn refusal_of_file(name: &str, bytes: &[u8]) -> ImportRefusal {
    match import_table(name, bytes) {
        Err(CommandError::ImportRefused { file_name, refusal }) => {
            assert_eq!(file_name, name);
            refusal
        }
        other => panic!("not a refusal: {other:?}"),
    }
}

fn roles(imported: &Imported) -> Vec<(&str, Role)> {
    imported
        .table
        .columns()
        .iter()
        .map(|column| (column.name(), column.values().role()))
        .collect()
}

#[test]
fn every_text_of_the_file_is_kept_in_the_composed_form() {
    // Each accent written as a separate character after its letter, as a
    // Mac often writes them.
    let bytes = "IndividualID;Nu\u{301}mero;origin;note\n\
                 Jose\u{301};1;Peru\u{301};a\u{301}\n\
                 p2;2;Per\u{fa};b\n";
    let imported = import_table("plants.csv", bytes.as_bytes()).unwrap();
    let table = &imported.table;
    assert_eq!(table.names().names(), ["Jos\u{e9}", "p2"]);
    assert_eq!(table.columns()[0].name(), "N\u{fa}mero");
    // The two spellings of Perú are one population.
    let origin = table.columns()[1].categorical().unwrap();
    assert_eq!(
        origin.levels(),
        &LevelValues::Text(vec!["Per\u{fa}".to_owned()])
    );
    assert_eq!(origin.codes(), [code(0), code(0)]);
    assert_eq!(
        table.columns()[2].values().to_stored().unwrap(),
        crate::table::Stored::Text(vec![Some("\u{e1}".to_owned()), Some("b".to_owned())])
    );
}

#[test]
fn two_ids_or_two_column_names_that_differ_only_in_how_an_accent_is_written_are_refused() {
    assert_eq!(
        refusal("IndividualID;x\nJose\u{301};1\nJos\u{e9};2\n".as_bytes()),
        ImportRefusal::IndividualWrittenTwoWays {
            name: "Jos\u{e9}".to_owned()
        }
    );
    assert_eq!(
        refusal("IndividualID;Peru\u{301};Per\u{fa}\nA;1;2\n".as_bytes()),
        ImportRefusal::ColumnWrittenTwoWays {
            name: "Per\u{fa}".to_owned()
        }
    );
}

#[test]
fn a_csv_gives_its_individuals_and_each_column_with_its_guessed_role() {
    let bytes = "Individual ID;height;origin;lat;Long;fertile;seeds\n\
                 A;1,5;Spain;40,4;-3,7;TRUE;10\n\
                 B;2;Peru;-12;-77;FALSE;\n\
                 C;NA;Spain;;-200;TRUE;7\n";
    let imported = import_table("plants.csv", bytes.as_bytes()).unwrap();
    assert_eq!(imported.undecoded_line, None);
    // origin, the first category of the two, the second column after the
    // names.
    assert_eq!(imported.active_classification, Some(ColumnId::new(2)));
    assert_eq!(imported.table.names().header(), "IndividualID");
    assert_eq!(imported.table.names().names(), ["A", "B", "C"]);
    // Long has -200, which no longitude is: a number.
    assert_eq!(
        roles(&imported),
        [
            ("height", Role::Number),
            ("origin", Role::Category),
            ("lat", Role::Latitude),
            ("Long", Role::Number),
            ("fertile", Role::Category),
            ("seeds", Role::Number),
        ]
    );
    let column = |index: usize| imported.table.columns()[index].values();
    assert_eq!(
        column(0),
        &ColumnValues::Number(Numbers::Float(vec![Some(1.5), Some(2.0), None]))
    );
    assert_eq!(
        column(1),
        &ColumnValues::Category(Categorical::new(
            LevelValues::Text(vec!["Peru".to_owned(), "Spain".to_owned()]),
            palette(2),
            vec![code(1), code(0), code(1)],
        ))
    );
    assert_eq!(
        column(2),
        &ColumnValues::Latitude(Numbers::Float(vec![Some(40.4), Some(-12.0), None]))
    );
    assert_eq!(
        column(4),
        &ColumnValues::Category(Categorical::new(
            LevelValues::Boolean(vec![false, true]),
            palette(2),
            vec![code(1), code(0), code(1)],
        ))
    );
    assert_eq!(
        column(5),
        &ColumnValues::Number(Numbers::Integer(vec![Some(10), None, Some(7)]))
    );
}

#[test]
fn a_column_of_text_of_more_than_20_values_is_text_and_of_20_a_category() {
    let mut csv = String::from("IndividualID,twenty,twenty-one\n");
    for row in 0..21 {
        // twenty: v0 to v19, and v0 again; twenty-one: w0 to w20.
        csv.push_str(&format!("p{row},v{},w{row}\n", row % 20));
    }
    let imported = import_table("plants.csv", csv.as_bytes()).unwrap();
    assert_eq!(
        roles(&imported),
        [("twenty", Role::Category), ("twenty-one", Role::Text)]
    );
}

#[test]
fn a_table_without_a_category_starts_with_no_active_classification() {
    // note has no value, so it is text.
    let csv = "IndividualID,height,note\np1,1,\np2,2,\n";
    let imported = import_table("plants.csv", csv.as_bytes()).unwrap();
    assert_eq!(imported.active_classification, None);
}

#[test]
fn a_column_with_no_values_is_text_whatever_its_header() {
    // lat would be a latitude if it had values; table_io reads an empty
    // column as text. kind has one value, so it stays a category.
    let csv = "IndividualID,empty,lat,kind\np1,,,wild\np2,NA,,wild\n";
    let imported = import_table("plants.csv", csv.as_bytes()).unwrap();
    assert_eq!(
        roles(&imported),
        [
            ("empty", Role::Text),
            ("lat", Role::Text),
            ("kind", Role::Category)
        ]
    );
}

#[test]
fn a_first_column_not_named_individual_id_is_refused_with_its_header() {
    assert_eq!(
        refusal(b"accession,height\nA,1\n"),
        ImportRefusal::NotIndividualId {
            header: "accession".to_owned()
        }
    );
}

#[test]
fn another_column_named_as_the_first_is_refused_with_its_column() {
    assert_eq!(
        refusal(b"IndividualID,height,individual_id\nA,1,x\n"),
        ImportRefusal::NamedIndividualId {
            format: FileFormat::Text,
            column: 3,
        }
    );
}

#[test]
fn the_refusals_of_table_io_keep_their_lines_and_separator() {
    assert_eq!(
        refusal(b"IndividualID,pop\nA,P1\nB\n"),
        ImportRefusal::RaggedRow {
            line: 3,
            expected: 2,
            found: 1,
            separator: Separator::Comma,
        }
    );
    assert_eq!(
        refusal(b"IndividualID;pop\nA;P1\nA;P2\n"),
        ImportRefusal::DuplicateIndividual {
            format: FileFormat::Text,
            name: "A".to_owned(),
            first_row: 2,
            second_row: 3,
        }
    );
    assert_eq!(refusal(b""), ImportRefusal::Empty);
}

#[test]
fn a_file_larger_than_20_mb_is_refused_with_its_size() {
    let bytes = vec![b'a'; 20_000_001];
    assert_eq!(
        refusal(&bytes),
        ImportRefusal::TooLarge {
            size: 20_000_001,
            max_bytes: 20_000_000,
        }
    );
}

#[test]
fn a_character_that_could_not_be_decoded_is_reported_with_its_line() {
    // The mark of UTF-8, then a byte 0xFF on line 3, which is not UTF-8.
    let mut bytes = b"\xEF\xBB\xBFIndividualID,note\nA,x\nB,".to_vec();
    bytes.extend([0xFF, b'\n']);
    let imported = import_table("plants.csv", &bytes).unwrap();
    assert_eq!(imported.undecoded_line, Some(3));
}

#[test]
fn a_damaged_xlsx_is_unreadable_with_its_name_and_the_reader_s_message() {
    // The first bytes of a zip, and nothing of the rest.
    let mut bytes = b"PK\x03\x04".to_vec();
    bytes.extend([0; 26]);
    assert_eq!(
        import_table("plants.xlsx", &bytes),
        Err(CommandError::ImportUnreadable {
            file_name: "plants.xlsx".to_owned(),
            message: "invalid Zip archive: Could not find EOCD".to_owned(),
        })
    );
}

#[test]
fn an_xlsx_with_a_cell_reference_too_large_to_count_is_refused_and_does_not_panic() {
    // The xlsx of two individuals the core exports, with the reference of
    // cell B3 changed to ZZZZZZZ3, a column whose number overflows a u32.
    let result = import_table("plants.xlsx", include_bytes!("overflowing-reference.xlsx"));
    // calamine's count of the column wraps, as in a release build, and
    // the sheet is then too large.
    assert_eq!(
        result,
        Err(CommandError::ImportRefused {
            file_name: "plants.xlsx".to_owned(),
            refusal: ImportRefusal::SheetTooLarge {
                sheet: "Sheet1".to_owned(),
                first_row: 1,
                first_column: 1,
                num_rows: 3,
                num_columns: 4_058_115_286,
                max_cells: 2_000_000,
            },
        })
    );
}

/// The role the import guesses for a column `header` of the values `values`.
fn guessed(header: &str, values: [&str; 2]) -> Role {
    let csv = format!("IndividualID,{header}\nA,{}\nB,{}\n", values[0], values[1]);
    let imported = import_table("plants.csv", csv.as_bytes()).unwrap();
    imported.table.columns()[0].values().role()
}

#[test]
fn a_longitude_is_guessed_from_its_header_in_any_case_and_with_spaces() {
    // 150 and -170.5 are no latitude, so a longitude checked as a latitude
    // would be a number.
    assert_eq!(guessed("lon", ["150", "-150"]), Role::Longitude);
    assert_eq!(guessed("long", ["-170.5", "170"]), Role::Longitude);
    assert_eq!(guessed(" Longitude ", ["120", "-10"]), Role::Longitude);
    assert_eq!(guessed("longitude", ["181", "0"]), Role::Number);
    // table_io removes the spaces at the ends of a header, so only a name
    // given to the guess itself keeps them.
    assert_eq!(
        guessed_role(" Longitude ", &Stored::Float(vec![Some(120.0)])),
        Role::Longitude
    );
}

#[test]
fn a_latitude_is_guessed_from_its_header_in_any_case_and_with_spaces() {
    assert_eq!(guessed("LAT", ["45", "-80"]), Role::Latitude);
    assert_eq!(guessed(" lat ", ["-45", "80"]), Role::Latitude);
    // 95 is a longitude and no latitude.
    assert_eq!(guessed("latitude", ["95", "10"]), Role::Number);
}

#[test]
fn a_refusal_of_an_xlsx_keeps_its_format_and_the_rows_of_its_sheet() {
    // The xlsx of individuals A and B the core exports, with B's name in
    // cell A3 changed to A.
    assert_eq!(
        refusal_of_file("plants.xlsx", include_bytes!("duplicate-individual.xlsx")),
        ImportRefusal::DuplicateIndividual {
            format: FileFormat::Xlsx,
            name: "A".to_owned(),
            first_row: 2,
            second_row: 3,
        }
    );
}

#[test]
fn a_ragged_row_of_a_file_split_by_semicolons_names_the_semicolon() {
    assert_eq!(
        refusal(b"IndividualID;pop;height\nA;P1;1\nB;P2\n"),
        ImportRefusal::RaggedRow {
            line: 3,
            expected: 3,
            found: 2,
            separator: Separator::Semicolon,
        }
    );
}

#[test]
fn two_columns_of_one_name_are_refused_with_the_first_and_then_the_second() {
    assert_eq!(
        refusal(b"IndividualID,height,pop,height\nA,1,x,2\n"),
        ImportRefusal::DuplicateColumn {
            format: FileFormat::Text,
            name: "height".to_owned(),
            first_column: 2,
            second_column: 4,
        }
    );
}

#[test]
fn an_xlsx_of_more_than_2_000_000_cells_is_refused_with_the_limit() {
    use crate::fixtures::{column, names};
    use crate::formats::ExportFormat;
    let num_rows = 1_000_001;
    let individuals: Vec<String> = (0..num_rows).map(|row| format!("p{row}")).collect();
    let individuals: Vec<&str> = individuals.iter().map(String::as_str).collect();
    let table = Table::new(
        "IndividualID",
        names(&individuals),
        vec![column(
            "height",
            ColumnValues::Number(Numbers::Integer(vec![Some(1); num_rows])),
        )],
    )
    .unwrap();
    let bytes = crate::export::export_table(&table, ExportFormat::Xlsx).unwrap();
    assert_eq!(
        refusal_of_file("plants.xlsx", &bytes),
        ImportRefusal::SheetTooLarge {
            sheet: "Sheet1".to_owned(),
            first_row: 1,
            first_column: 1,
            num_rows: 1_000_001,
            num_columns: 2,
            max_cells: 2_000_000,
        }
    );
}
