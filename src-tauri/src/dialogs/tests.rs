use super::*;

fn answered(show: impl FnOnce(Reply)) -> Result<Option<PathBuf>, CommandError> {
    tauri::async_runtime::block_on(answer(show))
}

#[test]
fn a_dialog_that_ends_without_an_answer_is_a_defect_and_no_panic() {
    // What the plugin does when the event loop is gone: the callback, and
    // the sender in it, are dropped without a call.
    let answer = answered(drop);
    assert_eq!(
        answer,
        Err(CommandError::Defect {
            what: "a dialog that ended without an answer, as when the app quits while it opens"
                .to_owned()
        })
    );
}

#[test]
fn a_dialog_the_user_closed_gives_no_file() {
    assert_eq!(answered(|reply| reply.give(None)), Ok(None));
}

#[test]
fn a_dialog_answered_from_another_thread_gives_its_file() {
    let answer = answered(|reply| {
        std::thread::spawn(move || {
            reply.give(Some(FilePath::Path(PathBuf::from("/data/plants.csv"))));
        });
    });
    assert_eq!(answer, Ok(Some(PathBuf::from("/data/plants.csv"))));
}
