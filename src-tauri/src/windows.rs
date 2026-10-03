//! The windows of the widgets, opened and closed with Tauri's windows for
//! the core (`docs/core.md`, section 7; tauri.md, "Windows").

use std::sync::Mutex;

use tauri::utils::config::BackgroundThrottlingPolicy;
use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};
use vavilov_core::{CommandError, Session, WidgetSpec, WindowHost, WindowLabel};

use crate::commands::lock;

/// The size a widget's window opens at, in logical pixels, before the
/// layouts of `docs/design.md`, section 2.4, restore one.
const WIDGET_SIZE: (f64, f64) = (800.0, 640.0);

/// The smallest a widget's window can be made, in logical pixels.
const WIDGET_MIN_SIZE: (f64, f64) = (360.0, 300.0);

/// The app's windows, as the core opens and closes them.
pub struct TauriWindows<'a, R: Runtime>(pub &'a AppHandle<R>);

impl<R: Runtime> WindowHost for TauriWindows<'_, R> {
    /// Makes the widget's window hidden, sized, and then shows it, so that
    /// it does not flash at another size (tauri.md, "Windows"). It is a
    /// top-level window with no parent, takes the first click while
    /// inactive, which a point view needs to start a drag on it, and takes
    /// its title from its page's. On macOS it cannot go fullscreen, which
    /// would move it to a Space of its own away from the other windows
    /// (`docs/design.md`, section 10).
    fn open(&mut self, label: &WindowLabel, widget: &WidgetSpec) -> Result<(), CommandError> {
        let failed = |error: tauri::Error| CommandError::WindowFailed {
            label: label.clone(),
            message: error.to_string(),
        };
        let builder =
            WebviewWindowBuilder::new(self.0, label.as_str(), WebviewUrl::App("index.html".into()))
                .title("Vavilov Explorer")
                .inner_size(WIDGET_SIZE.0, WIDGET_SIZE.1)
                .min_inner_size(WIDGET_MIN_SIZE.0, WIDGET_MIN_SIZE.1)
                .visible(false)
                .accept_first_mouse(accepts_first_mouse(widget))
                .background_throttling(BackgroundThrottlingPolicy::Disabled)
                .on_document_title_changed(|window, title| {
                    if let Err(error) = window.set_title(&title) {
                        eprintln!(
                            "Vavilov Explorer: window {} could not take its title: {error}",
                            window.label()
                        );
                    }
                });
        #[cfg(target_os = "macos")]
        let builder = builder.maximizable(false);
        let window = builder.build().map_err(failed)?;
        if let Err(error) = window.show() {
            // A window left hidden would stay open unseen, since the
            // session forgets the widget whose window failed.
            if let Err(destroyed) = window.destroy() {
                eprintln!("Vavilov Explorer: window {label} could not be closed: {destroyed}");
            }
            return Err(failed(error));
        }
        Ok(())
    }

    /// Closes the window once the call that asked for it has returned, as
    /// a window is never destroyed from inside a call (tauri.md); a window
    /// already gone is closed.
    fn close(&mut self, label: &WindowLabel) -> Result<(), CommandError> {
        let Some(window) = self.0.get_webview_window(label.as_str()) else {
            return Ok(());
        };
        let closing = window.clone();
        window
            .run_on_main_thread(move || {
                if let Err(error) = closing.destroy() {
                    eprintln!(
                        "Vavilov Explorer: window {} could not be closed: {error}",
                        closing.label()
                    );
                }
            })
            .map_err(|error| CommandError::WindowFailed {
                label: label.clone(),
                message: error.to_string(),
            })
    }
}

/// Whether the widget's window takes the first click while it is inactive:
/// the point views do, so that a lasso or a rotation starts on the first
/// press; the others do not, since there a click changes the selection
/// (`docs/design.md`, section 10).
const fn accepts_first_mouse(widget: &WidgetSpec) -> bool {
    match widget {
        WidgetSpec::Scatter3d { .. } => true,
    }
}

/// Closes the windows of the widgets a command left with a column they
/// cannot show, once the session's lock is released; a window that cannot
/// be closed is written to the log, since the session has forgotten it
/// already and it receives nothing more.
pub fn close_all(host: &mut impl WindowHost, labels: &[WindowLabel]) {
    for label in labels {
        if let Err(error) = host.close(label) {
            eprintln!("Vavilov Explorer: {error}");
        }
    }
}

/// Opens the window of the widget `label`, which the session added under
/// its lock, once the lock is released. A window that could not be made
/// is taken out of the session; and a widget that a command closed while
/// its window was being made, a load or a change of role that ran in the
/// meantime, has its window closed as soon as it exists, since that
/// command's close found no window yet.
///
/// # Errors
///
/// `WindowFailed` when the window could not be made or closed, or a
/// `Defect`.
pub fn open_widget_window(
    session: &Mutex<Session>,
    host: &mut impl WindowHost,
    label: &WindowLabel,
    spec: &WidgetSpec,
) -> Result<(), CommandError> {
    let opened = host.open(label, spec);
    let mut session = lock(session)?;
    if let Err(error) = opened {
        session.window_closed(label);
        return Err(error);
    }
    let closed_meanwhile = session.widget(label).is_none();
    drop(session);
    if closed_meanwhile {
        host.close(label)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests;
