import { test, expect } from '@playwright/test'

// ใช้บัญชี seed admin จริง (apps/backend/.env: SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD) — ไม่ mock
// backend เพราะจุดประสงค์ของ e2e คือยืนยัน flow login จริงทำงานได้ตั้งแต่ frontend ถึง backend ถึง DB
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@btec.rcthai.or.th'
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'BtecAdmin2026!'

test.describe('Login flow', () => {
  test('shows an error on wrong credentials', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill('nobody@btec.rcthai.or.th')
    await page.getByLabel('Password').fill('wrong-password-123')
    await page.getByRole('button', { name: 'Login' }).click()

    // ผิด → ต้องยังอยู่หน้า login พร้อม error message โชว์ ไม่ redirect ไปไหน
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByText(/incorrect|invalid|wrong/i)).toBeVisible({ timeout: 10_000 })
  })

  test('logs in successfully and reaches an authenticated page', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill(ADMIN_EMAIL)
    await page.getByLabel('Password').fill(ADMIN_PASSWORD)
    await page.getByRole('button', { name: 'Login' }).click()

    // ไม่ assert URL ปลายทางเป๊ะๆ (อาจเจอ force-change-password ถ้า flag ยังติดอยู่) —
    // แค่ยืนยันว่าหลุดออกจากหน้า login แปลว่า auth ผ่านจริงถึง backend/DB
    await expect(page).not.toHaveURL(/\/login$/, { timeout: 10_000 })
  })
})

test.describe('Language switcher', () => {
  test('toggles visible text between EN and TH on the login page', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('button', { name: 'Login' })).toBeVisible()

    await page.getByRole('button', { name: 'TH' }).click()
    // ปุ่มล็อกอินภาษาไทยควรเปลี่ยนข้อความ (ไม่ใช่ "Login" อีกต่อไป)
    await expect(page.getByRole('button', { name: 'Login' })).not.toBeVisible()
  })
})
