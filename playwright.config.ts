import { defineConfig, devices } from '@playwright/test'

/** Port for the production preview (base /qian/, like GitHub Pages). Override with E2E_PORT. */
const PORT = Number(process.env.E2E_PORT) || 4317
const BASE_PATH = '/qian/'

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: `http://localhost:${PORT}${BASE_PATH}`,
    trace: 'retain-on-failure',
    // Tests run against a fresh context; the service worker is tested on its own (pwa.spec.ts).
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'Desktop Chrome', use: { ...devices['Desktop Chrome'] } },
    { name: 'Pixel 7', use: { ...devices['Pixel 7'] } },
    { name: 'iPhone 14', use: { ...devices['iPhone 14'] } },
  ],
  webServer: {
    // Production build served under /qian/ (vite preview uses the same base as the build).
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}${BASE_PATH}`,
    // Always build and serve the current code. A leftover server on the port (old build, another
    // worktree) then fails loudly via --strictPort instead of being tested silently.
    // PW_REUSE_SERVER=1 opts back into reuse while iterating against a preview you started yourself.
    reuseExistingServer: !!process.env.PW_REUSE_SERVER,
    timeout: 180_000,
  },
})
