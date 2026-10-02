use super::*;
use crate::error::ExportRefusal;
use crate::fixtures::{column, names};
use crate::formats::{CsvChoices, CsvEncoding, DecimalMark, MissingText, Separator};
use crate::ids::ColumnId;
use crate::import::import_table;
use crate::table::{ColumnValues, NewColumn, Numbers, Role, Stored};

fn built(name: &str, stored: Stored, role: Role) -> NewColumn {
    column(
        name,
        ColumnValues::from_stored(stored, role, ColumnId::new(1), name).unwrap(),
    )
}

fn texts(values: &[Option<&str>]) -> Stored {
    Stored::Text(
        values
            .iter()
            .map(|value| value.map(str::to_owned))
            .collect(),
    )
}

/// Two plants: a height, missing for B; their origin, a category; a
/// country of origin, made from names; seeds; whether fertile.
fn two() -> Table {
    Table::new(
        "Individual ID",
        names(&["A", "B"]),
        vec![
            column(
                "height",
                ColumnValues::Number(Numbers::Float(vec![Some(1.5), None])),
            ),
            built(
                "origin",
                texts(&[Some("Spain"), Some("Peru")]),
                Role::Category,
            ),
            built(
                "country",
                texts(&[Some("Spain"), Some("PE")]),
                Role::Country,
            ),
            built(
                "seeds",
                Stored::Integer(vec![Some(3), Some(-2)]),
                Role::Number,
            ),
            built(
                "fertile",
                Stored::Boolean(vec![Some(true), Some(false)]),
                Role::Category,
            ),
        ],
    )
    .unwrap()
}

const SPANISH: CsvChoices = CsvChoices {
    separator: Separator::Semicolon,
    decimal: DecimalMark::Comma,
    encoding: CsvEncoding::Utf8,
    missing: MissingText::Empty,
};

fn refusal(table: &Table, format: ExportFormat) -> ExportRefusal {
    match export_table(table, format) {
        Err(CommandError::ExportRefused { refusal }) => refusal,
        other => panic!("not a refusal: {other:?}"),
    }
}

#[test]
fn a_csv_has_the_header_individual_id_and_each_value_as_the_user_chose() {
    let bytes = export_table(&two(), ExportFormat::Csv { choices: SPANISH }).unwrap();
    assert_eq!(
        String::from_utf8(bytes).unwrap(),
        "IndividualID;height;origin;country;seeds;fertile\r\n\
         A;1,5;Spain;ESP;3;TRUE\r\n\
         B;;Peru;PER;-2;FALSE\r\n"
    );
}

#[test]
fn an_xlsx_reads_back_as_the_same_table() {
    let bytes = export_table(&two(), ExportFormat::Xlsx).unwrap();
    let back = import_table("plants.xlsx", &bytes).unwrap().table;
    assert_eq!(back.names().names(), ["A", "B"]);
    let values: Vec<Stored> = back
        .columns()
        .iter()
        .map(|column| column.values().to_stored().unwrap())
        .collect();
    assert_eq!(
        values,
        [
            Stored::Float(vec![Some(1.5), None]),
            texts(&[Some("Spain"), Some("Peru")]),
            texts(&[Some("ESP"), Some("PER")]),
            Stored::Integer(vec![Some(3), Some(-2)]),
            Stored::Boolean(vec![Some(true), Some(false)]),
        ]
    );
}

#[test]
fn a_text_that_reads_back_as_missing_is_refused_with_its_column_and_individual() {
    let table = Table::new(
        "IndividualID",
        names(&["A", "B"]),
        vec![built(
            "note",
            texts(&[Some("tall"), Some("NA")]),
            Role::Text,
        )],
    )
    .unwrap();
    assert_eq!(
        refusal(&table, ExportFormat::Csv { choices: SPANISH }),
        ExportRefusal::ReadsAsMissing {
            column_name: "note".to_owned(),
            individual: "B".to_owned(),
        }
    );
}

#[test]
fn an_xlsx_refuses_a_whole_number_beyond_2_to_the_53_and_a_name_that_is_an_error() {
    let large = Table::new(
        "IndividualID",
        names(&["A", "B"]),
        vec![built(
            "seeds",
            Stored::Integer(vec![Some(1), Some(1 << 60)]),
            Role::Number,
        )],
    )
    .unwrap();
    assert_eq!(
        refusal(&large, ExportFormat::Xlsx),
        ExportRefusal::IntegerTooLarge {
            column_name: "seeds".to_owned(),
            individual: "B".to_owned(),
        }
    );
    let error = Table::new(
        "IndividualID",
        names(&["A"]),
        vec![built("#N/A", Stored::Integer(vec![Some(1)]), Role::Number)],
    )
    .unwrap();
    assert_eq!(
        refusal(&error, ExportFormat::Xlsx),
        ExportRefusal::ErrorAsName {
            column_name: "#N/A".to_owned(),
        }
    );
}

