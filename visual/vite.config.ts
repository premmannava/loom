import { defineConfig } from "vite";
import { resolve } from "node:path";

// Serves the visual regression page for Playwright. No browser is opened.
export default defineConfig({
  root: resolve(__dirname, ".."),
  server: { open: false },
});
