import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { readModelEnv } from "./scripts/model-env";

// `npm run dev` serves the playground; `npm run build` builds the library.
export default defineConfig(({ mode }) => {
  const model = readModelEnv(mode, __dirname);
  return {
    root: ".",
    server: {
      open: "/playground/index.html",
      // The playground's "Ask a model" goes through here, so the browser needs no
      // CORS from the model server and never sees the API key.
      proxy: {
        "/api/model": {
          target: model.url,
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/model/, ""),
          headers: (model.apiKey ? { Authorization: `Bearer ${model.apiKey}` } : {}) as Record<string, string>,
        },
      },
    },
    // Not secret: which model to preselect and what to add to requests.
    define: {
      __LOOM_MODEL__: JSON.stringify(model.model),
      __LOOM_MODEL_URL__: JSON.stringify(model.url),
      __LOOM_USER_SUFFIX__: JSON.stringify(model.userSuffix),
    },
    build: {
      lib: {
        entry: {
          loom: resolve(__dirname, "src/index.ts"),
          map: resolve(__dirname, "src/components/map/index.ts"),
          testing: resolve(__dirname, "src/testing/index.ts"),
          model: resolve(__dirname, "src/model/index.ts"),
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
  };
});
