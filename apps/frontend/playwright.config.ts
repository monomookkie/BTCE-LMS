import { defineConfig, devices } from '@playwright/test'

// e2e ต้องการ backend + frontend dev server จริงคู่กัน (ไม่ mock) — ต้องมี MariaDB dev รันอยู่แล้ว
// (docker-compose up -d db) และ apps/backend/.env ตั้งค่าไว้ครบก่อนรัน `pnpm --filter frontend e2e`
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: 'pnpm --filter backend dev',
      cwd: '../..',
      url: 'http://localhost:3000/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter frontend dev',
      cwd: '../..',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
})
