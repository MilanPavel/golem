import { defineConfig } from "@playwright/test";

// Records the web UI demo (`just demo-web`): e2e/demo.record.ts. It is not a test, so
// playwright.config.ts never runs it. The script takes its own frames, so Playwright's video is off.
export default defineConfig({
  testDir: "e2e",
  testMatch: "demo.record.ts",
  outputDir: "test-results/demo",
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  use: {
    channel: "chrome",
    headless: true,
    video: "off",
  },
});
