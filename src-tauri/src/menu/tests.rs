use super::*;

#[test]
fn each_name_the_window_gives_an_action_is_the_action_of_its_item() {
    assert_eq!(action_named("importTable"), Some(MenuAction::ImportTable));
    assert_eq!(action_named("exportCsv"), Some(MenuAction::ExportCsv));
    assert_eq!(action_named("exportXlsx"), Some(MenuAction::ExportXlsx));
    assert_eq!(action_named("undo"), Some(MenuAction::Undo));
    assert_eq!(action_named("redo"), Some(MenuAction::Redo));
    assert_eq!(action_named("scatter3d"), Some(MenuAction::Scatter3d));
    assert_eq!(action_named("map"), Some(MenuAction::Map));
    assert_eq!(action_named("countryMap"), Some(MenuAction::CountryMap));
    assert_eq!(action_named("histogram"), Some(MenuAction::Histogram));
}

#[test]
fn a_name_of_no_item_of_ours_is_no_action() {
    assert_eq!(action_named("import-table"), None);
    assert_eq!(action_named("ImportTable"), None);
    assert_eq!(action_named(""), None);
}
