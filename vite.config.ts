import { configDefaults, defineConfig } from "vitest/config";

// https://vite.dev/config/
export default defineConfig({
  // Keep Rust's errors visible in the terminal of `npm run tauri dev`.
  clearScreen: false,
  server: {
    // Tauri's devUrl (src-tauri/tauri.conf.json) expects this port.
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**", "**/spikes/**"] },
  },
  // The spikes are throwaway experiments with runners of their own; their
  // WebDriver tests are not Vitest tests. The worktrees of the reviewers
  // hold copies of the tests at other commits.
  test: {
    exclude: [...configDefaults.exclude, "spikes/**", ".claude/**"],
  },
});
