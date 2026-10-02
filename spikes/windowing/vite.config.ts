import { defineConfig } from "vite";

// Port 1440, away from the app's 1420 and the e2e harness's 1430.
export default defineConfig({
  clearScreen: false,
  server: { port: 1440, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
});
