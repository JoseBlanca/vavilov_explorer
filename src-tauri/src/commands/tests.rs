use serde_json::{Value, json};
use tauri::http::{HeaderMap, HeaderName, HeaderValue};
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponseBody};
use tauri::test::{INVOKE_KEY, MockRuntime, get_ipc_response, mock_builder};
use tauri::webview::InvokeRequest;
use tauri::{App, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use vavilov_core::{
    Categorical, Colour, ColumnId, ColumnValues, Command, LevelCode, LevelValues, NewColumn,
    Request, RowIndex, Table, UndoRedo,
};

use super::*;
use crate::with_session;

const ORIGIN: u32 = 1;

/// The app on Tauri's mock runtime, with the real configuration and
/// capabilities, so that a call is checked against them as in the app.
fn app() -> (App<MockRuntime>, WebviewWindow<MockRuntime>) {
    let app = with_session(mock_builder())
        .build(tauri::generate_context!(test = true))
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
        "IndividualID",
        vec!["p1".to_owned(), "p2".to_owned(), "p3".to_owned()],
        vec![NewColumn {
            name: "origin".to_owned(),
            values: ColumnValues::Category(Categorical::new(
                LevelValues::Text(vec!["Spain".to_owned(), "Peru".to_owned()]),
                vec![colour, colour],
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
        ("target", population.to_string()),
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
            json!({ "column": 1, "selected": null, "basedOn": 0 }),
        ),
        (
            "add_population",
            json!({ "column": 1, "name": "China", "decimalMark": ",", "basedOn": 0 }),
        ),
        (
            "set_edit_mode",
            json!({ "column": 1, "target": "unassigned", "mode": "add", "basedOn": 0 }),
        ),
        (
            "set_role",
            json!({ "column": 1, "role": "category", "basedOn": 0 }),
        ),
        (
            "set_filter",
            json!({
                "text": "Spain", "column": null, "cell": "part", "showing": "matching",
                "decimalMark": ",", "basedOn": 0
            }),
        ),
        ("undo", json!({ "basedOn": 0 })),
        ("redo", json!({ "basedOn": 0, "sentAt": 1.5 })),
        (
            "fetch_rows",
            json!({ "first": 0, "count": 0, "columns": [], "basedOn": 0 }),
        ),
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
    // The region's decimal mark needs no table.
    assert!(matches!(
        json_command(&window, "region_decimal_mark", json!({})),
        Ok(InvokeResponseBody::Json(mark)) if mark.starts_with('"')
    ));
    // An export with no table is refused before the Save dialog opens.
    assert_eq!(
        json_command(
            &window,
            "export_table",
            json!({ "format": { "kind": "xlsx" }, "basedOn": 0 })
        )
        .unwrap_err(),
        no_project
    );
}

#[test]
fn a_window_cannot_name_the_file_of_an_import() {
    let (_app, window) = app();
    // The file comes from the system's dialog alone: a path is an argument
    // import_table does not have, refused before any dialog opens.
    let refused = json_command(
        &window,
        "import_table",
        json!({ "sentAt": 1.5, "path": "/etc/passwd" }),
    )
    .unwrap_err();
    assert_eq!(refused["kind"], "defect");
    assert!(
        refused["what"]
            .as_str()
            .unwrap()
            .contains("unknown field `path`"),
        "{refused}"
    );
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
        json!({ "column": ORIGIN, "selected": { "population": 0 }, "basedOn": 1 }),
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
            json!({ "column": 9, "selected": { "population": 0 }, "basedOn": 1 })
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
        json!({ "kind": "defect", "what": "a command that takes raw bytes was given JSON, as Tauri sends every \
                     body once a window has fallen back from its custom IPC protocol to postMessage" })
    );
}

// The capability lets only the main window call the commands, so a widget's
// window is refused before the session sees it. The session's own refusal of
// a label it does not know, and the closing of such a window, come into play
// once the widgets are in the capability (core.md, section 7); the session's
// refusal is tested in the core.
#[test]
fn a_window_of_a_widget_cannot_subscribe_yet() {
    let (app, _main) = app();
    let stray = WebviewWindowBuilder::new(&app, "scatter3d-1", WebviewUrl::default())
        .build()
        .unwrap();
    let refusal =
        json_command(&stray, "subscribe", json!({ "onChange": "__CHANNEL__:2" })).unwrap_err();
    assert!(
        refusal
            .as_str()
            .is_some_and(|text| text.contains("subscribe not allowed")),
        "{refusal}"
    );
}

#[test]
fn a_window_outside_the_capability_cannot_call_the_commands() {
    let (app, _main) = app();
    load(&app);
    let other = WebviewWindowBuilder::new(&app, "other", WebviewUrl::default())
        .build()
        .unwrap();
    for cmd in ["undo", "set_hover"] {
        let refusal = json_command(&other, cmd, json!({ "row": null, "basedOn": 1 })).unwrap_err();
        assert!(
            refusal
                .as_str()
                .is_some_and(|text| text.contains("not allowed")),
            "{cmd}: {refusal}"
        );
    }
    assert_eq!(codes(&app), [Some(0), Some(1), None]);
}

fn session_of(app: &App<MockRuntime>) -> std::sync::MutexGuard<'_, Session> {
    app.state::<Mutex<Session>>().inner().lock().unwrap()
}

#[test]
fn the_hover_reaches_the_session() {
    let (app, window) = app();
    load(&app);
    json_command(
        &window,
        "set_hover",
        json!({ "row": 2, "basedOn": 1, "sentAt": 1.5 }),
    )
    .unwrap();
    assert_eq!(session_of(&app).hover(), Some(RowIndex::new(2)));
    json_command(&window, "set_hover", json!({ "row": null, "basedOn": 1 })).unwrap();
    assert_eq!(session_of(&app).hover(), None);
}

#[test]
fn the_active_classification_reaches_the_session() {
    let (app, window) = app();
    load(&app);
    json_command(
        &window,
        "set_active_classification",
        json!({ "column": null, "basedOn": 1 }),
    )
    .unwrap();
    assert_eq!(session_of(&app).active(), None);
    json_command(
        &window,
        "set_active_classification",
        json!({ "column": ORIGIN, "basedOn": 2 }),
    )
    .unwrap();
    assert_eq!(
        session_of(&app).active(),
        Some(vavilov_core::Active {
            column: ColumnId::new(ORIGIN),
            selected: None,
            mode: None,
        })
    );
}

#[test]
fn a_lasso_in_remove_mode_and_a_redo_through_the_commands() {
    let (app, window) = app();
    load(&app);
    json_command(
        &window,
        "select_population",
        json!({ "column": ORIGIN, "selected": { "population": 1 }, "basedOn": 1 }),
    )
    .unwrap();
    assert_eq!(
        session_of(&app).active(),
        Some(vavilov_core::Active {
            column: ColumnId::new(ORIGIN),
            selected: Some(vavilov_core::Selected::Population(LevelCode::new(1))),
            mode: None,
        })
    );
    // Rows 0 and 1 out of Peru, at revision 2: only row 1 is in Peru.
    invoke(
        &window,
        "unassign_rows",
        InvokeBody::Raw(vec![0b011]),
        &lasso_headers(1, 2),
    )
    .unwrap();
    assert_eq!(codes(&app), [Some(0), None, None]);
    json_command(&window, "undo", json!({ "basedOn": 3 })).unwrap();
    assert_eq!(codes(&app), [Some(0), Some(1), None]);
    json_command(&window, "redo", json!({ "basedOn": 4 })).unwrap();
    assert_eq!(codes(&app), [Some(0), None, None]);
    assert_eq!(
        session_of(&app).undo_redo(),
        UndoRedo {
            can_undo: true,
            can_redo: false
        }
    );
}

#[test]
fn every_command_that_calls_takes_is_registered_with_tauri() {
    let (app, window) = app();
    load(&app);
    for command in crate::calls::COMMANDS {
        let answer = json_command(&window, command, json!({ "basedOn": 1 }));
        if let Err(Value::String(text)) = &answer {
            assert!(!text.contains("not found"), "{command}: {text}");
        }
    }
}

#[test]
fn the_description_of_the_table_comes_back_as_json() {
    let (app, window) = app();
    load(&app);
    let InvokeResponseBody::Json(text) =
        json_command(&window, "describe_table", json!({})).unwrap()
    else {
        panic!("a description as raw bytes");
    };
    let description: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(
        description,
        json!({
            "loadedAt": 1,
            "shapeAt": 1,
            "numRows": 3,
            "names": { "id": 0, "header": "IndividualID" },
            "columns": [{
                "id": 1, "name": "origin", "revision": 1,
                "storage": "text", "role": "category",
                "roles": ["category", "country", "text"],
                "levels": [
                    { "value": "Spain", "colour": "#0072b2" },
                    { "value": "Peru", "colour": "#0072b2" },
                ],
            }],
        })
    );
}

#[test]
fn a_lasso_with_the_unassigned_selected_unassigns_through_the_commands() {
    let (app, window) = app();
    load(&app);
    json_command(
        &window,
        "select_population",
        json!({ "column": ORIGIN, "selected": "unassigned", "basedOn": 1 }),
    )
    .unwrap();
    let headers = [
        ("column", ORIGIN.to_string()),
        ("target", "unassigned".to_owned()),
        ("based-on", "2".to_owned()),
    ];
    invoke(
        &window,
        "assign_rows",
        InvokeBody::Raw(vec![0b011]),
        &headers,
    )
    .unwrap();
    assert_eq!(codes(&app), [None, None, None]);
}

#[test]
fn a_population_added_through_its_command_is_selected_and_a_refusal_names_why() {
    let (app, window) = app();
    load(&app);
    json_command(
        &window,
        "add_population",
        json!({ "column": ORIGIN, "name": " China", "decimalMark": ",", "basedOn": 1, "sentAt": 1.5 }),
    )
    .unwrap();
    let session = session_of(&app);
    assert_eq!(
        session
            .table()
            .unwrap()
            .column(ColumnId::new(ORIGIN))
            .unwrap()
            .categorical()
            .unwrap()
            .levels(),
        &vavilov_core::LevelValues::Text(vec![
            "Spain".to_owned(),
            "Peru".to_owned(),
            "China".to_owned()
        ])
    );
    assert_eq!(
        session.active(),
        Some(vavilov_core::Active {
            column: ColumnId::new(ORIGIN),
            selected: Some(vavilov_core::Selected::Population(LevelCode::new(2))),
            mode: None,
        })
    );
    drop(session);
    assert_eq!(
        json_command(
            &window,
            "add_population",
            json!({ "column": ORIGIN, "name": "Peru", "decimalMark": ",", "basedOn": 2 }),
        )
        .unwrap_err(),
        json!({
            "kind": "populationRefused", "columnName": "origin", "text": "Peru",
            "refusal": { "kind": "taken", "code": 1 }
        })
    );
}

#[test]
fn plus_pressed_through_its_command_assigns_the_rows_that_enter_the_selection() {
    let (app, window) = app();
    load(&app);
    json_command(
        &window,
        "select_population",
        json!({ "column": ORIGIN, "selected": { "population": 0 }, "basedOn": 1 }),
    )
    .unwrap();
    json_command(
        &window,
        "set_edit_mode",
        json!({ "column": ORIGIN, "target": { "population": 0 }, "mode": "add", "basedOn": 2 }),
    )
    .unwrap();
    // Row 1, Peru, enters the selection and goes to Spain.
    invoke(
        &window,
        "set_selection",
        InvokeBody::Raw(vec![0b010]),
        &[("based-on", "3".to_owned())],
    )
    .unwrap();
    assert_eq!(codes(&app), [Some(0), Some(0), None]);
    json_command(
        &window,
        "set_edit_mode",
        json!({ "column": ORIGIN, "target": { "population": 0 }, "mode": null, "basedOn": 4 }),
    )
    .unwrap();
    assert_eq!(
        session_of(&app).active().and_then(|active| active.mode),
        None
    );
}

#[test]
fn a_page_of_rows_comes_back_as_raw_bytes() {
    let (app, window) = app();
    load(&app);
    let answer = json_command(
        &window,
        "fetch_rows",
        json!({ "first": 1, "count": 2, "columns": [ORIGIN], "basedOn": 1 }),
    )
    .unwrap();
    let InvokeResponseBody::Raw(bytes) = answer else {
        panic!("a page of rows as JSON");
    };
    #[rustfmt::skip]
    let expected: Vec<u8> = vec![
        3, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        // page: loaded at 1, rows shown since 1, names since 1, from
        // position 1, 2 rows, which are the rows 1 and 2
        8, 0, 0, 0, 40, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0,
        1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0,
        // names: p2, p3
        9, 0, 0, 0, 16, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 4, 0, 0, 0, b'p', b'2', b'p', b'3',
        // origin: Peru, missing
        10, 0, 0, 0, 20, 0, 0, 0, 1, 0, 0, 0, 4, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0,
        1, 0, 0xFF, 0xFF, 0, 0, 0, 0,
    ];
    assert_eq!(bytes, expected);
}

#[test]
fn a_page_past_the_last_row_crosses_as_its_refusal() {
    let (app, window) = app();
    load(&app);
    assert_eq!(
        json_command(
            &window,
            "fetch_rows",
            json!({ "first": 2, "count": 2, "columns": [], "basedOn": 1 }),
        )
        .unwrap_err(),
        json!({ "kind": "rowsOutOfRange", "first": 2, "count": 2, "numShown": 3 })
    );
}

#[test]
fn a_change_of_role_through_its_command_reaches_the_session() {
    let (app, window) = app();
    load(&app);
    json_command(
        &window,
        "set_role",
        json!({ "column": ORIGIN, "role": "country", "basedOn": 1 }),
    )
    .unwrap();
    let session = session_of(&app);
    let values = session
        .table()
        .unwrap()
        .column(ColumnId::new(ORIGIN))
        .unwrap()
        .values()
        .role();
    assert_eq!(values, vavilov_core::Role::Country);
    // Still the active classification, its levels built again as codes.
    assert_eq!(
        session.active(),
        Some(vavilov_core::Active {
            column: ColumnId::new(ORIGIN),
            selected: None,
            mode: None,
        })
    );
}

#[test]
fn a_role_the_storage_type_cannot_take_crosses_as_its_refusal() {
    let (app, window) = app();
    load(&app);
    assert_eq!(
        json_command(
            &window,
            "set_role",
            json!({ "column": ORIGIN, "role": "number", "basedOn": 1 }),
        )
        .unwrap_err(),
        json!({ "kind": "roleNotPossible", "column": 1, "storage": "text", "role": "number" })
    );
}

#[test]
fn every_window_of_the_configuration_turns_off_background_throttling() {
    let context: tauri::Context<MockRuntime> = tauri::generate_context!(test = true);
    let windows = &context.config().app.windows;
    assert!(!windows.is_empty());
    for window in windows {
        assert_eq!(
            window.background_throttling,
            Some(tauri::utils::config::BackgroundThrottlingPolicy::Disabled),
            "window {}",
            window.label
        );
    }
}

#[test]
fn the_main_window_cannot_call_tauri_s_own_functions_it_does_not_use() {
    let (_app, main) = app();
    for cmd in [
        "plugin:window|title",
        "plugin:window|create",
        "plugin:event|listen",
        "plugin:webview|create_webview_window",
        "plugin:app|version",
    ] {
        let refusal = json_command(&main, cmd, json!({})).unwrap_err();
        assert!(
            refusal
                .as_str()
                .is_some_and(|text| text.contains("not allowed")),
            "{cmd}: {refusal}"
        );
    }
}
