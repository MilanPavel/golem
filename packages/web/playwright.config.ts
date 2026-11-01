import { defineConfig } from "@playwright/test";

// The fixtures start the daemon, the gateway, and the dev server, so there is no webServer block.
export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.spec.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: { channel: "chrome", headless: true },
});
