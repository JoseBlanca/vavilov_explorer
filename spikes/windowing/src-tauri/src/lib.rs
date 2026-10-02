//! Throwaway experiment for docs/design.md, section 11: one session in the
//! backend, the only owner of the shared state, broadcasting every change
//! as raw bytes over one Tauri channel per window. See ../README.md.
//!
//! Every message starts with a 24-byte header: the kind in byte 0, the
//! revision as a little-endian u64 at byte 8, and at byte 16 the time the
//! sending window made the change, as an f64 of milliseconds since the
//! epoch, which the receiving windows subtract from their own clock.

use std::fs::OpenOptions;
use std::io::Write as _;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

use tauri::ipc::{Channel, InvokeBody, InvokeResponseBody, Request, Response};
use tauri::utils::config::BackgroundThrottlingPolicy;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Individuals in the synthetic dataset; a multiple of 8, so that the
/// selection is a whole number of bytes.
const N: usize = 50_000;
const SELECTION_BYTES: usize = N / 8;
const CLUSTERS: usize = 5;

const SNAPSHOT: u8 = 0;
const HOVER: u8 = 1;
const SELECTION: u8 = 2;
const MEMBERSHIP: u8 = 3;
const START_BENCH: u8 = 8;
const SEND_REPORT: u8 = 9;

/// The window that runs the benchmark, and the one that only receives.
const SENDER: &str = "view-1";
const RECEIVER: &str = "view-2";

struct Subscriber {
    label: String,
    channel: Channel<InvokeResponseBody>,
}

struct Session {
    revision: u64,
    /// The individual under the pointer, or -1 for none.
    hover: i32,
    /// One bit per individual, the first individual in the lowest bit.
    selection: Vec<u8>,
    /// The population of each individual.
    membership: Vec<u16>,
    subscribers: Vec<Subscriber>,
    ready: Vec<String>,
    final_reports: Vec<String>,
    autorun: bool,
    results: PathBuf,
}

fn header(kind: u8, revision: u64, t0: f64, payload: usize) -> Vec<u8> {
    let mut m = Vec::with_capacity(24 + payload);
    m.push(kind);
    m.extend_from_slice(&[0; 7]);
    m.extend_from_slice(&revision.to_le_bytes());
    m.extend_from_slice(&t0.to_le_bytes());
    m
}

impl Session {
    fn new() -> Self {
        let results = std::env::var("SPIKE_RESULTS").map_or_else(
            |_| PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../results.jsonl")),
            PathBuf::from,
        );
        Session {
            revision: 0,
            hover: -1,
            selection: vec![0; SELECTION_BYTES],
            membership: (0..N).map(|i| (i % CLUSTERS) as u16).collect(),
            subscribers: Vec::new(),
            ready: Vec::new(),
            final_reports: Vec::new(),
            autorun: std::env::var("SPIKE_AUTORUN").is_ok_and(|v| v == "1"),
            results,
        }
    }

    /// Sends to every window; a window whose channel fails is reported and
    /// dropped, as a closed window would be.
    fn broadcast(&mut self, message: &[u8]) {
        self.subscribers.retain(|s| {
            match s.channel.send(InvokeResponseBody::Raw(message.to_vec())) {
                Ok(()) => true,
                Err(e) => {
                    eprintln!("spike: dropping the channel of {}: {e}", s.label);
                    false
                }
            }
        });
    }

    fn send_to(&self, label: &str, message: Vec<u8>) -> Result<(), String> {
        let s = self
            .subscribers
            .iter()
            .find(|s| s.label == label)
            .ok_or_else(|| format!("{label} has not subscribed"))?;
        s.channel
            .send(InvokeResponseBody::Raw(message))
            .map_err(|e| format!("sending to {label}: {e}"))
    }

