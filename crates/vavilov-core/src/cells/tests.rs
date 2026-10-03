use super::*;
use crate::fixtures::{BLUE, VERMILLION, boolean, categorical, code, float, integer, names};
use crate::table::{Role, Stored};

fn value(values: &ColumnValues, text: &str, mark: &str) -> Result<Typed, CellRefusal> {
    typed(values, text, mark)
}

fn of(role: Role, stored: Stored) -> ColumnValues {
    ColumnValues::from_stored(stored, role, crate::ids::ColumnId::new(1), "a test").unwrap()
}

#[test]
fn a_whole_number_is_read_as_one_and_anything_else_is_refused() {
    let column = integer(vec![Some(1)]);
    assert_eq!(
        value(&column, " -12 ", ","),
        Ok(Typed::Value(CellValue::Integer(Some(-12))))
    );
    assert_eq!(
        value(&column, "", ","),
        Ok(Typed::Value(CellValue::Integer(None)))
    );
    assert_eq!(
        value(&column, "  ", ","),
        Ok(Typed::Value(CellValue::Integer(None)))
    );
    for text in ["1,5", "1.0", "ten", "NA", "9223372036854775808"] {
        assert_eq!(
            value(&column, text, ","),
            Err(CellRefusal::NotWholeNumber),
            "{text}"
        );
    }
    assert_eq!(
        value(&column, "9223372036854775807", ","),
        Ok(Typed::Value(CellValue::Integer(Some(i64::MAX))))
    );
}

#[test]
fn a_decimal_number_is_read_with_the_region_s_mark_and_a_point_is_refused_where_it_is_not_the_mark()
{
    let column = float(vec![Some(1.0)]);
    let decimal = |text: &str, mark: &str| value(&column, text, mark);
    assert_eq!(
        decimal("1,5", ","),
        Ok(Typed::Value(CellValue::Float(Some(1.5))))
    );
    assert_eq!(
        decimal("-0,25", ","),
        Ok(Typed::Value(CellValue::Float(Some(-0.25))))
    );
    assert_eq!(
        decimal("2", ","),
        Ok(Typed::Value(CellValue::Float(Some(2.0))))
    );
    assert_eq!(
        decimal("1e3", ","),
        Ok(Typed::Value(CellValue::Float(Some(1000.0))))
    );
    assert_eq!(
        decimal("1.5", "."),
        Ok(Typed::Value(CellValue::Float(Some(1.5))))
    );
    assert_eq!(
        decimal("1٫5", "٫"),
        Ok(Typed::Value(CellValue::Float(Some(1.5))))
    );
    assert_eq!(decimal("", ","), Ok(Typed::Value(CellValue::Float(None))));
    let refused = |mark: &str| {
        Err(CellRefusal::NotDecimalNumber {
            decimal_mark: mark.to_owned(),
        })
    };
    // 1.500 in Spain is one thousand five hundred to its reader.
    assert_eq!(decimal("1.500", ","), refused(","));
    assert_eq!(decimal("1,5", "."), refused("."));
    for text in ["inf", "NaN", "1e400", "one", "1,5,5"] {
        assert_eq!(decimal(text, ","), refused(","), "{text}");
    }
}

#[test]
fn a_latitude_and_a_longitude_must_be_in_their_range() {
    let latitude = of(Role::Latitude, Stored::Float(vec![Some(40.0)]));
    assert_eq!(
        value(&latitude, "-90", "."),
        Ok(Typed::Value(CellValue::Float(Some(-90.0))))
    );
    assert_eq!(value(&latitude, "90.5", "."), Err(CellRefusal::NotLatitude));
    assert_eq!(
        value(&latitude, "", "."),
        Ok(Typed::Value(CellValue::Float(None)))
    );
    let longitude = of(Role::Longitude, Stored::Integer(vec![Some(3)]));
    assert_eq!(
        value(&longitude, "180", "."),
        Ok(Typed::Value(CellValue::Integer(Some(180))))
    );
    assert_eq!(
        value(&longitude, "-181", "."),
        Err(CellRefusal::NotLongitude)
    );
    assert_eq!(
        value(&longitude, "3000000000", "."),
        Err(CellRefusal::NotLongitude)
    );
    assert_eq!(
        value(&longitude, "1,5", ","),
        Err(CellRefusal::NotWholeNumber)
    );
}

