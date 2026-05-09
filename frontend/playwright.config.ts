import { defineConfig } from '@playwright/test';

const e2ePort = Number(process.env.PLAYWRIGHT_PORT ?? 5174);
const e2eBaseUrl = `http://localhost:${e2ePort}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 1,
  timeout: 15_000,
  use: {
    baseURL: e2eBaseUrl,
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    // E2E uses port 5174 so it never conflicts with the dev server on 5173.
    // Always starts fresh — guarantees code changes are compiled.
    command: `npx vite --port ${e2ePort} --strictPort`,
    url: e2eBaseUrl,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
