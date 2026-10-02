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