#[test]
fn a_text_is_taken_as_typed_and_an_empty_one_is_missing() {
    let column = ColumnValues::Text(vec![Some("tall".to_owned())]);
    assert_eq!(
        value(&column, " short ", "."),
        Ok(Typed::Value(CellValue::Text(Some(" short ".to_owned()))))
    );
    assert_eq!(
        value(&column, "NA", "."),
        Ok(Typed::Value(CellValue::Text(Some("NA".to_owned()))))
    );
    assert_eq!(
        value(&column, "", "."),
        Ok(Typed::Value(CellValue::Text(None)))
    );
}

#[test]
fn a_category_takes_one_of_its_values_and_refuses_another() {
    let origin = categorical(&[("Spain", VERMILLION), ("Peru", BLUE)], vec![code(0)]);
    assert_eq!(value(&origin, " Peru ", "."), Ok(Typed::Code(code(1))));
    assert_eq!(value(&origin, "", "."), Ok(Typed::Code(None)));
    // A text level is matched exactly, case included.
    assert_eq!(value(&origin, "peru", "."), Err(CellRefusal::NotALevel));
    assert_eq!(value(&origin, "Chile", "."), Err(CellRefusal::NotALevel));
}

#[test]
fn a_category_of_numbers_takes_a_value_by_its_number() {
    let whole = of(Role::Category, Stored::Integer(vec![Some(10), Some(5)]));
    // Levels 5, 10.
    assert_eq!(value(&whole, "05", "."), Ok(Typed::Code(code(0))));
    assert_eq!(value(&whole, "10", "."), Ok(Typed::Code(code(1))));
    assert_eq!(value(&whole, "7", "."), Err(CellRefusal::NotALevel));
    assert_eq!(value(&whole, "5,0", ","), Err(CellRefusal::NotWholeNumber));
    let decimal = of(Role::Category, Stored::Float(vec![Some(1.5), Some(0.0)]));
    // Levels 0, 1.5; −0 is the level 0.
    assert_eq!(value(&decimal, "1,5", ","), Ok(Typed::Code(code(1))));
    assert_eq!(value(&decimal, "-0", ","), Ok(Typed::Code(code(0))));
    assert_eq!(
        value(&decimal, "1.5", ","),
        Err(CellRefusal::NotDecimalNumber {
            decimal_mark: ",".to_owned()
        })
    );
}

#[test]
fn a_category_of_yes_or_no_takes_true_and_false_in_any_case() {
    let fertile = boolean(vec![Some(true), Some(false)]);
    // FALSE before TRUE.
    assert_eq!(value(&fertile, "true", "."), Ok(Typed::Code(code(1))));
    assert_eq!(value(&fertile, "FALSE", "."), Ok(Typed::Code(code(0))));
    assert_eq!(value(&fertile, "yes", "."), Err(CellRefusal::NotYesOrNo));
    let only_true = boolean(vec![Some(true)]);
    assert_eq!(value(&only_true, "FALSE", "."), Err(CellRefusal::NotALevel));
}

#[test]
fn a_country_is_taken_by_any_of_its_names_and_codes_when_it_is_a_value_of_the_column() {
    let origin = of(
        Role::Country,
        Stored::Text(vec![Some("Spain".to_owned()), Some("PER".to_owned())]),
    );
    // Levels ESP, PER.
    assert_eq!(value(&origin, "es", "."), Ok(Typed::Code(code(0))));
    assert_eq!(
        value(&origin, "Kingdom of Spain", "."),
        Ok(Typed::Code(code(0)))
    );
    assert_eq!(value(&origin, "Peru", "."), Ok(Typed::Code(code(1))));
    assert_eq!(value(&origin, "", "."), Ok(Typed::Code(None)));
    assert_eq!(value(&origin, "Chile", "."), Err(CellRefusal::NotALevel));
    assert_eq!(
        value(&origin, "Atlantis", "."),
        Err(CellRefusal::NotACountry)
    );
}

#[test]
fn an_id_must_not_be_empty_nor_another_individual_s() {
    let ids = names(&["p1", "p2"]);
    assert_eq!(name_of(&ids, 0, "p9"), Ok("p9".to_owned()));
    assert_eq!(name_of(&ids, 0, "p1"), Ok("p1".to_owned()));
    assert_eq!(name_of(&ids, 0, " p2"), Ok(" p2".to_owned()));
    assert_eq!(name_of(&ids, 0, "p2"), Err(CellRefusal::IdTaken));
    assert_eq!(name_of(&ids, 1, ""), Err(CellRefusal::EmptyId));
}