    fn append_result(&self, line: &str) -> Result<(), String> {
        println!("spike result: {line}");
        let mut f = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.results)
            .map_err(|e| format!("opening {}: {e}", self.results.display()))?;
        writeln!(f, "{line}").map_err(|e| format!("writing {}: {e}", self.results.display()))
    }
}

fn lock<'a>(session: &'a State<'_, Mutex<Session>>) -> Result<MutexGuard<'a, Session>, String> {
    session.lock().map_err(|_| "the session lock is poisoned".to_string())
}

/// The bytes of a raw request and the sender's time from its `t0` header.
fn raw_body<'a>(request: &'a Request<'_>, expected: usize) -> Result<(&'a [u8], f64), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected a raw body".into());
    };
    if bytes.len() != expected {
        return Err(format!("expected {expected} bytes, got {}", bytes.len()));
    }
    let t0 = request
        .headers()
        .get("t0")
        .ok_or("missing the t0 header")?
        .to_str()
        .map_err(|e| e.to_string())?
        .parse::<f64>()
        .map_err(|e| e.to_string())?;
    Ok((bytes, t0))
}

/// Registers the window's channel and returns the state at the current
/// revision, in the same lock, so that no change falls between the two.
#[tauri::command]
fn subscribe(
    window: WebviewWindow,
    on_change: Channel<InvokeResponseBody>,
    session: State<'_, Mutex<Session>>,
) -> Result<Response, String> {
    let mut s = lock(&session)?;
    let label = window.label().to_string();
    s.subscribers.retain(|x| x.label != label);
    s.subscribers.push(Subscriber { label, channel: on_change });
    let mut m = header(SNAPSHOT, s.revision, 0.0, 8 + SELECTION_BYTES + 2 * N);
    m.extend_from_slice(&s.hover.to_le_bytes());
    m.extend_from_slice(&[0; 4]);
    m.extend_from_slice(&s.selection);
    for code in &s.membership {
        m.extend_from_slice(&code.to_le_bytes());
    }
    Ok(Response::new(m))
}

/// N points in five clusters, as x, y, z little-endian f32s.
#[tauri::command]
fn positions() -> Response {
    let mut state = 0x9E37_79B9_7F4A_7C15_u64;
    let mut uniform = move || {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        (state >> 11) as f64 / (1_u64 << 53) as f64
    };
    let centres = [[-0.6, -0.4, 0.2], [0.5, 0.5, -0.3], [0.0, -0.6, -0.6], [0.6, -0.3, 0.6], [-0.4, 0.6, 0.5]];
    let mut out = Vec::with_capacity(N * 12);
    for i in 0..N {
        let c = centres[i % CLUSTERS];
        for centre in c {
            let spread = (uniform() + uniform() + uniform() - 1.5) * 0.35;
            out.extend_from_slice(&((centre + spread) as f32).to_le_bytes());
        }
    }
    Response::new(out)
}

#[tauri::command]
fn set_hover(index: i32, t0: f64, session: State<'_, Mutex<Session>>) -> Result<(), String> {
    if index < -1 || index >= N as i32 {
        return Err(format!("no individual {index}"));
    }
    let mut s = lock(&session)?;
    s.revision += 1;
    s.hover = index;
    let mut m = header(HOVER, s.revision, t0, 8);
    m.extend_from_slice(&index.to_le_bytes());
    m.extend_from_slice(&[0; 4]);
    s.broadcast(&m);
    Ok(())
}

#[tauri::command]
fn set_selection(request: Request<'_>, session: State<'_, Mutex<Session>>) -> Result<(), String> {
    let (bytes, t0) = raw_body(&request, SELECTION_BYTES)?;
    let mut s = lock(&session)?;
    s.revision += 1;
    s.selection.copy_from_slice(bytes);
    let mut m = header(SELECTION, s.revision, t0, SELECTION_BYTES);
    m.extend_from_slice(bytes);
    s.broadcast(&m);
    Ok(())
}

