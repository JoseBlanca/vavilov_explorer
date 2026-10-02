// The isolation hook: every message a window sends passes through here
// before Tauri encrypts it for the backend. It passes them on unchanged.
window.__TAURI_ISOLATION_HOOK__ = (payload) => payload;
