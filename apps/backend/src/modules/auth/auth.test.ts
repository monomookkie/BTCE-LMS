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

  // ─── POST /auth/register ──────────────────────────────────────────────────
  // Rate limit (5/min) not covered here: apps/backend/src/plugins/rateLimit.ts
  // allow-lists 127.0.0.1 in test env (the address app.inject() always uses),
  // specifically to avoid tripping route-level limits during the test suite —
  // so a 6-requests-then-429 test would pass without exercising anything.
  // The route's `config.rateLimit.max: 5` is verified by code review instead.

  describe('POST /auth/register', () => {
    it('valid @redcross.or.th email → 201, role=USER, isActive=true, cookies set', async () => {
      const email = `register-ok-${Date.now()}@redcross.or.th`
      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          name: 'New Staff',
          email,
          password: 'ValidPass1!',
          department: 'Blood Bank Division',
          position: 'Nurse',
        },
      })
      expect(res.statusCode).toBe(201)
      const body = res.json<{ role: string; isActive: boolean }>()
      expect(body.role).toBe('USER')
      expect(body.isActive).toBe(true)

      const setCookies = res.headers['set-cookie'] as string[]
      expect(setCookies.some((c) => c.startsWith('access_token='))).toBe(true)
      expect(setCookies.some((c) => c.startsWith('refresh_token='))).toBe(true)

      // auto-login: /auth/me ใช้ cookie ที่ได้จาก register ได้ทันที
      const meRes = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { cookie: extractCookies(res) },
      })
      expect(meRes.statusCode).toBe(200)

      // department + position ถูก persist ลง DB จริง
      const dbUser = await prisma.user.findUnique({ where: { email } })
      expect(dbUser?.department).toBe('Blood Bank Division')
      expect(dbUser?.position).toBe('Nurse')
    })

    it('duplicate email → 409 with generic message (no enumeration)', async () => {
      const email = `dup-${Date.now()}@redcross.or.th`
      await createUser({ email })

      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          name: 'Someone',
          email,
          password: 'ValidPass1!',
          department: 'Blood Bank Division',
          position: 'Nurse',
        },
      })
      expect(res.statusCode).toBe(409)
      // ต้องไม่ใช่ข้อความ users.service.ts เดิม ("A user with this email already exists")
      expect(res.json<{ message: string }>().message).not.toMatch(/already exists/i)
    })

    it('password shorter than 8 chars → 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          name: 'Short Pw',
          email: `shortpw-${Date.now()}@redcross.or.th`,
          password: 'Sh0rt!',
          department: 'Blood Bank Division',
          position: 'Nurse',
        },
      })
      expect(res.statusCode).toBe(400)
    })

    it('password missing complexity (no uppercase/special char) → 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          name: 'Weak Pw',
          email: `weakpw-${Date.now()}@redcross.or.th`,
          password: 'alllowercase1',
          department: 'Blood Bank Division',
          position: 'Nurse',
        },
      })
      expect(res.statusCode).toBe(400)
    })

    it('missing department → 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          name: 'No Dept',
          email: `nodept-${Date.now()}@redcross.or.th`,
          password: 'ValidPass1!',
          position: 'Nurse',
        },
      })
      expect(res.statusCode).toBe(400)
    })

    it('missing position → 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          name: 'No Position',
          email: `noposition-${Date.now()}@redcross.or.th`,
          password: 'ValidPass1!',
          department: 'Blood Bank Division',
        },
      })
      expect(res.statusCode).toBe(400)
    })

    it('sending role=ADMIN in payload → created user is still USER (no privilege escalation)', async () => {
      const email = `noescalate-${Date.now()}@redcross.or.th`
      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          name: 'Wannabe Admin',
          email,
          password: 'ValidPass1!',
          department: 'Blood Bank Division',
          position: 'Nurse',
          role: 'ADMIN',
        },
      })
      expect(res.statusCode).toBe(201)
      expect(res.json<{ role: string }>().role).toBe('USER')

      const dbUser = await prisma.user.findUnique({ where: { email } })
      expect(dbUser?.role).toBe('USER')
    })

    it('register writes a USER_REGISTER audit log', async () => {
      const email = `audit-${Date.now()}@redcross.or.th`
      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          name: 'Audit Me',
          email,
          password: 'ValidPass1!',
          department: 'Blood Bank Division',
          position: 'Nurse',
        },
      })
      const userId = res.json<{ id: string }>().id

      const log = await prisma.auditLog.findFirst({
        where: { action: 'USER_REGISTER', actorId: userId },
      })
      expect(log).not.toBeNull()
    })

    // ─── Domain restriction ──────────────────────────────────────────────────

    it('non-redcross.or.th email (@gmail.com) → 400 domain error', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          name: 'Outsider',
          email: `outsider-${Date.now()}@gmail.com`,
          password: 'ValidPass1!',
          department: 'Blood Bank Division',
          position: 'Nurse',
        },
      })
      expect(res.statusCode).toBe(400)
    })

    it('subdomain-spoofed email (@redcross.or.th.evil.com) → 400, not a bypass', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          name: 'Spoofer',
          email: `spoof-${Date.now()}@redcross.or.th.evil.com`,
          password: 'ValidPass1!',
          department: 'Blood Bank Division',
          position: 'Nurse',
        },
      })
      expect(res.statusCode).toBe(400)
    })

    it('mixed-case domain (User@REDCROSS.OR.TH) → 201, case-insensitive match', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          name: 'Case Test',
          email: `CaseTest-${Date.now()}@REDCROSS.OR.TH`,
          password: 'ValidPass1!',
          department: 'Blood Bank Division',
          position: 'Nurse',
        },
      })
      expect(res.statusCode).toBe(201)
      expect(res.json<{ role: string }>().role).toBe('USER')
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
