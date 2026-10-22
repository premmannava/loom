// Bundles the server and the engine code it uses (../src) into dist/server.js.
// The MCP packages stay external: they're this package's dependencies.
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    target: "node20",
    ssr: fileURLToPath(new URL("./src/main.ts", import.meta.url)),
    rollupOptions: {
      external: [/^@modelcontextprotocol\//, "zod", /^node:/],
      output: { format: "es", entryFileNames: "server.js" },
    },
  },
});
