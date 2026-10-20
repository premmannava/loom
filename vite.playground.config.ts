import { defineConfig } from "vite";
import { resolve } from "node:path";

// Builds the playground as a static site (used for previews and the published demo).
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist-playground",
    rollupOptions: { input: resolve(__dirname, "playground/index.html") },
  },
});
