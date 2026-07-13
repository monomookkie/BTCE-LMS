import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildTestApp, createUser, loginAs, prisma } from '../../test/helpers.js'
import type { TestApp } from '../../test/helpers.js'
import type { CourseAdminResponse, CoursePublicResponse } from '@btec-lms/shared'

describe('Courses module', () => {
  let app: TestApp

  beforeAll(async () => {
    app = await buildTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  // ─── helper ──────────────────────────────────────────────────────────────

  async function createCourseAs(cookies: string, overrides: Record<string, unknown> = {}) {
    return app.inject({
      method: 'POST',
      url: '/courses',
      headers: { cookie: cookies },
      payload: {
        titleEn: 'Test Course',
        categoryEn: 'Safety',
        ...overrides,
      },
    })
  }

  /** เพิ่ม quiz + 1 คำถามให้ course — จำเป็นก่อน publish เสมอ (2A invariant) */
  async function addQuizWithQuestion(cookies: string, courseId: string) {
    await app.inject({
      method: 'POST',
      url: `/courses/${courseId}/quiz`,
      headers: { cookie: cookies },
      payload: { titleEn: 'Test Quiz', passScore: 80 },
    })
    await app.inject({
      method: 'POST',
      url: `/courses/${courseId}/quiz/questions`,
      headers: { cookie: cookies },
      payload: {
        textEn: 'Sample question?',
        options: [
          { textEn: 'Correct', isCorrect: true },
          { textEn: 'Wrong', isCorrect: false },
        ],
      },
    })
  }

  /** สร้าง course + quiz + publish — helper รวมสำหรับ test ที่ต้องการ PUBLISHED course */
  async function createPublishedCourseAs(cookies: string, overrides: Record<string, unknown> = {}) {
    const created = (await createCourseAs(cookies, overrides)).json<CourseAdminResponse>()
    await addQuizWithQuestion(cookies, created.id)
    await app.inject({
      method: 'PATCH',
      url: `/courses/${created.id}/status`,
      headers: { cookie: cookies },
      payload: { status: 'PUBLISHED' },
    })
    return created
  }

  // ─── RBAC ─────────────────────────────────────────────────────────────────

  describe('RBAC', () => {
    it('USER role POST /courses → 403', async () => {
      const { user, plainPassword } = await createUser({ role: 'USER' })
      const { cookies } = await loginAs(app, user.email, plainPassword)

      const res = await createCourseAs(cookies)
      expect(res.statusCode).toBe(403)
    })

    it('ADMIN role POST /courses → 201', async () => {
      const { user, plainPassword } = await createUser({ role: 'ADMIN' })
      const { cookies } = await loginAs(app, user.email, plainPassword)

      const res = await createCourseAs(cookies)
      expect(res.statusCode).toBe(201)
    })

    it('USER role PATCH /courses/:id/status → 403 (ADMIN only)', async () => {
      const { user: admin, plainPassword: adminPw } = await createUser({ role: 'ADMIN' })
      const { cookies: adminCookies } = await loginAs(app, admin.email, adminPw)
      const courseRes = await createCourseAs(adminCookies)
      const courseId = courseRes.json<CourseAdminResponse>().id

      const { user, plainPassword } = await createUser({ role: 'USER' })
      const { cookies } = await loginAs(app, user.email, plainPassword)

      const res = await app.inject({
        method: 'PATCH',
        url: `/courses/${courseId}/status`,
        headers: { cookie: cookies },
        payload: { status: 'PUBLISHED' },
      })
      expect(res.statusCode).toBe(403)
    })

    it('USER role PUT /courses/:id/positions → 403 (ADMIN only)', async () => {
      const { user: admin, plainPassword: adminPw } = await createUser({ role: 'ADMIN' })
      const { cookies: adminCookies } = await loginAs(app, admin.email, adminPw)
      const courseRes = await createCourseAs(adminCookies, { accessType: 'POSITION_BASED' })
      const courseId = courseRes.json<CourseAdminResponse>().id

      const { user, plainPassword } = await createUser({ role: 'USER' })
      const { cookies } = await loginAs(app, user.email, plainPassword)

      const res = await app.inject({
        method: 'PUT',
        url: `/courses/${courseId}/positions`,
        headers: { cookie: cookies },
        payload: { positionIds: [] },
      })
      expect(res.statusCode).toBe(403)
    })

    it('unauthenticated PUT /courses/:id/positions → 401', async () => {
      const { user: admin, plainPassword: adminPw } = await createUser({ role: 'ADMIN' })
      const { cookies: adminCookies } = await loginAs(app, admin.email, adminPw)
      const courseRes = await createCourseAs(adminCookies, { accessType: 'POSITION_BASED' })
      const courseId = courseRes.json<CourseAdminResponse>().id

      const res = await app.inject({
        method: 'PUT',
        url: `/courses/${courseId}/positions`,
        payload: { positionIds: [] },
      })
      expect(res.statusCode).toBe(401)
    })
  })

  // ─── Course CRUD ───────────────────────────────────────────────────────────

  describe('Course CRUD', () => {
    it('POST /courses → creates with DRAFT status + audit log', async () => {
      const { user, plainPassword } = await createUser({ role: 'ADMIN' })
      const { cookies } = await loginAs(app, user.email, plainPassword)

      const res = await createCourseAs(cookies, {
        titleEn: 'Blood Donation Fundamentals',
        categoryEn: 'Clinical',
        expiryMonths: 12,
      })

      expect(res.statusCode).toBe(201)
      const body = res.json<CourseAdminResponse>()
      expect(body.status).toBe('DRAFT')
      expect(body.expiryMonths).toBe(12)
      expect(body.createdById).toBe(user.id)

      const log = await prisma.auditLog.findFirst({
        where: { action: 'COURSE_CREATE', targetId: body.id },
      })
      expect(log).not.toBeNull()
      expect(log!.actorId).toBe(user.id)
    })

    it('GET /courses/:id → returns course', async () => {
      const { user, plainPassword } = await createUser({ role: 'ADMIN' })
      const { cookies } = await loginAs(app, user.email, plainPassword)
      const created = (await createCourseAs(cookies)).json<CourseAdminResponse>()

      const res = await app.inject({
        method: 'GET',
        url: `/courses/${created.id}`,
        headers: { cookie: cookies },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json<CourseAdminResponse>().id).toBe(created.id)
    })

    it('PATCH /courses/:id → updates metadata + increments version', async () => {
      const { user, plainPassword } = await createUser({ role: 'ADMIN' })
      const { cookies } = await loginAs(app, user.email, plainPassword)
      const created = (await createCourseAs(cookies)).json<CourseAdminResponse>()

      const res = await app.inject({
        method: 'PATCH',
        url: `/courses/${created.id}`,
        headers: { cookie: cookies },
        payload: { titleEn: 'Updated Title', expiryMonths: 6 },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json<CourseAdminResponse>()
      expect(body.title).toBe('Updated Title') // localized field
      expect(body.expiryMonths).toBe(6)
      expect(body.version).toBe(created.version + 1)

      const log = await prisma.auditLog.findFirst({
        where: { action: 'COURSE_UPDATE', targetId: created.id },
      })
      expect(log).not.toBeNull()
    })
  })

  // ─── Status transitions ────────────────────────────────────────────────────

  describe('Status transitions', () => {
    it('ADMIN PATCH /courses/:id/status → PUBLISHED, audit logs COURSE_PUBLISH', async () => {
      const { user, plainPassword } = await createUser({ role: 'ADMIN' })
      const { cookies } = await loginAs(app, user.email, plainPassword)
      const created = (await createCourseAs(cookies)).json<CourseAdminResponse>()
      await addQuizWithQuestion(cookies, created.id)

      const res = await app.inject({
        method: 'PATCH',
        url: `/courses/${created.id}/status`,
        headers: { cookie: cookies },
        payload: { status: 'PUBLISHED' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json<CourseAdminResponse>().status).toBe('PUBLISHED')

      const log = await prisma.auditLog.findFirst({
        where: { action: 'COURSE_PUBLISH', targetId: created.id },
      })
      expect(log).not.toBeNull()
    })

    it('publish without a quiz → 400 (2A: every published course must have a quiz)', async () => {
      const { user, plainPassword } = await createUser({ role: 'ADMIN' })
      const { cookies } = await loginAs(app, user.email, plainPassword)
      const created = (await createCourseAs(cookies)).json<CourseAdminResponse>()

      const res = await app.inject({
        method: 'PATCH',
        url: `/courses/${created.id}/status`,
        headers: { cookie: cookies },
        payload: { status: 'PUBLISHED' },
      })
      expect(res.statusCode).toBe(400)
    })

    it('publish with a quiz that has 0 questions → 400', async () => {
      const { user, plainPassword } = await createUser({ role: 'ADMIN' })
      const { cookies } = await loginAs(app, user.email, plainPassword)
      const created = (await createCourseAs(cookies)).json<CourseAdminResponse>()

      await app.inject({
        method: 'POST',
        url: `/courses/${created.id}/quiz`,
        headers: { cookie: cookies },
        payload: { titleEn: 'Empty Quiz', passScore: 80 },
      })

      const res = await app.inject({
        method: 'PATCH',
        url: `/courses/${created.id}/status`,
        headers: { cookie: cookies },
        payload: { status: 'PUBLISHED' },
      })
      expect(res.statusCode).toBe(400)
    })

    it('publish with a quiz that has >=1 question → 200', async () => {
      const { user, plainPassword } = await createUser({ role: 'ADMIN' })
      const { cookies } = await loginAs(app, user.email, plainPassword)
      const created = await createPublishedCourseAs(cookies)

      const res = await app.inject({
        method: 'GET',
        url: `/courses/${created.id}`,
        headers: { cookie: cookies },
      })
      expect(res.json<CourseAdminResponse>().status).toBe('PUBLISHED')
    })

    it('cannot change status of ARCHIVED course → 400', async () => {
      const { user, plainPassword } = await createUser({ role: 'ADMIN' })
      const { cookies } = await loginAs(app, user.email, plainPassword)
      const created = (await createCourseAs(cookies)).json<CourseAdminResponse>()

      // DRAFT → ARCHIVED
      await app.inject({
        method: 'PATCH',
        url: `/courses/${created.id}/status`,
        headers: { cookie: cookies },
        payload: { status: 'ARCHIVED' },
      })

      // ARCHIVED → PUBLISHED ต้อง fail
      const res = await app.inject({
        method: 'PATCH',
        url: `/courses/${created.id}/status`,
        headers: { cookie: cookies },
        payload: { status: 'PUBLISHED' },
      })
      expect(res.statusCode).toBe(400)
    })
  })

  // ─── USER visibility — เห็นเฉพาะ PUBLISHED ────────────────────────────────

  describe('USER visibility (PUBLISHED only)', () => {
    it('USER GET /courses → เห็นเฉพาะ PUBLISHED ไม่เห็น DRAFT/ARCHIVED', async () => {
      const { user: admin, plainPassword: adminPw } = await createUser({ role: 'ADMIN' })
      const { cookies: adminCookies } = await loginAs(app, admin.email, adminPw)

      // สร้าง 3 courses: DRAFT, PUBLISHED, ARCHIVED
      const draft = (await createCourseAs(adminCookies, { titleEn: 'Draft Course' })).json<CourseAdminResponse>()
      const published = (await createCourseAs(adminCookies, { titleEn: 'Published Course' })).json<CourseAdminResponse>()
      const archived = (await createCourseAs(adminCookies, { titleEn: 'Archived Course' })).json<CourseAdminResponse>()

      await addQuizWithQuestion(adminCookies, published.id)
      await app.inject({
        method: 'PATCH',
        url: `/courses/${published.id}/status`,
        headers: { cookie: adminCookies },
        payload: { status: 'PUBLISHED' },
      })
      await app.inject({
        method: 'PATCH',
        url: `/courses/${archived.id}/status`,
        headers: { cookie: adminCookies },
        payload: { status: 'ARCHIVED' },
      })

      // USER เห็นอะไร
      const { user, plainPassword } = await createUser({ role: 'USER' })
      const { cookies } = await loginAs(app, user.email, plainPassword)

      const res = await app.inject({
        method: 'GET',
        url: '/courses',
        headers: { cookie: cookies },
      })
      expect(res.statusCode).toBe(200)
      const ids = res.json<{ data: CoursePublicResponse[] }>().data.map((c) => c.id)
      expect(ids).toContain(published.id)
      expect(ids).not.toContain(draft.id)
      expect(ids).not.toContain(archived.id)
    })

    it('USER GET /courses/:id ของ DRAFT course → 404', async () => {
      const { user: admin, plainPassword: adminPw } = await createUser({ role: 'ADMIN' })
      const { cookies: adminCookies } = await loginAs(app, admin.email, adminPw)
      const draft = (await createCourseAs(adminCookies, { titleEn: 'Hidden Draft' })).json<CourseAdminResponse>()

      const { user, plainPassword } = await createUser({ role: 'USER' })
      const { cookies } = await loginAs(app, user.email, plainPassword)

      const res = await app.inject({
        method: 'GET',
        url: `/courses/${draft.id}`,
        headers: { cookie: cookies },
      })
      expect(res.statusCode).toBe(404)
    })
  })

  // ─── Soft delete + cascade ─────────────────────────────────────────────────

  describe('Soft delete', () => {
    it('DELETE /courses/:id → soft deletes course + cascade materials, audit COURSE_DELETE', async () => {
      const { user, plainPassword } = await createUser({ role: 'ADMIN' })
      const { cookies } = await loginAs(app, user.email, plainPassword)
      const course = (await createCourseAs(cookies, { titleEn: 'To Delete' })).json<CourseAdminResponse>()

      // สร้าง material ก่อน delete
      await prisma.material.create({
        data: { courseId: course.id, type: 'LINK', titleEn: 'A Link', url: 'https://example.com', order: 0 },
      })

      const delRes = await app.inject({
        method: 'DELETE',
        url: `/courses/${course.id}`,
        headers: { cookie: cookies },
      })
      expect(delRes.statusCode).toBe(200)

      // course ถูก soft delete
      const dbCourse = await prisma.course.findUnique({ where: { id: course.id } })
      expect(dbCourse!.deletedAt).not.toBeNull()

      // materials ถูก cascade soft delete
      const materials = await prisma.material.findMany({ where: { courseId: course.id } })
      expect(materials.every((m) => m.deletedAt !== null)).toBe(true)

      // ไม่ควรอยู่ใน list
      const listRes = await app.inject({
        method: 'GET',
        url: '/courses',
        headers: { cookie: cookies },
      })
      const ids = listRes.json<{ data: CourseAdminResponse[] }>().data.map((c) => c.id)
      expect(ids).not.toContain(course.id)

      const log = await prisma.auditLog.findFirst({
        where: { action: 'COURSE_DELETE', targetId: course.id },
      })
      expect(log).not.toBeNull()
    })
  })

  // ─── Bilingual content fields ─────────────────────────────────────────────

  describe('Bilingual content fields (i18n Step 3)', () => {
    it('missing titleEn → 400 validation error', async () => {
      const { user, plainPassword } = await createUser({ role: 'ADMIN' })
      const { cookies } = await loginAs(app, user.email, plainPassword)

      const res = await app.inject({
        method: 'POST',
        url: '/courses',
        headers: { cookie: cookies },
        payload: { categoryEn: 'Safety' }, // titleEn missing
      })
      expect(res.statusCode).toBe(400)
    })

    it('En only (no Th) + locale=en → returns titleEn', async () => {
      const { user, plainPassword } = await createUser({ role: 'ADMIN' })
      const { cookies } = await loginAs(app, user.email, plainPassword)

      const res = await createCourseAs(cookies, {
        titleEn: 'English Only',
        categoryEn: 'Test',
        // titleTh: undefined
      })
      expect(res.statusCode).toBe(201)
      const body = res.json<CourseAdminResponse>()
      expect(body.title).toBe('English Only')  // localized field = titleEn
      expect(body.titleEn).toBe('English Only')
      expect(body.titleTh).toBeNull()
    })

    it('En only (no Th) + locale=th → fallback to titleEn', async () => {
      const { user, plainPassword } = await createUser({ role: 'ADMIN' })
      const { cookies } = await loginAs(app, user.email, plainPassword)

      // ตั้ง user language เป็น th
      await prisma.user.update({ where: { id: user.id }, data: { language: 'th' } })

      const res = await createCourseAs(cookies, {
        titleEn: 'English Fallback',
        categoryEn: 'Test',
        // no titleTh
      })
      expect(res.statusCode).toBe(201)
      // locale=th แต่ titleTh ว่าง → fallback to titleEn
      expect(res.json<CourseAdminResponse>().title).toBe('English Fallback')
    })

    it('both titleEn + titleTh + locale=th → returns titleTh', async () => {
      const { user, plainPassword } = await createUser({ role: 'ADMIN' })
      const { cookies } = await loginAs(app, user.email, plainPassword)

      // ตั้ง user language เป็น th
      await prisma.user.update({ where: { id: user.id }, data: { language: 'th' } })

      const res = await createCourseAs(cookies, {
        titleEn: 'Safety Training',
        titleTh: 'การฝึกอบรมความปลอดภัย',
        categoryEn: 'Safety',
      })
      expect(res.statusCode).toBe(201)
      expect(res.json<CourseAdminResponse>().title).toBe('การฝึกอบรมความปลอดภัย')
    })

    it('ADMIN POST /courses → response includes raw titleEn + titleTh (edit form fields)', async () => {
      const { user, plainPassword } = await createUser({ role: 'ADMIN' })
      const { cookies } = await loginAs(app, user.email, plainPassword)

      const res = await createCourseAs(cookies, {
        titleEn: 'Raw Fields Test',
        titleTh: 'ทดสอบฟิลด์ดิบ',
        categoryEn: 'Test',
      })
      const body = res.json<CourseAdminResponse>()
      expect(body.titleEn).toBe('Raw Fields Test')
      expect(body.titleTh).toBe('ทดสอบฟิลด์ดิบ')
      expect(body.categoryEn).toBeDefined()
    })
  })

  // ─── Role-based response schema (public vs admin) ──────────────────────────

  describe('Role-based response schema', () => {
    it('USER GET /courses → response has NO raw bilingual fields (titleEn/categoryEn etc.)', async () => {
      const { user: admin, plainPassword: adminPw } = await createUser({ role: 'ADMIN' })
      const { cookies: adminCookies } = await loginAs(app, admin.email, adminPw)

      // สร้าง + publish course
      const created = (await createCourseAs(adminCookies, {
        titleEn: 'Public Course',
        titleTh: 'หลักสูตรสาธารณะ',
        categoryEn: 'Training',
      })).json<CourseAdminResponse>()
      await addQuizWithQuestion(adminCookies, created.id)
      await app.inject({
        method: 'PATCH',
        url: `/courses/${created.id}/status`,
        headers: { cookie: adminCookies },
        payload: { status: 'PUBLISHED' },
      })

      const { user, plainPassword } = await createUser({ role: 'USER' })
      const { cookies } = await loginAs(app, user.email, plainPassword)

      const listRes = await app.inject({ method: 'GET', url: '/courses', headers: { cookie: cookies } })
      expect(listRes.statusCode).toBe(200)
      const courses = listRes.json<{ data: CoursePublicResponse[] }>().data
      const course = courses.find((c) => c.id === created.id)
      expect(course).toBeDefined()

      // ต้องมี localized fields
      expect(course!.title).toBeDefined()
      expect(course!.category).toBeDefined()

      // ห้ามมี raw bilingual fields
      expect('titleEn' in course!).toBe(false)
      expect('titleTh' in course!).toBe(false)
      expect('categoryEn' in course!).toBe(false)
      expect('categoryTh' in course!).toBe(false)
      expect('descriptionEn' in course!).toBe(false)
      expect('descriptionTh' in course!).toBe(false)
    })

    it('USER GET /courses/:id → response has NO raw bilingual fields', async () => {
      const { user: admin, plainPassword: adminPw } = await createUser({ role: 'ADMIN' })
      const { cookies: adminCookies } = await loginAs(app, admin.email, adminPw)

      const created = (await createCourseAs(adminCookies, {
        titleEn: 'Detail Course',
        categoryEn: 'Training',
      })).json<CourseAdminResponse>()
      await addQuizWithQuestion(adminCookies, created.id)
      await app.inject({
        method: 'PATCH',
        url: `/courses/${created.id}/status`,
        headers: { cookie: adminCookies },
        payload: { status: 'PUBLISHED' },
      })

      const { user, plainPassword } = await createUser({ role: 'USER' })
      const { cookies } = await loginAs(app, user.email, plainPassword)

      const res = await app.inject({
        method: 'GET',
        url: `/courses/${created.id}`,
        headers: { cookie: cookies },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json<CoursePublicResponse>()

      expect(body.title).toBe('Detail Course')
      expect('titleEn' in body).toBe(false)
      expect('titleTh' in body).toBe(false)
      expect('categoryEn' in body).toBe(false)
    })

    it('ADMIN GET /courses/:id → response includes raw bilingual fields', async () => {
      const { user, plainPassword } = await createUser({ role: 'ADMIN' })
      const { cookies } = await loginAs(app, user.email, plainPassword)

      const created = (await createCourseAs(cookies, {
        titleEn: 'Admin Detail',
        titleTh: 'รายละเอียดแอดมิน',
        categoryEn: 'Admin Cat',
        categoryTh: 'หมวดหมู่แอดมิน',
      })).json<CourseAdminResponse>()

      const res = await app.inject({
        method: 'GET',
        url: `/courses/${created.id}`,
        headers: { cookie: cookies },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json<CourseAdminResponse>()

      expect(body.titleEn).toBe('Admin Detail')
      expect(body.titleTh).toBe('รายละเอียดแอดมิน')
      expect(body.categoryEn).toBe('Admin Cat')
      expect(body.categoryTh).toBe('หมวดหมู่แอดมิน')
    })
  })

  // ─── Access type & positions (2C-2) ───────────────────────────────────────

  describe('Access type & positions (2C-2)', () => {
    async function createPosition(cookies: string, nameEn = `Pos ${Date.now()}-${Math.random()}`) {
      const res = await app.inject({
        method: 'POST',
        url: '/positions',
        headers: { cookie: cookies },
        payload: { nameEn },
      })
      return res.json<{ id: string }>().id
    }

    it('POST /courses defaults to accessType PUBLIC, positions empty', async () => {
      const { user, plainPassword } = await createUser({ role: 'ADMIN' })
      const { cookies } = await loginAs(app, user.email, plainPassword)

      const created = (await createCourseAs(cookies)).json<CourseAdminResponse>()
      expect(created.accessType).toBe('PUBLIC')
      expect(created.positions).toEqual([])
    })

    it('publish-gate: POSITION_BASED course with 0 positions → 400', async () => {
      const { user, plainPassword } = await createUser({ role: 'ADMIN' })
      const { cookies } = await loginAs(app, user.email, plainPassword)
      const created = (await createCourseAs(cookies, { accessType: 'POSITION_BASED' })).json<CourseAdminResponse>()
      await addQuizWithQuestion(cookies, created.id)

      const res = await app.inject({
        method: 'PATCH',
        url: `/courses/${created.id}/status`,
        headers: { cookie: cookies },
        payload: { status: 'PUBLISHED' },
      })
      expect(res.statusCode).toBe(400)
    })

    it('publish-gate: POSITION_BASED course with >=1 position → 200', async () => {
      const { user, plainPassword } = await createUser({ role: 'ADMIN' })
      const { cookies } = await loginAs(app, user.email, plainPassword)
      const created = (await createCourseAs(cookies, { accessType: 'POSITION_BASED' })).json<CourseAdminResponse>()
      await addQuizWithQuestion(cookies, created.id)
      const positionId = await createPosition(cookies)
      await app.inject({
        method: 'PUT',
        url: `/courses/${created.id}/positions`,
        headers: { cookie: cookies },
        payload: { positionIds: [positionId] },
      })

      const res = await app.inject({
        method: 'PATCH',
        url: `/courses/${created.id}/status`,
        headers: { cookie: cookies },
        payload: { status: 'PUBLISHED' },
      })
      expect(res.statusCode).toBe(200)
    })

    it('PUT /courses/:id/positions on a PUBLIC course → 400', async () => {
      const { user, plainPassword } = await createUser({ role: 'ADMIN' })
      const { cookies } = await loginAs(app, user.email, plainPassword)
      const created = (await createCourseAs(cookies, { accessType: 'PUBLIC' })).json<CourseAdminResponse>()
      const positionId = await createPosition(cookies)

      const res = await app.inject({
        method: 'PUT',
        url: `/courses/${created.id}/positions`,
        headers: { cookie: cookies },
        payload: { positionIds: [positionId] },
      })
      expect(res.statusCode).toBe(400)
    })

    it('course-position-removal-gate: removing the last position from a PUBLISHED POSITION_BASED course → 400', async () => {
      const { user, plainPassword } = await createUser({ role: 'ADMIN' })
      const { cookies } = await loginAs(app, user.email, plainPassword)
      const created = (await createCourseAs(cookies, { accessType: 'POSITION_BASED' })).json<CourseAdminResponse>()
      await addQuizWithQuestion(cookies, created.id)
      const positionId = await createPosition(cookies)
      await app.inject({
        method: 'PUT',
        url: `/courses/${created.id}/positions`,
        headers: { cookie: cookies },
        payload: { positionIds: [positionId] },
      })
      await app.inject({
        method: 'PATCH',
        url: `/courses/${created.id}/status`,
        headers: { cookie: cookies },
        payload: { status: 'PUBLISHED' },
      })

      const res = await app.inject({
        method: 'PUT',
        url: `/courses/${created.id}/positions`,
        headers: { cookie: cookies },
        payload: { positionIds: [] },
      })
      expect(res.statusCode).toBe(400)
    })

    it('removing the last position from a DRAFT POSITION_BASED course → 200 (gate only applies to PUBLISHED)', async () => {
      const { user, plainPassword } = await createUser({ role: 'ADMIN' })
      const { cookies } = await loginAs(app, user.email, plainPassword)
      const created = (await createCourseAs(cookies, { accessType: 'POSITION_BASED' })).json<CourseAdminResponse>()
      const positionId = await createPosition(cookies)
      await app.inject({
        method: 'PUT',
        url: `/courses/${created.id}/positions`,
        headers: { cookie: cookies },
        payload: { positionIds: [positionId] },
      })

      const res = await app.inject({
        method: 'PUT',
        url: `/courses/${created.id}/positions`,
        headers: { cookie: cookies },
        payload: { positionIds: [] },
      })
      expect(res.statusCode).toBe(200)
    })

    it('accessType-lock: course with an active enrollment → PATCH accessType (PUBLIC→POSITION_BASED) → 400', async () => {
      const { user: admin, plainPassword: adminPw } = await createUser({ role: 'ADMIN' })
      const { cookies: adminCookies } = await loginAs(app, admin.email, adminPw)
      const { user, plainPassword: userPw } = await createUser({ role: 'USER' })
      const { cookies: userCookies } = await loginAs(app, user.email, userPw)
      const created = await createPublishedCourseAs(adminCookies, { accessType: 'PUBLIC' })

      const enrollRes = await app.inject({
        method: 'POST',
        url: '/enrollments/self',
        headers: { cookie: userCookies },
        payload: { courseId: created.id },
      })
      expect(enrollRes.statusCode).toBe(201)

      const res = await app.inject({
        method: 'PATCH',
        url: `/courses/${created.id}`,
        headers: { cookie: adminCookies },
        payload: { accessType: 'POSITION_BASED' },
      })
      expect(res.statusCode).toBe(400)
    })

    it('accessType-lock: course with an active enrollment → PATCH accessType (POSITION_BASED→PUBLIC) → 400', async () => {
      const { user: admin, plainPassword: adminPw } = await createUser({ role: 'ADMIN' })
      const { cookies: adminCookies } = await loginAs(app, admin.email, adminPw)
      const { user, plainPassword: userPw } = await createUser({ role: 'USER' })
      const { cookies: userCookies } = await loginAs(app, user.email, userPw)
      const created = (await createCourseAs(adminCookies, { accessType: 'POSITION_BASED' })).json<CourseAdminResponse>()
      await addQuizWithQuestion(adminCookies, created.id)
      const positionId = await createPosition(adminCookies)
      await app.inject({
        method: 'PUT',
        url: `/courses/${created.id}/positions`,
        headers: { cookie: adminCookies },
        payload: { positionIds: [positionId] },
      })
      await app.inject({
        method: 'PATCH',
        url: `/courses/${created.id}/status`,
        headers: { cookie: adminCookies },
        payload: { status: 'PUBLISHED' },
      })
      // user ต้องมี position ตรงกับที่ course ผูกไว้ถึงจะ self-enroll ผ่าน (2C-3 position matching)
      await prisma.user.update({ where: { id: user.id }, data: { positionId } })

      const enrollRes = await app.inject({
        method: 'POST',
        url: '/enrollments/self',
        headers: { cookie: userCookies },
        payload: { courseId: created.id },
      })
      expect(enrollRes.statusCode).toBe(201)

      const res = await app.inject({
        method: 'PATCH',
        url: `/courses/${created.id}`,
        headers: { cookie: adminCookies },
        payload: { accessType: 'PUBLIC' },
      })
      expect(res.statusCode).toBe(400)
    })

    it('accessType-lock: no active enrollment (never enrolled) → PATCH accessType → 200', async () => {
      const { user, plainPassword } = await createUser({ role: 'ADMIN' })
      const { cookies } = await loginAs(app, user.email, plainPassword)
      const created = await createPublishedCourseAs(cookies, { accessType: 'PUBLIC' })

      const res = await app.inject({
        method: 'PATCH',
        url: `/courses/${created.id}`,
        headers: { cookie: cookies },
        payload: { accessType: 'POSITION_BASED' },
      })
      // accessType เปลี่ยนได้ แต่ publish-gate ยังบังคับต้องมี position อยู่ — ตอนนี้ course
      // เป็น PUBLISHED + POSITION_BASED + 0 position (สถานะไม่ต้องห้ามระหว่าง edit เอง เพราะ
      // publish-gate เช็คเฉพาะตอน "publish" ไม่เช็คตอน "แก้ course ที่ published อยู่แล้ว")
      expect(res.statusCode).toBe(200)
      expect(res.json<CourseAdminResponse>().accessType).toBe('POSITION_BASED')
    })

    it('accessType-lock: enrollment cancelled (soft-deleted) → PATCH accessType → 200 (only active enrollments count)', async () => {
      const { user: admin, plainPassword: adminPw } = await createUser({ role: 'ADMIN' })
      const { cookies: adminCookies } = await loginAs(app, admin.email, adminPw)
      const { user, plainPassword: userPw } = await createUser({ role: 'USER' })
      const { cookies: userCookies } = await loginAs(app, user.email, userPw)
      const created = await createPublishedCourseAs(adminCookies, { accessType: 'PUBLIC' })

      const enrollRes = await app.inject({
        method: 'POST',
        url: '/enrollments/self',
        headers: { cookie: userCookies },
        payload: { courseId: created.id },
      })
      const enrollment = enrollRes.json<{ id: string }>()

      // ยืนยันว่า lock ทำงานตอนยังมี active enrollment
      const lockedRes = await app.inject({
        method: 'PATCH',
        url: `/courses/${created.id}`,
        headers: { cookie: adminCookies },
        payload: { accessType: 'POSITION_BASED' },
      })
      expect(lockedRes.statusCode).toBe(400)

      // cancel (soft-delete) enrollment
      const cancelRes = await app.inject({
        method: 'DELETE',
        url: `/enrollments/${enrollment.id}`,
        headers: { cookie: adminCookies },
      })
      expect(cancelRes.statusCode).toBe(200)

      // ถอนหมดแล้ว → แก้ accessType ได้ตามปกติ
      const res = await app.inject({
        method: 'PATCH',
        url: `/courses/${created.id}`,
        headers: { cookie: adminCookies },
        payload: { accessType: 'POSITION_BASED' },
      })
      expect(res.statusCode).toBe(200)
    })

    it('PATCH accessType to the SAME value with active enrollment → 200 (not a real change, lock does not apply)', async () => {
      const { user: admin, plainPassword: adminPw } = await createUser({ role: 'ADMIN' })
      const { cookies: adminCookies } = await loginAs(app, admin.email, adminPw)
      const { user, plainPassword: userPw } = await createUser({ role: 'USER' })
      const { cookies: userCookies } = await loginAs(app, user.email, userPw)
      const created = await createPublishedCourseAs(adminCookies, { accessType: 'PUBLIC' })

      await app.inject({
        method: 'POST',
        url: '/enrollments/self',
        headers: { cookie: userCookies },
        payload: { courseId: created.id },
      })

      const res = await app.inject({
        method: 'PATCH',
        url: `/courses/${created.id}`,
        headers: { cookie: adminCookies },
        payload: { accessType: 'PUBLIC' },
      })
      expect(res.statusCode).toBe(200)
    })

    it('ADMIN response includes localized position names', async () => {
      const { user, plainPassword } = await createUser({ role: 'ADMIN' })
      const { cookies } = await loginAs(app, user.email, plainPassword)
      const created = (await createCourseAs(cookies, { accessType: 'POSITION_BASED' })).json<CourseAdminResponse>()
      const positionId = await createPosition(cookies, 'Nurse Position')
      const res = await app.inject({
        method: 'PUT',
        url: `/courses/${created.id}/positions`,
        headers: { cookie: cookies },
        payload: { positionIds: [positionId] },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json<CourseAdminResponse>()
      expect(body.positions).toHaveLength(1)
      expect(body.positions[0]!.name).toBe('Nurse Position')
    })
  })
})
