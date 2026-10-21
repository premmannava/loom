import { defineConfig } from "vite";
import { resolve } from "node:path";

// Builds the playground as a static site (used for previews and the published demo).
export default defineConfig({
  base: "./",
  // The static playground has no dev server to reach a model through; "Ask a model" says so.
  define: { __LOOM_MODEL__: '""', __LOOM_MODEL_URL__: '""', __LOOM_USER_SUFFIX__: '""' },
  build: {
    outDir: "dist-playground",
    rollupOptions: { input: resolve(__dirname, "playground/index.html") },
  },
});
