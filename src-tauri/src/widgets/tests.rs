use super::*;
use crate::error::WindowError;

const HEIGHT: ColumnId = ColumnId::new(1);
const SEEDS: ColumnId = ColumnId::new(4);

fn label(text: &str) -> WindowLabel {
    WindowLabel::new(text)
}

fn histogram(column: ColumnId) -> WidgetSpec {
    WidgetSpec::Histogram { column }
}

fn scatter(x: ColumnId, y: ColumnId, z: ColumnId) -> WidgetSpec {
    WidgetSpec::Scatter3d { axes: [x, y, z] }
}

fn ids_in(widgets: &Widgets, window: &str) -> Vec<u32> {
    widgets
        .widgets_of(&label(window))
        .iter()
        .map(|widget| widget.id.get())
        .collect()
}

/// The list of the histograms 1 of height and 2 of seeds, at sequence 1,
/// as docs/core.md, section 5, lays it out. The same bytes are decoded in
/// src/backend/decodeWidgets.test.ts.
#[rustfmt::skip]
const TWO_HISTOGRAMS: [u8; 72] = [
    6, 0, 0, 0, 0, 0, 0, 0, // a list of widgets
    1, 0, 0, 0, 0, 0, 0, 0, // sequence 1
    2, 0, 0, 0, 0, 0, 0, 0, // two widgets
    1, 0, 0, 0, 4, 0, 0, 0, 1, 0, 0, 0, 255, 255, 255, 255, // 1, a histogram of height
    255, 255, 255, 255, 0, 0, 0, 0,
    2, 0, 0, 0, 4, 0, 0, 0, 4, 0, 0, 0, 255, 255, 255, 255, // 2, a histogram of seeds
    255, 255, 255, 255, 0, 0, 0, 0,
];

#[test]
fn the_histograms_share_one_plots_window_and_each_takes_a_number_of_its_own() {
    let mut widgets = Widgets::default();
    let opened = [
        widgets.open(histogram(HEIGHT)).unwrap(),
        widgets.open(histogram(SEEDS)).unwrap(),
        widgets.open(scatter(HEIGHT, SEEDS, HEIGHT)).unwrap(),
        widgets.open(scatter(SEEDS, SEEDS, SEEDS)).unwrap(),
    ];
    assert_eq!(
        opened.map(|each| (
            each.window.as_str().to_owned(),
            each.widget.get(),
            each.list.is_none()
        )),
        [
            ("plots-1".to_owned(), 1, true),
            ("plots-1".to_owned(), 2, false),
            ("scatter3d-2".to_owned(), 3, true),
            ("scatter3d-3".to_owned(), 4, true),
        ]
    );
    assert_eq!(
        widgets.widgets_of(&label("plots-1")),
        [
            Widget {
                id: WidgetId::new(1),
                spec: histogram(HEIGHT)
            },
            Widget {
                id: WidgetId::new(2),
                spec: histogram(SEEDS)
            }
        ]
    );
}

#[test]
fn a_widget_added_to_an_open_window_gives_its_new_list_to_send_it() {
    let mut widgets = Widgets::default();
    assert_eq!(widgets.open(histogram(HEIGHT)).unwrap().list, None);
    let list = widgets.open(histogram(SEEDS)).unwrap().list.unwrap();
    assert_eq!(list.to_bytes().unwrap(), TWO_HISTOGRAMS);
}

#[test]
fn a_list_asked_for_takes_the_next_sequence_number() {
    let mut widgets = Widgets::default();
    widgets.open(histogram(HEIGHT)).unwrap();
    let first = widgets.list(&label("plots-1")).unwrap();
    let second = widgets.list(&label("plots-1")).unwrap();
    assert_eq!((first.seq, second.seq), (1, 2));
    assert_eq!(
        widgets.list(&label("plots-9")),
        Err(AppError::Window(WindowError::UnknownWindow {
            label: label("plots-9")
        }))
    );
}

#[test]
fn closing_a_tile_forgets_its_widget_and_closing_the_last_forgets_its_window() {
    let mut widgets = Widgets::default();
    widgets.open(histogram(HEIGHT)).unwrap();
    widgets.open(histogram(SEEDS)).unwrap();
    // The window is given the list it has left, after the one the second
    // histogram gave.
    assert_eq!(
        widgets.close(&label("plots-1"), WidgetId::new(1)),
        Ok(Closed::Kept(WidgetList {
            seq: 2,
            widgets: vec![Widget {
                id: WidgetId::new(2),
                spec: histogram(SEEDS)
            }]
        }))
    );
    assert_eq!(ids_in(&widgets, "plots-1"), [2]);
    assert_eq!(
        widgets.close(&label("plots-1"), WidgetId::new(2)),
        Ok(Closed::Window)
    );
    assert!(!widgets.is_open(&label("plots-1")));
}

