// The messages of src-tauri/src/lib.rs: a 24-byte header (the kind in
// byte 0, the revision as a u64 at byte 8, the sender's time as an f64 at
// byte 16), then the payload.
import { invoke } from "@tauri-apps/api/core";

export const N = 50_000;
export const SELECTION_BYTES = N / 8;
export const HEADER = 24;

export const Kind = {
  snapshot: 0,
  hover: 1,
  selection: 2,
  membership: 3,
  startBench: 8,
  sendReport: 9,
} as const;

export interface Header {
  kind: number;
  revision: number;
  t0: number;
}

export function readHeader(buffer: ArrayBuffer): Header {
  if (buffer.byteLength < HEADER) throw new Error(`a message of ${buffer.byteLength} bytes has no header`);
  const v = new DataView(buffer);
  return { kind: v.getUint8(0), revision: Number(v.getBigUint64(8, true)), t0: v.getFloat64(16, true) };
}

/** Milliseconds since the epoch, comparable across windows. */
export function now(): number {
  return performance.timeOrigin + performance.now();
}

/** Writes a line of results through the backend, and to the console. */
export async function report(entry: object, finalReport = false): Promise<void> {
  const text = JSON.stringify(entry);
  console.log("spike:", text);
  await invoke("report", { text, finalReport });
}

/** Errors are reported to the results file, never dropped. */
export function reportErrors(label: string): void {
  const send = (error: string) => void report({ window: label, error }).catch((e) => console.error(e));
  window.addEventListener("error", (e) => send(String(e.error ?? e.message)));
  window.addEventListener("unhandledrejection", (e) => send(String(e.reason)));
}
