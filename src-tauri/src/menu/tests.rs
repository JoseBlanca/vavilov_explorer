use super::*;

#[test]
fn each_name_the_window_gives_an_action_is_the_action_of_its_item() {
    assert_eq!(action_named("importTable"), Some(MenuAction::ImportTable));
    assert_eq!(action_named("exportCsv"), Some(MenuAction::ExportCsv));
    assert_eq!(action_named("exportXlsx"), Some(MenuAction::ExportXlsx));
}

#[test]
fn a_name_of_no_item_of_ours_is_no_action() {
    assert_eq!(action_named("import-table"), None);
    assert_eq!(action_named("ImportTable"), None);
    assert_eq!(action_named(""), None);
}
