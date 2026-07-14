import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildTestApp, createUser, loginAs, prisma } from '../../test/helpers.js'
import type { TestApp } from '../../test/helpers.js'

type Actor = { cookies: string; userId: string }

let app: TestApp

beforeAll(async () => {
  app = await buildTestApp()
})

afterAll(async () => {
  await app.close()
})

async function setup(role: 'ADMIN' | 'USER' = 'USER'): Promise<Actor> {
  const { user, plainPassword } = await createUser({ role })
  const { cookies } = await loginAs(app, user.email, plainPassword)
  return { cookies, userId: user.id }
}

describe('Positions module', () => {
  describe('GET /positions — public (unauthenticated)', () => {
    it('returns active positions with no auth required, localized name only (no raw en/th)', async () => {
      await prisma.position.create({ data: { nameEn: 'Nurse', nameTh: 'พยาบาล' } })

      const res = await app.inject({ method: 'GET', url: '/positions' })
      expect(res.statusCode).toBe(200)
      const body = res.json<Array<{ id: string; name: string; nameEn?: string }>>()
      expect(body.some((p) => p.name === 'Nurse')).toBe(true)
      expect(body[0]?.nameEn).toBeUndefined()
    })

    it('excludes soft-deleted positions', async () => {
      const position = await prisma.position.create({ data: { nameEn: 'Retired Position' } })
      await prisma.position.update({ where: { id: position.id }, data: { deletedAt: new Date() } })

      const res = await app.inject({ method: 'GET', url: '/positions' })
      const body = res.json<Array<{ name: string }>>()
      expect(body.some((p) => p.name === 'Retired Position')).toBe(false)
    })

    it('excludes isSystemOnly positions (e.g. "Administrator") — must not be selectable at self-register', async () => {
      await prisma.position.create({ data: { nameEn: 'System Reserved', isSystemOnly: true } })

      const res = await app.inject({ method: 'GET', url: '/positions' })
      const body = res.json<Array<{ name: string }>>()
      expect(body.some((p) => p.name === 'System Reserved')).toBe(false)
    })
  })

  describe('GET /positions/admin', () => {
    it('ADMIN sees raw nameEn/nameTh', async () => {
      const admin = await setup('ADMIN')
      await prisma.position.create({ data: { nameEn: 'Technician', nameTh: 'ช่างเทคนิค' } })

      const res = await app.inject({
        method: 'GET',
        url: '/positions/admin',
        headers: { cookie: admin.cookies },
      })
      expect(res.statusCode).toBe(200)
      const found = res.json<Array<{ nameEn: string; nameTh: string | null }>>().find((p) => p.nameEn === 'Technician')
      expect(found?.nameTh).toBe('ช่างเทคนิค')
    })

    it('ADMIN still sees isSystemOnly positions (assignable to other users via UserDirectoryPage)', async () => {
      const admin = await setup('ADMIN')
      await prisma.position.create({ data: { nameEn: 'System Reserved Admin View', isSystemOnly: true } })

      const res = await app.inject({
        method: 'GET',
        url: '/positions/admin',
        headers: { cookie: admin.cookies },
      })
      const found = res.json<Array<{ nameEn: string; isSystemOnly: boolean }>>().find((p) => p.nameEn === 'System Reserved Admin View')
      expect(found).toBeDefined()
      expect(found?.isSystemOnly).toBe(true)
    })

    it('USER denied → 403', async () => {
      const user = await setup('USER')
      const res = await app.inject({
        method: 'GET',
        url: '/positions/admin',
        headers: { cookie: user.cookies },
      })
      expect(res.statusCode).toBe(403)
    })
  })

  describe('POST /positions', () => {
    it('ADMIN creates a position → 201', async () => {
      const admin = await setup('ADMIN')
      const res = await app.inject({
        method: 'POST',
        url: '/positions',
        headers: { cookie: admin.cookies },
        payload: { nameEn: 'Pharmacist', nameTh: 'เภสัชกร' },
      })
      expect(res.statusCode).toBe(201)
      expect(res.json<{ nameEn: string }>().nameEn).toBe('Pharmacist')
    })

    it('duplicate nameEn → 409', async () => {
      const admin = await setup('ADMIN')
      await prisma.position.create({ data: { nameEn: 'Duplicate Name' } })

      const res = await app.inject({
        method: 'POST',
        url: '/positions',
        headers: { cookie: admin.cookies },
        payload: { nameEn: 'Duplicate Name' },
      })
      expect(res.statusCode).toBe(409)
    })

    it('re-creating a soft-deleted position revives it instead of 500ing on the unique constraint', async () => {
      const admin = await setup('ADMIN')
      const position = await prisma.position.create({ data: { nameEn: 'Revivable' } })
      await prisma.position.update({ where: { id: position.id }, data: { deletedAt: new Date() } })

      const res = await app.inject({
        method: 'POST',
        url: '/positions',
        headers: { cookie: admin.cookies },
        payload: { nameEn: 'Revivable', nameTh: 'ฟื้นคืน' },
      })
      expect(res.statusCode).toBe(201)
      expect(res.json<{ id: string; nameTh: string | null }>().id).toBe(position.id)
      expect(res.json<{ nameTh: string | null }>().nameTh).toBe('ฟื้นคืน')

      const listRes = await app.inject({ method: 'GET', url: '/positions' })
      expect(listRes.json<Array<{ name: string }>>().some((p) => p.name === 'Revivable')).toBe(true)
    })

    it('USER denied → 403', async () => {
      const user = await setup('USER')
      const res = await app.inject({
        method: 'POST',
        url: '/positions',
        headers: { cookie: user.cookies },
        payload: { nameEn: 'Should Not Create' },
      })
      expect(res.statusCode).toBe(403)
    })
  })

  describe('PATCH /positions/:id', () => {
    it('ADMIN renames a position → 200', async () => {
      const admin = await setup('ADMIN')
      const position = await prisma.position.create({ data: { nameEn: 'Old Name' } })

      const res = await app.inject({
        method: 'PATCH',
        url: `/positions/${position.id}`,
        headers: { cookie: admin.cookies },
        payload: { nameEn: 'New Name' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json<{ nameEn: string }>().nameEn).toBe('New Name')
    })

    it('rename to an existing active nameEn → 409', async () => {
      const admin = await setup('ADMIN')
      await prisma.position.create({ data: { nameEn: 'Taken Name' } })
      const position = await prisma.position.create({ data: { nameEn: 'Renamable' } })

      const res = await app.inject({
        method: 'PATCH',
        url: `/positions/${position.id}`,
        headers: { cookie: admin.cookies },
        payload: { nameEn: 'Taken Name' },
      })
      expect(res.statusCode).toBe(409)
    })

    it('unknown id → 404', async () => {
      const admin = await setup('ADMIN')
      const res = await app.inject({
        method: 'PATCH',
        url: `/positions/c${'x'.repeat(24)}`,
        headers: { cookie: admin.cookies },
        payload: { nameEn: 'X' },
      })
      expect(res.statusCode).toBe(404)
    })
  })

  describe('DELETE /positions/:id', () => {
    it('ADMIN soft-deletes an unused position → 200, gone from GET /positions', async () => {
      const admin = await setup('ADMIN')
      const position = await prisma.position.create({ data: { nameEn: 'Deletable' } })

      const res = await app.inject({
        method: 'DELETE',
        url: `/positions/${position.id}`,
        headers: { cookie: admin.cookies },
      })
      expect(res.statusCode).toBe(200)

      const listRes = await app.inject({ method: 'GET', url: '/positions' })
      expect(listRes.json<Array<{ name: string }>>().some((p) => p.name === 'Deletable')).toBe(false)
    })

    it('blocked when a user is still assigned → 400', async () => {
      const admin = await setup('ADMIN')
      const position = await prisma.position.create({ data: { nameEn: 'In Use' } })
      const { user } = await createUser({ role: 'USER' })
      await prisma.user.update({ where: { id: user.id }, data: { positionId: position.id } })

      const res = await app.inject({
        method: 'DELETE',
        url: `/positions/${position.id}`,
        headers: { cookie: admin.cookies },
      })
      expect(res.statusCode).toBe(400)

      const stillThere = await prisma.position.findUnique({ where: { id: position.id } })
      expect(stillThere?.deletedAt).toBeNull()
    })

    it('USER denied → 403', async () => {
      const user = await setup('USER')
      const position = await prisma.position.create({ data: { nameEn: 'Guarded' } })

      const res = await app.inject({
        method: 'DELETE',
        url: `/positions/${position.id}`,
        headers: { cookie: user.cookies },
      })
      expect(res.statusCode).toBe(403)
    })

    it('blocked when a course is still linked (2C-2) → 400, not cascaded', async () => {
      const admin = await setup('ADMIN')
      const position = await prisma.position.create({ data: { nameEn: 'Linked To Course' } })
      const course = await prisma.course.create({
        data: { titleEn: 'Course Using Position', categoryEn: 'Test', accessType: 'POSITION_BASED' },
      })
      await prisma.coursePosition.create({ data: { courseId: course.id, positionId: position.id } })

      const res = await app.inject({
        method: 'DELETE',
        url: `/positions/${position.id}`,
        headers: { cookie: admin.cookies },
      })
      expect(res.statusCode).toBe(400)

      const stillThere = await prisma.position.findUnique({ where: { id: position.id } })
      expect(stillThere?.deletedAt).toBeNull()
      const stillLinked = await prisma.coursePosition.findFirst({ where: { positionId: position.id } })
      expect(stillLinked).not.toBeNull()
    })
  })

  // 2C-5: admin create/edit user form ใช้ positionId ตรงๆ แล้ว ไม่ใช้ resolvePositionId shim อีก —
  // consumer ที่เหลืออยู่จริงคือ CSV bulk import เท่านั้น (free-text โดยธรรมชาติ ไม่มีทาง "เลือกจาก dropdown"
  // ได้จริงสำหรับข้อมูลนำเข้าจำนวนมาก) ยืนยันว่า find-or-create + revive ยังทำงานถูกผ่านทางนั้น
  describe('resolvePositionId shim — CSV bulk import only remaining consumer', () => {
    it('CSV import resolving a soft-deleted position by exact string revives it instead of 500ing', async () => {
      const admin = await setup('ADMIN')
      const position = await prisma.position.create({ data: { nameEn: 'Shim Revivable' } })
      await prisma.position.update({ where: { id: position.id }, data: { deletedAt: new Date() } })

      const email = `shim-revive-${Date.now()}@test.com`
      const csv = ['email,name,position', `${email},Shim Revive,Shim Revivable`].join('\n')
      const body = Buffer.concat([
        Buffer.from(
          '--b\r\n' +
            'Content-Disposition: form-data; name="file"; filename="users.csv"\r\n' +
            'Content-Type: text/csv\r\n\r\n',
        ),
        Buffer.from(csv),
        Buffer.from('\r\n--b--\r\n'),
      ])

      const res = await app.inject({
        method: 'POST',
        url: '/users/import',
        headers: { cookie: admin.cookies, 'content-type': 'multipart/form-data; boundary=b' },
        body,
      })
      expect(res.statusCode).toBe(200)
      expect(res.json<{ created: number }>().created).toBe(1)

      const importedUser = await prisma.user.findUnique({ where: { email } })
      expect(importedUser?.positionId).toBe(position.id)

      const revived = await prisma.position.findUnique({ where: { id: position.id } })
      expect(revived?.deletedAt).toBeNull()
    })

    it('CSV import resolving a brand-new position name creates it (find-or-create)', async () => {
      const admin = await setup('ADMIN')
      const email = `shim-create-${Date.now()}@test.com`
      const newName = `Brand New Position ${Date.now()}`
      const csv = ['email,name,position', `${email},Shim Create,${newName}`].join('\n')
      const body = Buffer.concat([
        Buffer.from(
          '--b\r\n' +
            'Content-Disposition: form-data; name="file"; filename="users.csv"\r\n' +
            'Content-Type: text/csv\r\n\r\n',
        ),
        Buffer.from(csv),
        Buffer.from('\r\n--b--\r\n'),
      ])

      const res = await app.inject({
        method: 'POST',
        url: '/users/import',
        headers: { cookie: admin.cookies, 'content-type': 'multipart/form-data; boundary=b' },
        body,
      })
      expect(res.statusCode).toBe(200)
      expect(res.json<{ created: number }>().created).toBe(1)

      const created = await prisma.position.findFirst({ where: { nameEn: newName } })
      expect(created).not.toBeNull()
    })
  })

  // ─── POST /positions/:id/merge (2C-5) ──────────────────────────────────────

  describe('POST /positions/:id/merge', () => {
    it('moves all users + course links from source to target, then soft-deletes source', async () => {
      const admin = await setup('ADMIN')
      const source = await prisma.position.create({ data: { nameEn: 'Source Position' } })
      const target = await prisma.position.create({ data: { nameEn: 'Target Position' } })

      const { user: u1 } = await createUser({ role: 'USER' })
      const { user: u2 } = await createUser({ role: 'USER' })
      await prisma.user.update({ where: { id: u1.id }, data: { positionId: source.id } })
      await prisma.user.update({ where: { id: u2.id }, data: { positionId: source.id } })

      const course = await prisma.course.create({
        data: { titleEn: 'Course A', categoryEn: 'Safety', status: 'PUBLISHED', accessType: 'POSITION_BASED' },
      })
      await prisma.coursePosition.create({ data: { courseId: course.id, positionId: source.id } })

      const res = await app.inject({
        method: 'POST',
        url: `/positions/${source.id}/merge`,
        headers: { cookie: admin.cookies },
        payload: { targetPositionId: target.id },
      })
      expect(res.statusCode).toBe(200)

      const [movedU1, movedU2] = await Promise.all([
        prisma.user.findUnique({ where: { id: u1.id } }),
        prisma.user.findUnique({ where: { id: u2.id } }),
      ])
      expect(movedU1?.positionId).toBe(target.id)
      expect(movedU2?.positionId).toBe(target.id)

      const courseLink = await prisma.coursePosition.findFirst({ where: { courseId: course.id } })
      expect(courseLink?.positionId).toBe(target.id)

      const deletedSource = await prisma.position.findUnique({ where: { id: source.id } })
      expect(deletedSource?.deletedAt).not.toBeNull()

      // 0 orphan: ไม่มี user/course อ้างอิง source เหลือค้างหลัง merge
      const remainingUsers = await prisma.user.count({ where: { positionId: source.id } })
      const remainingLinks = await prisma.coursePosition.count({ where: { positionId: source.id } })
      expect(remainingUsers).toBe(0)
      expect(remainingLinks).toBe(0)
    })

    it('course linked to BOTH source and target → dedup (source link deleted, not duplicated)', async () => {
      const admin = await setup('ADMIN')
      const source = await prisma.position.create({ data: { nameEn: 'Dup Source' } })
      const target = await prisma.position.create({ data: { nameEn: 'Dup Target' } })

      const course = await prisma.course.create({
        data: { titleEn: 'Shared Course', categoryEn: 'Safety', status: 'DRAFT', accessType: 'POSITION_BASED' },
      })
      await prisma.coursePosition.create({ data: { courseId: course.id, positionId: source.id } })
      await prisma.coursePosition.create({ data: { courseId: course.id, positionId: target.id } })

      const res = await app.inject({
        method: 'POST',
        url: `/positions/${source.id}/merge`,
        headers: { cookie: admin.cookies },
        payload: { targetPositionId: target.id },
      })
      expect(res.statusCode).toBe(200)

      // ไม่ชน unique(courseId, positionId) — เหลือ link เดียวไปที่ target ไม่ใช่ 2 links
      const links = await prisma.coursePosition.findMany({ where: { courseId: course.id } })
      expect(links).toHaveLength(1)
      expect(links[0]?.positionId).toBe(target.id)
    })

    it('merge into itself → 400', async () => {
      const admin = await setup('ADMIN')
      const position = await prisma.position.create({ data: { nameEn: 'Self Merge' } })

      const res = await app.inject({
        method: 'POST',
        url: `/positions/${position.id}/merge`,
        headers: { cookie: admin.cookies },
        payload: { targetPositionId: position.id },
      })
      expect(res.statusCode).toBe(400)
    })

    it('target position does not exist → 400, source untouched', async () => {
      const admin = await setup('ADMIN')
      const source = await prisma.position.create({ data: { nameEn: 'Untouched Source' } })

      const res = await app.inject({
        method: 'POST',
        url: `/positions/${source.id}/merge`,
        headers: { cookie: admin.cookies },
        payload: { targetPositionId: `c${'x'.repeat(24)}` },
      })
      expect(res.statusCode).toBe(400)

      const stillActive = await prisma.position.findUnique({ where: { id: source.id } })
      expect(stillActive?.deletedAt).toBeNull()
    })

    it('audit log POSITION_MERGE written with counts', async () => {
      const admin = await setup('ADMIN')
      const source = await prisma.position.create({ data: { nameEn: 'Audit Source' } })
      const target = await prisma.position.create({ data: { nameEn: 'Audit Target' } })
      const { user } = await createUser({ role: 'USER' })
      await prisma.user.update({ where: { id: user.id }, data: { positionId: source.id } })

      await app.inject({
        method: 'POST',
        url: `/positions/${source.id}/merge`,
        headers: { cookie: admin.cookies },
        payload: { targetPositionId: target.id },
      })

      const log = await prisma.auditLog.findFirst({
        where: { action: 'POSITION_MERGE', targetId: source.id },
        orderBy: { createdAt: 'desc' },
      })
      expect(log).not.toBeNull()
      expect(log?.metadata).toMatchObject({ usersMoved: 1, targetPositionId: target.id })
    })

    it('USER cannot merge → 403', async () => {
      const user = await setup('USER')
      const source = await prisma.position.create({ data: { nameEn: 'Guarded Source' } })
      const target = await prisma.position.create({ data: { nameEn: 'Guarded Target' } })

      const res = await app.inject({
        method: 'POST',
        url: `/positions/${source.id}/merge`,
        headers: { cookie: user.cookies },
        payload: { targetPositionId: target.id },
      })
      expect(res.statusCode).toBe(403)
    })
  })

  // ─── GET /positions/admin — userCount/courseCount (2C-5) ───────────────────

  describe('GET /positions/admin — usage counts', () => {
    it('returns accurate userCount and courseCount per position', async () => {
      const admin = await setup('ADMIN')
      const position = await prisma.position.create({ data: { nameEn: 'Counted Position' } })
      const { user } = await createUser({ role: 'USER' })
      await prisma.user.update({ where: { id: user.id }, data: { positionId: position.id } })

      const course = await prisma.course.create({
        data: { titleEn: 'Counted Course', categoryEn: 'Safety', status: 'DRAFT', accessType: 'POSITION_BASED' },
      })
      await prisma.coursePosition.create({ data: { courseId: course.id, positionId: position.id } })

      const res = await app.inject({
        method: 'GET',
        url: '/positions/admin',
        headers: { cookie: admin.cookies },
      })
      const found = res.json<Array<{ id: string; userCount: number; courseCount: number }>>().find((p) => p.id === position.id)
      expect(found?.userCount).toBe(1)
      expect(found?.courseCount).toBe(1)
    })
  })
})
