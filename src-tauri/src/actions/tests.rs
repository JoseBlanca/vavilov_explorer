use std::sync::{Arc, Mutex};

use vavilov_core::{Command, Request, Revision, SendFailed, Subscriber};

use super::*;

#[derive(Clone, Default)]
struct Recorder(Arc<Mutex<Vec<Vec<u8>>>>);

impl Subscriber for Recorder {
    fn send(&self, message: Vec<u8>) -> Result<(), SendFailed> {
        self.0.lock().unwrap().push(message);
        Ok(())
    }
}

#[test]
fn an_action_reaches_the_main_window_as_a_message_of_its_own_and_takes_no_revision() {
    let mut session = Session::new();
    let recorder = Recorder::default();
    session
        .subscribe(WindowLabel::main(), Box::new(recorder.clone()))
        .unwrap();
    assert_eq!(send_action(&mut session, MenuAction::ExportXlsx), Ok(None));
    assert_eq!(session.revision().get(), 0);
    // The bytes the core wrote before the menu moved to the app layer, which
    // src/backend/decodeAction.test.ts decodes.
    #[rustfmt::skip]
    let expected: Vec<u8> = vec![
        4, 0, 0, 0, 0, 0, 0, 0, // action, no time
        0, 0, 0, 0, 0, 0, 0, 0, // revision 0
        0, 0, 0, 0, 0, 0, 0, 0, // no time
        12, 0, 0, 0, 8, 0, 0, 0, // the action part, 8 bytes
        3, 0, 0, 0, 0, 0, 0, 0, // Export as Excel…
    ];
    assert_eq!(*recorder.0.lock().unwrap(), [expected]);
}

#[test]
fn an_action_carries_the_session_s_current_revision() {
    let mut session = Session::new();
    let table =
        vavilov_core::Table::new("IndividualID", vec!["p1".to_owned()], Vec::new()).unwrap();
    session
        .dispatch(Request {
            command: Command::LoadTable {
                table,
                active_classification: None,
            },
            based_on: Revision::ZERO,
            sent_at: None,
        })
        .unwrap();
    let recorder = Recorder::default();
    session
        .subscribe(WindowLabel::main(), Box::new(recorder.clone()))
        .unwrap();
    send_action(&mut session, MenuAction::ImportTable).unwrap();
    let sent = recorder.0.lock().unwrap();
    let message = sent.first().unwrap();
    assert_eq!(message.get(8..16), Some(&[1, 0, 0, 0, 0, 0, 0, 0][..]));
    assert_eq!(message.get(32..34), Some(&[1, 0][..]));
}

#[test]
fn an_action_before_the_main_window_subscribed_reaches_no_window() {
    let mut session = Session::new();
    assert_eq!(
        send_action(&mut session, MenuAction::Undo),
        Err(AppError::Window(WindowError::UnknownWindow {
            label: WindowLabel::main()
        }))
    );
}

#[test]
fn each_action_has_a_code_of_its_own() {
    let actions = [
        MenuAction::ImportTable,
        MenuAction::ExportCsv,
        MenuAction::ExportXlsx,
        MenuAction::Undo,
        MenuAction::Redo,
        MenuAction::Scatter3d,
        MenuAction::Map,
        MenuAction::CountryMap,
        MenuAction::Histogram,
        MenuAction::SelectNone,
        MenuAction::OpenExample,
    ];
    assert_eq!(
        actions.map(MenuAction::code),
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
    );
}

/// A channel whose window is gone.
struct Failing;

impl Subscriber for Failing {
    fn send(&self, _message: Vec<u8>) -> Result<(), SendFailed> {
        Err(SendFailed {
            reason: "the window is gone".to_owned(),
        })
    }
}

#[test]
fn a_main_window_whose_channel_failed_is_removed_and_returned_with_its_failure() {
    let mut session = Session::new();
    session
        .subscribe(WindowLabel::main(), Box::new(Failing))
        .unwrap();
    assert_eq!(
        send_action(&mut session, MenuAction::Redo),
        Ok(Some(Dropped {
            label: WindowLabel::main(),
            reason: SendFailed {
                reason: "the window is gone".to_owned()
            }
        }))
    );
    assert!(send_action(&mut session, MenuAction::Redo).is_err());
}
