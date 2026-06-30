import { defineConfig } from 'vitest/config'

// Test DB URL — แยกจาก dev DB (btec_lms_test vs btec_lms)
const TEST_DATABASE_URL = 'mysql://btec:btecpassword@localhost:3307/btec_lms_test'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // ไฟล์รัน sequential — ป้องกัน beforeEach cleanup ของไฟล์หนึ่งลบ data ที่อีกไฟล์ใช้
    fileParallelism: false,
    // env นี้ inject เข้า process.env ใน worker threads ก่อน module ใดๆ ถูก import
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DATABASE_URL,
      JWT_SECRET: 'test-only-jwt-secret-min32chars-vitest!!',
      REFRESH_TOKEN_SECRET: 'test-only-refresh-secret-min32chars!!',
      COOKIE_SECRET: 'test-only-cookie-secret-min32chars!!!',
      CORS_ORIGIN: 'http://localhost:5173',
    },
    globalSetup: './src/test/globalSetup.ts',
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 30_000,
  },
})
