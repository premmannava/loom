// Builds the view's script as one file; scripts/inline-ui.mjs puts it, the
// styles and the fonts into dist/ui.html, because MCP Apps views are served
// as a single HTML resource with nothing loaded from elsewhere.
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  build: {
    outDir: "dist/ui-build",
    emptyOutDir: true,
    target: "es2022",
    minify: true,
    lib: {
      entry: fileURLToPath(new URL("./src/ui/main.ts", import.meta.url)),
      name: "SayShapeView",
      formats: ["iife"],
      fileName: () => "view.js",
    },
  },
});
