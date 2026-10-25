import { defineConfig } from "@playwright/test";

const baseURL = process.env.TRACE_E2E_URL ?? "http://localhost:3001";
const apiURL = process.env.TRACE_E2E_API_URL ?? "http://localhost:8000/api/v1";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL,
    channel: "chrome",
    storageState: "./e2e/.state/workspaces.json",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "php artisan serve --port=8000",
      cwd: "../backend",
      url: `${apiURL}/meta`,
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: "npm run dev -- --port 3001",
      url: baseURL,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
