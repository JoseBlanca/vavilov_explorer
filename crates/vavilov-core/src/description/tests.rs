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
                    "id": 1, "name": "height", "revision": 1,
                    "storage": "float", "role": "number", "numDistinct": 3,
                },
                {
                    "id": 2, "name": "origin", "revision": 1,
                    "storage": "text", "role": "classification",
                    "levels": [
                        { "value": "Spain", "colour": "#d55e00" },
                        { "value": "Peru", "colour": "#0072b2" },
                    ],
                },
                {
                    "id": 3, "name": "cluster", "revision": 1,
                    "storage": "text", "role": "classification",
                    "levels": [
                        { "value": "A", "colour": "#d55e00" },
                        { "value": "B", "colour": "#0072b2" },
                        { "value": "C", "colour": "#009e73" },
                    ],
                },
                {
                    "id": 4, "name": "seeds", "revision": 1,
                    "storage": "integer", "role": "number", "numDistinct": 3,
                },
                {
                    "id": 5, "name": "fertile", "revision": 1,
                    "storage": "boolean", "role": "category",
                    "levels": [
                        { "value": false, "colour": "#e69f00" },
                        { "value": true, "colour": "#56b4e9" },
                    ],
                },
                {
                    "id": 6, "name": "note", "revision": 1,
                    "storage": "text", "role": "text", "numDistinct": 3,
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
