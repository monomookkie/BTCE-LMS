import { spawnSync } from 'node:child_process'

// ต้อง match กับ vitest.config.ts — globalSetup รันใน main thread ไม่ได้รับ test.env
const TEST_DATABASE_URL = 'mysql://btec:btecpassword@localhost:3307/btec_lms_test'

export async function setup() {
  console.log('\n[test] Resetting test DB and applying migrations...')

  // migrate reset + deploy แทน db push เพื่อรองรับ migration ที่ต้องการ CREATE ก่อน DROP
  const result = spawnSync(
    'npx',
    ['--no', 'prisma', 'migrate', 'reset', '--force', '--skip-seed'],
    {
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
      stdio: 'inherit',
      shell: true,
    },
  )

  if (result.status !== 0) {
    throw new Error(`prisma migrate reset failed with exit code ${result.status ?? 'unknown'}`)
  }

  console.log('[test] Test DB ready\n')
}
