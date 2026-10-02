// The control window: the instructions of the manual checks and a button
// that starts the benchmark in view-1.
import { invoke } from "@tauri-apps/api/core";

export async function startControl(): Promise<void> {
  const root = document.createElement("div");
  root.id = "control";
  const path = await invoke<string>("results_path");
  root.innerHTML = `
    <h3>Windowing spike</h3>
    <p><button id="bench">Run benchmark</button> sends 600 hovers, 120 selections and
    60 membership changes from view-1, one per frame, and writes what each window
    measured to <code>${path}</code>.</p>
    <p>Manual checks, each logged to the same file:</p>
    <ol>
      <li>Click this window. Move the pointer over view-2 without clicking: do points
      highlight in both views?</li>
      <li>Click this window. Press and drag in view-1 (acceptFirstMouse on), then the
      same in view-2 (off).</li>
      <li>Minimize view-2 for a while, hover in view-1, restore view-2: does it show
      the current hover?</li>
    </ol>
    <pre id="log"></pre>`;
  document.body.append(root);
  const log = root.querySelector<HTMLPreElement>("#log")!;
  root.querySelector<HTMLButtonElement>("#bench")!.addEventListener("click", () => {
    log.textContent = "benchmark started…";
    invoke("start_bench").catch((e) => (log.textContent = `start_bench failed: ${e}`));
  });
}
