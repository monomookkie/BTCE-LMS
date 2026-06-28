import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildTestApp, createUser, loginAs, prisma } from '../../test/helpers.js'
import type { TestApp } from '../../test/helpers.js'
import type { CourseResponse, MaterialResponse } from '@btec-lms/shared'

describe('Materials module', () => {
  let app: TestApp

  beforeAll(async () => {
    app = await buildTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  // ─── helpers ───────────────────────────────────────────────────────────────

  async function setupAdminAndCourse() {
    const { user: admin, plainPassword } = await createUser({ role: 'ADMIN' })
    const { cookies } = await loginAs(app, admin.email, plainPassword)
    const courseRes = await app.inject({
      method: 'POST',
      url: '/courses',
      headers: { cookie: cookies },
      payload: { title: 'Test Course', category: 'Safety', passScore: 80 },
    })
    return { admin, cookies, course: courseRes.json<CourseResponse>() }
  }

  // ─── RBAC ─────────────────────────────────────────────────────────────────

  describe('RBAC', () => {
    it('USER GET /courses/:id/materials → 403', async () => {
      const { course } = await setupAdminAndCourse()
      const { user, plainPassword } = await createUser({ role: 'USER' })
      const { cookies } = await loginAs(app, user.email, plainPassword)

      const res = await app.inject({
        method: 'GET',
        url: `/courses/${course.id}/materials`,
        headers: { cookie: cookies },
      })
      expect(res.statusCode).toBe(403)
    })

    it('USER POST /courses/:id/materials/link → 403', async () => {
      const { course } = await setupAdminAndCourse()
      const { user, plainPassword } = await createUser({ role: 'USER' })
      const { cookies } = await loginAs(app, user.email, plainPassword)

      const res = await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/materials/link`,
        headers: { cookie: cookies },
        payload: { type: 'LINK', title: 'Some Link', url: 'https://example.com' },
      })
      expect(res.statusCode).toBe(403)
    })
  })

  // ─── Link/Video material (JSON) ────────────────────────────────────────────

  describe('Link / Video material', () => {
    it('POST /courses/:id/materials/link → 201, stores url (no fileKey)', async () => {
      const { cookies, course } = await setupAdminAndCourse()

      const res = await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/materials/link`,
        headers: { cookie: cookies },
        payload: { type: 'LINK', title: 'Reference Article', url: 'https://example.com/article' },
      })

      expect(res.statusCode).toBe(201)
      const body = res.json<MaterialResponse>()
      expect(body.url).toBe('https://example.com/article')
      expect(body.fileKey).toBeNull()
      expect(body.signedUrl).toBeNull() // ไม่ใช่ file upload
      expect(body.type).toBe('LINK')

      // DB เก็บ url ไม่ใช่ base64
      const dbMaterial = await prisma.material.findUnique({ where: { id: body.id } })
      expect(dbMaterial!.url).toBe('https://example.com/article')
      expect(dbMaterial!.fileKey).toBeNull()
    })

    it('POST /courses/:id/materials/link → VIDEO type', async () => {
      const { cookies, course } = await setupAdminAndCourse()

      const res = await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/materials/link`,
        headers: { cookie: cookies },
        payload: { type: 'VIDEO', title: 'Training Video', url: 'https://youtu.be/abc123' },
      })

      expect(res.statusCode).toBe(201)
      expect(res.json<MaterialResponse>().type).toBe('VIDEO')
    })

    it('audit log MATERIAL_CREATE written', async () => {
      const { admin, cookies, course } = await setupAdminAndCourse()

      const res = await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/materials/link`,
        headers: { cookie: cookies },
        payload: { type: 'LINK', title: 'Audited Link', url: 'https://example.com' },
      })
      const materialId = res.json<MaterialResponse>().id

      const log = await prisma.auditLog.findFirst({
        where: { action: 'MATERIAL_CREATE', targetId: materialId },
      })
      expect(log).not.toBeNull()
      expect(log!.actorId).toBe(admin.id)
    })
  })

  // ─── File upload (multipart) — FakeStorageProvider ────────────────────────

  describe('File upload (multipart)', () => {
    it('POST /courses/:id/materials → stores fileKey not base64, returns signedUrl', async () => {
      const { cookies, course } = await setupAdminAndCourse()

      // สร้าง fake PDF buffer (content ไม่สำคัญ ใน test ใช้ FakeStorageProvider)
      const fakeContent = Buffer.from('%PDF-1.4 fake content for test')
      const formData = [
        '--boundary\r\n',
        'Content-Disposition: form-data; name="type"\r\n\r\nPDF\r\n',
        '--boundary\r\n',
        'Content-Disposition: form-data; name="title"\r\n\r\nBlood Safety Protocol\r\n',
        '--boundary\r\n',
        `Content-Disposition: form-data; name="file"; filename="protocol.pdf"\r\n`,
        'Content-Type: application/pdf\r\n\r\n',
      ]
      const formPrefix = Buffer.from(formData.join(''))
      const formSuffix = Buffer.from('\r\n--boundary--\r\n')
      const body = Buffer.concat([formPrefix, fakeContent, formSuffix])

      const res = await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/materials`,
        headers: {
          cookie: cookies,
          'content-type': 'multipart/form-data; boundary=boundary',
        },
        body,
      })

      expect(res.statusCode).toBe(201)
      const mat = res.json<MaterialResponse>()

      // ต้องมี fileKey (ไม่ใช่ base64)
      expect(mat.fileKey).not.toBeNull()
      expect(mat.fileKey).toMatch(/^fake\/materials\//) // FakeStorageProvider prefix
      // fileKey ต้องไม่ใช่ base64
      expect(mat.fileKey).not.toMatch(/^[A-Za-z0-9+/]+=*$/)

      // signedUrl ต้องมี (generated จาก FakeProvider)
      expect(mat.signedUrl).toMatch(/^https:\/\/fake\.storage\.test\//)

      // DB เก็บ fileKey (ไม่ใช่ binary/base64)
      const db = await prisma.material.findUnique({ where: { id: mat.id } })
      expect(db!.fileKey).toBe(mat.fileKey)
      expect(db!.url).toBeNull()
    })

    it('upload wrong MIME type → 400', async () => {
      const { cookies, course } = await setupAdminAndCourse()

      const fakeContent = Buffer.from('MZ fake exe content')
      const formData = [
        '--b\r\n',
        'Content-Disposition: form-data; name="type"\r\n\r\nPDF\r\n',
        '--b\r\n',
        'Content-Disposition: form-data; name="title"\r\n\r\nFake PDF\r\n',
        '--b\r\n',
        'Content-Disposition: form-data; name="file"; filename="virus.exe"\r\n',
        'Content-Type: application/x-msdownload\r\n\r\n',
      ]
      const body = Buffer.concat([
        Buffer.from(formData.join('')),
        fakeContent,
        Buffer.from('\r\n--b--\r\n'),
      ])

      const res = await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/materials`,
        headers: {
          cookie: cookies,
          'content-type': 'multipart/form-data; boundary=b',
        },
        body,
      })

      expect(res.statusCode).toBe(400)
    })
  })

  // ─── Reorder ───────────────────────────────────────────────────────────────

  describe('Reorder', () => {
    it('PATCH /reorder → updates order, audit MATERIAL_REORDER', async () => {
      const { admin, cookies, course } = await setupAdminAndCourse()

      // สร้าง 3 links
      const ids: string[] = []
      for (const title of ['First', 'Second', 'Third']) {
        const res = await app.inject({
          method: 'POST',
          url: `/courses/${course.id}/materials/link`,
          headers: { cookie: cookies },
          payload: { type: 'LINK', title, url: 'https://example.com' },
        })
        ids.push(res.json<MaterialResponse>().id)
      }

      // reverse order
      const newOrder = [...ids].reverse()
      const reorderRes = await app.inject({
        method: 'PATCH',
        url: `/courses/${course.id}/materials/reorder`,
        headers: { cookie: cookies },
        payload: { materialIds: newOrder },
      })
      expect(reorderRes.statusCode).toBe(200)

      // ยืนยัน order ใน DB
      for (let i = 0; i < newOrder.length; i++) {
        const m = await prisma.material.findUnique({ where: { id: newOrder[i]! } })
        expect(m!.order).toBe(i)
      }

      const log = await prisma.auditLog.findFirst({
        where: { action: 'MATERIAL_REORDER', targetId: course.id },
      })
      expect(log).not.toBeNull()
      expect(log!.actorId).toBe(admin.id)
    })

    it('reorder with materialId from different course → 400', async () => {
      const { cookies, course } = await setupAdminAndCourse()
      const { course: otherCourse } = await setupAdminAndCourse()

      // สร้าง material ใน course อื่น
      const otherMat = await app.inject({
        method: 'POST',
        url: `/courses/${otherCourse.id}/materials/link`,
        headers: { cookie: cookies },
        payload: { type: 'LINK', title: 'Other', url: 'https://other.com' },
      })
      const otherId = otherMat.json<MaterialResponse>().id

      const res = await app.inject({
        method: 'PATCH',
        url: `/courses/${course.id}/materials/reorder`,
        headers: { cookie: cookies },
        payload: { materialIds: [otherId] },
      })
      expect(res.statusCode).toBe(400)
    })
  })

  // ─── Soft delete ───────────────────────────────────────────────────────────

  describe('Soft delete', () => {
    it('DELETE /courses/:id/materials/:materialId → soft deletes, filtered from list', async () => {
      const { cookies, course } = await setupAdminAndCourse()

      const created = (await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/materials/link`,
        headers: { cookie: cookies },
        payload: { type: 'LINK', title: 'To Delete', url: 'https://example.com' },
      })).json<MaterialResponse>()

      const delRes = await app.inject({
        method: 'DELETE',
        url: `/courses/${course.id}/materials/${created.id}`,
        headers: { cookie: cookies },
      })
      expect(delRes.statusCode).toBe(200)

      // DB record ยังอยู่ แต่มี deletedAt
      const db = await prisma.material.findUnique({ where: { id: created.id } })
      expect(db!.deletedAt).not.toBeNull()

      // ไม่ควรอยู่ใน list
      const listRes = await app.inject({
        method: 'GET',
        url: `/courses/${course.id}/materials`,
        headers: { cookie: cookies },
      })
      const ids = listRes.json<MaterialResponse[]>().map((m) => m.id)
      expect(ids).not.toContain(created.id)
    })
  })
})
