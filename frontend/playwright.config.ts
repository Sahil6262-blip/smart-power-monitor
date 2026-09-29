import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 40000,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    browserName: 'chromium',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  reporter: [['list']],
})
