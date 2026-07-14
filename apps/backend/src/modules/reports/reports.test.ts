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

  // ─── item 4: By Course / By User report helpers ───────────────────────────

  async function seedCourseWithQuiz(passRequiredCount = 1) {
    const course = await prisma.course.create({
      data: { titleEn: `Course-${randomUUID().slice(0, 6)}`, categoryEn: 'Safety', status: 'PUBLISHED' },
      select: { id: true },
    })
    const quiz = await prisma.quiz.create({
      data: { courseId: course.id, titleEn: 'Quiz', passRequiredCount },
      select: { id: true },
    })
    return { courseId: course.id, quizId: quiz.id }
  }

  async function seedQuizAttempt(
    quizId: string,
    userId: string,
    opts: { score: number; passed: boolean; correctCount?: number; totalQuestions?: number },
  ) {
    return prisma.quizAttempt.create({
      data: {
        quizId,
        userId,
        score: opts.score,
        passed: opts.passed,
        answers: {},
        ...(opts.correctCount != null && { correctCount: opts.correctCount }),
        ...(opts.totalQuestions != null && { totalQuestions: opts.totalQuestions }),
      },
    })
  }

  async function seedSurveyWithQuestions(
    courseId: string,
    questions: { type: 'RATING' | 'TEXT'; textEn: string }[],
  ) {
    const survey = await prisma.survey.create({ data: { courseId }, select: { id: true } })
    const created: { id: string; type: 'RATING' | 'TEXT' }[] = []
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]!
      const row = await prisma.surveyQuestion.create({
        data: { surveyId: survey.id, type: q.type, textEn: q.textEn, order: i },
        select: { id: true, type: true },
      })
      created.push(row)
    }
    return { surveyId: survey.id, questions: created }
  }

  async function seedSurveyResponse(surveyId: string, userId: string, answers: Record<string, number | string>) {
    return prisma.surveyResponse.create({ data: { surveyId, userId, answers } })
  }

  // ─── 6. GET /reports/by-course ─────────────────────────────────────────────

  describe('GET /reports/by-course', () => {
    it('RBAC: USER → 403, unauthenticated → 401', async () => {
      const { courseId } = await seedCourseWithQuiz()
      const user = await makeRegularUser()
      expect(
        (await app.inject({ method: 'GET', url: `/reports/by-course?courseId=${courseId}`, headers: { cookie: user.cookies } })).statusCode,
      ).toBe(403)
      expect(
        (await app.inject({ method: 'GET', url: `/reports/by-course?courseId=${courseId}` })).statusCode,
      ).toBe(401)
    })

    it('nonexistent courseId → 404', async () => {
      const admin = await makeAdmin()
      const res = await app.inject({
        method: 'GET',
        url: `/reports/by-course?courseId=${'c'.repeat(25)}`,
        headers: { cookie: admin.cookies },
      })
      expect(res.statusCode).toBe(404)
    })

    it('enrollmentCount/passCount/passRate computed correctly, hasSurvey=false → ratingStats empty', async () => {
      const admin = await makeAdmin()
      const { courseId, quizId } = await seedCourseWithQuiz()
      const u1 = await makeRegularUser()
      const u2 = await makeRegularUser()
      await prisma.enrollment.create({ data: { userId: u1.userId, courseId, status: 'COMPLETED', progress: 100 } })
      await prisma.enrollment.create({ data: { userId: u2.userId, courseId, status: 'IN_PROGRESS', progress: 50 } })
      await seedQuizAttempt(quizId, u1.userId, { score: 90, passed: true })

      const res = await app.inject({
        method: 'GET',
        url: `/reports/by-course?courseId=${courseId}`,
        headers: { cookie: admin.cookies },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json<{ enrollmentCount: number; passCount: number; passRate: number | null; hasSurvey: boolean; ratingStats: unknown[] }>()
      expect(body.enrollmentCount).toBe(2)
      expect(body.passCount).toBe(1)
      expect(body.passRate).toBe(50)
      expect(body.hasSurvey).toBe(false)
      expect(body.ratingStats).toEqual([])
    })

    it('passRate = null when enrollmentCount = 0', async () => {
      const admin = await makeAdmin()
      const { courseId } = await seedCourseWithQuiz()
      const res = await app.inject({
        method: 'GET',
        url: `/reports/by-course?courseId=${courseId}`,
        headers: { cookie: admin.cookies },
      })
      const body = res.json<{ enrollmentCount: number; passRate: number | null }>()
      expect(body.enrollmentCount).toBe(0)
      expect(body.passRate).toBeNull()
    })

    it('passCount counts DISTINCT users (multiple passed attempts by same user counted once)', async () => {
      const admin = await makeAdmin()
      const { courseId, quizId } = await seedCourseWithQuiz()
      const u1 = await makeRegularUser()
      await prisma.enrollment.create({ data: { userId: u1.userId, courseId, status: 'COMPLETED', progress: 100 } })
      await seedQuizAttempt(quizId, u1.userId, { score: 60, passed: false })
      await seedQuizAttempt(quizId, u1.userId, { score: 90, passed: true })
      await seedQuizAttempt(quizId, u1.userId, { score: 95, passed: true })

      const res = await app.inject({
        method: 'GET',
        url: `/reports/by-course?courseId=${courseId}`,
        headers: { cookie: admin.cookies },
      })
      const body = res.json<{ passCount: number }>()
      expect(body.passCount).toBe(1)
    })

    it('hasSurvey=true → ratingStats has average + distribution per RATING question, TEXT questions excluded', async () => {
      const admin = await makeAdmin()
      const { courseId } = await seedCourseWithQuiz()
      const { surveyId, questions } = await seedSurveyWithQuestions(courseId, [
        { type: 'RATING', textEn: 'Content was clear' },
        { type: 'TEXT', textEn: 'Any comments?' },
      ])
      const ratingQ = questions.find((q) => q.type === 'RATING')!
      const u1 = await makeRegularUser()
      const u2 = await makeRegularUser()
      const u3 = await makeRegularUser()
      await seedSurveyResponse(surveyId, u1.userId, { [ratingQ.id]: 5, [questions[1]!.id]: 'great' })
      await seedSurveyResponse(surveyId, u2.userId, { [ratingQ.id]: 3 })
      await seedSurveyResponse(surveyId, u3.userId, { [ratingQ.id]: 4 })

      const res = await app.inject({
        method: 'GET',
        url: `/reports/by-course?courseId=${courseId}`,
        headers: { cookie: admin.cookies },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json<{
        hasSurvey: boolean
        ratingStats: { questionId: string; average: number; responseCount: number; distribution: { rating: number; count: number }[] }[]
      }>()
      expect(body.hasSurvey).toBe(true)
      // TEXT question ต้องไม่โผล่ใน ratingStats
      expect(body.ratingStats).toHaveLength(1)
      const stat = body.ratingStats[0]!
      expect(stat.questionId).toBe(ratingQ.id)
      expect(stat.responseCount).toBe(3)
      expect(stat.average).toBe(4) // (5+3+4)/3 = 4
      expect(stat.distribution).toHaveLength(5)
      expect(stat.distribution.find((d) => d.rating === 5)?.count).toBe(1)
      expect(stat.distribution.find((d) => d.rating === 3)?.count).toBe(1)
      expect(stat.distribution.find((d) => d.rating === 4)?.count).toBe(1)
      expect(stat.distribution.find((d) => d.rating === 1)?.count).toBe(0)
    })

    it('creates REPORT_BY_COURSE_VIEW audit log', async () => {
      const admin = await makeAdmin()
      const { courseId } = await seedCourseWithQuiz()
      const countBefore = await prisma.auditLog.count({ where: { action: 'REPORT_BY_COURSE_VIEW', actorId: admin.userId } })

      await app.inject({ method: 'GET', url: `/reports/by-course?courseId=${courseId}`, headers: { cookie: admin.cookies } })

      const countAfter = await prisma.auditLog.count({ where: { action: 'REPORT_BY_COURSE_VIEW', actorId: admin.userId } })
      expect(countAfter).toBe(countBefore + 1)
    })
  })

  // ─── 6b. GET /reports/by-course/passed — named list (not anonymous) ───────

  describe('GET /reports/by-course/passed', () => {
    it('RBAC: USER → 403, unauthenticated → 401', async () => {
      const { courseId } = await seedCourseWithQuiz()
      const user = await makeRegularUser()
      expect(
        (await app.inject({ method: 'GET', url: `/reports/by-course/passed?courseId=${courseId}`, headers: { cookie: user.cookies } })).statusCode,
      ).toBe(403)
      expect(
        (await app.inject({ method: 'GET', url: `/reports/by-course/passed?courseId=${courseId}` })).statusCode,
      ).toBe(401)
    })

    it('nonexistent courseId → 404', async () => {
      const admin = await makeAdmin()
      const res = await app.inject({
        method: 'GET',
        url: `/reports/by-course/passed?courseId=${'c'.repeat(25)}`,
        headers: { cookie: admin.cookies },
      })
      expect(res.statusCode).toBe(404)
    })

    it('returns userName + correctCount/totalQuestions (of the best-scoring attempt) for users who passed, excludes non-passers', async () => {
      const admin = await makeAdmin()
      const { courseId, quizId } = await seedCourseWithQuiz()
      const passer = await makeRegularUser()
      const failer = await makeRegularUser()
      await seedQuizAttempt(quizId, passer.userId, { score: 60, passed: false, correctCount: 3, totalQuestions: 5 })
      await seedQuizAttempt(quizId, passer.userId, { score: 95, passed: true, correctCount: 19, totalQuestions: 20 })
      await seedQuizAttempt(quizId, failer.userId, { score: 50, passed: false, correctCount: 2, totalQuestions: 4 })

      const res = await app.inject({
        method: 'GET',
        url: `/reports/by-course/passed?courseId=${courseId}`,
        headers: { cookie: admin.cookies },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json<{ data: { userId: string; userName: string; correctCount: number | null; totalQuestions: number | null }[]; total: number }>()
      expect(body.total).toBe(1)
      const row = body.data.find((r) => r.userId === passer.userId)
      expect(row).toBeDefined()
      // ต้องเป็นของ attempt คะแนนสูงสุด (score=95) ไม่ใช่ attempt แรกที่ passed
      expect(row!.correctCount).toBe(19)
      expect(row!.totalQuestions).toBe(20)
      expect(body.data.some((r) => r.userId === failer.userId)).toBe(false)
    })

    it('legacy attempt without correctCount/totalQuestions → shows null (not backfilled)', async () => {
      const admin = await makeAdmin()
      const { courseId, quizId } = await seedCourseWithQuiz()
      const passer = await makeRegularUser()
      // ไม่ส่ง correctCount/totalQuestions — จำลอง attempt เก่าก่อน migration นี้
      await seedQuizAttempt(quizId, passer.userId, { score: 90, passed: true })

      const res = await app.inject({
        method: 'GET',
        url: `/reports/by-course/passed?courseId=${courseId}`,
        headers: { cookie: admin.cookies },
      })
      const body = res.json<{ data: { userId: string; correctCount: number | null; totalQuestions: number | null }[] }>()
      const row = body.data.find((r) => r.userId === passer.userId)
      expect(row!.correctCount).toBeNull()
      expect(row!.totalQuestions).toBeNull()
    })

    it('pagination: page/limit respected', async () => {
      const admin = await makeAdmin()
      const { courseId, quizId } = await seedCourseWithQuiz()
      for (let i = 0; i < 3; i++) {
        const u = await makeRegularUser()
        await seedQuizAttempt(quizId, u.userId, { score: 90, passed: true })
      }

      const res = await app.inject({
        method: 'GET',
        url: `/reports/by-course/passed?courseId=${courseId}&page=1&limit=2`,
        headers: { cookie: admin.cookies },
      })
      const body = res.json<{ data: unknown[]; total: number; page: number; limit: number }>()
      expect(body.total).toBe(3)
      expect(body.data).toHaveLength(2)
    })

    it('creates REPORT_BY_COURSE_VIEW audit log', async () => {
      const admin = await makeAdmin()
      const { courseId } = await seedCourseWithQuiz()
      const countBefore = await prisma.auditLog.count({ where: { action: 'REPORT_BY_COURSE_VIEW', actorId: admin.userId } })

      await app.inject({ method: 'GET', url: `/reports/by-course/passed?courseId=${courseId}`, headers: { cookie: admin.cookies } })

      const countAfter = await prisma.auditLog.count({ where: { action: 'REPORT_BY_COURSE_VIEW', actorId: admin.userId } })
      expect(countAfter).toBe(countBefore + 1)
    })
  })

  // ─── 7. GET /reports/by-course/comments — anonymous ────────────────────────

  describe('GET /reports/by-course/comments — anonymous by design (PDPA)', () => {
    it('RBAC: USER → 403', async () => {
      const { courseId } = await seedCourseWithQuiz()
      const user = await makeRegularUser()
      expect(
        (await app.inject({ method: 'GET', url: `/reports/by-course/comments?courseId=${courseId}`, headers: { cookie: user.cookies } })).statusCode,
      ).toBe(403)
    })

    it('response rows contain ONLY questionId/questionText/comment — no userId, userName, id, or createdAt at all', async () => {
      const admin = await makeAdmin()
      const { courseId } = await seedCourseWithQuiz()
      const { surveyId, questions } = await seedSurveyWithQuestions(courseId, [
        { type: 'TEXT', textEn: 'Any comments?' },
      ])
      const textQ = questions[0]!
      const u1 = await makeRegularUser()
      await seedSurveyResponse(surveyId, u1.userId, { [textQ.id]: 'This course was excellent!' })

      const res = await app.inject({
        method: 'GET',
        url: `/reports/by-course/comments?courseId=${courseId}`,
        headers: { cookie: admin.cookies },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json<{ data: Record<string, unknown>[]; total: number }>()
      expect(body.total).toBe(1)
      const row = body.data[0]!
      expect(Object.keys(row).sort()).toEqual(['comment', 'questionId', 'questionText'])
      expect(row['comment']).toBe('This course was excellent!')
      // ยืนยันชัดๆ ว่าไม่มี field เหล่านี้หลุดออกมาแม้แต่ undefined
      expect('userId' in row).toBe(false)
      expect('userName' in row).toBe(false)
      expect('createdAt' in row).toBe(false)
      expect('id' in row).toBe(false)

      // raw response body (ไม่ผ่าน typed parse) ก็ต้องไม่มี userId string หลุดออกมาด้วย
      const raw = JSON.stringify(res.json())
      expect(raw).not.toContain(u1.userId)
    })

    it('RATING question answers are excluded from comments (only TEXT questions)', async () => {
      const admin = await makeAdmin()
      const { courseId } = await seedCourseWithQuiz()
      const { surveyId, questions } = await seedSurveyWithQuestions(courseId, [
        { type: 'RATING', textEn: 'Rate it' },
      ])
      const u1 = await makeRegularUser()
      await seedSurveyResponse(surveyId, u1.userId, { [questions[0]!.id]: 5 })

      const res = await app.inject({
        method: 'GET',
        url: `/reports/by-course/comments?courseId=${courseId}`,
        headers: { cookie: admin.cookies },
      })
      const body = res.json<{ data: unknown[]; total: number }>()
      expect(body.total).toBe(0)
    })

    it('empty comment strings are excluded', async () => {
      const admin = await makeAdmin()
      const { courseId } = await seedCourseWithQuiz()
      const { surveyId, questions } = await seedSurveyWithQuestions(courseId, [
        { type: 'TEXT', textEn: 'Any comments?' },
      ])
      const u1 = await makeRegularUser()
      await seedSurveyResponse(surveyId, u1.userId, { [questions[0]!.id]: '   ' })

      const res = await app.inject({
        method: 'GET',
        url: `/reports/by-course/comments?courseId=${courseId}`,
        headers: { cookie: admin.cookies },
      })
      const body = res.json<{ total: number }>()
      expect(body.total).toBe(0)
    })

    it('no survey / no TEXT questions → empty list, 200 (not error)', async () => {
      const admin = await makeAdmin()
      const { courseId } = await seedCourseWithQuiz()
      const res = await app.inject({
        method: 'GET',
        url: `/reports/by-course/comments?courseId=${courseId}`,
        headers: { cookie: admin.cookies },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json<{ data: unknown[]; total: number }>()
      expect(body.data).toEqual([])
      expect(body.total).toBe(0)
    })

    it('pagination: page/limit respected', async () => {
      const admin = await makeAdmin()
      const { courseId } = await seedCourseWithQuiz()
      const { surveyId, questions } = await seedSurveyWithQuestions(courseId, [
        { type: 'TEXT', textEn: 'Any comments?' },
      ])
      const textQ = questions[0]!
      for (let i = 0; i < 3; i++) {
        const u = await makeRegularUser()
        await seedSurveyResponse(surveyId, u.userId, { [textQ.id]: `Comment number ${i}` })
      }

      const res = await app.inject({
        method: 'GET',
        url: `/reports/by-course/comments?courseId=${courseId}&page=1&limit=2`,
        headers: { cookie: admin.cookies },
      })
      const body = res.json<{ data: unknown[]; total: number; page: number; limit: number }>()
      expect(body.total).toBe(3)
      expect(body.data).toHaveLength(2)
      expect(body.page).toBe(1)
      expect(body.limit).toBe(2)
    })
  })

  // ─── 8. GET /reports/by-user ────────────────────────────────────────────────

  describe('GET /reports/by-user', () => {
    it('RBAC: USER → 403, unauthenticated → 401', async () => {
      const target = await makeRegularUser()
      const user = await makeRegularUser()
      expect(
        (await app.inject({ method: 'GET', url: `/reports/by-user?userId=${target.userId}`, headers: { cookie: user.cookies } })).statusCode,
      ).toBe(403)
      expect(
        (await app.inject({ method: 'GET', url: `/reports/by-user?userId=${target.userId}` })).statusCode,
      ).toBe(401)
    })

    it('nonexistent userId → 404', async () => {
      const admin = await makeAdmin()
      const res = await app.inject({
        method: 'GET',
        url: `/reports/by-user?userId=${'c'.repeat(25)}`,
        headers: { cookie: admin.cookies },
      })
      expect(res.statusCode).toBe(404)
    })

    it('splits enrollments into mandatory vs optional correctly', async () => {
      const admin = await makeAdmin()
      const target = await makeRegularUser()
      const { enrollmentId: mandId } = await seedEnrollmentDirect(target.userId, { status: 'IN_PROGRESS', isMandatory: true })
      const { enrollmentId: optId } = await seedEnrollmentDirect(target.userId, { status: 'COMPLETED', isMandatory: false })

      const res = await app.inject({
        method: 'GET',
        url: `/reports/by-user?userId=${target.userId}`,
        headers: { cookie: admin.cookies },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json<{ userId: string; userName: string; mandatory: { enrollmentId: string }[]; optional: { enrollmentId: string }[] }>()
      expect(body.userId).toBe(target.userId)
      expect(body.mandatory.map((r) => r.enrollmentId)).toEqual([mandId])
      expect(body.optional.map((r) => r.enrollmentId)).toEqual([optId])
    })

    it('excludes soft-deleted enrollments', async () => {
      const admin = await makeAdmin()
      const target = await makeRegularUser()
      const { enrollmentId } = await seedEnrollmentDirect(target.userId, { status: 'IN_PROGRESS' })
      await prisma.enrollment.update({ where: { id: enrollmentId }, data: { deletedAt: new Date() } })

      const res = await app.inject({
        method: 'GET',
        url: `/reports/by-user?userId=${target.userId}`,
        headers: { cookie: admin.cookies },
      })
      const body = res.json<{ mandatory: unknown[]; optional: { enrollmentId: string }[] }>()
      expect(body.optional.map((r: { enrollmentId: string }) => r.enrollmentId)).not.toContain(enrollmentId)
    })

    it('quizPassed = null when course has no quiz (not false — N/A vs not-yet-passed)', async () => {
      const admin = await makeAdmin()
      const target = await makeRegularUser()
      await seedEnrollmentDirect(target.userId, { status: 'IN_PROGRESS' })

      const res = await app.inject({
        method: 'GET',
        url: `/reports/by-user?userId=${target.userId}`,
        headers: { cookie: admin.cookies },
      })
      const body = res.json<{ optional: { quizPassed: boolean | null; quizCorrectCount: number | null; quizTotalQuestions: number | null }[] }>()
      expect(body.optional[0]!.quizPassed).toBeNull()
      expect(body.optional[0]!.quizCorrectCount).toBeNull()
      expect(body.optional[0]!.quizTotalQuestions).toBeNull()
    })

    it('quizPassed = false + quizCorrectCount/quizTotalQuestions = null when quiz exists but user never attempted', async () => {
      const admin = await makeAdmin()
      const target = await makeRegularUser()
      const { courseId } = await seedCourseWithQuiz()
      await prisma.enrollment.create({ data: { userId: target.userId, courseId, status: 'IN_PROGRESS', progress: 30 } })

      const res = await app.inject({
        method: 'GET',
        url: `/reports/by-user?userId=${target.userId}`,
        headers: { cookie: admin.cookies },
      })
      const body = res.json<{ optional: { quizPassed: boolean | null; quizCorrectCount: number | null; quizTotalQuestions: number | null }[] }>()
      expect(body.optional[0]!.quizPassed).toBe(false)
      expect(body.optional[0]!.quizCorrectCount).toBeNull()
      expect(body.optional[0]!.quizTotalQuestions).toBeNull()
    })

    it('quizCorrectCount/quizTotalQuestions come from the highest-scoring attempt, quizPassed = true if ANY attempt passed', async () => {
      const admin = await makeAdmin()
      const target = await makeRegularUser()
      const { courseId, quizId } = await seedCourseWithQuiz()
      await prisma.enrollment.create({ data: { userId: target.userId, courseId, status: 'COMPLETED', progress: 100 } })
      await seedQuizAttempt(quizId, target.userId, { score: 60, passed: false, correctCount: 6, totalQuestions: 10 })
      await seedQuizAttempt(quizId, target.userId, { score: 95, passed: true, correctCount: 19, totalQuestions: 20 })
      await seedQuizAttempt(quizId, target.userId, { score: 70, passed: false, correctCount: 7, totalQuestions: 10 })

      const res = await app.inject({
        method: 'GET',
        url: `/reports/by-user?userId=${target.userId}`,
        headers: { cookie: admin.cookies },
      })
      const body = res.json<{ optional: { quizPassed: boolean; quizCorrectCount: number; quizTotalQuestions: number }[] }>()
      expect(body.optional[0]!.quizPassed).toBe(true)
      expect(body.optional[0]!.quizCorrectCount).toBe(19)
      expect(body.optional[0]!.quizTotalQuestions).toBe(20)
    })

    it('creates REPORT_BY_USER_VIEW audit log', async () => {
      const admin = await makeAdmin()
      const target = await makeRegularUser()
      const countBefore = await prisma.auditLog.count({ where: { action: 'REPORT_BY_USER_VIEW', actorId: admin.userId } })

      await app.inject({ method: 'GET', url: `/reports/by-user?userId=${target.userId}`, headers: { cookie: admin.cookies } })

      const countAfter = await prisma.auditLog.count({ where: { action: 'REPORT_BY_USER_VIEW', actorId: admin.userId } })
      expect(countAfter).toBe(countBefore + 1)
    })
  })
})
