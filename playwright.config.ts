import { defineConfig, devices } from "@playwright/test";

const PORT = 5199;

// Visual regression tests. `npm run test:visual` runs them; see visual/visual.spec.ts.
export default defineConfig({
  testDir: "visual",
  testMatch: "*.spec.ts",
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  expect: {
    // A small tolerance for anti-aliasing; real changes move far more pixels.
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: "disabled" },
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices["Desktop Chrome"],
    viewport: { width: 1100, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: "light",
  },
  projects: [{ name: "chromium" }],
  webServer: {
    command: `npx vite --config visual/vite.config.ts --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/visual/index.html`,
    reuseExistingServer: !process.env.CI,
  },
});
