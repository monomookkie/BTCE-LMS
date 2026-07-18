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

  /** สร้าง PUBLISHED course และ return id — ต้องมี quiz ≥1 คำถามก่อน publish (2A)
   *  accessType=POSITION_BASED จะสร้าง+ผูก position ให้อัตโนมัติ (publish-gate ของ 2C-2 ต้องการ ≥1) */
  async function createPublishedCourse(
    adminCookies: string,
    accessType: 'PUBLIC' | 'POSITION_BASED' = 'PUBLIC',
  ): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/courses',
      headers: { cookie: adminCookies },
      payload: {
        titleEn: 'Test Course',
        categoryEn: 'Safety',
        accessType,
      },
    })
    const course = res.json<CourseAdminResponse>()

    await app.inject({
      method: 'POST',
      url: `/courses/${course.id}/quiz`,
      headers: { cookie: adminCookies },
      payload: { titleEn: 'Test Quiz', passScore: 80 },
    })
    await app.inject({
      method: 'POST',
      url: `/courses/${course.id}/quiz/questions`,
      headers: { cookie: adminCookies },
      payload: {
        textEn: 'Sample question?',
        options: [
          { textEn: 'Correct', isCorrect: true },
          { textEn: 'Wrong', isCorrect: false },
        ],
      },
    })

    if (accessType === 'POSITION_BASED') {
      const positionRes = await app.inject({
        method: 'POST',
        url: '/positions',
        headers: { cookie: adminCookies },
        payload: { nameEn: `Test Position ${Date.now()}-${Math.random()}` },
      })
      const position = positionRes.json<{ id: string }>()
      await app.inject({
        method: 'PUT',
        url: `/courses/${course.id}/positions`,
        headers: { cookie: adminCookies },
        payload: { positionIds: [position.id] },
      })
    }

    await app.inject({
      method: 'PATCH',
      url: `/courses/${course.id}/status`,
      headers: { cookie: adminCookies },
      payload: { status: 'PUBLISHED' },
    })

    return course.id
  }

  /** สร้าง PUBLISHED + POSITION_BASED course ผูก 1 position แล้ว return ทั้ง courseId + positionId
   *  (createPublishedCourse ไม่ return positionId — ต้องใช้ helper แยกสำหรับ test ที่ต้อง
   *  set user.positionId ให้ตรง/ไม่ตรงกับ position ของ course) */
  async function createPositionBasedCourse(adminCookies: string): Promise<{ courseId: string; positionId: string }> {
    const res = await app.inject({
      method: 'POST',
      url: '/courses',
      headers: { cookie: adminCookies },
      payload: { titleEn: 'Test Course', categoryEn: 'Safety', accessType: 'POSITION_BASED' },
    })
    const course = res.json<CourseAdminResponse>()

    await app.inject({
      method: 'POST',
      url: `/courses/${course.id}/quiz`,
      headers: { cookie: adminCookies },
      payload: { titleEn: 'Test Quiz', passScore: 80 },
    })
    await app.inject({
      method: 'POST',
      url: `/courses/${course.id}/quiz/questions`,
      headers: { cookie: adminCookies },
      payload: {
        textEn: 'Sample question?',
        options: [
          { textEn: 'Correct', isCorrect: true },
          { textEn: 'Wrong', isCorrect: false },
        ],
      },
    })

    const positionRes = await app.inject({
      method: 'POST',
      url: '/positions',
      headers: { cookie: adminCookies },
      payload: { nameEn: `Test Position ${Date.now()}-${Math.random()}` },
    })
    const position = positionRes.json<{ id: string }>()
    await app.inject({
      method: 'PUT',
      url: `/courses/${course.id}/positions`,
      headers: { cookie: adminCookies },
      payload: { positionIds: [position.id] },
    })

    await app.inject({
      method: 'PATCH',
      url: `/courses/${course.id}/status`,
      headers: { cookie: adminCookies },
      payload: { status: 'PUBLISHED' },
    })

    return { courseId: course.id, positionId: position.id }
  }

  /** Self-enroll user เข้า course (ด้วย cookie ของ user เอง) — return enrollment
   *  แทนที่ assignEnrollment (ADMIN) ที่ถูกลบใน 2C-3 — course ในไฟล์นี้ต้องเป็น PUBLIC
   *  ถึงจะ self-enroll ผ่านได้ตาม default ของ createPublishedCourse */
  async function assign(userCookies: string, courseId: string) {
    return app.inject({
      method: 'POST',
      url: '/enrollments/self',
      headers: { cookie: userCookies },
      payload: { courseId },
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

  // ─── Self-enroll: PUBLIC / POSITION_BASED matching (2C-3) ──────────────────

  describe('POST /enrollments/self — access-type gating', () => {
    it('PUBLIC course → any USER can self-enroll, status IN_PROGRESS, isMandatory=false', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { user, cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies, 'PUBLIC')

      const res = await assign(userCookies, courseId)
      expect(res.statusCode).toBe(201)

      const body = res.json<EnrollmentResponse>()
      expect(body.userId).toBe(user.id)
      expect(body.courseId).toBe(courseId)
      expect(body.courseTitle).toBe('Test Course')
      expect(body.status).toBe('IN_PROGRESS')
      expect(body.isMandatory).toBe(false)
    })

    it('POSITION_BASED course, user.positionId matches a linked position → 201, isMandatory=true', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { user, cookies: userCookies } = await setupUser()
      const { courseId, positionId } = await createPositionBasedCourse(adminCookies)
      await prisma.user.update({ where: { id: user.id }, data: { positionId } })

      const res = await assign(userCookies, courseId)
      expect(res.statusCode).toBe(201)
      expect(res.json<EnrollmentResponse>().isMandatory).toBe(true)
    })

    it('POSITION_BASED course, user.positionId set but does NOT match any linked position → 403', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { courseId } = await createPositionBasedCourse(adminCookies)

      // user มี position จริง แต่เป็นคนละตำแหน่งกับที่ course ผูกไว้
      const otherPosition = await prisma.position.create({ data: { nameEn: `Unrelated ${Date.now()}` } })
      const { user: mismatchedUser, cookies: mismatchedCookies } = await setupUser()
      await prisma.user.update({ where: { id: mismatchedUser.id }, data: { positionId: otherPosition.id } })

      const res = await assign(mismatchedCookies, courseId)
      expect(res.statusCode).toBe(403)
    })

    it('POSITION_BASED course, user.positionId = null (never assigned / "Others") → 403 with positionRequired message', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { cookies: userCookies } = await setupUser()
      const { courseId } = await createPositionBasedCourse(adminCookies)

      const res = await assign(userCookies, courseId)
      expect(res.statusCode).toBe(403)
    })

    it('duplicate active enrollment → 400', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies, 'PUBLIC')

      await assign(userCookies, courseId)
      const second = await assign(userCookies, courseId)
      expect(second.statusCode).toBe(400)
    })

    it('audit log ENROLLMENT_SELF written', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { user, cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies, 'PUBLIC')

      const res = await assign(userCookies, courseId)
      const enrollmentId = res.json<EnrollmentResponse>().id

      const log = await prisma.auditLog.findFirst({
        where: { action: 'ENROLLMENT_SELF', targetId: enrollmentId },
      })
      expect(log).not.toBeNull()
      expect(log!.actorId).toBe(user.id)
    })
  })

  // ─── Race closure: concurrent selfEnroll vs accessType change (2C-2 TOCTOU, closed in 2C-3) ──

  describe('Race closure — selfEnroll vs PATCH accessType', () => {
    it('concurrent self-enroll and accessType change never both succeed inconsistently', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies, 'PUBLIC')

      const [enrollRes, patchRes] = await Promise.all([
        app.inject({
          method: 'POST',
          url: '/enrollments/self',
          headers: { cookie: userCookies },
          payload: { courseId },
        }),
        app.inject({
          method: 'PATCH',
          url: `/courses/${courseId}`,
          headers: { cookie: adminCookies },
          payload: { accessType: 'POSITION_BASED' },
        }),
      ])

      // ห้ามเกิดทั้งคู่พร้อมกัน: ถ้า accessType เปลี่ยนสำเร็จ (200) แปลว่า transaction ของ
      // PATCH เห็น enrollment count = 0 ตอน commit — ซึ่งขัดกับ enroll ที่สำเร็จ (201) พร้อมกัน
      // ไม่ว่าฝั่งไหนจะ "ชนะ" ก่อน ผลลัพธ์ต้องสอดคล้องกันเสมอ (row lock ปิด race นี้ไว้)
      const bothSucceeded = patchRes.statusCode === 200 && enrollRes.statusCode === 201
      expect(bothSucceeded).toBe(false)
    })
  })

  // ─── Enrollment cutoff (2A: enrollmentCloseAt ปิดรับ enroll ใหม่) ──────────

  describe('Enrollment cutoff (enrollmentCloseAt)', () => {
    async function setEnrollmentCloseAt(adminCookies: string, courseId: string, isoDate: string) {
      const res = await app.inject({
        method: 'PATCH',
        url: `/courses/${courseId}`,
        headers: { cookie: adminCookies },
        payload: { enrollmentCloseAt: isoDate },
      })
      expect(res.statusCode).toBe(200)
    }

    it('selfEnroll: cutoff in the past → 400, enrollmentClosed message', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      await setEnrollmentCloseAt(adminCookies, courseId, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())

      const res = await assign(userCookies, courseId)
      expect(res.statusCode).toBe(400)
    })

    it('selfEnroll: cutoff in the future → still allowed', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      await setEnrollmentCloseAt(adminCookies, courseId, new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString())

      const res = await assign(userCookies, courseId)
      expect(res.statusCode).toBe(201)
    })

    it('selfEnroll: cutoff in the past → 400', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies, 'PUBLIC')
      await setEnrollmentCloseAt(adminCookies, courseId, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())

      const res = await app.inject({
        method: 'POST',
        url: '/enrollments/self',
        headers: { cookie: userCookies },
        payload: { courseId },
      })
      expect(res.statusCode).toBe(400)
    })

    it('already-enrolled user unaffected by a cutoff set after they enrolled', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)

      // enroll ก่อนตั้ง cutoff
      const assignRes = await assign(userCookies, courseId)
      expect(assignRes.statusCode).toBe(201)

      // ตั้ง cutoff ย้อนหลังทีหลัง
      await setEnrollmentCloseAt(adminCookies, courseId, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())

      // enrollment เดิมยังอยู่ + ดึงรายการ enrollment ของตัวเองได้ปกติ
      const meRes = await app.inject({
        method: 'GET',
        url: '/enrollments/me',
        headers: { cookie: userCookies },
      })
      expect(meRes.statusCode).toBe(200)
      const ids = meRes.json<{ data: EnrollmentResponse[] }>().data.map((e) => e.id)
      expect(ids).toContain(assignRes.json<EnrollmentResponse>().id)

      // แต่ user คนใหม่ enroll เพิ่มไม่ได้แล้ว
      const { cookies: otherUserCookies } = await setupUser()
      const secondAssign = await assign(otherUserCookies, courseId)
      expect(secondAssign.statusCode).toBe(400)
    })
  })

  // ─── Re-enroll หลัง cancel (critical: soft delete ต้องไม่ block @@unique) ──

  describe('Cancel → Re-enroll (soft delete uniqueness)', () => {
    it('assign → cancel → assign อีกครั้ง same user+course → 201 ไม่ติด constraint', async () => {
      const { admin, cookies: adminCookies } = await setupAdmin()
      const { cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)

      // Assign ครั้งแรก
      const first = await assign(userCookies, courseId)
      expect(first.statusCode).toBe(201)
      const firstId = first.json<EnrollmentResponse>().id

      // Cancel (soft delete)
      const cancelRes = await cancel(adminCookies, firstId)
      expect(cancelRes.statusCode).toBe(200)

      // ตรวจว่า record ยังอยู่ใน DB (soft delete)
      const dbRecord = await prisma.enrollment.findUnique({ where: { id: firstId } })
      expect(dbRecord?.deletedAt).not.toBeNull()

      // Assign ซ้ำคนเดิม course เดิม — ต้องผ่าน (ไม่ติด constraint)
      const second = await assign(userCookies, courseId)
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
      const { cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)

      await assign(userCookies, courseId)
      const duplicate = await assign(userCookies, courseId)
      expect(duplicate.statusCode).toBe(400)
    })
  })

  // ─── PATCH /enrollments/:id — ADMIN sets/clears dueAt (แทนที่ assignEnrollment ที่ลบใน 2C-3) ──

  describe('PATCH /enrollments/:id — dueAt', () => {
    it('ADMIN sets dueAt → 200, audit log ENROLLMENT_SET_DUE_DATE', async () => {
      const { admin, cookies: adminCookies } = await setupAdmin()
      const { cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const enrolled = (await assign(userCookies, courseId)).json<EnrollmentResponse>()

      const dueAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      const res = await app.inject({
        method: 'PATCH',
        url: `/enrollments/${enrolled.id}`,
        headers: { cookie: adminCookies },
        payload: { dueAt },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json<EnrollmentResponse>().dueAt).toBe(dueAt)

      const log = await prisma.auditLog.findFirst({
        where: { action: 'ENROLLMENT_SET_DUE_DATE', targetId: enrolled.id },
      })
      expect(log).not.toBeNull()
      expect(log!.actorId).toBe(admin.id)
    })

    it('ADMIN clears dueAt with null → 200, dueAt back to null', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const enrolled = (await assign(userCookies, courseId)).json<EnrollmentResponse>()

      const dueAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      await app.inject({
        method: 'PATCH',
        url: `/enrollments/${enrolled.id}`,
        headers: { cookie: adminCookies },
        payload: { dueAt },
      })

      const res = await app.inject({
        method: 'PATCH',
        url: `/enrollments/${enrolled.id}`,
        headers: { cookie: adminCookies },
        payload: { dueAt: null },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json<EnrollmentResponse>().dueAt).toBeNull()
    })

    it('USER cannot set dueAt → 403', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const enrolled = (await assign(userCookies, courseId)).json<EnrollmentResponse>()

      const res = await app.inject({
        method: 'PATCH',
        url: `/enrollments/${enrolled.id}`,
        headers: { cookie: userCookies },
        payload: { dueAt: new Date().toISOString() },
      })
      expect(res.statusCode).toBe(403)
    })

    it('non-existent enrollment → 404', async () => {
      const { cookies: adminCookies } = await setupAdmin()

      const res = await app.inject({
        method: 'PATCH',
        url: `/enrollments/${'c'.repeat(25)}`,
        headers: { cookie: adminCookies },
        payload: { dueAt: new Date().toISOString() },
      })
      expect(res.statusCode).toBe(404)
    })

    it('cancelled (soft-deleted) enrollment → 404', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const enrolled = (await assign(userCookies, courseId)).json<EnrollmentResponse>()
      await cancel(adminCookies, enrolled.id)

      const res = await app.inject({
        method: 'PATCH',
        url: `/enrollments/${enrolled.id}`,
        headers: { cookie: adminCookies },
        payload: { dueAt: new Date().toISOString() },
      })
      expect(res.statusCode).toBe(404)
    })
  })

  // ─── Self-enroll — auth guard ───────────────────────────────────────────────
  // PUBLIC/POSITION_BASED coverage moved to "POST /enrollments/self — access-type gating" above

  describe('POST /enrollments/self', () => {
    it('unauthenticated self-enroll → 401', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const courseId = await createPublishedCourse(adminCookies, 'PUBLIC')

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
      const { cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)

      const assigned = await assign(userCookies, courseId)
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
      const { cookies: otherUserCookies } = await setupUser()
      const { cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)

      const assigned = await assign(otherUserCookies, courseId)
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
      const { cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)

      const assigned = await assign(userCookies, courseId)
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

    /** เปิด material ผ่าน endpoint จริง แล้วเซ็ต activeSeconds ตรงใน DB เพื่อผ่านเกณฑ์เวลาขั้นต่ำ (LINK/PDF gate) โดยไม่ต้องรอจริง */
    async function openAndPassTimeGate(enrollmentId: string, materialId: string, userCookies: string) {
      await app.inject({
        method: 'POST',
        url: `/enrollments/${enrollmentId}/materials/${materialId}/open`,
        headers: { cookie: userCookies },
      })
      await prisma.materialProgress.updateMany({
        where: { enrollmentId, materialId },
        data: { activeSeconds: 301 },
      })
    }

    /** backdate openedAt แบบกำหนดวินาทีเอง — ใช้ทดสอบ time-ceiling sanity check ของ VIDEO progress */
    async function backdateOpenedAt(enrollmentId: string, materialId: string, secondsAgo: number) {
      await prisma.materialProgress.updateMany({
        where: { enrollmentId, materialId },
        data: { openedAt: new Date(Date.now() - secondsAgo * 1000) },
      })
    }

    it('mark material complete → progress updated (quiz นับเป็น 1 item ร่วมด้วย — 2C-6)', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addLinkMaterial(adminCookies, courseId)

      const enrolled = (await assign(userCookies, courseId)).json<EnrollmentResponse>()
      await openAndPassTimeGate(enrolled.id, matId, userCookies)

      const res = await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/complete-material/${matId}`,
        headers: { cookie: userCookies },
      })
      expect(res.statusCode).toBe(200)

      const body = res.json<EnrollmentResponse>()
      // 1 material (เสร็จ) + 1 quiz (ยังไม่สอบ) → 1/2 = 50% ไม่ใช่ 100% (2C-6: quiz นับรวมในตัวหาร)
      expect(body.progress).toBe(50)
      expect(body.completedMaterials).toContain(matId)
    })

    it('all materials done, quiz not yet passed → progress ไม่ถึง 100% (2C-6: quiz นับเป็น item ในตัวหาร ไม่ใช่แค่ gate สถานะ)', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addLinkMaterial(adminCookies, courseId)

      const enrolled = (await assign(userCookies, courseId)).json<EnrollmentResponse>()
      await openAndPassTimeGate(enrolled.id, matId, userCookies)

      const res = await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/complete-material/${matId}`,
        headers: { cookie: userCookies },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json<EnrollmentResponse>()
      // material เสร็จหมดแล้ว (1/1) แต่ quiz (added by createPublishedCourse) ยังไม่สอบผ่าน → 1/2 = 50%
      expect(body.progress).toBe(50)
      expect(body.status).not.toBe('COMPLETED')
    })

    it('deleted material excluded from total → progress can still reach 100%', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)

      // สร้าง 2 materials
      const mat1 = await addLinkMaterial(adminCookies, courseId)
      const mat2 = await addLinkMaterial(adminCookies, courseId)

      const enrolled = (await assign(userCookies, courseId)).json<EnrollmentResponse>()
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
      // mat2 ถูกลบ → material total = 1, completed = 1; รวม quiz อีก 1 item (ยังไม่สอบ) → total = 2, completed = 1 → 50%
      expect(res2.json<EnrollmentResponse>().progress).toBe(50)
      // quiz (added by createPublishedCourse) not yet passed → not COMPLETED yet
      expect(res2.json<EnrollmentResponse>().status).not.toBe('COMPLETED')
    })

    it('IDOR: USER complete-material ของ enrollment คนอื่น → 404', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { cookies: victimCookies } = await setupUser()
      const { cookies: attackerCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addLinkMaterial(adminCookies, courseId)

      const enrolled = (await assign(victimCookies, courseId)).json<EnrollmentResponse>()
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
      const { cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const otherCourseId = await createPublishedCourse(adminCookies)
      const otherMat = await addLinkMaterial(adminCookies, otherCourseId)

      const enrolled = (await assign(userCookies, courseId)).json<EnrollmentResponse>()

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
      const { cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addLinkMaterial(adminCookies, courseId)

      const enrolled = (await assign(userCookies, courseId)).json<EnrollmentResponse>()

      const res = await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/complete-material/${matId}`,
        headers: { cookie: userCookies },
      })
      expect(res.statusCode).toBe(400)
    })

    it('LINK: open แล้วรีบ complete ทันที (ยังไม่ถึงเวลาขั้นต่ำ) → 400', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addLinkMaterial(adminCookies, courseId)

      const enrolled = (await assign(userCookies, courseId)).json<EnrollmentResponse>()

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
      const { cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addLinkMaterial(adminCookies, courseId)

      const enrolled = (await assign(userCookies, courseId)).json<EnrollmentResponse>()
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
      const { cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addVideoMaterial(adminCookies, courseId)

      const enrolled = (await assign(userCookies, courseId)).json<EnrollmentResponse>()

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
      const { cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addVideoMaterial(adminCookies, courseId)

      const enrolled = (await assign(userCookies, courseId)).json<EnrollmentResponse>()

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
      const { cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addVideoMaterial(adminCookies, courseId)

      const enrolled = (await assign(userCookies, courseId)).json<EnrollmentResponse>()

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
      const { cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addVideoMaterial(adminCookies, courseId)

      const enrolled = (await assign(userCookies, courseId)).json<EnrollmentResponse>()

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
      const { cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addVideoMaterial(adminCookies, courseId)

      const enrolled = (await assign(userCookies, courseId)).json<EnrollmentResponse>()

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
      const { cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addVideoMaterial(adminCookies, courseId)

      const enrolled = (await assign(userCookies, courseId)).json<EnrollmentResponse>()

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
      const { cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addVideoMaterial(adminCookies, courseId)

      const enrolled = (await assign(userCookies, courseId)).json<EnrollmentResponse>()

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
      const { cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addVideoMaterial(adminCookies, courseId)

      const enrolled = (await assign(userCookies, courseId)).json<EnrollmentResponse>()

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

      // เซ็ต activeSeconds ให้ผ่าน 300 วิ — ต้องผ่านได้ทั้งที่ watchedPercent ยังเป็น 0
      await prisma.materialProgress.updateMany({
        where: { enrollmentId: enrolled.id, materialId: matId },
        data: { activeSeconds: 301 },
      })
      const afterWait = await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/complete-material/${matId}`,
        headers: { cookie: userCookies },
      })
      expect(afterWait.statusCode).toBe(200)
    })

    it('VIDEO: ไม่ embed-failed (ปกติ) → ยังคงใช้ percent-gate แม้เวลาผ่านไปนาน', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addVideoMaterial(adminCookies, courseId)

      const enrolled = (await assign(userCookies, courseId)).json<EnrollmentResponse>()

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
      const { cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addVideoMaterial(adminCookies, courseId)

      const enrolled = (await assign(userCookies, courseId)).json<EnrollmentResponse>()

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
      const { cookies: victimCookies } = await setupUser()
      const { cookies: attackerCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addVideoMaterial(adminCookies, courseId)

      const enrolled = (await assign(victimCookies, courseId)).json<EnrollmentResponse>()

      const res = await app.inject({
        method: 'POST',
        url: `/enrollments/${enrolled.id}/materials/${matId}/embed-failed`,
        headers: { cookie: attackerCookies },
      })
      expect(res.statusCode).toBe(404)
    })

    it('progress: ยิงก่อน open มาก่อน → 400', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addVideoMaterial(adminCookies, courseId)

      const enrolled = (await assign(userCookies, courseId)).json<EnrollmentResponse>()

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
      const { cookies: victimCookies } = await setupUser()
      const { cookies: attackerCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addLinkMaterial(adminCookies, courseId)

      const enrolled = (await assign(victimCookies, courseId)).json<EnrollmentResponse>()

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
      const { cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addLinkMaterial(adminCookies, courseId)

      const enrolled = (await assign(userCookies, courseId)).json<EnrollmentResponse>()

      const res = await app.inject({
        method: 'GET',
        url: `/enrollments/${enrolled.id}/materials/${matId}/progress`,
        headers: { cookie: userCookies },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ materialId: matId, openedAt: null, watchedPercent: 0, embedFailed: false, activeSeconds: 0 })
    })

    it('GET progress: หลัง open + progress → hydrate ค่าล่าสุด', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)
      const matId = await addVideoMaterial(adminCookies, courseId)

      const enrolled = (await assign(userCookies, courseId)).json<EnrollmentResponse>()

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

    // ─── POST /enrollments/:id/materials/:materialId/heartbeat (active-time gate) ──

    describe('POST /enrollments/:id/materials/:materialId/heartbeat', () => {
      it('สะสม activeSeconds จากหลาย heartbeat และผ่านเกณฑ์เมื่อครบ MIN_READ_SECONDS', async () => {
        const { cookies: adminCookies } = await setupAdmin()
        const { cookies: userCookies } = await setupUser()
        const courseId = await createPublishedCourse(adminCookies)
        const matId = await addLinkMaterial(adminCookies, courseId)
        const enrolled = (await assign(userCookies, courseId)).json<EnrollmentResponse>()

        await app.inject({
          method: 'POST',
          url: `/enrollments/${enrolled.id}/materials/${matId}/open`,
          headers: { cookie: userCookies },
        })

        const hb1 = await app.inject({
          method: 'POST',
          url: `/enrollments/${enrolled.id}/materials/${matId}/heartbeat`,
          headers: { cookie: userCookies },
          payload: { deltaSeconds: 5 },
        })
        expect(hb1.statusCode).toBe(200)
        expect(hb1.json<{ activeSeconds: number }>().activeSeconds).toBe(5)

        // ยังไม่ครบ 300 วิ — mark complete ต้องยัง 400
        const tooSoon = await app.inject({
          method: 'POST',
          url: `/enrollments/${enrolled.id}/complete-material/${matId}`,
          headers: { cookie: userCookies },
        })
        expect(tooSoon.statusCode).toBe(400)

        // deltaSeconds ต่อ heartbeat ถูกจำกัดที่ HEARTBEAT_MAX_DELTA_SECONDS — ส่งหลายครั้งแทนก้อนใหญ่ก้อนเดียว
        let lastActiveSeconds = 0
        for (let i = 0; i < 30; i++) {
          const hb = await app.inject({
            method: 'POST',
            url: `/enrollments/${enrolled.id}/materials/${matId}/heartbeat`,
            headers: { cookie: userCookies },
            payload: { deltaSeconds: 10 },
          })
          lastActiveSeconds = hb.json<{ activeSeconds: number }>().activeSeconds
        }
        expect(lastActiveSeconds).toBe(300)

        const nowOk = await app.inject({
          method: 'POST',
          url: `/enrollments/${enrolled.id}/complete-material/${matId}`,
          headers: { cookie: userCookies },
        })
        expect(nowOk.statusCode).toBe(200)
      })

      it('heartbeat ก่อนเปิด material → 400 (ต้อง /open มาก่อนเสมอ)', async () => {
        const { cookies: adminCookies } = await setupAdmin()
        const { cookies: userCookies } = await setupUser()
        const courseId = await createPublishedCourse(adminCookies)
        const matId = await addLinkMaterial(adminCookies, courseId)
        const enrolled = (await assign(userCookies, courseId)).json<EnrollmentResponse>()

        const res = await app.inject({
          method: 'POST',
          url: `/enrollments/${enrolled.id}/materials/${matId}/heartbeat`,
          headers: { cookie: userCookies },
          payload: { deltaSeconds: 5 },
        })
        expect(res.statusCode).toBe(400)
      })

      it('deltaSeconds เกินเพดาน HEARTBEAT_MAX_DELTA_SECONDS → 400 (กัน client ยิงค่าปลอมโตๆ)', async () => {
        const { cookies: adminCookies } = await setupAdmin()
        const { cookies: userCookies } = await setupUser()
        const courseId = await createPublishedCourse(adminCookies)
        const matId = await addLinkMaterial(adminCookies, courseId)
        const enrolled = (await assign(userCookies, courseId)).json<EnrollmentResponse>()

        await app.inject({
          method: 'POST',
          url: `/enrollments/${enrolled.id}/materials/${matId}/open`,
          headers: { cookie: userCookies },
        })

        const res = await app.inject({
          method: 'POST',
          url: `/enrollments/${enrolled.id}/materials/${matId}/heartbeat`,
          headers: { cookie: userCookies },
          payload: { deltaSeconds: 9999 },
        })
        expect(res.statusCode).toBe(400)
      })

      it('activeSeconds ไม่เกิน MIN_READ_SECONDS แม้ heartbeat สะสมเกิน (เพดานกันเผื่อ)', async () => {
        const { cookies: adminCookies } = await setupAdmin()
        const { cookies: userCookies } = await setupUser()
        const courseId = await createPublishedCourse(adminCookies)
        const matId = await addLinkMaterial(adminCookies, courseId)
        const enrolled = (await assign(userCookies, courseId)).json<EnrollmentResponse>()

        await app.inject({
          method: 'POST',
          url: `/enrollments/${enrolled.id}/materials/${matId}/open`,
          headers: { cookie: userCookies },
        })

        for (let i = 0; i < 40; i++) {
          await app.inject({
            method: 'POST',
            url: `/enrollments/${enrolled.id}/materials/${matId}/heartbeat`,
            headers: { cookie: userCookies },
            payload: { deltaSeconds: 10 },
          })
        }

        const res = await app.inject({
          method: 'GET',
          url: `/enrollments/${enrolled.id}/materials/${matId}/progress`,
          headers: { cookie: userCookies },
        })
        expect(res.json<{ activeSeconds: number }>().activeSeconds).toBe(300)
      })
    })
  })

  // ─── GET /enrollments/me ───────────────────────────────────────────────────

  describe('GET /enrollments/me', () => {
    it('returns only own enrollments + courseTitle populated', async () => {
      const { cookies: adminCookies } = await setupAdmin()
      const { user: u1, cookies: u1Cookies } = await setupUser()
      const { cookies: u2Cookies } = await setupUser()

      const course1 = await createPublishedCourse(adminCookies)
      const course2 = await createPublishedCourse(adminCookies)

      await assign(u1Cookies, course1)
      await assign(u2Cookies, course2)

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
      const { cookies: userCookies } = await setupUser()
      const courseId = await createPublishedCourse(adminCookies)

      const enrolled = (await assign(userCookies, courseId)).json<EnrollmentResponse>()
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
