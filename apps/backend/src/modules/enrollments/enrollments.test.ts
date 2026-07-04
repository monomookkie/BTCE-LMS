import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildTestApp, createUser, loginAs, prisma } from '../../test/helpers.js'
import type { TestApp } from '../../test/helpers.js'
import type { EnrollmentResponse, CourseAdminResponse } from '@btec-lms/shared'

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
        titleEn: 'Test Course',
        categoryEn: 'Safety',
        passScore: 80,
        allowSelfEnroll: selfEnroll,
      },
    })
    const course = res.json<CourseAdminResponse>()

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
      expect(body.courseTitle).toBe('Test Course')
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
      expect(body.courseTitle).toBe('Test Course')
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
        payload: { type: 'LINK', titleEn: 'Unit 1', url: 'https://example.com' },
      })
      return res.json<{ id: string }>().id
    }

    async function addVideoMaterial(adminCookies: string, courseId: string): Promise<string> {
      const res = await app.inject({
        method: 'POST',
        url: `/courses/${courseId}/materials/link`,
        headers: { cookie: adminCookies },
        payload: { type: 'VIDEO', titleEn: 'Video 1', url: 'https://youtube.com/watch?v=abc' },
      })
      return res.json<{ id: string }>().id
    }

    /** เปิด material ผ่าน endpoint จริง แล้ว backdate openedAt ใน DB เพื่อผ่านเกณฑ์เวลาขั้นต่ำ (LINK/PDF gate) โดยไม่ต้องรอจริง */
    async function openAndPassTimeGate(enrollmentId: string, materialId: string, userCookies: string) {
      await app.inject({
        method: 'POST',
        url: `/enrollments/${enrollmentId}/materials/${materialId}/open`,
        headers: { cookie: userCookies },
      })
      await prisma.materialProgress.updateMany({
        where: { enrollmentId, materialId },
        data: { openedAt: new Date(Date.now() - 301_000) },
      })
    }

    /** backdate openedAt แบบกำหนดวินาทีเอง — ใช้ทดสอบ time-ceiling sanity check ของ VIDEO progress */
    async function backdateOpenedAt(enrollmentId: string, materialId: string, secondsAgo: number) {
      await prisma.materialProgress.updateMany({
        where: { enrollmentId, materialId },
        data: { openedAt: new Date(Date.now() - secondsAgo * 1000) },
      })
    }

    it('mark material complete → progress updated', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { user, cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addLinkMaterial(adminCookies, courseId)

      const enrolled = (await assign(adminCookies, user.id, courseId)).json<EnrollmentResponse>()
      await openAndPassTimeGate(enrolled.id, matId, userCookies)

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
      await openAndPassTimeGate(enrolled.id, matId, userCookies)

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
      await openAndPassTimeGate(enrolled.id, mat1, userCookies)

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
      // ดังนั้นทดสอบด้วย mark mat1 อีกครั้ง (idempotent, ไม่ต้องผ่าน gate ซ้ำเพราะ complete แล้ว) เพื่อ trigger recalc
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
      const { user: victim, cookies: victimCookies } = await setupUser()
      const { cookies: attackerCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addLinkMaterial(adminCookies, courseId)

      const enrolled = (await assign(adminCookies, victim.id, courseId)).json<EnrollmentResponse>()
      await openAndPassTimeGate(enrolled.id, matId, victimCookies)

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

    // ─── Tier 2/3 view gate ───────────────────────────────────────────────────

    it('LINK: complete โดยไม่เคย open มาก่อน → 400', async () => {
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
      expect(res.statusCode).toBe(400)
    })

    it('LINK: open แล้วรีบ complete ทันที (ยังไม่ถึงเวลาขั้นต่ำ) → 400', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { user, cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addLinkMaterial(adminCookies, courseId)

      const enrolled = (await assign(adminCookies, user.id, courseId)).json<EnrollmentResponse>()

      await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/materials/${matId}/open`,
        headers: { cookie: userCookies },
      })

      const res = await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/complete-material/${matId}`,
        headers: { cookie: userCookies },
      })
      expect(res.statusCode).toBe(400)
    })

    it('open เป็น idempotent — เปิดซ้ำไม่ reset openedAt เดิม', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { user, cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addLinkMaterial(adminCookies, courseId)

      const enrolled = (await assign(adminCookies, user.id, courseId)).json<EnrollmentResponse>()
      await openAndPassTimeGate(enrolled.id, matId, userCookies)

      // เปิดซ้ำ — ต้องไม่ reset openedAt กลับเป็นปัจจุบัน
      const res = await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/materials/${matId}/open`,
        headers: { cookie: userCookies },
      })
      expect(res.statusCode).toBe(200)

      const completeRes = await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/complete-material/${matId}`,
        headers: { cookie: userCookies },
      })
      expect(completeRes.statusCode).toBe(200)
    })

    it('VIDEO: watchedPercent < 90 → complete 400', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { user, cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addVideoMaterial(adminCookies, courseId)

      const enrolled = (await assign(adminCookies, user.id, courseId)).json<EnrollmentResponse>()

      await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/materials/${matId}/open`,
        headers: { cookie: userCookies },
      })
      await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/materials/${matId}/progress`,
        headers: { cookie: userCookies },
        payload: { watchedPercent: 50 },
      })

      const res = await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/complete-material/${matId}`,
        headers: { cookie: userCookies },
      })
      expect(res.statusCode).toBe(400)
    })

    it('VIDEO: watchedPercent >= 90 → complete ผ่าน', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { user, cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addVideoMaterial(adminCookies, courseId)

      const enrolled = (await assign(adminCookies, user.id, courseId)).json<EnrollmentResponse>()

      await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/materials/${matId}/open`,
        headers: { cookie: userCookies },
      })
      // backdate ให้เวลาผ่านไปมากพอ — ไม่งั้น time-ceiling sanity check จะ clamp 95% ลงเพราะเพิ่ง open
      await backdateOpenedAt(enrolled.id, matId, 100_000)
      await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/materials/${matId}/progress`,
        headers: { cookie: userCookies },
        payload: { watchedPercent: 95, durationSeconds: 600 },
      })

      const res = await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/complete-material/${matId}`,
        headers: { cookie: userCookies },
      })
      expect(res.statusCode).toBe(200)
    })

    it('VIDEO: progress กันไถถอยหลัง — ส่งค่าน้อยกว่าเดิมไม่ลด watchedPercent', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { user, cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addVideoMaterial(adminCookies, courseId)

      const enrolled = (await assign(adminCookies, user.id, courseId)).json<EnrollmentResponse>()

      await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/materials/${matId}/open`,
        headers: { cookie: userCookies },
      })
      await backdateOpenedAt(enrolled.id, matId, 100_000)
      await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/materials/${matId}/progress`,
        headers: { cookie: userCookies },
        payload: { watchedPercent: 95, durationSeconds: 600 },
      })
      const res = await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/materials/${matId}/progress`,
        headers: { cookie: userCookies },
        payload: { watchedPercent: 10, durationSeconds: 600 },
      })
      expect(res.json<{ watchedPercent: number }>().watchedPercent).toBe(95)
    })

    // ─── Time-ceiling sanity check (กัน watchedPercent ปลอมที่ไม่ผ่านเวลาจริง) ─────

    it('VIDEO: ยิง watchedPercent สูงทันทีหลัง open (ไม่มีเวลาผ่านจริง) → ถูก clamp ตาม time-ceiling', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { user, cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addVideoMaterial(adminCookies, courseId)

      const enrolled = (await assign(adminCookies, user.id, courseId)).json<EnrollmentResponse>()

      await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/materials/${matId}/open`,
        headers: { cookie: userCookies },
      })
      // ไม่ backdate — ยิง progress แทบจะทันทีหลัง open (elapsed ~0s)
      const res = await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/materials/${matId}/progress`,
        headers: { cookie: userCookies },
        payload: { watchedPercent: 100, durationSeconds: 600 },
      })
      const watchedPercent = res.json<{ watchedPercent: number }>().watchedPercent
      // ceiling ≈ (elapsed/600)*100 + 10 buffer ≈ 10 — ต้องไม่ใช่ 100 ที่ client อ้าง
      expect(watchedPercent).toBeLessThan(20)
    })

    it('VIDEO: ไม่ส่ง durationSeconds เลย → ใช้ MIN_ASSUMED_VIDEO_DURATION_SECONDS (30s) เป็น fallback ceiling ที่เข้มกว่า', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { user, cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addVideoMaterial(adminCookies, courseId)

      const enrolled = (await assign(adminCookies, user.id, courseId)).json<EnrollmentResponse>()

      await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/materials/${matId}/open`,
        headers: { cookie: userCookies },
      })
      await backdateOpenedAt(enrolled.id, matId, 15) // elapsed = 15s

      const res = await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/materials/${matId}/progress`,
        headers: { cookie: userCookies },
        payload: { watchedPercent: 100 }, // ไม่ส่ง durationSeconds
      })
      const watchedPercent = res.json<{ watchedPercent: number }>().watchedPercent
      // fallback duration = 30s → ceiling = (15/30)*100+10 = 60 — ยังต่ำกว่า 100 ที่ client อ้าง
      expect(watchedPercent).toBeLessThanOrEqual(60)
      expect(watchedPercent).toBeGreaterThan(0)
    })

    it('VIDEO: durationSeconds ถูก lock ที่ค่าแรก — ส่งค่าใหม่ครั้งถัดไปไม่มีผลต่อ ceiling', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { user, cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addVideoMaterial(adminCookies, courseId)

      const enrolled = (await assign(adminCookies, user.id, courseId)).json<EnrollmentResponse>()

      await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/materials/${matId}/open`,
        headers: { cookie: userCookies },
      })
      await backdateOpenedAt(enrolled.id, matId, 300) // elapsed = 300s

      // ครั้งแรก: ล็อก duration = 600s → ceiling = (300/600)*100+10 = 60
      const first = await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/materials/${matId}/progress`,
        headers: { cookie: userCookies },
        payload: { watchedPercent: 40, durationSeconds: 600 },
      })
      expect(first.json<{ watchedPercent: number }>().watchedPercent).toBe(40)

      // ครั้งถัดไป: พยายามส่ง durationSeconds เล็กลงเพื่อปั่น ceiling ให้หลวมขึ้น — ต้องไม่มีผล (ยังใช้ 600 ที่ล็อกไว้)
      const second = await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/materials/${matId}/progress`,
        headers: { cookie: userCookies },
        payload: { watchedPercent: 90, durationSeconds: 5 },
      })
      // ถ้า duration ถูกปั่นสำเร็จ (ใช้ 5 แทน 600) ceiling จะทะลุ 100 ทันที ทำให้ผ่าน 90 ไปได้ — ต้องไม่เกิดขึ้น
      expect(second.json<{ watchedPercent: number }>().watchedPercent).toBe(60)
    })

    it('VIDEO: เวลาผ่านจริงเพียงพอ (elapsed สอดคล้องกับ % ที่อ้าง) → ไม่ถูก clamp', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { user, cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addVideoMaterial(adminCookies, courseId)

      const enrolled = (await assign(adminCookies, user.id, courseId)).json<EnrollmentResponse>()

      await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/materials/${matId}/open`,
        headers: { cookie: userCookies },
      })
      await backdateOpenedAt(enrolled.id, matId, 540) // 90% ของวิดีโอ 600 วิ

      const res = await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/materials/${matId}/progress`,
        headers: { cookie: userCookies },
        payload: { watchedPercent: 90, durationSeconds: 600 },
      })
      expect(res.json<{ watchedPercent: number }>().watchedPercent).toBe(90)
    })

    // ─── embed-failed fallback (YouTube โหลดไม่สำเร็จ → time-gate แบบ LINK) ────

    it('VIDEO: embed-failed → complete gate เปลี่ยนเป็น time-gate (300 วิ) แทน percent-gate', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { user, cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addVideoMaterial(adminCookies, courseId)

      const enrolled = (await assign(adminCookies, user.id, courseId)).json<EnrollmentResponse>()

      await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/materials/${matId}/open`,
        headers: { cookie: userCookies },
      })

      const embedFailedRes = await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/materials/${matId}/embed-failed`,
        headers: { cookie: userCookies },
      })
      expect(embedFailedRes.statusCode).toBe(200)
      expect(embedFailedRes.json<{ embedFailed: boolean }>().embedFailed).toBe(true)

      // watchedPercent ยังคง 0 (ไม่เคย track ได้) — ถ้าเป็น percent-gate ปกติจะ 400 ตลอดไป
      // แต่เพิ่งเปิดมา ไม่ถึง 300 วิ — ต้อง 400 (ตาม time-gate ไม่ใช่ percent-gate)
      const tooSoon = await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/complete-material/${matId}`,
        headers: { cookie: userCookies },
      })
      expect(tooSoon.statusCode).toBe(400)

      // backdate ให้ผ่าน 300 วิ — ต้องผ่านได้ทั้งที่ watchedPercent ยังเป็น 0
      await backdateOpenedAt(enrolled.id, matId, 301)
      const afterWait = await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/complete-material/${matId}`,
        headers: { cookie: userCookies },
      })
      expect(afterWait.statusCode).toBe(200)
    })

    it('VIDEO: ไม่ embed-failed (ปกติ) → ยังคงใช้ percent-gate แม้เวลาผ่านไปนาน', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { user, cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addVideoMaterial(adminCookies, courseId)

      const enrolled = (await assign(adminCookies, user.id, courseId)).json<EnrollmentResponse>()

      await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/materials/${matId}/open`,
        headers: { cookie: userCookies },
      })
      await backdateOpenedAt(enrolled.id, matId, 10_000) // เวลาผ่านมากพอสำหรับ time-gate แล้ว

      // ไม่เคย mark embed-failed, watchedPercent ยังเป็น 0 — ต้องยังโดน percent-gate บล็อกอยู่
      const res = await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/complete-material/${matId}`,
        headers: { cookie: userCookies },
      })
      expect(res.statusCode).toBe(400)
    })

    it('embed-failed: ยิงก่อน open มาก่อน → upsert สร้าง progress row ให้เอง (กัน race กับ /open)', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { user, cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addVideoMaterial(adminCookies, courseId)

      const enrolled = (await assign(adminCookies, user.id, courseId)).json<EnrollmentResponse>()

      const res = await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/materials/${matId}/embed-failed`,
        headers: { cookie: userCookies },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json<{ embedFailed: boolean; openedAt: string | null }>()
      expect(body.embedFailed).toBe(true)
      expect(body.openedAt).not.toBeNull()
    })

    it('IDOR: embed-failed ของ enrollment คนอื่น → 404', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { user: victim } = await setupUser()
      const { cookies: attackerCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addVideoMaterial(adminCookies, courseId)

      const enrolled = (await assign(adminCookies, victim.id, courseId)).json<EnrollmentResponse>()

      const res = await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/materials/${matId}/embed-failed`,
        headers: { cookie: attackerCookies },
      })
      expect(res.statusCode).toBe(404)
    })

    it('progress: ยิงก่อน open มาก่อน → 400', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { user, cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addVideoMaterial(adminCookies, courseId)

      const enrolled = (await assign(adminCookies, user.id, courseId)).json<EnrollmentResponse>()

      const res = await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/materials/${matId}/progress`,
        headers: { cookie: userCookies },
        payload: { watchedPercent: 50 },
      })
      expect(res.statusCode).toBe(400)
    })

    it('IDOR: open/progress ของ enrollment คนอื่น → 404', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { user: victim } = await setupUser()
      const { cookies: attackerCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addLinkMaterial(adminCookies, courseId)

      const enrolled = (await assign(adminCookies, victim.id, courseId)).json<EnrollmentResponse>()

      const openRes = await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/materials/${matId}/open`,
        headers: { cookie: attackerCookies },
      })
      expect(openRes.statusCode).toBe(404)

      const progressRes = await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/materials/${matId}/progress`,
        headers: { cookie: attackerCookies },
        payload: { watchedPercent: 50 },
      })
      expect(progressRes.statusCode).toBe(404)

      const getRes = await app.inject({
        method: 'GET',
        url: `/enrollments/${enrolled.id}/materials/${matId}/progress`,
        headers: { cookie: attackerCookies },
      })
      expect(getRes.statusCode).toBe(404)
    })

    it('GET progress: ยังไม่เคยเปิด → default { watchedPercent: 0, openedAt: null }', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { user, cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addLinkMaterial(adminCookies, courseId)

      const enrolled = (await assign(adminCookies, user.id, courseId)).json<EnrollmentResponse>()

      const res = await app.inject({
        method: 'GET',
        url: `/enrollments/${enrolled.id}/materials/${matId}/progress`,
        headers: { cookie: userCookies },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ materialId: matId, openedAt: null, watchedPercent: 0, embedFailed: false })
    })

    it('GET progress: หลัง open + progress → hydrate ค่าล่าสุด', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { user, cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addVideoMaterial(adminCookies, courseId)

      const enrolled = (await assign(adminCookies, user.id, courseId)).json<EnrollmentResponse>()

      await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/materials/${matId}/open`,
        headers: { cookie: userCookies },
      })
      // backdate ให้เวลาผ่านไปมากพอ — ไม่งั้น time-ceiling sanity check จะ clamp 42% ลงเพราะเพิ่ง open
      await backdateOpenedAt(enrolled.id, matId, 100_000)
      await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/materials/${matId}/progress`,
        headers: { cookie: userCookies },
        payload: { watchedPercent: 42, durationSeconds: 600 },
      })

      const res = await app.inject({
        method: 'GET',
        url: `/enrollments/${enrolled.id}/materials/${matId}/progress`,
        headers: { cookie: userCookies },
      })
      const body = res.json<{ materialId: string; openedAt: string | null; watchedPercent: number }>()
      expect(body.watchedPercent).toBe(42)
      expect(body.openedAt).not.toBeNull()
    })
  })

  // ─── GET /enrollments/me ───────────────────────────────────────────────────

  describe('GET /enrollments/me', () => {
    it('returns only own enrollments + courseTitle populated', async () => {
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
      expect(body.data[0]!.courseTitle).toBe('Test Course')
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
