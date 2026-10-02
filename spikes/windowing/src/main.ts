// One page for every window; the window's label says which part it runs.
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { startControl } from "./control";
import { reportErrors } from "./protocol";
import { startView } from "./view";

const label = getCurrentWebviewWindow().label;
reportErrors(label);
if (label === "main") void startControl();
else void startView(label);
