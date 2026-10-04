use serde_json::json;

use crate::command::{Command, Request};
use crate::fixtures::plants;
use crate::ids::{ColumnId, Revision};
use crate::session::Session;

#[test]
fn the_description_names_every_column_with_its_storage_type_role_and_levels() {
    let mut session = Session::new();
    session
        .dispatch(Request {
            command: Command::LoadTable {
                table: plants(),
                active_classification: Some(ColumnId::new(2)),
            },
            based_on: Revision::ZERO,
            sent_at: None,
        })
        .unwrap();
    assert_eq!(
        serde_json::to_value(session.describe().unwrap()).unwrap(),
        json!({
            "loadedAt": 1,
            "shapeAt": 1,
            "numRows": 4,
            "names": { "id": 0, "header": "IndividualID" },
            "columns": [
                {
                    "id": 1, "name": "height", "revision": 1, "storage": "float",
                    "role": "number",
                    "roles": ["number", "latitude", "longitude", "category"],
                },
                {
                    "id": 2, "name": "origin", "revision": 1, "storage": "text",
                    "role": "category",
                    "roles": ["category", "country", "text"],
                    "levels": [
                        { "value": "Spain", "colour": "#d55e00" },
                        { "value": "Peru", "colour": "#0072b2" },
                    ],
                },
                {
                    "id": 3, "name": "cluster", "revision": 1, "storage": "text",
                    "role": "category",
                    "roles": ["category", "text"],
                    "levels": [
                        { "value": "A", "colour": "#d55e00" },
                        { "value": "B", "colour": "#0072b2" },
                        { "value": "C", "colour": "#009e73" },
                    ],
                },
                {
                    "id": 4, "name": "seeds", "revision": 1, "storage": "integer",
                    "role": "number",
                    "roles": ["number", "latitude", "longitude", "category"],
                },
                {
                    "id": 5, "name": "fertile", "revision": 1, "storage": "boolean",
                    "role": "category",
                    "roles": ["category"],
                    "levels": [
                        { "value": false, "colour": "#e69f00" },
                        { "value": true, "colour": "#56b4e9" },
                    ],
                },
                {
                    "id": 6, "name": "note", "revision": 1, "storage": "text",
                    "role": "text",
                    "roles": ["category", "text"],
                },
            ],
        })
    );
}

#[test]
fn with_no_project_there_is_nothing_to_describe() {
    assert_eq!(
        Session::new().describe(),
        Err(crate::error::CommandError::NoProject)
    );
}

#[test]
fn the_levels_of_whole_numbers_are_texts_so_that_none_is_rounded_and_decimal_ones_numbers() {
    use crate::fixtures::{column, names};
    use crate::table::{Categorical, ColumnValues, Stored, Table};
    // 2^53 + 1, which a JavaScript number would read as 2^53.
    let integers = Stored::Integer(vec![Some(9_007_199_254_740_993), Some(-7)]);
    let floats = Stored::Float(vec![Some(1.5), Some(-0.25)]);
    let table = Table::new(
        "IndividualID",
        names(&["p1", "p2"]),
        vec![
            column(
                "seeds",
                ColumnValues::Category(Categorical::from_stored(&integers, "seeds").unwrap()),
            ),
            column(
                "height",
                ColumnValues::Category(Categorical::from_stored(&floats, "height").unwrap()),
            ),
        ],
    )
    .unwrap();
    let mut session = Session::new();
    session
        .dispatch(Request {
            command: Command::LoadTable {
                table,
                active_classification: None,
            },
            based_on: Revision::ZERO,
            sent_at: None,
        })
        .unwrap();
    let description = serde_json::to_value(session.describe().unwrap()).unwrap();
    assert_eq!(
        description["columns"][0]["levels"],
        json!([
            { "value": "-7", "colour": "#e69f00" },
            { "value": "9007199254740993", "colour": "#56b4e9" },
        ])
    );
    assert_eq!(
        description["columns"][1]["levels"],
        json!([
            { "value": -0.25, "colour": "#e69f00" },
            { "value": 1.5, "colour": "#56b4e9" },
        ])
    );
}

#[test]
fn the_levels_of_a_country_column_name_their_country_and_its_numeric_code() {
    use crate::fixtures::{column, names};
    use crate::table::{Categorical, ColumnValues, Role, Stored, Table};
    let origins = Stored::Text(vec![
        Some("Spain".to_owned()),
        Some("SU".to_owned()),
        Some("guf".to_owned()),
    ]);
    let table = Table::new(
        "IndividualID",
        names(&["p1", "p2", "p3"]),
        vec![column(
            "origin",
            ColumnValues::Category(Categorical::from_stored(&origins, "origin").unwrap()),
        )],
    )
    .unwrap();
    let mut session = Session::new();
    session
        .dispatch(Request {
            command: Command::LoadTable {
                table,
                active_classification: None,
            },
            based_on: Revision::ZERO,
            sent_at: None,
        })
        .unwrap();
    // A category of the same names is not of countries, and its levels say none.
    let before = serde_json::to_value(session.describe().unwrap()).unwrap();
    assert_eq!(before["columns"][0]["levels"][0].get("country"), None);
    session
        .dispatch(Request {
            command: Command::SetRole {
                column: ColumnId::new(1),
                role: Role::Country,
            },
            based_on: Revision::new(1),
            sent_at: None,
        })
        .unwrap();
    let description = serde_json::to_value(session.describe().unwrap()).unwrap();
    let levels = description["columns"][0]["levels"].as_array().unwrap();
    let countries: Vec<_> = levels
        .iter()
        .map(|level| (level["value"].clone(), level["country"].clone()))
        .collect();
    assert_eq!(
        countries,
        vec![
            (json!("ESP"), json!({ "name": "Spain", "numeric": "724" })),
            (
                json!("GUF"),
                json!({ "name": "French Guiana", "numeric": "254" })
            ),
            (
                json!("SUN"),
                json!({ "name": "Soviet Union", "numeric": null })
            ),
        ]
    );
}
