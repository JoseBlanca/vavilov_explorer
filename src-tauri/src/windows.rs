//! The windows of the widgets, opened, brought to the front and closed
//! with Tauri's windows (`docs/design.md`, section 2.2; tauri.md,
//! "Windows").

use std::sync::Mutex;

use tauri::utils::config::BackgroundThrottlingPolicy;
use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};
use vavilov_core::WindowLabel;

use crate::commands::lock_widgets;
use crate::error::{AppError, WindowError};
use crate::widgets::{WidgetSpec, Widgets, WindowHost, WindowKind};

/// The size a widget's window opens at, in logical pixels, before the
/// layouts of `docs/design.md`, section 2.4, restore one.
const WIDGET_SIZE: (f64, f64) = (800.0, 640.0);

/// The smallest a widget's window can be made, in logical pixels.
const WIDGET_MIN_SIZE: (f64, f64) = (360.0, 300.0);

/// The app's windows of widgets, as Tauri makes them.
pub struct TauriWindows<'a, R: Runtime>(pub &'a AppHandle<R>);

impl<R: Runtime> WindowHost for TauriWindows<'_, R> {
    /// Makes the widget's window hidden, sized, and then shows it, so that
    /// it does not flash at another size (tauri.md, "Windows"). It is a
    /// top-level window with no parent, takes the first click while
    /// inactive, which a point view needs to start a drag on it, and takes
    /// its title from its page's. On macOS it cannot go fullscreen, which
    /// would move it to a Space of its own away from the other windows
    /// (`docs/design.md`, section 10).
    fn open(&mut self, label: &WindowLabel, widget: &WidgetSpec) -> Result<(), AppError> {
        let failed = |error: tauri::Error| {
            AppError::from(WindowError::WindowFailed {
                label: label.clone(),
                message: error.to_string(),
            })
        };
        let builder =
            WebviewWindowBuilder::new(self.0, label.as_str(), WebviewUrl::App("index.html".into()))
                .title("Vavilov Explorer")
                .inner_size(WIDGET_SIZE.0, WIDGET_SIZE.1)
                .min_inner_size(WIDGET_MIN_SIZE.0, WIDGET_MIN_SIZE.1)
                .visible(false)
                .accept_first_mouse(accepts_first_mouse(widget.window_kind()))
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
            // app forgets the widgets whose window failed.
            if let Err(destroyed) = window.destroy() {
                eprintln!("Vavilov Explorer: window {label} could not be closed: {destroyed}");
            }
            return Err(failed(error));
        }
        Ok(())
    }

    /// Brings the window to the front, out of the Dock or the taskbar when
    /// it was minimized; a window not made yet is left alone, since it
    /// shows itself once made.
    fn raise(&mut self, label: &WindowLabel) -> Result<(), AppError> {
        let Some(window) = self.0.get_webview_window(label.as_str()) else {
            return Ok(());
        };
        let failed = |error: tauri::Error| {
            AppError::from(WindowError::WindowFailed {
                label: label.clone(),
                message: error.to_string(),
            })
        };
        window.unminimize().map_err(failed)?;
        window.set_focus().map_err(failed)
    }

    /// Closes the window once the call that asked for it has returned, as
    /// a window is never destroyed from inside a call (tauri.md); a window
    /// already gone is closed. The caller runs off the main thread, from
    /// which Tauri runs a task it is given at once.
    fn close(&mut self, label: &WindowLabel) -> Result<(), AppError> {
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
            .map_err(|error| {
                AppError::from(WindowError::WindowFailed {
                    label: label.clone(),
                    message: error.to_string(),
                })
            })
    }
}

/// Whether a window of the kind takes the first click while it is
/// inactive: the 3D scatter's does, so that a lasso or a rotation starts on
/// the first press; the Plots window does not, since there a click on a bar
/// selects its individuals, nor the Maps window, whose first click only
/// brings it to the front, as the owner decided on 4 October 2026, since a
/// click on a country selects (`docs/design.md`, sections 2.2 and 10).
const fn accepts_first_mouse(kind: WindowKind) -> bool {
    match kind {
        WindowKind::Scatter3d => true,
        WindowKind::Plots | WindowKind::Maps => false,
    }
}

/// Closes the windows of widgets a load or a closed widget left, once the
/// locks are released; a window that cannot be closed is written to the
/// log, since the app has forgotten it already and it receives nothing
/// more.
pub fn close_all(host: &mut impl WindowHost, labels: &[WindowLabel]) {
    for label in labels {
        if let Err(error) = host.close(label) {
            eprintln!("Vavilov Explorer: {error}");
        }
    }
}

/// Opens the window `label` of the widget `spec`, its first, which the app
/// added under its lock, once the lock is released. A window that could
/// not be made is forgotten with its widgets; and a window forgotten while
/// it was being made, by a load that ran in the meantime, is closed as
/// soon as it exists, since the load's close found no window yet.
///
/// # Errors
///
/// `WindowFailed` when the window could not be made or closed, or a
/// `Defect`.
pub fn open_widget_window(
    widgets: &Mutex<Widgets>,
    host: &mut impl WindowHost,
    label: &WindowLabel,
    spec: &WidgetSpec,
) -> Result<(), AppError> {
    let opened = host.open(label, spec);
    let mut widgets = lock_widgets(widgets)?;
    if let Err(error) = opened {
        widgets.window_closed(label);
        return Err(error);
    }
    let closed_meanwhile = !widgets.is_open(label);
    drop(widgets);
    if closed_meanwhile {
        host.close(label)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests;
