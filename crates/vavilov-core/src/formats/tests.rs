use super::*;

#[test]
fn a_format_is_read_from_its_kind_and_its_choices() {
    assert_eq!(
        serde_json::from_str::<ExportFormat>(r#"{"kind":"xlsx"}"#).unwrap(),
        ExportFormat::Xlsx
    );
    assert_eq!(
        serde_json::from_str::<ExportFormat>(
            r#"{"kind":"csv","choices":{"separator":"tab","decimal":"comma","encoding":"windows1252","missing":"na"}}"#
        )
        .unwrap(),
        ExportFormat::Csv {
            choices: CsvChoices {
                separator: Separator::Tab,
                decimal: DecimalMark::Comma,
                encoding: CsvEncoding::Windows1252,
                missing: MissingText::Na,
            }
        }
    );
}

#[test]
fn a_format_with_a_field_it_has_not_is_refused() {
    for json in [
        r#"{"kind":"xlsx","x":1}"#,
        r#"{"kind":"csv","x":1,"choices":{"separator":"tab","decimal":"comma","encoding":"utf8","missing":"na"}}"#,
        r#"{"kind":"csv","choices":{"separator":"tab","decimal":"comma","encoding":"utf8","missing":"na","x":1}}"#,
    ] {
        let read = serde_json::from_str::<ExportFormat>(json);
        assert!(read.is_err(), "{json} gave {read:?}");
    }
}

#[test]
fn a_csv_with_the_comma_as_both_separator_and_decimal_mark_is_refused() {
    let json = r#"{"kind":"csv","choices":{"separator":"comma","decimal":"comma","encoding":"utf8","missing":"empty"}}"#;
    let read = serde_json::from_str::<ExportFormat>(json);
    assert!(read.is_err(), "{json} gave {read:?}");
    let json = r#"{"kind":"csv","choices":{"separator":"semicolon","decimal":"comma","encoding":"utf8","missing":"empty"}}"#;
    assert!(serde_json::from_str::<ExportFormat>(json).is_ok());
}
