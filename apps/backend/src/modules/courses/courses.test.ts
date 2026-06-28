import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildTestApp, createUser, loginAs, prisma } from '../../test/helpers.js'
import type { TestApp } from '../../test/helpers.js'
import type { CourseResponse } from '@btec-lms/shared'

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
        title: 'Test Course',
        category: 'Safety',
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
      expect(res.json<CourseResponse>().status).toBe('DRAFT')
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
      const courseId = courseRes.json<CourseResponse>().id

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
      const courseId = courseRes.json<CourseResponse>().id

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
        title: 'Blood Donation Fundamentals',
        category: 'Clinical',
        expiryMonths: 12,
      })

      expect(res.statusCode).toBe(201)
      const body = res.json<CourseResponse>()
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
      const created = (await createCourseAs(cookies)).json<CourseResponse>()

      const res = await app.inject({
        method: 'GET',
        url: `/courses/${created.id}`,
        headers: { cookie: cookies },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json<CourseResponse>().id).toBe(created.id)
    })

    it('PATCH /courses/:id → updates metadata + increments version', async () => {
      const { user, plainPassword } = await createUser({ role: 'ADMIN' })
      const { cookies } = await loginAs(app, user.email, plainPassword)
      const created = (await createCourseAs(cookies)).json<CourseResponse>()

      const res = await app.inject({
        method: 'PATCH',
        url: `/courses/${created.id}`,
        headers: { cookie: cookies },
        payload: { title: 'Updated Title', passScore: 90 },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json<CourseResponse>()
      expect(body.title).toBe('Updated Title')
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
      const created = (await createCourseAs(cookies)).json<CourseResponse>()

      const res = await app.inject({
        method: 'PATCH',
        url: `/courses/${created.id}/status`,
        headers: { cookie: cookies },
        payload: { status: 'PUBLISHED' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json<CourseResponse>().status).toBe('PUBLISHED')

      const log = await prisma.auditLog.findFirst({
        where: { action: 'COURSE_PUBLISH', targetId: created.id },
      })
      expect(log).not.toBeNull()
    })

    it('cannot change status of ARCHIVED course → 400', async () => {
      const { user, plainPassword } = await createUser({ role: 'ADMIN' })
      const { cookies } = await loginAs(app, user.email, plainPassword)
      const created = (await createCourseAs(cookies)).json<CourseResponse>()

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
      const draft = (await createCourseAs(adminCookies, { title: 'Draft Course' })).json<CourseResponse>()
      const published = (await createCourseAs(adminCookies, { title: 'Published Course' })).json<CourseResponse>()
      const archived = (await createCourseAs(adminCookies, { title: 'Archived Course' })).json<CourseResponse>()

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
      const ids = res.json<{ data: CourseResponse[] }>().data.map((c) => c.id)
      expect(ids).toContain(published.id)
      expect(ids).not.toContain(draft.id)
      expect(ids).not.toContain(archived.id)
    })

    it('USER GET /courses/:id ของ DRAFT course → 404', async () => {
      const { user: admin, plainPassword: adminPw } = await createUser({ role: 'ADMIN' })
      const { cookies: adminCookies } = await loginAs(app, admin.email, adminPw)
      const draft = (await createCourseAs(adminCookies, { title: 'Hidden Draft' })).json<CourseResponse>()

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
      const course = (await createCourseAs(cookies, { title: 'To Delete' })).json<CourseResponse>()

      // สร้าง material ก่อน delete
      await prisma.material.create({
        data: { courseId: course.id, type: 'LINK', title: 'A Link', url: 'https://example.com', order: 0 },
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
      const ids = listRes.json<{ data: CourseResponse[] }>().data.map((c) => c.id)
      expect(ids).not.toContain(course.id)

      const log = await prisma.auditLog.findFirst({
        where: { action: 'COURSE_DELETE', targetId: course.id },
      })
      expect(log).not.toBeNull()
    })
  })
})
