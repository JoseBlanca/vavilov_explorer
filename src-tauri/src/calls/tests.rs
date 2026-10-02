use serde_json::json;
use vavilov_core::{Categorical, Colour, ColumnValues, Level, NewColumn, Table};

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
        "",
        vec!["p1".to_owned(), "p2".to_owned(), "p3".to_owned()],
        vec![NewColumn {
            name: "origin".to_owned(),
            values: ColumnValues::Categorical(Categorical::new(
                vec![Level::new("Spain", colour), Level::new("Peru", colour)],
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
        "select_population",
        json!({ "column": 1, "selected": { "population": 1 }, "basedOn": 1 }),
    )
    .unwrap();
    assert_eq!(
        session.active(),
        Some(vavilov_core::Active {
            column: ColumnId::new(1),
            selected: Some(Selected::Population(LevelCode::new(1)))
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
    // The page part: loaded at 1, from row 2, 1 row.
    assert_eq!(
        &bytes[24..48],
        [
            8, 0, 0, 0, 16, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0
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
