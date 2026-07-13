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
  })

  describe('resolvePositionId shim — admin create-user still sends free-text position', () => {
    it('resolving a soft-deleted position by exact string revives it instead of 500ing', async () => {
      const admin = await setup('ADMIN')
      const position = await prisma.position.create({ data: { nameEn: 'Shim Revivable' } })
      await prisma.position.update({ where: { id: position.id }, data: { deletedAt: new Date() } })

      const res = await app.inject({
        method: 'POST',
        url: '/users',
        headers: { cookie: admin.cookies },
        payload: {
          email: `shim-revive-${Date.now()}@test.com`,
          password: 'TestPass1!',
          name: 'Shim Revive',
          position: 'Shim Revivable',
        },
      })
      expect(res.statusCode).toBe(201)
      expect(res.json<{ positionId: string }>().positionId).toBe(position.id)

      const revived = await prisma.position.findUnique({ where: { id: position.id } })
      expect(revived?.deletedAt).toBeNull()
    })
  })
})
