import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  // The E2E suite intentionally shares one in-memory MongoDB instance.
  // Serial workers keep demo-fleet setup and cleanup deterministic.
  workers: 1,
  retries: 0,
  reporter: "list",
  webServer: [
    { command: "npm run dev:memory -w backend", url: "http://127.0.0.1:4000/health", reuseExistingServer: true, timeout: 120_000 },
    { command: "npm run dev -w frontend -- --host 127.0.0.1", url: "http://127.0.0.1:5173", reuseExistingServer: true, timeout: 120_000 },
  ],
  use: {
    baseURL: "http://localhost:5173",
    ...(process.env.CI ? {} : { channel: "msedge" }),
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "desktop-edge", use: { ...devices["Desktop Edge"] } }],
});
