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

  async function makeRegularUser(): Promise<LoginResult> {
    const { user, plainPassword } = await createUser({ role: 'USER' })
    const { cookies } = await loginAs(app, user.email, plainPassword)
    return { cookies, userId: user.id }
  }

  /** สร้าง enrollment โดยตรงใน DB ไม่ผ่าน API */
  async function seedEnrollmentDirect(
    userId: string,
    opts: { status?: 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED'; isMandatory?: boolean } = {},
  ) {
    const course = await prisma.course.create({
      data: {
        titleEn: `Course-${randomUUID().slice(0, 6)}`,
        categoryEn: 'Safety',
        status: 'PUBLISHED',
      },
      select: { id: true, titleEn: true },
    })
    const enrollment = await prisma.enrollment.create({
      data: {
        userId,
        courseId: course.id,
        status: opts.status ?? 'IN_PROGRESS',
        isMandatory: opts.isMandatory ?? false,
        progress: opts.status === 'COMPLETED' ? 100 : 50,
        ...(opts.status === 'COMPLETED' && { completedAt: new Date() }),
      },
      select: { id: true },
    })
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
      await seedEnrollmentDirect(u1.userId, { status: 'COMPLETED' })

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

      // ADMIN ต้องเห็น user ที่เพิ่มมา
      expect(body.totalUsers).toBeGreaterThanOrEqual(1)
    })
  })

  // ─── 2b. Dashboard — mandatory/optional split (2C-4) ──────────────────────

  describe('GET /reports/dashboard — mandatory/optional split', () => {
    it('mandatoryComplianceRate = null when there are zero mandatory enrollments (not 0%)', async () => {
      const admin = await makeAdmin()
      const u = await makeRegularUser()
      await seedEnrollmentDirect(u.userId, { status: 'COMPLETED', isMandatory: false })

      const res = await app.inject({
        method: 'GET',
        url: '/reports/dashboard',
        headers: { cookie: admin.cookies },
      })
      const body = res.json<DashboardSummary>()
      expect(body.mandatoryEnrollments).toBe(0)
      expect(body.mandatoryComplianceRate).toBeNull()
      // optional ยังนับตามปกติ ไม่ปนกับ mandatory
      expect(body.optionalEnrollments).toBeGreaterThanOrEqual(1)
    })

    it('mandatoryComplianceRate counts ONLY mandatory enrollments, ignores optional entirely', async () => {
      const admin = await makeAdmin()
      const u = await makeRegularUser()
      // 2 mandatory: 1 completed, 1 not → rate = 50%
      await seedEnrollmentDirect(u.userId, { status: 'COMPLETED', isMandatory: true })
      await seedEnrollmentDirect(u.userId, { status: 'IN_PROGRESS', isMandatory: true })
      // 3 optional, all completed — must NOT drag mandatoryComplianceRate toward 100%
      await seedEnrollmentDirect(u.userId, { status: 'COMPLETED', isMandatory: false })
      await seedEnrollmentDirect(u.userId, { status: 'COMPLETED', isMandatory: false })
      await seedEnrollmentDirect(u.userId, { status: 'COMPLETED', isMandatory: false })

      const res = await app.inject({
        method: 'GET',
        url: '/reports/dashboard',
        headers: { cookie: admin.cookies },
      })
      const body = res.json<DashboardSummary>()
      expect(body.mandatoryEnrollments).toBe(2)
      expect(body.mandatoryCompleted).toBe(1)
      expect(body.mandatoryComplianceRate).toBe(50)
      expect(body.optionalEnrollments).toBe(3)
      expect(body.optionalCompleted).toBe(3)
    })

    it('overallCompletionRate mixes mandatory+optional together (documented as NOT the compliance rate)', async () => {
      const admin = await makeAdmin()
      const u = await makeRegularUser()
      // total 4, completed 2 → overall = 50%, but mandatory-only would be different (1/1 = 100%)
      await seedEnrollmentDirect(u.userId, { status: 'COMPLETED', isMandatory: true })
      await seedEnrollmentDirect(u.userId, { status: 'COMPLETED', isMandatory: false })
      await seedEnrollmentDirect(u.userId, { status: 'IN_PROGRESS', isMandatory: false })
      await seedEnrollmentDirect(u.userId, { status: 'IN_PROGRESS', isMandatory: false })

      const res = await app.inject({
        method: 'GET',
        url: '/reports/dashboard',
        headers: { cookie: admin.cookies },
      })
      const body = res.json<DashboardSummary>()
      expect(body.overallCompletionRate).toBe(50)
      expect(body.mandatoryComplianceRate).toBe(100) // 1/1 mandatory completed — deliberately different from overall
    })

    it('overallCompletionRate = null when there are zero enrollments at all', async () => {
      const admin = await makeAdmin()

      const res = await app.inject({
        method: 'GET',
        url: '/reports/dashboard',
        headers: { cookie: admin.cookies },
      })
      const body = res.json<DashboardSummary>()
      expect(body.totalEnrollments).toBe(0)
      expect(body.overallCompletionRate).toBeNull()
      expect(body.mandatoryComplianceRate).toBeNull()
    })
  })

  // ─── 4. GET /reports/compliance — list ────────────────────────────────────

  describe('GET /reports/compliance', () => {
    it('ADMIN: returns paginated list with correct shape', async () => {
      const admin = await makeAdmin()
      const u = await makeRegularUser()
      await seedEnrollmentDirect(u.userId, { status: 'COMPLETED' })

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

    it('ADMIN sees enrollments across all users', async () => {
      const admin = await makeAdmin()
      const userA = await makeRegularUser()
      const userB = await makeRegularUser()

      const { enrollmentId: eidA } = await seedEnrollmentDirect(userA.userId, { status: 'IN_PROGRESS' })
      const { enrollmentId: eidB } = await seedEnrollmentDirect(userB.userId, { status: 'IN_PROGRESS' })

      const res = await app.inject({
        method: 'GET',
        url: '/reports/compliance',
        headers: { cookie: admin.cookies },
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

    it('ADMIN filter by isMandatory=true → only mandatory rows, isMandatory field present on every row', async () => {
      const admin = await makeAdmin()
      const u = await makeRegularUser()
      const { enrollmentId: mandatoryId } = await seedEnrollmentDirect(u.userId, { status: 'IN_PROGRESS', isMandatory: true })
      await seedEnrollmentDirect(u.userId, { status: 'IN_PROGRESS', isMandatory: false })

      const res = await app.inject({
        method: 'GET',
        url: '/reports/compliance?isMandatory=true',
        headers: { cookie: admin.cookies },
      })
      const body = res.json<ComplianceList>()
      expect(body.data.every((r) => r.isMandatory === true)).toBe(true)
      expect(body.data.map((r) => r.enrollmentId)).toContain(mandatoryId)
    })

    it('ADMIN filter by isMandatory=false → only optional rows', async () => {
      const admin = await makeAdmin()
      const u = await makeRegularUser()
      await seedEnrollmentDirect(u.userId, { status: 'IN_PROGRESS', isMandatory: true })
      const { enrollmentId: optionalId } = await seedEnrollmentDirect(u.userId, { status: 'IN_PROGRESS', isMandatory: false })

      const res = await app.inject({
        method: 'GET',
        url: '/reports/compliance?isMandatory=false',
        headers: { cookie: admin.cookies },
      })
      const body = res.json<ComplianceList>()
      expect(body.data.every((r) => r.isMandatory === false)).toBe(true)
      expect(body.data.map((r) => r.enrollmentId)).toContain(optionalId)
    })

    it('USER → 403', async () => {
      const user = await makeRegularUser()
      expect(
        (await app.inject({ method: 'GET', url: '/reports/compliance', headers: { cookie: user.cookies } })).statusCode,
      ).toBe(403)
    })

    it('list view สร้าง REPORT_COMPLIANCE_VIEW audit log (ADMIN อ่าน PII ก้อนใหญ่ต้องมี audit trail)', async () => {
      const admin = await makeAdmin()
      const countBefore = await prisma.auditLog.count({
        where: { action: 'REPORT_COMPLIANCE_VIEW', actorId: admin.userId },
      })

      await app.inject({
        method: 'GET',
        url: '/reports/compliance',
        headers: { cookie: admin.cookies },
      })

      const countAfter = await prisma.auditLog.count({
        where: { action: 'REPORT_COMPLIANCE_VIEW', actorId: admin.userId },
      })
      expect(countAfter).toBe(countBefore + 1)

      const log = await prisma.auditLog.findFirst({
        where: { action: 'REPORT_COMPLIANCE_VIEW', actorId: admin.userId },
        orderBy: { createdAt: 'desc' },
      })
      expect(log?.metadata).toMatchObject({ rows: expect.any(Number) })
    })
  })

  // ─── 5. GET /reports/compliance/export — CSV ──────────────────────────────

  describe('GET /reports/compliance/export', () => {
    it('returns CSV with BOM + correct Content-Type', async () => {
      const admin = await makeAdmin()
      const u = await makeRegularUser()
      await seedEnrollmentDirect(u.userId, { status: 'COMPLETED' })

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
      expect(body).toContain('Mandatory')

      // ห้ามมี email / employeeId ใน CSV
      expect(body).not.toContain('@test.com')
    })

    it('Mandatory column renders Yes/No correctly per row (EN only — matches existing CSV convention, not i18n)', async () => {
      const admin = await makeAdmin()

      const mandatoryName = `Mandatory-${randomUUID().slice(0, 8)}`
      const { user: mandatoryUser, plainPassword: pw1 } = await createUser({ role: 'USER', name: mandatoryName })
      await loginAs(app, mandatoryUser.email, pw1)
      await seedEnrollmentDirect(mandatoryUser.id, { status: 'IN_PROGRESS', isMandatory: true })

      const optionalName = `Optional-${randomUUID().slice(0, 8)}`
      const { user: optionalUser, plainPassword: pw2 } = await createUser({ role: 'USER', name: optionalName })
      await loginAs(app, optionalUser.email, pw2)
      await seedEnrollmentDirect(optionalUser.id, { status: 'IN_PROGRESS', isMandatory: false })

      const res = await app.inject({
        method: 'GET',
        url: '/reports/compliance/export',
        headers: { cookie: admin.cookies },
      })
      const lines = res.payload.split('\r\n')
      const mandatoryLine = lines.find((l) => l.includes(mandatoryName))
      const optionalLine = lines.find((l) => l.includes(optionalName))
      expect(mandatoryLine).toContain('Yes')
      expect(optionalLine).toContain('No')
    })

    it('ADMIN export: CSV includes enrollments from users other than the exporter', async () => {
      const admin = await makeAdmin()

      const uniqueName = `UNIQUE-${randomUUID().slice(0, 8)}`
      const { user: rawUser, plainPassword: pw } = await createUser({ role: 'USER', name: uniqueName })
      const targetUser = { userId: rawUser.id, cookies: (await loginAs(app, rawUser.email, pw)).cookies }
      await seedEnrollmentDirect(targetUser.userId, { status: 'IN_PROGRESS' })

      const res = await app.inject({
        method: 'GET',
        url: '/reports/compliance/export',
        headers: { cookie: admin.cookies },
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
