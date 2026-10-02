use serde_json::json;

use crate::command::{Command, Request};
use crate::fixtures::plants;
use crate::ids::{ColumnId, Revision};
use crate::session::Session;

#[test]
fn the_description_names_every_column_with_its_type_and_levels() {
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
            "numRows": 4,
            "names": { "id": 0, "header": "accession" },
            "columns": [
                { "id": 1, "name": "height", "revision": 1, "type": "numeric" },
                {
                    "id": 2, "name": "origin", "revision": 1, "type": "categorical",
                    "levels": [
                        { "name": "Spain", "colour": "#d55e00" },
                        { "name": "Peru", "colour": "#0072b2" },
                    ],
                },
                {
                    "id": 3, "name": "cluster", "revision": 1, "type": "categorical",
                    "levels": [
                        { "name": "A", "colour": "#d55e00" },
                        { "name": "B", "colour": "#0072b2" },
                        { "name": "C", "colour": "#009e73" },
                    ],
                },
                { "id": 4, "name": "seeds", "revision": 1, "type": "integer" },
                { "id": 5, "name": "fertile", "revision": 1, "type": "boolean" },
                { "id": 6, "name": "note", "revision": 1, "type": "text" },
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
