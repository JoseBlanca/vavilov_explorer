use std::path::{Path, PathBuf};

use vavilov_core::{
    CsvChoices, CsvEncoding, DecimalMark, ExportFormat, MissingText, Role, Separator, export_table,
};

use super::FILE;
use crate::{demo, transfer};

/// The example table's file in the repository.
fn file() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join(FILE)
}

/// The demo table as the export writes a CSV with commas, the point and
/// UTF-8, and empty cells for the missing values.
fn demo_csv() -> Vec<u8> {
    export_table(
        &demo::table().unwrap(),
        ExportFormat::Csv {
            choices: CsvChoices {
                separator: Separator::Comma,
                decimal: DecimalMark::Point,
                encoding: CsvEncoding::Utf8,
                missing: MissingText::Empty,
            },
        },
    )
    .unwrap()
}

#[test]
fn the_example_file_is_the_demo_table_as_the_export_writes_it() {
    // `VAVILOV_WRITE_EXAMPLE=1 cargo test -p vavilov-explorer example`
    // writes it again, after a change of the demo table.
    if std::env::var_os("VAVILOV_WRITE_EXAMPLE").is_some() {
        std::fs::write(file(), demo_csv()).unwrap();
    }
    let written = std::fs::read(file()).unwrap();
    assert!(
        written == demo_csv(),
        "{FILE} is not the demo table: write it again with VAVILOV_WRITE_EXAMPLE=1"
    );
}

#[test]
fn the_example_file_imports_with_the_roles_the_import_guesses() {
    let (file_name, imported) = transfer::read(&file()).unwrap();
    assert_eq!(file_name, "example-plants.csv");
    let table = imported.table;
    assert_eq!(table.num_rows(), 2_000);
    let roles: Vec<(String, Role)> = table
        .columns()
        .iter()
        .map(|column| (column.name().to_owned(), column.values().role()))
        .collect();
    let role_of = |name: &str| {
        roles
            .iter()
            .find(|(each, _)| each == name)
            .map(|(_, role)| *role)
    };
    assert_eq!(role_of("latitude"), Some(Role::Latitude));
    assert_eq!(role_of("longitude"), Some(Role::Longitude));
    // A column of countries is a category until its role is chosen.
    assert_eq!(role_of("country"), Some(Role::Category));
    assert_eq!(role_of("PC1"), Some(Role::Number));
    assert_eq!(imported.undecoded_line, None);
}
