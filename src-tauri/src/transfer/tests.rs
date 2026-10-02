use serde_json::json;
use vavilov_core::import_table;

use super::*;

fn imported(bytes: &[u8]) -> Imported {
    import_table("plants.csv", bytes).unwrap()
}

#[test]
fn an_import_whose_dialog_was_open_while_another_loaded_is_applied() {
    let mut session = Session::new();
    // The arguments of the second import, sent before the first one landed.
    let second: ImportArgs = serde_json::from_value(json!({ "sentAt": 1.5 })).unwrap();
    let first: ImportArgs = serde_json::from_value(json!({ "sentAt": 1.0 })).unwrap();
    load(
        &mut session,
        "a.csv".to_owned(),
        imported(b"IndividualID,height\np1,1.5\n"),
        first,
    )
    .unwrap();
    let (answer, _) = load(
        &mut session,
        "b.csv".to_owned(),
        imported(b"IndividualID,height\np1,1.5\np2,2.5\n"),
        second,
    )
    .unwrap();
    assert_eq!(
        answer,
        ImportAnswer::Imported {
            file_name: "b.csv".to_owned(),
            undecoded_line: None
        }
    );
    assert_eq!(session.revision(), Revision::new(2));
}

#[test]
fn an_import_takes_no_revision() {
    let refused = serde_json::from_value::<ImportArgs>(json!({ "basedOn": 0, "sentAt": 1.5 }));
    assert!(
        refused
            .unwrap_err()
            .to_string()
            .contains("unknown field `basedOn`")
    );
}