#[tauri::command]
fn set_membership(request: Request<'_>, session: State<'_, Mutex<Session>>) -> Result<(), String> {
    let (bytes, t0) = raw_body(&request, 2 * N)?;
    let mut s = lock(&session)?;
    s.revision += 1;
    let (pairs, _) = bytes.as_chunks::<2>();
    for (code, pair) in s.membership.iter_mut().zip(pairs) {
        *code = u16::from_le_bytes(*pair);
    }
    let mut m = header(MEMBERSHIP, s.revision, t0, 2 * N);
    m.extend_from_slice(bytes);
    s.broadcast(&m);
    Ok(())
}

/// Starts the benchmark in the sender window.
#[tauri::command]
fn start_bench(session: State<'_, Mutex<Session>>) -> Result<(), String> {
    let s = lock(&session)?;
    s.send_to(SENDER, header(START_BENCH, 0, 0.0, 0))
}

/// A window has its data and its channel. With SPIKE_AUTORUN=1 the
/// benchmark starts once both views are ready.
#[tauri::command]
fn ready(window: WebviewWindow, session: State<'_, Mutex<Session>>) -> Result<(), String> {
    let mut s = lock(&session)?;
    let label = window.label().to_string();
    if !s.ready.contains(&label) {
        s.ready.push(label);
    }
    let both = [SENDER, RECEIVER].iter().all(|l| s.ready.iter().any(|r| r == l));
    if s.autorun && both {
        s.send_to(SENDER, header(START_BENCH, 0, 0.0, 0))?;
    }
    Ok(())
}

/// The sender finished; every window is asked for its measurements.
#[tauri::command]
fn bench_done(session: State<'_, Mutex<Session>>) -> Result<(), String> {
    let mut s = lock(&session)?;
    s.final_reports.clear();
    s.broadcast(&header(SEND_REPORT, 0, 0.0, 0));
    Ok(())
}

/// A line of results, JSON written by a window. With SPIKE_AUTORUN=1 the
/// app exits once both views have sent their final report.
#[tauri::command]
fn report(
    app: AppHandle,
    window: WebviewWindow,
    text: String,
    final_report: bool,
    session: State<'_, Mutex<Session>>,
) -> Result<(), String> {
    let mut s = lock(&session)?;
    s.append_result(&text)?;
    if final_report {
        s.final_reports.push(window.label().to_string());
        let both = [SENDER, RECEIVER].iter().all(|l| s.final_reports.iter().any(|r| r == l));
        if s.autorun && both {
            app.exit(0);
        }
    }
    Ok(())
}

/// Minimizes or restores a window, for the check of a hidden window.
#[tauri::command]
fn set_minimized(app: AppHandle, label: String, minimized: bool) -> Result<(), String> {
    let window = app.get_webview_window(&label).ok_or_else(|| format!("no window {label}"))?;
    if minimized { window.minimize() } else { window.unminimize() }.map_err(|e| e.to_string())
}

#[tauri::command]
fn results_path(session: State<'_, Mutex<Session>>) -> Result<String, String> {
    Ok(lock(&session)?.results.display().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(feature = "wdio")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());
    builder
        .manage(Mutex::new(Session::new()))
        .setup(|app| {
            // view-1 takes the first click of an inactive window, view-2
            // does not, so that the two can be compared by hand.
            for (i, accept) in [(1_u32, true), (2_u32, false)] {
                WebviewWindowBuilder::new(app, format!("view-{i}"), WebviewUrl::App("index.html".into()))
                    .title(format!("Spike: view-{i}, acceptFirstMouse {accept}"))
                    .inner_size(460.0, 460.0)
                    .position(460.0 + f64::from(i - 1) * 480.0, 60.0)
                    .accept_first_mouse(accept)
                    .background_throttling(BackgroundThrottlingPolicy::Disabled)
                    .build()?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            subscribe,
            positions,
            set_hover,
            set_selection,
            set_membership,
            start_bench,
            ready,
            bench_done,
            report,
            set_minimized,
            results_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running the spike");
}
