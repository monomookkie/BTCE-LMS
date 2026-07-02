import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildTestApp, createUser, loginAs, prisma } from '../../test/helpers.js'
import type { TestApp } from '../../test/helpers.js'

describe('Users module', () => {
  let app: TestApp

  beforeAll(async () => {
    app = await buildTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  // ─── RBAC — endpoint ที่ต้องการ ADMIN/MANAGER ─────────────────────────────

  describe('RBAC', () => {
    it('USER role GET /users → 403 (ADMIN/MANAGER only)', async () => {
      const { user, plainPassword } = await createUser({ role: 'USER' })
      const { cookies } = await loginAs(app, user.email, plainPassword)

      const res = await app.inject({
        method: 'GET',
        url: '/users',
        headers: { cookie: cookies },
      })
      expect(res.statusCode).toBe(403)
    })

    it('USER role GET /users/:id → 403 (ADMIN/MANAGER only)', async () => {
      const { user: target } = await createUser({ email: 'target-view@test.com', role: 'USER' })
      const { user: attacker, plainPassword } = await createUser({
        email: 'attacker-view@test.com',
        role: 'USER',
      })
      const { cookies } = await loginAs(app, attacker.email, plainPassword)

      const res = await app.inject({
        method: 'GET',
        url: `/users/${target.id}`,
        headers: { cookie: cookies },
      })
      expect(res.statusCode).toBe(403)
    })

    it('MANAGER role GET /users → 200 (has access)', async () => {
      const { user, plainPassword } = await createUser({ role: 'MANAGER' })
      const { cookies } = await loginAs(app, user.email, plainPassword)

      const res = await app.inject({
        method: 'GET',
        url: '/users',
        headers: { cookie: cookies },
      })
      expect(res.statusCode).toBe(200)
    })
  })

  // ─── IDOR — USER ไม่สามารถแก้ข้อมูล user อื่น ─────────────────────────────

  describe('IDOR prevention', () => {
    it('USER role PATCH /users/:id (other user) → 403', async () => {
      const { user: target } = await createUser({ email: 'idor-target@test.com', role: 'USER' })
      const { user: attacker, plainPassword } = await createUser({
        email: 'idor-attacker@test.com',
        role: 'USER',
      })
      const { cookies } = await loginAs(app, attacker.email, plainPassword)

      const res = await app.inject({
        method: 'PATCH',
        url: `/users/${target.id}`,
        headers: { cookie: cookies },
        payload: { name: 'Injected Name' },
      })
      expect(res.statusCode).toBe(403)

      // target name ต้องไม่ถูกเปลี่ยน
      const unchanged = await prisma.user.findUnique({ where: { id: target.id } })
      expect(unchanged!.name).not.toBe('Injected Name')
    })

    it('USER role DELETE /users/:id → 403', async () => {
      const { user: target } = await createUser({ email: 'idor-del-target@test.com', role: 'USER' })
      const { user: attacker, plainPassword } = await createUser({
        email: 'idor-del-attacker@test.com',
        role: 'USER',
      })
      const { cookies } = await loginAs(app, attacker.email, plainPassword)

      const res = await app.inject({
        method: 'DELETE',
        url: `/users/${target.id}`,
        headers: { cookie: cookies },
      })
      expect(res.statusCode).toBe(403)

      // target ต้องยังอยู่ใน DB
      const stillExists = await prisma.user.findUnique({ where: { id: target.id } })
      expect(stillExists).not.toBeNull()
      expect(stillExists!.deletedAt).toBeNull()
    })
  })

  // ─── Self-delete guard ─────────────────────────────────────────────────────

  describe('Self-delete guard', () => {
    it('ADMIN DELETE /users/:own-id → 400', async () => {
      const { user: admin, plainPassword } = await createUser({
        email: 'admin-self-del@test.com',
        role: 'ADMIN',
      })
      const { cookies } = await loginAs(app, admin.email, plainPassword)

      const res = await app.inject({
        method: 'DELETE',
        url: `/users/${admin.id}`,
        headers: { cookie: cookies },
      })
      expect(res.statusCode).toBe(400)

      // admin ยังอยู่ใน DB
      const stillExists = await prisma.user.findUnique({ where: { id: admin.id } })
      expect(stillExists).not.toBeNull()
      expect(stillExists!.deletedAt).toBeNull()
    })
  })

  // ─── Soft delete ──────────────────────────────────────────────────────────

  describe('Soft delete', () => {
    it('deleted user is filtered from GET /users list', async () => {
      const { user: admin, plainPassword: adminPw } = await createUser({
        email: 'admin-sd@test.com',
        role: 'ADMIN',
      })
      const { user: target } = await createUser({ email: 'target-sd@test.com', role: 'USER' })
      const { cookies } = await loginAs(app, admin.email, adminPw)

      // ยืนยันว่า target อยู่ใน list ก่อน delete
      const beforeRes = await app.inject({
        method: 'GET',
        url: '/users',
        headers: { cookie: cookies },
      })
      const beforeIds = beforeRes.json<{ data: { id: string }[] }>().data.map((u) => u.id)
      expect(beforeIds).toContain(target.id)

      // Soft delete
      const delRes = await app.inject({
        method: 'DELETE',
        url: `/users/${target.id}`,
        headers: { cookie: cookies },
      })
      expect(delRes.statusCode).toBe(200)

      // ไม่ควรอยู่ใน list หลัง delete
      const afterRes = await app.inject({
        method: 'GET',
        url: '/users',
        headers: { cookie: cookies },
      })
      const afterIds = afterRes.json<{ data: { id: string }[] }>().data.map((u) => u.id)
      expect(afterIds).not.toContain(target.id)

      // ยืนยันว่าเป็น soft delete (record ยังอยู่ใน DB แต่มี deletedAt)
      const deleted = await prisma.user.findUnique({ where: { id: target.id } })
      expect(deleted).not.toBeNull()
      expect(deleted!.deletedAt).not.toBeNull()
    })

    it('soft-deleted user cannot login', async () => {
      const { user: admin, plainPassword: adminPw } = await createUser({
        email: 'admin-sd2@test.com',
        role: 'ADMIN',
      })
      const { user: target, plainPassword: targetPw } = await createUser({
        email: 'target-sd2@test.com',
        role: 'USER',
      })
      const { cookies: adminCookies } = await loginAs(app, admin.email, adminPw)

      // login ได้ก่อน delete
      const beforeLogin = await loginAs(app, target.email, targetPw)
      expect(beforeLogin.statusCode).toBe(200)

      // soft delete
      await app.inject({
        method: 'DELETE',
        url: `/users/${target.id}`,
        headers: { cookie: adminCookies },
      })

      // login ไม่ได้หลัง delete
      const afterLogin = await loginAs(app, target.email, targetPw)
      expect(afterLogin.statusCode).toBe(401)
    })
  })

  // ─── Profile endpoints ────────────────────────────────────────────────────

  describe('Profile (GET /users/me, PATCH /users/me)', () => {
    it('PATCH /users/me updates only own profile', async () => {
      const { user, plainPassword } = await createUser({ email: 'profile-update@test.com' })
      const { cookies } = await loginAs(app, user.email, plainPassword)

      const res = await app.inject({
        method: 'PATCH',
        url: '/users/me',
        headers: { cookie: cookies },
        payload: { name: 'Updated Name', position: 'Senior Dev' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json<{ name: string; position: string }>().name).toBe('Updated Name')
      expect(res.json<{ name: string; position: string }>().position).toBe('Senior Dev')
    })

    it('PATCH /users/me writes USER_UPDATE_PROFILE audit log', async () => {
      const { user, plainPassword } = await createUser({ email: 'profile-audit@test.com' })
      const { cookies } = await loginAs(app, user.email, plainPassword)

      await app.inject({
        method: 'PATCH',
        url: '/users/me',
        headers: { cookie: cookies },
        payload: { name: 'Audited Name' },
      })

      const log = await prisma.auditLog.findFirst({
        where: { action: 'USER_UPDATE_PROFILE', actorId: user.id },
        orderBy: { createdAt: 'desc' },
      })
      expect(log).not.toBeNull()
    })
  })

  // ─── CSV bulk import — per-row errors, no silent skip ─────────────────────

  describe('POST /users/import', () => {
    it('good row created, duplicate-email row and malformed row both reported per-row (not silent)', async () => {
      const { user: admin, plainPassword } = await createUser({
        email: 'admin-csv@test.com',
        role: 'ADMIN',
      })
      const { user: dup } = await createUser({ email: 'already-exists@test.com', role: 'USER' })
      const { cookies } = await loginAs(app, admin.email, plainPassword)

      const csv = [
        'email,name,role',
        'new-import-user@test.com,New Import User,USER',
        `${dup.email},Duplicate Row,USER`,
        ',Missing Email Row,USER',
      ].join('\n')

      const body = Buffer.concat([
        Buffer.from(
          '--b\r\n' +
            'Content-Disposition: form-data; name="file"; filename="users.csv"\r\n' +
            'Content-Type: text/csv\r\n\r\n',
        ),
        Buffer.from(csv),
        Buffer.from('\r\n--b--\r\n'),
      ])

      const res = await app.inject({
        method: 'POST',
        url: '/users/import',
        headers: { cookie: cookies, 'content-type': 'multipart/form-data; boundary=b' },
        body,
      })
      expect(res.statusCode).toBe(200)
      const result = res.json<{
        created: number
        skipped: number
        errors: { row: number; email: string; reason: string }[]
      }>()

      expect(result.created).toBe(1)
      // duplicate-email row must show up in errors[], not just as a silent skipped count
      const dupError = result.errors.find((e) => e.email === dup.email)
      expect(dupError).toBeDefined()
      expect(dupError!.reason.length).toBeGreaterThan(0)

      // malformed row (missing email) also reported per-row
      const malformedError = result.errors.find((e) => e.row === 4)
      expect(malformedError).toBeDefined()

      const created = await prisma.user.findUnique({ where: { email: 'new-import-user@test.com' } })
      expect(created).not.toBeNull()
    })
  })
})
