import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests',
  testMatch: ['offline*.spec.ts', 'redesign.spec.ts'],
  fullyParallel: false,
  workers: 1,
  timeout: 40000,
  use: {
    baseURL: 'http://127.0.0.1:4179',
    browserName: 'chromium',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview -- --port 4179 --strictPort',
    url: 'http://127.0.0.1:4179',
    reuseExistingServer: false,
    timeout: 30000,
  },
  reporter: [['list']],
})
