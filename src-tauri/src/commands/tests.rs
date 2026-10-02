use serde_json::{Value, json};
use tauri::http::{HeaderMap, HeaderName, HeaderValue};
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponseBody};
use tauri::test::{
    INVOKE_KEY, MockRuntime, get_ipc_response, mock_builder, mock_context, noop_assets,
};
use tauri::webview::InvokeRequest;
use tauri::{App, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use vavilov_core::{Categorical, Colour, ColumnValues, Level, NewColumn, Table, UndoRedo};

use super::*;
use crate::with_session;

const ORIGIN: u32 = 1;

fn app() -> (App<MockRuntime>, WebviewWindow<MockRuntime>) {
    let app = with_session(mock_builder())
        .build(mock_context(noop_assets()))
        .unwrap();
    let window = WebviewWindowBuilder::new(&app, "main", WebviewUrl::default())
        .build()
        .unwrap();
    (app, window)
}

fn invoke(
    window: &WebviewWindow<MockRuntime>,
    cmd: &str,
    body: InvokeBody,
    headers: &[(&'static str, String)],
) -> Result<InvokeResponseBody, Value> {
    let mut header_map = HeaderMap::new();
    for (name, value) in headers {
        header_map.insert(
            HeaderName::from_static(name),
            HeaderValue::from_str(value).unwrap(),
        );
    }
    get_ipc_response(
        window,
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: if cfg!(windows) {
                "http://tauri.localhost"
            } else {
                "tauri://localhost"
            }
            .parse()
            .unwrap(),
            body,
            headers: header_map,
            invoke_key: INVOKE_KEY.to_owned(),
        },
    )
}

fn json_command(
    window: &WebviewWindow<MockRuntime>,
    cmd: &str,
    args: Value,
) -> Result<InvokeResponseBody, Value> {
    invoke(window, cmd, InvokeBody::Json(args), &[])
}

fn subscribe_main(window: &WebviewWindow<MockRuntime>) -> Vec<u8> {
    match json_command(window, "subscribe", json!({ "onChange": "__CHANNEL__:1" })).unwrap() {
        InvokeResponseBody::Raw(bytes) => bytes,
        InvokeResponseBody::Json(json) => panic!("a snapshot as JSON: {json}"),
    }
}

/// Three plants with `origin` (Spain, Peru) as column 1, loaded with it
/// active, at revision 1.
fn load(app: &App<MockRuntime>) {
    let colour = Colour {
        red: 0,
        green: 114,
        blue: 178,
    };
    let table = Table::new(
        "accession",
        vec!["p1".to_owned(), "p2".to_owned(), "p3".to_owned()],
        vec![NewColumn {
            name: "origin".to_owned(),
            values: ColumnValues::Categorical(Categorical::new(
                vec![Level::new("Spain", colour), Level::new("Peru", colour)],
                vec![Some(LevelCode::new(0)), Some(LevelCode::new(1)), None],
            )),
        }],
    )
    .unwrap();
    let session = app.state::<Mutex<Session>>();
    let mut session = session.lock().unwrap();
    let based_on = session.revision();
    session
        .dispatch(Request {
            command: Command::LoadTable {
                table,
                active_classification: Some(ColumnId::new(ORIGIN)),
            },
            based_on,
            sent_at: None,
        })
        .unwrap();
}

fn codes(app: &App<MockRuntime>) -> Vec<Option<u16>> {
    let session = app.state::<Mutex<Session>>();
    let session = session.lock().unwrap();
    let column = session
        .table()
        .unwrap()
        .column(ColumnId::new(ORIGIN))
        .unwrap();
    column
        .categorical()
        .unwrap()
        .codes()
        .iter()
        .map(|code| code.map(LevelCode::get))
        .collect()
}

fn lasso_headers(population: u16, based_on: u64) -> Vec<(&'static str, String)> {
    vec![
        ("column", ORIGIN.to_string()),
        ("population", population.to_string()),
        ("based-on", based_on.to_string()),
    ]
}

#[test]
fn every_command_is_registered_and_finds_the_session() {
    let (_app, window) = app();
    assert!(matches!(
        json_command(&window, "subscribe", json!({ "onChange": "__CHANNEL__:1" })),
        Ok(InvokeResponseBody::Raw(_))
    ));
    let no_project = json!({ "kind": "noProject" });
    for (cmd, args) in [
        ("set_hover", json!({ "row": null, "basedOn": 0 })),
        (
            "set_active_classification",
            json!({ "column": null, "basedOn": 0 }),
        ),
        (
            "select_population",
            json!({ "column": 1, "population": null, "basedOn": 0 }),
        ),
        ("undo", json!({ "basedOn": 0 })),
        ("redo", json!({ "basedOn": 0, "sentAt": 1.5 })),
    ] {
        assert_eq!(
            json_command(&window, cmd, args).unwrap_err(),
            no_project,
            "{cmd}"
        );
    }
    for cmd in ["set_selection", "assign_rows", "unassign_rows"] {
        assert_eq!(
            invoke(
                &window,
                cmd,
                InvokeBody::Raw(Vec::new()),
                &lasso_headers(0, 0)
            )
            .unwrap_err(),
            no_project,
            "{cmd}"
        );
    }
}

#[test]
fn subscribe_returns_the_snapshot_as_raw_bytes() {
    let (app, window) = app();
    load(&app);
    let snapshot = subscribe_main(&window);
    // A snapshot, kind 0, at revision 1, whose first part says a project
    // of three rows is open.
    assert_eq!(
        &snapshot[..16],
        [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]
    );
    assert_eq!(
        &snapshot[24..48],
        [
            1, 0, 0, 0, 24, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0
        ]
    );
}

#[test]
fn a_lasso_and_its_undo_through_the_commands_change_the_codes() {
    let (app, window) = app();
    load(&app);
    subscribe_main(&window);
    json_command(
        &window,
        "select_population",
        json!({ "column": ORIGIN, "population": 0, "basedOn": 1 }),
    )
    .unwrap();
    // Rows 1 and 2 into Spain, at revision 2.
    invoke(
        &window,
        "assign_rows",
        InvokeBody::Raw(vec![0b110]),
        &lasso_headers(0, 2),
    )
    .unwrap();
    assert_eq!(codes(&app), [Some(0), Some(0), Some(0)]);
    json_command(&window, "undo", json!({ "basedOn": 3 })).unwrap();
    assert_eq!(codes(&app), [Some(0), Some(1), None]);
    let session = app.state::<Mutex<Session>>();
    assert_eq!(
        session.lock().unwrap().undo_redo(),
        UndoRedo {
            can_undo: false,
            can_redo: true
        }
    );
}

#[test]
fn a_selection_through_its_command_reaches_the_session() {
    let (app, window) = app();
    load(&app);
    let headers = [
        ("based-on", "1".to_owned()),
        ("sent-at", "1727865600000.5".to_owned()),
    ];
    invoke(
        &window,
        "set_selection",
        InvokeBody::Raw(vec![0b101]),
        &headers,
    )
    .unwrap();
    let session = app.state::<Mutex<Session>>();
    assert_eq!(
        session.lock().unwrap().selection().unwrap().as_bytes(),
        [0b101]
    );
}

#[test]
fn a_refusal_crosses_as_its_kind_and_its_fields() {
    let (app, window) = app();
    load(&app);
    assert_eq!(
        json_command(
            &window,
            "select_population",
            json!({ "column": 9, "population": 0, "basedOn": 1 })
        )
        .unwrap_err(),
        json!({ "kind": "notActiveClassification", "column": 9 })
    );
    assert_eq!(
        invoke(
            &window,
            "set_selection",
            InvokeBody::Raw(vec![0b1000]),
            &[("based-on", "1".to_owned())]
        )
        .unwrap_err(),
        json!({ "kind": "rowSetUnusedBits", "numRows": 3 })
    );
}

#[test]
fn a_lasso_made_before_a_load_is_refused_as_such() {
    let (app, window) = app();
    load(&app);
    load(&app);
    assert_eq!(
        invoke(
            &window,
            "assign_rows",
            InvokeBody::Raw(vec![0, 0]),
            &lasso_headers(0, 1)
        )
        .unwrap_err(),
        json!({ "kind": "madeBeforeLoad", "basedOn": 1, "loadedAt": 2 })
    );
}

#[test]
fn a_raw_command_without_a_header_it_needs_is_a_defect() {
    let (app, window) = app();
    load(&app);
    assert_eq!(
        invoke(&window, "set_selection", InvokeBody::Raw(vec![0]), &[]).unwrap_err(),
        json!({ "kind": "defect", "what": "a command without its header based-on" })
    );
    assert_eq!(
        invoke(
            &window,
            "set_selection",
            InvokeBody::Json(json!({})),
            &[("based-on", "1".to_owned())]
        )
        .unwrap_err(),
        json!({ "kind": "defect", "what": "a command that takes raw bytes was given JSON" })
    );
}

// That the window is then closed is not seen here: the mock runtime never
// sends the event that removes a destroyed window from Tauri's list, so the
// closing is left to the tests of the real app.
#[test]
fn a_window_the_session_does_not_know_is_refused() {
    let (app, _main) = app();
    let stray = WebviewWindowBuilder::new(&app, "scatter3d-1", WebviewUrl::default())
        .build()
        .unwrap();
    assert_eq!(
        json_command(&stray, "subscribe", json!({ "onChange": "__CHANNEL__:2" })).unwrap_err(),
        json!({ "kind": "unknownWindow", "label": "scatter3d-1" })
    );
}
