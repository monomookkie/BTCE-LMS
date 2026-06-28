import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildTestApp, createUser, loginAs, extractCookies, prisma } from '../../test/helpers.js'
import type { TestApp } from '../../test/helpers.js'

describe('Auth module', () => {
  let app: TestApp

  beforeAll(async () => {
    app = await buildTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  // ─── POST /auth/login ──────────────────────────────────────────────────────

  describe('POST /auth/login', () => {
    it('correct credentials → 200, sets httpOnly cookies, GET /auth/me works', async () => {
      const { user, plainPassword } = await createUser({ email: 'login-ok@test.com' })

      const loginRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: user.email, password: plainPassword },
      })

      expect(loginRes.statusCode).toBe(200)

      // cookies ถูก set และเป็น HttpOnly
      const setCookies = loginRes.headers['set-cookie'] as string[]
      expect(setCookies.some((c) => c.startsWith('access_token='))).toBe(true)
      expect(setCookies.some((c) => c.toLowerCase().includes('httponly'))).toBe(true)
      expect(setCookies.some((c) => c.startsWith('refresh_token='))).toBe(true)

      // GET /auth/me ด้วย cookie ที่ได้มา
      const meRes = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { cookie: extractCookies(loginRes) },
      })
      expect(meRes.statusCode).toBe(200)
      expect(meRes.json<{ email: string }>().email).toBe(user.email)
    })

    it('GET /auth/me without cookie → 401', async () => {
      const res = await app.inject({ method: 'GET', url: '/auth/me' })
      expect(res.statusCode).toBe(401)
    })

    it('wrong password and non-existent email both return 401 with identical message (no leak)', async () => {
      await createUser({ email: 'exists@test.com', password: 'CorrectPass1!' })

      const [wrongPassRes, noUserRes] = await Promise.all([
        app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email: 'exists@test.com', password: 'WrongPass1!' },
        }),
        app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email: 'ghost@test.com', password: 'AnyPass1!' },
        }),
      ])

      expect(wrongPassRes.statusCode).toBe(401)
      expect(noUserRes.statusCode).toBe(401)
      // ข้อความต้องเหมือนกัน — ห้าม leak ว่า email มีอยู่หรือไม่
      expect(wrongPassRes.json<{ message: string }>().message).toBe(
        noUserRes.json<{ message: string }>().message,
      )
    })

    it('suspended account → 401 same message as wrong password, audit logs USER_LOGIN_SUSPENDED separately', async () => {
      const { user, plainPassword } = await createUser({
        email: 'suspended@test.com',
        isActive: false,
      })

      const suspendedRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: user.email, password: plainPassword },
      })

      const wrongPassRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: user.email, password: 'WrongPass1!' },
      })

      // ฝั่ง client เห็น message เดียวกัน
      expect(suspendedRes.statusCode).toBe(401)
      expect(suspendedRes.json<{ message: string }>().message).toBe(
        wrongPassRes.json<{ message: string }>().message,
      )

      // audit log บันทึก action แยกเพื่อให้ admin เห็น
      const suspendedLog = await prisma.auditLog.findFirst({
        where: { action: 'USER_LOGIN_SUSPENDED' },
        orderBy: { createdAt: 'desc' },
      })
      expect(suspendedLog).not.toBeNull()
      expect(suspendedLog!.actorId).toBe(user.id)
    })

    it('audit log USER_LOGIN_FAILED does not contain password field', async () => {
      await createUser({ email: 'auditcheck@test.com' })

      await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'auditcheck@test.com', password: 'WrongP@ss1!' },
      })

      const log = await prisma.auditLog.findFirst({
        where: { action: 'USER_LOGIN_FAILED' },
        orderBy: { createdAt: 'desc' },
      })
      expect(log).not.toBeNull()
      const meta = log!.metadata as Record<string, unknown>
      expect(meta).not.toHaveProperty('password')
      expect(meta['email']).toBe('auditcheck@test.com')
    })
  })

  // ─── POST /auth/refresh ───────────────────────────────────────────────────

  describe('POST /auth/refresh — refresh token rotation', () => {
    it('old refresh token is rejected after rotation (token reuse prevented)', async () => {
      const { user, plainPassword } = await createUser({ email: 'rotate@test.com' })
      const { cookies: firstCookies } = await loginAs(app, user.email, plainPassword)

      // rotate — ได้ token ใหม่
      const rotateRes = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        headers: { cookie: firstCookies },
      })
      expect(rotateRes.statusCode).toBe(200)

      // ใช้ token เก่าอีกครั้ง → ต้อง 401
      const reuseRes = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        headers: { cookie: firstCookies },
      })
      expect(reuseRes.statusCode).toBe(401)
    })

    it('new token from rotation works for subsequent requests', async () => {
      const { user, plainPassword } = await createUser({ email: 'rotate2@test.com' })
      const { cookies: oldCookies } = await loginAs(app, user.email, plainPassword)

      const rotateRes = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        headers: { cookie: oldCookies },
      })
      const newCookies = extractCookies(rotateRes)

      const meRes = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { cookie: newCookies },
      })
      expect(meRes.statusCode).toBe(200)
    })
  })

  // ─── POST /auth/change-password ──────────────────────────────────────────

  describe('POST /auth/change-password', () => {
    it('new password works, old password is rejected after change', async () => {
      const { user, plainPassword: oldPass } = await createUser({ email: 'changepw@test.com' })
      const { cookies } = await loginAs(app, user.email, oldPass)

      const changeRes = await app.inject({
        method: 'POST',
        url: '/auth/change-password',
        headers: { cookie: cookies },
        payload: { currentPassword: oldPass, newPassword: 'NewSecureP@ss1!' },
      })
      expect(changeRes.statusCode).toBe(200)

      // รหัสเดิม → 401
      const oldLoginRes = await loginAs(app, user.email, oldPass)
      expect(oldLoginRes.statusCode).toBe(401)

      // รหัสใหม่ → 200
      const newLoginRes = await loginAs(app, user.email, 'NewSecureP@ss1!')
      expect(newLoginRes.statusCode).toBe(200)
    })

    it('wrong current password → 400, password is NOT changed', async () => {
      const { user, plainPassword } = await createUser({ email: 'changepw-bad@test.com' })
      const { cookies } = await loginAs(app, user.email, plainPassword)

      const res = await app.inject({
        method: 'POST',
        url: '/auth/change-password',
        headers: { cookie: cookies },
        payload: { currentPassword: 'WrongCurrentPass!', newPassword: 'NewPass1!' },
      })
      expect(res.statusCode).toBe(400)

      // password เดิมยังใช้ได้
      const retryRes = await loginAs(app, user.email, plainPassword)
      expect(retryRes.statusCode).toBe(200)
    })
  })
})
