import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildTestApp, createUser, loginAs, prisma } from '../../test/helpers.js'
import type { TestApp } from '../../test/helpers.js'
import type { EnrollmentResponse, CourseResponse } from '@btec-lms/shared'

describe('Enrollments module', () => {
  let app: TestApp

  beforeAll(async () => {
    app = await buildTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  // ─── helpers ───────────────────────────────────────────────────────────────

  async function setupAdmin() {
    const { user, plainPassword } = await createUser({ role: 'ADMIN' })
    const { cookies } = await loginAs(app, user.email, plainPassword)
    return { admin: user, cookies }
  }

  async function setupUser() {
    const { user, plainPassword } = await createUser({ role: 'USER' })
    const { cookies } = await loginAs(app, user.email, plainPassword)
    return { user, cookies }
  }

  /** สร้าง PUBLISHED course และ return id */
  async function createPublishedCourse(adminCookies: string, selfEnroll = false): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/courses',
      headers: { cookie: adminCookies },
      payload: {
        title: 'Test Course',
        category: 'Safety',
        passScore: 80,
        allowSelfEnroll: selfEnroll,
      },
    })
    const course = res.json<CourseResponse>()

    await app.inject({
      method: 'PATCH',
      url: `/courses/${course.id}/status`,
      headers: { cookie: adminCookies },
      payload: { status: 'PUBLISHED' },
    })

    return course.id
  }

  /** Assign user เข้า course — return enrollment */
  async function assign(adminCookies: string, userId: string, courseId: string) {
    return app.inject({
      method: 'POST',
      url: '/enrollments',
      headers: { cookie: adminCookies },
      payload: { userId, courseId },
    })
  }

  /** Cancel enrollment */
  async function cancel(adminCookies: string, enrollmentId: string) {
    return app.inject({
      method: 'DELETE',
      url: `/enrollments/${enrollmentId}`,
      headers: { cookie: adminCookies },
    })
  }

  // ─── Assign ────────────────────────────────────────────────────────────────

  describe('POST /enrollments (assign)', () => {
    it('ADMIN assigns user → 201, status ASSIGNED', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { user } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)

      const res = await assign(adminCookies, user.id, courseId)
      expect(res.statusCode).toBe(201)

      const body = res.json<EnrollmentResponse>()
      expect(body.userId).toBe(user.id)
      expect(body.courseId).toBe(courseId)
      expect(body.status).toBe('ASSIGNED')
      expect(body.progress).toBe(0)
    })

    it('USER cannot assign → 403', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { user, cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)

      const res = await app.inject({
        method: 'POST',
        url: '/enrollments',
        headers: { cookie: userCookies },
        payload: { userId: user.id, courseId },
      })
      expect(res.statusCode).toBe(403)
    })

    it('duplicate active enrollment → 400', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { user } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)

      await assign(adminCookies, user.id, courseId)
      const second = await assign(adminCookies, user.id, courseId)
      expect(second.statusCode).toBe(400)
    })

    it('audit log ENROLLMENT_ASSIGN written', async () => {
      const { admin, cookies: adminCookies } = await setupAdmin()
      const { user } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)

      const res = await assign(adminCookies, user.id, courseId)
      const enrollmentId = res.json<EnrollmentResponse>().id

      const log = await prisma.auditLog.findFirst({
        where: { action: 'ENROLLMENT_ASSIGN', targetId: enrollmentId },
      })
      expect(log).not.toBeNull()
      expect(log!.actorId).toBe(admin.id)
    })
  })

  // ─── Re-enroll หลัง cancel (critical: soft delete ต้องไม่ block @@unique) ──

  describe('Cancel → Re-enroll (soft delete uniqueness)', () => {
    it('assign → cancel → assign อีกครั้ง same user+course → 201 ไม่ติด constraint', async () => {
      const { admin, cookies: adminCookies } = await setupAdmin()
      const { user } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)

      // Assign ครั้งแรก
      const first = await assign(adminCookies, user.id, courseId)
      expect(first.statusCode).toBe(201)
      const firstId = first.json<EnrollmentResponse>().id

      // Cancel (soft delete)
      const cancelRes = await cancel(adminCookies, firstId)
      expect(cancelRes.statusCode).toBe(200)

      // ตรวจว่า record ยังอยู่ใน DB (soft delete)
      const dbRecord = await prisma.enrollment.findUnique({ where: { id: firstId } })
      expect(dbRecord?.deletedAt).not.toBeNull()

      // Assign ซ้ำคนเดิม course เดิม — ต้องผ่าน (ไม่ติด constraint)
      const second = await assign(adminCookies, user.id, courseId)
      expect(second.statusCode).toBe(201)
      const secondId = second.json<EnrollmentResponse>().id

      // ต้องเป็น record ใหม่
      expect(secondId).not.toBe(firstId)

      // audit log cancel ต้องบันทึก
      const cancelLog = await prisma.auditLog.findFirst({
        where: { action: 'ENROLLMENT_CANCEL', targetId: firstId },
      })
      expect(cancelLog).not.toBeNull()
      expect(cancelLog!.actorId).toBe(admin.id)
    })

    it('active enrollment ยังอยู่ → assign ซ้ำ → 400 (app-level check)', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { user } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)

      await assign(adminCookies, user.id, courseId)
      const duplicate = await assign(adminCookies, user.id, courseId)
      expect(duplicate.statusCode).toBe(400)
    })
  })

  // ─── Self-enroll ────────────────────────────────────────────────────────────

  describe('POST /enrollments/self', () => {
    it('USER self-enroll allowSelfEnroll=true → 201, status IN_PROGRESS', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { user: selfUser, cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies, true)

      const res = await app.inject({
        method: 'POST',
        url: '/enrollments/self',
        headers: { cookie: userCookies },
        payload: { courseId },
      })
      expect(res.statusCode).toBe(201)

      const body = res.json<EnrollmentResponse>()
      expect(body.userId).toBe(selfUser.id)
      expect(body.status).toBe('IN_PROGRESS')
    })

    it('USER self-enroll allowSelfEnroll=false → 403', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies, false)

      const res = await app.inject({
        method: 'POST',
        url: '/enrollments/self',
        headers: { cookie: userCookies },
        payload: { courseId },
      })
      expect(res.statusCode).toBe(403)
    })

    it('unauthenticated self-enroll → 401', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const courseId = await createPublishedCourse(adminCookies, true)

      const res = await app.inject({
        method: 'POST',
        url: '/enrollments/self',
        payload: { courseId },
      })
      expect(res.statusCode).toBe(401)
    })
  })

  // ─── IDOR guard ─────────────────────────────────────────────────────────────

  describe('IDOR guard — GET /enrollments/:id', () => {
    it('USER gets own enrollment → 200', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { user, cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)

      const assigned = await assign(adminCookies, user.id, courseId)
      const enrollmentId = assigned.json<EnrollmentResponse>().id

      const res = await app.inject({
        method: 'GET',
        url: `/enrollments/${enrollmentId}`,
        headers: { cookie: userCookies },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json<EnrollmentResponse>().id).toBe(enrollmentId)
    })

    it("USER gets other user's enrollment → 404 (not 403, gating enumeration)", async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { user: otherUser } = await setupUser()
      const { cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)

      const assigned = await assign(adminCookies, otherUser.id, courseId)
      const enrollmentId = assigned.json<EnrollmentResponse>().id

      const res = await app.inject({
        method: 'GET',
        url: `/enrollments/${enrollmentId}`,
        headers: { cookie: userCookies },
      })
      expect(res.statusCode).toBe(404)
    })

    it('ADMIN gets any enrollment → 200 + logs ENROLLMENT_VIEW', async () => {
      const { admin, cookies: adminCookies } = await setupAdmin()
      const { user } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)

      const assigned = await assign(adminCookies, user.id, courseId)
      const enrollmentId = assigned.json<EnrollmentResponse>().id

      const res = await app.inject({
        method: 'GET',
        url: `/enrollments/${enrollmentId}`,
        headers: { cookie: adminCookies },
      })
      expect(res.statusCode).toBe(200)

      const log = await prisma.auditLog.findFirst({
        where: { action: 'ENROLLMENT_VIEW', targetId: enrollmentId },
      })
      expect(log).not.toBeNull()
      expect(log!.actorId).toBe(admin.id)
    })
  })

  // ─── Progress — complete-material ──────────────────────────────────────────

  describe('POST /enrollments/:id/complete-material/:materialId', () => {
    async function addLinkMaterial(adminCookies: string, courseId: string): Promise<string> {
      const res = await app.inject({
        method: 'POST',
        url: `/courses/${courseId}/materials/link`,
        headers: { cookie: adminCookies },
        payload: { type: 'LINK', title: 'Unit 1', url: 'https://example.com' },
      })
      return res.json<{ id: string }>().id
    }

    it('mark material complete → progress updated', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { user, cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addLinkMaterial(adminCookies, courseId)

      const enrolled = (await assign(adminCookies, user.id, courseId)).json<EnrollmentResponse>()

      const res = await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/complete-material/${matId}`,
        headers: { cookie: userCookies },
      })
      expect(res.statusCode).toBe(200)

      const body = res.json<EnrollmentResponse>()
      expect(body.progress).toBe(100)
      expect(body.completedMaterials).toContain(matId)
    })

    it('course no quiz + all materials done → status COMPLETED', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { user, cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addLinkMaterial(adminCookies, courseId)

      const enrolled = (await assign(adminCookies, user.id, courseId)).json<EnrollmentResponse>()

      const res = await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/complete-material/${matId}`,
        headers: { cookie: userCookies },
      })
      expect(res.json<EnrollmentResponse>().status).toBe('COMPLETED')
    })

    it('deleted material excluded from total → progress can still reach 100%', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { user, cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)

      // สร้าง 2 materials
      const mat1 = await addLinkMaterial(adminCookies, courseId)
      const mat2 = await addLinkMaterial(adminCookies, courseId)

      const enrolled = (await assign(adminCookies, user.id, courseId)).json<EnrollmentResponse>()

      // เรียนจบ mat1
      await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/complete-material/${mat1}`,
        headers: { cookie: userCookies },
      })

      // admin ลบ mat2 (soft delete)
      await app.inject({
        method: 'DELETE',
        url: `/courses/${courseId}/materials/${mat2}`,
        headers: { cookie: adminCookies },
      })

      // mark mat1 อีกครั้ง (หรือตรวจ progress จาก DB โดยตรง)
      // recalculate ถูก trigger ตอน mark complete ครั้งแรก
      // mat2 ถูกลบหลัง — progress จะ recalculate เมื่อ mark material ครั้งถัดไป
      // ดังนั้นทดสอบด้วย mark mat1 อีกครั้ง (idempotent) เพื่อ trigger recalc
      const res2 = await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/complete-material/${mat1}`,
        headers: { cookie: userCookies },
      })
      expect(res2.statusCode).toBe(200)
      // mat2 ถูกลบ → total = 1, completed = 1 → progress = 100
      expect(res2.json<EnrollmentResponse>().progress).toBe(100)
      expect(res2.json<EnrollmentResponse>().status).toBe('COMPLETED')
    })

    it('IDOR: USER complete-material ของ enrollment คนอื่น → 404', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { user: victim } = await setupUser()
      const { cookies: attackerCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addLinkMaterial(adminCookies, courseId)

      const enrolled = (await assign(adminCookies, victim.id, courseId)).json<EnrollmentResponse>()

      const res = await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/complete-material/${matId}`,
        headers: { cookie: attackerCookies },
      })
      expect(res.statusCode).toBe(404)
    })

    it('mark material from wrong course → 404', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { user, cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const otherCourseId = await createPublishedCourse(adminCookies)
      const otherMat = await addLinkMaterial(adminCookies, otherCourseId)

      const enrolled = (await assign(adminCookies, user.id, courseId)).json<EnrollmentResponse>()

      const res = await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/complete-material/${otherMat}`,
        headers: { cookie: userCookies },
      })
      expect(res.statusCode).toBe(404)
    })
  })

  // ─── GET /enrollments/me ───────────────────────────────────────────────────

  describe('GET /enrollments/me', () => {
    it('returns only own enrollments', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { user: u1, cookies: u1Cookies } = await setupUser()
      const { user: u2 } = await setupUser()

      const course1 = await createPublishedCourse(adminCookies)
      const course2 = await createPublishedCourse(adminCookies)

      await assign(adminCookies, u1.id, course1)
      await assign(adminCookies, u2.id, course2)

      const res = await app.inject({
        method: 'GET',
        url: '/enrollments/me',
        headers: { cookie: u1Cookies },
      })
      expect(res.statusCode).toBe(200)

      const body = res.json<{ data: EnrollmentResponse[] }>()
      expect(body.data.length).toBe(1)
      expect(body.data[0]!.userId).toBe(u1.id)
    })

    it('cancelled enrollment not returned in /me', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { user, cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)

      const enrolled = (await assign(adminCookies, user.id, courseId)).json<EnrollmentResponse>()
      await cancel(adminCookies, enrolled.id)

      const res = await app.inject({
        method: 'GET',
        url: '/enrollments/me',
        headers: { cookie: userCookies },
      })
      expect(res.json<{ data: EnrollmentResponse[] }>().data.length).toBe(0)
    })
  })
})
