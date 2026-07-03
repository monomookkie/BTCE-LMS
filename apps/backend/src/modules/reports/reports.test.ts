import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { buildTestApp, createUser, loginAs, prisma } from '../../test/helpers.js'
import type { TestApp } from '../../test/helpers.js'
import type { DashboardSummary, ComplianceList } from '@btec-lms/shared'

// ─── Local types ───────────────────────────────────────────────────────────────

type LoginResult = { cookies: string; userId: string }

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('Reports module', () => {
  let app: TestApp

  beforeAll(async () => {
    app = await buildTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  // ─── Shared helpers ────────────────────────────────────────────────────────

  async function makeAdmin(): Promise<LoginResult> {
    const { user, plainPassword } = await createUser({ role: 'ADMIN' })
    const { cookies } = await loginAs(app, user.email, plainPassword)
    return { cookies, userId: user.id }
  }

  async function makeManager(): Promise<LoginResult> {
    const { user, plainPassword } = await createUser({ role: 'MANAGER' })
    const { cookies } = await loginAs(app, user.email, plainPassword)
    return { cookies, userId: user.id }
  }

  async function makeRegularUser(): Promise<LoginResult> {
    const { user, plainPassword } = await createUser({ role: 'USER' })
    const { cookies } = await loginAs(app, user.email, plainPassword)
    return { cookies, userId: user.id }
  }

  /** สร้าง enrollment + cert โดยตรงใน DB ไม่ผ่าน API */
  async function seedEnrollmentDirect(
    userId: string,
    opts: { status?: 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED'; withCert?: boolean } = {},
  ) {
    const course = await prisma.course.create({
      data: {
        titleEn: `Course-${randomUUID().slice(0, 6)}`,
        categoryEn: 'Safety',
        status: 'PUBLISHED',
        expiryMonths: opts.withCert ? 3 : null,
      },
      select: { id: true, titleEn: true },
    })
    const enrollment = await prisma.enrollment.create({
      data: {
        userId,
        courseId: course.id,
        status: opts.status ?? 'IN_PROGRESS',
        progress: opts.status === 'COMPLETED' ? 100 : 50,
        ...(opts.status === 'COMPLETED' && { completedAt: new Date() }),
      },
      select: { id: true },
    })
    if (opts.withCert) {
      await prisma.certificate.create({
        data: {
          enrollmentId: enrollment.id,
          userId,
          courseId: course.id,
          courseTitleEn: course.titleEn,
          courseTitleTh: null,
          certNumber: `BTEC-RPT-${randomUUID().slice(0, 8).toUpperCase()}`,
          score: 90,
          verifyHash: randomUUID(),
          issuedAt: new Date(),
          expiresAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000), // 20 days → expiring-soon
        },
      })
    }
    return { courseId: course.id, enrollmentId: enrollment.id }
  }

  // ─── 1. GET /reports/dashboard — RBAC ─────────────────────────────────────

  describe('GET /reports/dashboard — auth & RBAC', () => {
    it('USER → 403', async () => {
      const user = await makeRegularUser()
      expect(
        (await app.inject({ method: 'GET', url: '/reports/dashboard', headers: { cookie: user.cookies } })).statusCode,
      ).toBe(403)
    })

    it('unauthenticated → 401', async () => {
      expect(
        (await app.inject({ method: 'GET', url: '/reports/dashboard' })).statusCode,
      ).toBe(401)
    })
  })

  // ─── 2. Dashboard — ADMIN sees all ────────────────────────────────────────

  describe('GET /reports/dashboard — ADMIN sees all', () => {
    it('returns summary with correct shape and non-negative counts', async () => {
      const admin = await makeAdmin()
      const u1 = await makeRegularUser()
      await seedEnrollmentDirect(u1.userId, { status: 'COMPLETED', withCert: true })

      const res = await app.inject({
        method: 'GET',
        url: '/reports/dashboard',
        headers: { cookie: admin.cookies },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json<DashboardSummary>()

      // shape check
      expect(typeof body.totalUsers).toBe('number')
      expect(typeof body.totalCourses).toBe('number')
      expect(typeof body.certsIssued).toBe('number')
      expect(typeof body.certsExpiringSoon).toBe('number')
      expect(typeof body.certsExpired).toBe('number')

      // ADMIN ต้องเห็น user ที่เพิ่มมา
      expect(body.totalUsers).toBeGreaterThanOrEqual(1)
      expect(body.certsIssued).toBeGreaterThanOrEqual(1)
      // cert อายุ 20 วัน → expiring-soon
      expect(body.certsExpiringSoon).toBeGreaterThanOrEqual(1)
    })
  })

  // ─── 3. Dashboard — MANAGER (unrestricted after department removal) ──────
  // REFACTOR-1: department removed — MANAGER is temporarily unrestricted (same
  // visibility as ADMIN) until the MANAGER role itself is removed in REFACTOR-2.

  describe('GET /reports/dashboard — MANAGER sees the same totals as ADMIN', () => {
    it('MANAGER count matches ADMIN count (no scoping left)', async () => {
      const manager = await makeManager()
      const admin = await makeAdmin()
      const user = await makeRegularUser()
      await seedEnrollmentDirect(user.userId, { status: 'COMPLETED', withCert: true })

      const [managerRes, adminRes] = await Promise.all([
        app.inject({ method: 'GET', url: '/reports/dashboard', headers: { cookie: manager.cookies } }),
        app.inject({ method: 'GET', url: '/reports/dashboard', headers: { cookie: admin.cookies } }),
      ])
      expect(managerRes.statusCode).toBe(200)
      expect(adminRes.statusCode).toBe(200)

      const managerBody = managerRes.json<DashboardSummary>()
      const adminBody = adminRes.json<DashboardSummary>()

      expect(managerBody.totalUsers).toBe(adminBody.totalUsers)
      expect(managerBody.totalEnrollments).toBe(adminBody.totalEnrollments)
      expect(managerBody.certsIssued).toBe(adminBody.certsIssued)
      expect(managerBody.totalUsers).toBeGreaterThanOrEqual(1)
    })
  })

  // ─── 4. GET /reports/compliance — list ────────────────────────────────────

  describe('GET /reports/compliance', () => {
    it('ADMIN: returns paginated list with correct shape', async () => {
      const admin = await makeAdmin()
      const u = await makeRegularUser()
      await seedEnrollmentDirect(u.userId, { status: 'COMPLETED', withCert: true })

      const res = await app.inject({
        method: 'GET',
        url: '/reports/compliance?page=1&limit=10',
        headers: { cookie: admin.cookies },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json<ComplianceList>()
      expect(typeof body.total).toBe('number')
      expect(Array.isArray(body.data)).toBe(true)
      expect(body.page).toBe(1)
      expect(body.limit).toBe(10)

      // ตรวจ shape ของ row แรก
      const row = body.data[0]
      if (row) {
        expect(row).toHaveProperty('enrollmentId')
        expect(row).toHaveProperty('userName')
        expect(row).toHaveProperty('courseTitle')
        expect(row).toHaveProperty('enrollmentStatus')
        expect(row).toHaveProperty('progress')
        // ห้ามมี PII เกิน
        expect(row).not.toHaveProperty('email')
        expect(row).not.toHaveProperty('employeeId')
        expect(row).not.toHaveProperty('password')
      }
    })

    // REFACTOR-1: department removed — MANAGER is temporarily unrestricted
    // (same visibility as ADMIN) until the MANAGER role itself is removed in REFACTOR-2.
    it('MANAGER sees enrollments across all users (no scoping left)', async () => {
      const manager = await makeManager()
      const userA = await makeRegularUser()
      const userB = await makeRegularUser()

      const { enrollmentId: eidA } = await seedEnrollmentDirect(userA.userId, { status: 'IN_PROGRESS' })
      const { enrollmentId: eidB } = await seedEnrollmentDirect(userB.userId, { status: 'IN_PROGRESS' })

      const res = await app.inject({
        method: 'GET',
        url: '/reports/compliance',
        headers: { cookie: manager.cookies },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json<ComplianceList>()

      const ids = body.data.map((r) => r.enrollmentId)
      expect(ids).toContain(eidA)
      expect(ids).toContain(eidB)
    })

    it('ADMIN filter by courseId → only that course', async () => {
      const admin = await makeAdmin()
      const u = await makeRegularUser()
      const { courseId } = await seedEnrollmentDirect(u.userId, { status: 'IN_PROGRESS' })
      await seedEnrollmentDirect(u.userId, { status: 'IN_PROGRESS' }) // another course

      const res = await app.inject({
        method: 'GET',
        url: `/reports/compliance?courseId=${courseId}`,
        headers: { cookie: admin.cookies },
      })
      const body = res.json<ComplianceList>()
      expect(body.data.every((r) => r.courseId === courseId)).toBe(true)
    })

    it('ADMIN filter by status → only that enrollment status, across pagination-worthy dataset', async () => {
      const admin = await makeAdmin()
      const u = await makeRegularUser()
      await seedEnrollmentDirect(u.userId, { status: 'COMPLETED' })
      await seedEnrollmentDirect(u.userId, { status: 'IN_PROGRESS' })
      await seedEnrollmentDirect(u.userId, { status: 'IN_PROGRESS' })

      const res = await app.inject({
        method: 'GET',
        url: '/reports/compliance?status=IN_PROGRESS',
        headers: { cookie: admin.cookies },
      })
      const body = res.json<ComplianceList>()
      expect(body.data.length).toBeGreaterThan(0)
      expect(body.data.every((r) => r.enrollmentStatus === 'IN_PROGRESS')).toBe(true)
    })

    it('row certStatus = expiring-soon สำหรับ cert ที่หมดใน 20 วัน', async () => {
      const admin = await makeAdmin()
      const u = await makeRegularUser()
      const { courseId } = await seedEnrollmentDirect(u.userId, { status: 'COMPLETED', withCert: true })

      const res = await app.inject({
        method: 'GET',
        url: `/reports/compliance?courseId=${courseId}`,
        headers: { cookie: admin.cookies },
      })
      const body = res.json<ComplianceList>()
      const row = body.data[0]!
      expect(row.certStatus).toBe('expiring-soon')
      expect(row.certNumber).toMatch(/^BTEC-RPT-/)
      expect(row.certExpiresAt).not.toBeNull()
    })

    it('USER → 403', async () => {
      const user = await makeRegularUser()
      expect(
        (await app.inject({ method: 'GET', url: '/reports/compliance', headers: { cookie: user.cookies } })).statusCode,
      ).toBe(403)
    })
  })

  // ─── 5. GET /reports/compliance/export — CSV ──────────────────────────────

  describe('GET /reports/compliance/export', () => {
    it('returns CSV with BOM + correct Content-Type', async () => {
      const admin = await makeAdmin()
      const u = await makeRegularUser()
      await seedEnrollmentDirect(u.userId, { status: 'COMPLETED', withCert: true })

      const res = await app.inject({
        method: 'GET',
        url: '/reports/compliance/export',
        headers: { cookie: admin.cookies },
      })
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toContain('text/csv')
      expect(res.headers['content-disposition']).toContain('attachment')
      expect(res.headers['content-disposition']).toContain('.csv')

      const body = res.payload
      // UTF-8 BOM: byte sequence EF BB BF
      const bom = res.rawPayload.slice(0, 3)
      expect(bom[0]).toBe(0xef)
      expect(bom[1]).toBe(0xbb)
      expect(bom[2]).toBe(0xbf)

      // header row
      expect(body).toContain('Name')
      expect(body).toContain('Course')
      expect(body).toContain('Cert Number')

      // ห้ามมี email / employeeId ใน CSV
      expect(body).not.toContain('@test.com')
    })

    // REFACTOR-1: department removed — MANAGER is temporarily unrestricted
    // (same visibility as ADMIN) until the MANAGER role itself is removed in REFACTOR-2.
    it('MANAGER export: CSV includes all users (no scoping left)', async () => {
      const manager = await makeManager()

      const uniqueName = `UNIQUE-${randomUUID().slice(0, 8)}`
      const { user: rawUser, plainPassword: pw } = await createUser({ role: 'USER', name: uniqueName })
      const targetUser = { userId: rawUser.id, cookies: (await loginAs(app, rawUser.email, pw)).cookies }
      await seedEnrollmentDirect(targetUser.userId, { status: 'IN_PROGRESS' })

      const res = await app.inject({
        method: 'GET',
        url: '/reports/compliance/export',
        headers: { cookie: manager.cookies },
      })
      expect(res.statusCode).toBe(200)
      expect(res.payload).toContain(uniqueName)
    })

    it('export สร้าง REPORT_EXPORT audit log', async () => {
      const admin = await makeAdmin()
      const countBefore = await prisma.auditLog.count({ where: { action: 'REPORT_EXPORT', actorId: admin.userId } })

      await app.inject({
        method: 'GET',
        url: '/reports/compliance/export',
        headers: { cookie: admin.cookies },
      })

      const countAfter = await prisma.auditLog.count({ where: { action: 'REPORT_EXPORT', actorId: admin.userId } })
      expect(countAfter).toBe(countBefore + 1)

      const log = await prisma.auditLog.findFirst({
        where: { action: 'REPORT_EXPORT', actorId: admin.userId },
        orderBy: { createdAt: 'desc' },
      })
      expect(log?.metadata).toMatchObject({ rows: expect.any(Number) })
    })

    it('USER → 403', async () => {
      const user = await makeRegularUser()
      expect(
        (await app.inject({ method: 'GET', url: '/reports/compliance/export', headers: { cookie: user.cookies } })).statusCode,
      ).toBe(403)
    })
  })
})
