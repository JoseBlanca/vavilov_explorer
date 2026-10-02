//! The windows that receive the messages of the session.

use crate::ids::WindowLabel;

/// The window's end of a channel, as the core sees it: the app implements
/// it over a Tauri channel, the e2e test program by passing the bytes to
/// the harness, and the tests by recording them.
pub trait Subscriber: Send {
    /// Sends one message to the window.
    ///
    /// # Errors
    ///
    /// `SendFailed` when the message could not be handed to the window.
    fn send(&self, message: Vec<u8>) -> Result<(), SendFailed>;
}

/// Why a message could not be sent, as the transport said it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SendFailed {
    /// The transport's message.
    pub reason: String,
}

/// The subscribers, one per window label.
#[derive(Default)]
pub(crate) struct Subscribers {
    windows: Vec<(WindowLabel, Box<dyn Subscriber>)>,
}

impl Subscribers {
    /// Registers `subscriber` for `label`, replacing the one it had.
    pub(crate) fn register(&mut self, label: WindowLabel, subscriber: Box<dyn Subscriber>) {
        self.unregister(&label);
        self.windows.push((label, subscriber));
    }

    /// Forgets the subscriber of `label`, if it had one.
    pub(crate) fn unregister(&mut self, label: &WindowLabel) {
        self.windows.retain(|(registered, _)| registered != label);
    }

    /// Sends `message` to every window, and removes and returns those whose
    /// subscriber failed.
    pub(crate) fn broadcast(&mut self, message: &[u8]) -> Vec<(WindowLabel, SendFailed)> {
        let mut failed = Vec::new();
        self.windows.retain(
            |(label, subscriber)| match subscriber.send(message.to_vec()) {
                Ok(()) => true,
                Err(reason) => {
                    failed.push((label.clone(), reason));
                    false
                }
            },
        );
        failed
    }
}
