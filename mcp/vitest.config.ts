// The MCP package's own test config. Without it, vitest would load the
// repository's root config (../vite.config.ts), which needs the library's
// dev dependencies, and CI installs only this package's.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
