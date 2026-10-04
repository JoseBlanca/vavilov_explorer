use serde_json::json;
use vavilov_core::{ColumnId, CommandError, WindowLabel};

use super::*;

#[test]
fn a_refusal_of_the_app_crosses_as_its_kind_and_its_fields_as_the_core_s_do() {
    assert_eq!(
        serde_json::to_value(AppError::from(WindowError::UnknownWindow {
            label: WindowLabel::new("scatter3d-1")
        }))
        .unwrap(),
        json!({ "kind": "unknownWindow", "label": "scatter3d-1" })
    );
    assert_eq!(
        serde_json::to_value(AppError::from(WindowError::UnknownWidget {
            label: WindowLabel::new("plots-1"),
            widget: WidgetId::new(2),
        }))
        .unwrap(),
        json!({ "kind": "unknownWidget", "label": "plots-1", "widget": 2 })
    );
    assert_eq!(
        serde_json::to_value(AppError::from(WindowError::WindowFailed {
            label: WindowLabel::new("maps-3"),
            message: "no display".to_owned(),
        }))
        .unwrap(),
        json!({ "kind": "windowFailed", "label": "maps-3", "message": "no display" })
    );
    // The core's, wrapped, cross as they did.
    assert_eq!(
        serde_json::to_value(AppError::from(CommandError::NotNumber {
            column: ColumnId::new(3)
        }))
        .unwrap(),
        json!({ "kind": "notNumber", "column": 3 })
    );
}

#[test]
fn the_refusals_of_a_widget_past_the_limits_cross_with_the_limit() {
    assert_eq!(
        serde_json::to_value(AppError::from(WindowError::TooManyTiles {
            label: WindowLabel::new("plots-1"),
            most: 6,
        }))
        .unwrap(),
        json!({ "kind": "tooManyTiles", "label": "plots-1", "most": 6 })
    );
    assert_eq!(
        serde_json::to_value(AppError::from(WindowError::TooManyWebGlViews { most: 16 })).unwrap(),
        json!({ "kind": "tooManyWebGlViews", "most": 16 })
    );
    assert_eq!(
        serde_json::to_value(AppError::from(WindowError::WindowNotRaised {
            label: WindowLabel::new("maps-3"),
            message: "no focus".to_owned(),
        }))
        .unwrap(),
        json!({ "kind": "windowNotRaised", "label": "maps-3", "message": "no focus" })
    );
}