#[test]
fn a_window_cannot_close_a_widget_it_does_not_hold() {
    let mut widgets = Widgets::default();
    widgets.open(histogram(HEIGHT)).unwrap();
    let scattered = widgets.open(scatter(HEIGHT, SEEDS, HEIGHT)).unwrap().window;
    assert_eq!(
        widgets.close(&scattered, WidgetId::new(1)),
        Err(AppError::Window(WindowError::UnknownWidget {
            label: scattered.clone(),
            widget: WidgetId::new(1)
        }))
    );
    assert_eq!(
        widgets.close(&label("plots-1"), WidgetId::new(9)),
        Err(AppError::Window(WindowError::UnknownWidget {
            label: label("plots-1"),
            widget: WidgetId::new(9)
        }))
    );
    assert_eq!(ids_in(&widgets, "plots-1"), [1]);
}

#[test]
fn a_plots_window_closed_and_opened_again_takes_a_new_label() {
    let mut widgets = Widgets::default();
    widgets.open(histogram(HEIGHT)).unwrap();
    widgets.window_closed(&label("plots-1"));
    assert!(widgets.widgets_of(&label("plots-1")).is_empty());
    assert_eq!(
        widgets.open(histogram(HEIGHT)).unwrap().window,
        label("plots-2")
    );
}

#[test]
fn a_load_forgets_every_window_and_gives_their_labels() {
    let mut widgets = Widgets::default();
    widgets.open(histogram(HEIGHT)).unwrap();
    widgets.open(scatter(HEIGHT, SEEDS, HEIGHT)).unwrap();
    assert_eq!(
        widgets.close_all(),
        [label("plots-1"), label("scatter3d-2")]
    );
    assert!(!widgets.is_open(&label("plots-1")));
    // The counters go on: no label is given again.
    assert_eq!(
        widgets.open(histogram(HEIGHT)).unwrap().window,
        label("plots-3")
    );
}

#[test]
fn each_kind_of_widget_crosses_as_its_kind_and_its_columns() {
    for (spec, json) in [
        (
            scatter(HEIGHT, SEEDS, HEIGHT),
            serde_json::json!({ "kind": "scatter3d", "axes": [1, 4, 1] }),
        ),
        (
            WidgetSpec::Map {
                latitude: HEIGHT,
                longitude: SEEDS,
            },
            serde_json::json!({ "kind": "map", "latitude": 1, "longitude": 4 }),
        ),
        (
            WidgetSpec::CountryMap {
                country: ColumnId::new(2),
            },
            serde_json::json!({ "kind": "countryMap", "country": 2 }),
        ),
        (
            histogram(HEIGHT),
            serde_json::json!({ "kind": "histogram", "column": 1 }),
        ),
    ] {
        assert_eq!(serde_json::to_value(&spec).unwrap(), json);
        assert_eq!(serde_json::from_value::<WidgetSpec>(json).unwrap(), spec);
    }
    for refused in [
        serde_json::json!({ "kind": "scatter3d", "axes": [1, 4] }),
        serde_json::json!({ "kind": "scatter3d", "axes": [1, 4, 1], "title": "x" }),
        serde_json::json!({ "kind": "map", "latitude": 1 }),
    ] {
        assert!(serde_json::from_value::<WidgetSpec>(refused).is_err());
    }
}

#[test]
fn the_two_maps_share_one_maps_window_apart_from_the_plots() {
    let mut widgets = Widgets::default();
    let opened = [
        widgets
            .open(WidgetSpec::Map {
                latitude: HEIGHT,
                longitude: SEEDS,
            })
            .unwrap(),
        widgets.open(histogram(HEIGHT)).unwrap(),
        widgets
            .open(WidgetSpec::CountryMap {
                country: ColumnId::new(2),
            })
            .unwrap(),
    ];
    assert_eq!(
        opened.map(|each| (each.window.as_str().to_owned(), each.list.is_none())),
        [
            ("maps-1".to_owned(), true),
            ("plots-2".to_owned(), true),
            ("maps-1".to_owned(), false),
        ]
    );
    assert_eq!(ids_in(&widgets, "maps-1"), [1, 3]);
}
