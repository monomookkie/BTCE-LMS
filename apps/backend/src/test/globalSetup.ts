import { spawnSync } from 'node:child_process'

// ต้อง match กับ vitest.config.ts — globalSetup รันใน main thread ไม่ได้รับ test.env
const TEST_DATABASE_URL = 'mysql://btec:btecpassword@localhost:3306/btec_lms_test'

export async function setup() {
  console.log('\n[test] Running prisma db push on test DB...')

  const result = spawnSync(
    'npx',
    ['--no', 'prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'],
    {
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
      stdio: 'inherit',
      shell: true, // required on Windows to resolve npx
    },
  )

  if (result.status !== 0) {
    throw new Error(`prisma db push failed with exit code ${result.status ?? 'unknown'}`)
  }

  console.log('[test] Test DB ready\n')
}
