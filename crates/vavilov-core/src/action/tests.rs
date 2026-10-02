use std::sync::{Arc, Mutex};

use super::*;
use crate::session::{SendFailed, Subscriber};

#[derive(Clone, Default)]
struct Recorder(Arc<Mutex<Vec<Vec<u8>>>>);

impl Subscriber for Recorder {
    fn send(&self, message: Vec<u8>) -> Result<(), SendFailed> {
        self.0.lock().unwrap().push(message);
        Ok(())
    }
}

#[test]
fn an_action_reaches_the_window_as_a_message_of_its_own_and_takes_no_revision() {
    let mut session = Session::new();
    let recorder = Recorder::default();
    session
        .subscribe(WindowLabel::main(), Box::new(recorder.clone()))
        .unwrap();
    assert_eq!(
        session.send_action(&WindowLabel::main(), MenuAction::ExportXlsx),
        Ok(None)
    );
    assert_eq!(session.revision().get(), 0);
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
fn each_action_has_its_code_and_the_session_s_current_revision() {
    use crate::command::{Command, Request};
    use crate::ids::Revision;
    let mut session = Session::new();
    session
        .dispatch(Request {
            command: Command::LoadTable {
                table: crate::fixtures::plants(),
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
    for action in [MenuAction::ImportTable, MenuAction::ExportCsv] {
        assert_eq!(session.send_action(&WindowLabel::main(), action), Ok(None));
    }
    assert_eq!(session.revision().get(), 1);
    #[rustfmt::skip]
    let import: Vec<u8> = vec![
        4, 0, 0, 0, 0, 0, 0, 0, // action, no time
        1, 0, 0, 0, 0, 0, 0, 0, // revision 1
        0, 0, 0, 0, 0, 0, 0, 0, // no time
        12, 0, 0, 0, 8, 0, 0, 0, // the action part, 8 bytes
        1, 0, 0, 0, 0, 0, 0, 0, // Import table…
    ];
    #[rustfmt::skip]
    let export_csv: Vec<u8> = vec![
        4, 0, 0, 0, 0, 0, 0, 0, // action, no time
        1, 0, 0, 0, 0, 0, 0, 0, // revision 1
        0, 0, 0, 0, 0, 0, 0, 0, // no time
        12, 0, 0, 0, 8, 0, 0, 0, // the action part, 8 bytes
        2, 0, 0, 0, 0, 0, 0, 0, // Export as CSV…
    ];
    assert_eq!(*recorder.0.lock().unwrap(), [import, export_csv]);
}

struct Failing;

impl Subscriber for Failing {
    fn send(&self, _message: Vec<u8>) -> Result<(), SendFailed> {
        Err(SendFailed {
            reason: "the channel is closed".to_owned(),
        })
    }
}

#[test]
fn a_window_whose_channel_failed_is_removed_and_returned_with_its_failure() {
    let mut session = Session::new();
    session
        .subscribe(WindowLabel::main(), Box::new(Failing))
        .unwrap();
    assert_eq!(
        session.send_action(&WindowLabel::main(), MenuAction::ImportTable),
        Ok(Some(Dropped {
            label: WindowLabel::main(),
            reason: SendFailed {
                reason: "the channel is closed".to_owned(),
            },
        }))
    );
    assert_eq!(
        session.send_action(&WindowLabel::main(), MenuAction::ImportTable),
        Err(CommandError::UnknownWindow {
            label: WindowLabel::main()
        })
    );
}

#[test]
fn an_action_for_a_window_not_subscribed_is_refused() {
    let mut session = Session::new();
    assert_eq!(
        session.send_action(&WindowLabel::main(), MenuAction::ImportTable),
        Err(CommandError::UnknownWindow {
            label: WindowLabel::main()
        })
    );
}

#[test]
fn undo_and_redo_have_the_codes_4_and_5() {
    let mut session = Session::new();
    let recorder = Recorder::default();
    session
        .subscribe(WindowLabel::main(), Box::new(recorder.clone()))
        .unwrap();
    for action in [MenuAction::Undo, MenuAction::Redo] {
        assert_eq!(session.send_action(&WindowLabel::main(), action), Ok(None));
    }
    let codes: Vec<u8> = recorder
        .0
        .lock()
        .unwrap()
        .iter()
        .map(|message| message[32])
        .collect();
    assert_eq!(codes, [4, 5]);
}
