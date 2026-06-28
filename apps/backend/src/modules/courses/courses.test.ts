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
        passScore: 80,
        ...overrides,
      },
    })
  }

  // ─── RBAC ─────────────────────────────────────────────────────────────────

  describe('RBAC', () => {
    it('USER role POST /courses → 403', async () => {
      const { user, plainPassword } = await createUser({ role: 'USER' })
      const { cookies } = await loginAs(app, user.email, plainPassword)

      const res = await createCourseAs(cookies)
      expect(res.statusCode).toBe(403)
    })

    it('MANAGER role POST /courses → 201', async () => {
      const { user, plainPassword } = await createUser({ role: 'MANAGER' })
      const { cookies } = await loginAs(app, user.email, plainPassword)

      const res = await createCourseAs(cookies)
      expect(res.statusCode).toBe(201)
      expect(res.json<CourseAdminResponse>().status).toBe('DRAFT')
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

    it('MANAGER role PATCH /courses/:id/status → 403 (ADMIN only)', async () => {
      const { user: admin, plainPassword: adminPw } = await createUser({ role: 'ADMIN' })
      const { cookies: adminCookies } = await loginAs(app, admin.email, adminPw)
      const courseRes = await createCourseAs(adminCookies)
      const courseId = courseRes.json<CourseAdminResponse>().id

      const { user, plainPassword } = await createUser({ role: 'MANAGER' })
      const { cookies } = await loginAs(app, user.email, plainPassword)

      const res = await app.inject({
        method: 'PATCH',
        url: `/courses/${courseId}/status`,
        headers: { cookie: cookies },
        payload: { status: 'PUBLISHED' },
      })
      expect(res.statusCode).toBe(403)
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
        payload: { titleEn: 'Updated Title', passScore: 90 },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json<CourseAdminResponse>()
      expect(body.title).toBe('Updated Title') // localized field
      expect(body.passScore).toBe(90)
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
        payload: { categoryEn: 'Safety', passScore: 80 }, // titleEn missing
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
})