#[test]
fn windows_1252_refuses_a_character_it_has_not_with_its_place() {
    let table = Table::new("IndividualID", names(&["Ősz"]), Vec::new()).unwrap();
    let choices = CsvChoices {
        encoding: CsvEncoding::Windows1252,
        ..SPANISH
    };
    assert_eq!(
        refusal(&table, ExportFormat::Csv { choices }),
        ExportRefusal::CannotCarry {
            column_name: "IndividualID".to_owned(),
            individual: Some("Ősz".to_owned()),
            character: 'Ő',
        }
    );
}

#[test]
fn a_table_of_no_individual_is_refused() {
    let table = Table::new(
        "IndividualID",
        Vec::new(),
        vec![column(
            "height",
            ColumnValues::Number(Numbers::Float(Vec::new())),
        )],
    )
    .unwrap();
    assert_eq!(
        refusal(&table, ExportFormat::Xlsx),
        ExportRefusal::NoIndividual
    );
}

#[test]
fn the_table_to_export_is_the_session_s_and_one_asked_for_before_its_load_is_refused() {
    use crate::command::{Command, Request};
    let mut session = Session::new();
    assert_eq!(
        session.table_to_export(Revision::ZERO),
        Err(CommandError::NoProject)
    );
    session
        .dispatch(Request {
            command: Command::LoadTable {
                table: two(),
                active_classification: None,
            },
            based_on: Revision::ZERO,
            sent_at: None,
        })
        .unwrap();
    let table = session.table_to_export(Revision::new(1)).unwrap();
    assert_eq!(table.names().names(), ["A", "B"]);
    assert_eq!(table.columns().len(), 5);
    assert_eq!(
        session.table_to_export(Revision::ZERO),
        Err(CommandError::MadeBeforeLoad {
            based_on: Revision::ZERO,
            loaded_at: Revision::new(1),
        })
    );
}

#[test]
fn a_csv_by_tabs_with_decimal_points_na_and_the_mark_of_utf_8_has_those_bytes() {
    let choices = CsvChoices {
        separator: Separator::Tab,
        decimal: DecimalMark::Point,
        encoding: CsvEncoding::Utf8WithMark,
        missing: MissingText::Na,
    };
    let bytes = export_table(&two(), ExportFormat::Csv { choices }).unwrap();
    assert_eq!(
        bytes,
        b"\xEF\xBB\xBFIndividualID\theight\torigin\tcountry\tseeds\tfertile\r\n\
          A\t1.5\tSpain\tESP\t3\tTRUE\r\n\
          B\tNA\tPeru\tPER\t-2\tFALSE\r\n"
    );
}

#[test]
fn each_separator_decimal_mark_and_missing_text_is_written_as_chosen() {
    let table = Table::new(
        "IndividualID",
        names(&["A", "B"]),
        vec![column(
            "height",
            ColumnValues::Number(Numbers::Float(vec![Some(1.5), None])),
        )],
    )
    .unwrap();
    let cases: [(Separator, DecimalMark, MissingText, &[u8]); 3] = [
        (
            Separator::Comma,
            DecimalMark::Point,
            MissingText::Empty,
            b"IndividualID,height\r\nA,1.5\r\nB,\r\n",
        ),
        (
            Separator::Semicolon,
            DecimalMark::Comma,
            MissingText::Na,
            b"IndividualID;height\r\nA;1,5\r\nB;NA\r\n",
        ),
        (
            Separator::Tab,
            DecimalMark::Comma,
            MissingText::Empty,
            b"IndividualID\theight\r\nA\t1,5\r\nB\t\r\n",
        ),
    ];
    for (separator, decimal, missing, expected) in cases {
        let choices = CsvChoices {
            separator,
            decimal,
            encoding: CsvEncoding::Utf8,
            missing,
        };
        assert_eq!(
            export_table(&table, ExportFormat::Csv { choices }).unwrap(),
            expected,
            "{choices:?}"
        );
    }
}

#[test]
fn each_encoding_writes_its_own_bytes_of_a_name_with_an_accent() {
    let table = Table::new("IndividualID", names(&["José"]), Vec::new()).unwrap();
    let cases: [(CsvEncoding, &[u8]); 3] = [
        (CsvEncoding::Utf8, b"IndividualID\r\nJos\xC3\xA9\r\n"),
        (
            CsvEncoding::Utf8WithMark,
            b"\xEF\xBB\xBFIndividualID\r\nJos\xC3\xA9\r\n",
        ),
        (CsvEncoding::Windows1252, b"IndividualID\r\nJos\xE9\r\n"),
    ];
    for (encoding, expected) in cases {
        let choices = CsvChoices {
            encoding,
            ..SPANISH
        };
        assert_eq!(
            export_table(&table, ExportFormat::Csv { choices }).unwrap(),
            expected,
            "{encoding:?}"
        );
    }
}
