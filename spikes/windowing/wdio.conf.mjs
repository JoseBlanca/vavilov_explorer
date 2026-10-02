// The WebDriver check: drives the real app, built with the embedded
// WebDriver server (`npm run tauri build -- --debug --features wdio`).
const app = new URL("./src-tauri/target/debug/windowing-spike", import.meta.url).pathname;

export const config = {
  runner: "local",
  specs: ["./test/*.spec.mjs"],
  maxInstances: 1,
  services: [["@wdio/tauri-service", { appBinaryPath: app, driverProvider: "embedded", embeddedPort: 4445 }]],
  capabilities: [{ browserName: "tauri", "tauri:options": { application: app } }],
  framework: "mocha",
  mochaOpts: { timeout: 60000 },
  logLevel: "warn",
};
