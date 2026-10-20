import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// `npm run dev` serves the playground; `npm run build` builds the library.
export default defineConfig({
  root: ".",
  server: { open: "/playground/index.html" },
  build: {
    lib: {
      entry: {
        loom: resolve(__dirname, "src/index.ts"),
        map: resolve(__dirname, "src/components/map/index.ts"),
        testing: resolve(__dirname, "src/testing/index.ts"),
      },
      formats: ["es"],
    },
    sourcemap: true,
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    benchmark: { include: ["bench/**/*.bench.ts"] },
  },
});
