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

  async function makeManager(deptId?: string): Promise<LoginResult> {
    const { user, plainPassword } = await createUser({ role: 'MANAGER' })
    if (deptId) {
      await prisma.user.update({ where: { id: user.id }, data: { departmentId: deptId } })
    }
    const { cookies } = await loginAs(app, user.email, plainPassword)
    return { cookies, userId: user.id }
  }

  async function makeRegularUser(deptId?: string): Promise<LoginResult> {
    const { user, plainPassword } = await createUser({ role: 'USER' })
    if (deptId) {
      await prisma.user.update({ where: { id: user.id }, data: { departmentId: deptId } })
    }
    const { cookies } = await loginAs(app, user.email, plainPassword)
    return { cookies, userId: user.id }
  }

  async function createDept(nameEn: string) {
    return prisma.department.create({ data: { nameEn }, select: { id: true } })
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
      const deptA = await createDept(`DeptA-${randomUUID().slice(0, 4)}`)
      const u1 = await makeRegularUser(deptA.id)
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

  // ─── 3. Dashboard — MANAGER scope ─────────────────────────────────────────

  describe('GET /reports/dashboard — MANAGER scoped to own dept', () => {
    it('MANAGER dept A ไม่เห็น count ของ dept B — explicit cross-dept block', async () => {
      const deptA = await createDept(`DeptA-${randomUUID().slice(0, 4)}`)
      const deptB = await createDept(`DeptB-${randomUUID().slice(0, 4)}`)

      const managerA = await makeManager(deptA.id)
      const userA = await makeRegularUser(deptA.id)
      const userB = await makeRegularUser(deptB.id)

      // seed ทั้ง 2 dept เท่า ๆ กัน
      // total ทุก dept: 3 users, 2 enrollments, 2 certs, 2 certsExpiringSoon
      await seedEnrollmentDirect(userA.userId, { status: 'COMPLETED', withCert: true })
      await seedEnrollmentDirect(userB.userId, { status: 'COMPLETED', withCert: true })

      const res = await app.inject({
        method: 'GET',
        url: '/reports/dashboard',
        headers: { cookie: managerA.cookies },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json<DashboardSummary>()

      // ─── dept A only: managerA + userA = 2 ───────────────────────────────
      expect(body.totalUsers).toBe(2)
      // dept B has 1 more user → if leaked would be 3
      expect(body.totalUsers).not.toBe(3)

      // ─── enrollments: userA เท่านั้น = 1 ─────────────────────────────────
      expect(body.totalEnrollments).toBe(1)
      // dept B has 1 enrollment → if leaked would be 2
      expect(body.totalEnrollments).not.toBe(2)

      // ─── certs: userA เท่านั้น = 1 ───────────────────────────────────────
      expect(body.certsIssued).toBe(1)
      // dept B has 1 cert → if leaked would be 2
      expect(body.certsIssued).not.toBe(2)

      // ─── expiring-soon: userA cert (20 days) = 1 ─────────────────────────
      expect(body.certsExpiringSoon).toBe(1)
      // dept B also has expiring cert → if leaked would be 2
      expect(body.certsExpiringSoon).not.toBe(2)

      // ─── completed enrollments = 1 (userA), NOT 2 ────────────────────────
      expect(body.completedEnrollments).toBe(1)
      expect(body.completedEnrollments).not.toBe(2)
    })

    it('MANAGER ไม่มี department → returns zeros, no 403', async () => {
      const manager = await makeManager() // ไม่ assign dept
      const res = await app.inject({
        method: 'GET',
        url: '/reports/dashboard',
        headers: { cookie: manager.cookies },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json<DashboardSummary>()
      expect(body.totalUsers).toBe(0)
      expect(body.certsIssued).toBe(0)
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

    it('MANAGER: เห็นเฉพาะ dept ตัวเอง — explicit cross-dept block', async () => {
      const deptA = await createDept(`DeptA-${randomUUID().slice(0, 4)}`)
      const deptB = await createDept(`DeptB-${randomUUID().slice(0, 4)}`)
      const managerA = await makeManager(deptA.id)
      const userA = await makeRegularUser(deptA.id)
      const userB = await makeRegularUser(deptB.id)

      // seed 1 enrollment each dept → total = 2 if leaked
      const { enrollmentId: eidA } = await seedEnrollmentDirect(userA.userId, { status: 'IN_PROGRESS' })
      const { enrollmentId: eidB } = await seedEnrollmentDirect(userB.userId, { status: 'IN_PROGRESS' })

      const res = await app.inject({
        method: 'GET',
        url: '/reports/compliance',
        headers: { cookie: managerA.cookies },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json<ComplianceList>()

      // ─── total count: dept A only = 1, NOT 2 (both depts) ────────────────
      expect(body.total).toBe(1)
      expect(body.total).not.toBe(2) // if leaked would be 2

      // ─── dept A enrollment IS present ────────────────────────────────────
      const ids = body.data.map((r) => r.enrollmentId)
      expect(ids).toContain(eidA)

      // ─── dept B enrollment is ABSENT (explicit absence check) ────────────
      expect(ids).not.toContain(eidB)
      expect(body.data.filter((r) => r.userId === userB.userId)).toHaveLength(0)
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

    it('MANAGER export: CSV มีเฉพาะ dept ตัวเอง', async () => {
      const deptA = await createDept(`DeptA-${randomUUID().slice(0, 4)}`)
      const deptB = await createDept(`DeptB-${randomUUID().slice(0, 4)}`)
      const managerA = await makeManager(deptA.id)

      // ตั้งชื่อ unique เพื่อตรวจหาใน CSV ได้ชัดเจน
      const uniqueNameB = `UNIQUE-B-${randomUUID().slice(0, 8)}`
      const { user: rawUserB, plainPassword: pwB } = await createUser({ role: 'USER', name: uniqueNameB })
      await prisma.user.update({ where: { id: rawUserB.id }, data: { departmentId: deptB.id } })
      const userB = { userId: rawUserB.id, cookies: (await loginAs(app, rawUserB.email, pwB)).cookies }

      const userA = await makeRegularUser(deptA.id)
      await seedEnrollmentDirect(userA.userId, { status: 'IN_PROGRESS' })
      await seedEnrollmentDirect(userB.userId, { status: 'IN_PROGRESS' })

      const res = await app.inject({
        method: 'GET',
        url: '/reports/compliance/export',
        headers: { cookie: managerA.cookies },
      })
      expect(res.statusCode).toBe(200)
      // userB มีชื่อ unique — ต้องไม่ปรากฏใน CSV ของ MANAGER A
      expect(res.payload).not.toContain(uniqueNameB)
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
      expect(log?.metadata).toMatchObject({ scope: 'all' })
    })

    it('USER → 403', async () => {
      const user = await makeRegularUser()
      expect(
        (await app.inject({ method: 'GET', url: '/reports/compliance/export', headers: { cookie: user.cookies } })).statusCode,
      ).toBe(403)
    })
  })
})
