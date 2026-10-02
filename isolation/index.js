// Tauri's isolation application (.claude/skills/coding/tauri.md): every
// message a window sends passes through this hook, in a sandboxed frame,
// before Tauri encrypts it for the backend. It passes them on unchanged.
// A plain script and not an ES module: a module does not load in the
// sandboxed frame on Windows.
globalThis.__TAURI_ISOLATION_HOOK__ = (payload) => payload;
