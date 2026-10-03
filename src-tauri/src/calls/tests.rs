use serde_json::json;
use vavilov_core::{Categorical, Colour, ColumnValues, LevelValues, NewColumn, Table};

use super::*;

/// A session with three plants loaded at revision 1, `origin` (Spain,
/// Peru) as column 1 and active.
fn loaded() -> Session {
    let colour = Colour {
        red: 230,
        green: 159,
        blue: 0,
    };
    let table = Table::new(
        "IndividualID",
        vec!["p1".to_owned(), "p2".to_owned(), "p3".to_owned()],
        vec![NewColumn {
            name: "origin".to_owned(),
            values: ColumnValues::Category(Categorical::new(
                LevelValues::Text(vec!["Spain".to_owned(), "Peru".to_owned()]),
                vec![colour, colour],
                vec![Some(LevelCode::new(0)), None, None],
            )),
        }],
    )
    .unwrap();
    let mut session = Session::new();
    session
        .dispatch(Request {
            command: Command::LoadTable {
                table,
                active_classification: Some(ColumnId::new(1)),
            },
            based_on: Revision::ZERO,
            sent_at: None,
        })
        .unwrap();
    session
}

fn json_call(
    session: &mut Session,
    command: &str,
    args: serde_json::Value,
) -> Result<Reply, CommandError> {
    call(session, command, &InvokeBody::Json(args), &HeaderMap::new())
}

#[test]
fn a_json_call_reaches_the_session() {
    let mut session = loaded();
    json_call(
        &mut session,
        "select_groups",
        json!({ "column": 1, "selected": [{ "group": 1 }], "basedOn": 1 }),
    )
    .unwrap();
    assert_eq!(
        session.active(),
        Some(vavilov_core::Active {
            column: ColumnId::new(1),
            selected: vavilov_core::SelectedGroups::one(Selected::Group(LevelCode::new(1))),
            mode: None,
        })
    );
}

#[test]
fn an_argument_the_command_does_not_have_is_a_defect() {
    let mut session = loaded();
    let refusal = json_call(
        &mut session,
        "set_active_classification",
        json!({ "columnId": 1, "basedOn": 1 }),
    )
    .unwrap_err();
    assert!(
        matches!(&refusal, CommandError::Defect { what } if what.contains("unknown field `columnId`")),
        "{refusal:?}"
    );
    let refusal = json_call(&mut session, "undo", json!({})).unwrap_err();
    assert!(
        matches!(&refusal, CommandError::Defect { what } if what.contains("missing field `basedOn`")),
        "{refusal:?}"
    );
}

#[test]
fn an_unknown_command_and_a_body_of_the_wrong_form_are_defects() {
    let mut session = loaded();
    assert_eq!(
        json_call(&mut session, "set_pointer_mode", json!({ "basedOn": 1 })).unwrap_err(),
        (CommandError::Defect {
            what: "a call to an unknown command set_pointer_mode".to_owned()
        })
    );
    assert_eq!(
        call(
            &mut session,
            "undo",
            &InvokeBody::Raw(vec![0]),
            &HeaderMap::new()
        )
        .unwrap_err(),
        (CommandError::Defect {
            what: "undo, which takes JSON arguments, was given raw bytes".to_owned()
        })
    );
}

#[test]
fn a_time_that_is_not_finite_is_a_defect_in_both_forms_of_call() {
    let mut session = loaded();
    let mut headers = HeaderMap::new();
    headers.insert("based-on", "1".parse().unwrap());
    headers.insert("sent-at", "NaN".parse().unwrap());
    assert!(matches!(
        call(
            &mut session,
            "set_selection",
            &InvokeBody::Raw(vec![0]),
            &headers
        ),
        Err(CommandError::Defect { .. })
    ));
    // JSON has no NaN; a window's NaN arrives as null, and is caught there
    // (src/backend/connection.ts).
    assert!(
        json_call(
            &mut session,
            "undo",
            json!({ "basedOn": 1, "sentAt": "NaN" })
        )
        .is_err()
    );
}

#[test]
fn a_page_of_rows_is_read_from_its_json_arguments() {
    let mut session = loaded();
    let Reply::Rows(bytes) = json_call(
        &mut session,
        "fetch_rows",
        json!({ "first": 2, "count": 1, "columns": [1], "basedOn": 1 }),
    )
    .unwrap() else {
        panic!("another reply than rows");
    };
    // The page part: loaded at 1, rows shown since 1, names since 1, from
    // position 2, 1 row, which is row 2.
    assert_eq!(
        &bytes[24..72],
        [
            8, 0, 0, 0, 36, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0,
            0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0
        ]
    );
}

#[test]
fn a_page_of_rows_with_an_argument_it_does_not_have_is_a_defect() {
    let mut session = loaded();
    let refused = json_call(
        &mut session,
        "fetch_rows",
        json!({ "first": 0, "count": 1, "columns": [1], "basedOn": 1, "sentAt": 2.0 }),
    );
    assert!(
        matches!(&refused, Err(CommandError::Defect { what }) if what.contains("sentAt")),
        "{refused:?}"
    );
}

/// The headers of a `set_cells` call on `column`, of `text` and the
/// decimal mark `mark`, both percent-encoded as `encodeURIComponent` does.
fn cell_headers(column: &str, text: &str, mark: &str) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert("column", column.parse().unwrap());
    headers.insert("text", text.parse().unwrap());
    headers.insert("decimal-mark", mark.parse().unwrap());
    headers.insert("based-on", "1".parse().unwrap());
    headers
}

#[test]
fn a_value_typed_in_cells_reaches_the_session_with_its_text_decoded() {
    let mut session = loaded();
    // Rows 1 and 2, given Peru; then the ID of row 0, "Ñandú 1".
    call(
        &mut session,
        "set_cells",
        &InvokeBody::Raw(vec![0b110]),
        &cell_headers("1", "Peru", "%2C"),
    )
    .unwrap();
    let codes = session.table().unwrap().columns()[0]
        .categorical()
        .unwrap()
        .codes()
        .to_vec();
    assert_eq!(
        codes,
        [
            Some(LevelCode::new(0)),
            Some(LevelCode::new(1)),
            Some(LevelCode::new(1))
        ]
    );
    call(
        &mut session,
        "set_cells",
        &InvokeBody::Raw(vec![0b1]),
        &cell_headers("0", "%C3%91and%C3%BA%201", "."),
    )
    .unwrap();
    assert_eq!(session.table().unwrap().names().names()[0], "Ñandú 1");
}

#[test]
fn a_text_that_is_not_percent_encoded_utf8_is_a_defect() {
    let mut session = loaded();
    for text in ["%C3", "%ZZ", "%", "%FF", "Ñ"] {
        let mut headers = cell_headers("1", "Peru", ".");
        if let Ok(value) = text.parse() {
            headers.insert("text", value);
        } else {
            continue;
        }
        let before = session.table().unwrap().clone();
        assert!(
            matches!(
                call(
                    &mut session,
                    "set_cells",
                    &InvokeBody::Raw(vec![0b1]),
                    &headers
                ),
                Err(CommandError::Defect { .. })
            ),
            "{text}"
        );
        assert_eq!(session.table().unwrap(), &before);
    }
}
