import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildTestApp, createUser, loginAs, prisma } from '../../test/helpers.js'
import type { TestApp } from '../../test/helpers.js'

describe('Notifications module', () => {
  let app: TestApp

  beforeAll(async () => {
    app = await buildTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  // ─── Helper ───────────────────────────────────────────────────────────────
  // ต้องรับ userId ที่ยังมีอยู่ใน DB (beforeEach ลบ users ทุก test)
  // → สร้าง user ใน test เอง แล้วส่ง id เข้ามา

  async function seedNotification(userId: string, readAt: Date | null = null) {
    return prisma.notification.create({
      data: {
        userId,
        title: `Notice for ${userId.slice(-4)}`,
        body: 'Test body',
        link: '/test',
        readAt,
      },
    })
  }

  // ─── Auth ─────────────────────────────────────────────────────────────────

  it('rejects unauthenticated GET /notifications/me → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/notifications/me' })
    expect(res.statusCode).toBe(401)
  })

  it('rejects unauthenticated PATCH /notifications/:id/read → 401', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/notifications/claaaaaaaaaaaaaaaaaaaa01/read',
    })
    expect(res.statusCode).toBe(401)
  })

  it('rejects unauthenticated PATCH /notifications/read-all → 401', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/notifications/read-all' })
    expect(res.statusCode).toBe(401)
  })

  // ─── GET /notifications/me — isolation ────────────────────────────────────

  it('GET /me returns only own notifications (not other user\'s)', async () => {
    const a = await createUser({ role: 'USER' })
    const b = await createUser({ role: 'USER' })
    const { cookies: aCookies } = await loginAs(app, a.user.email, a.plainPassword)

    // seed 2 for userA, 1 for userB
    await seedNotification(a.user.id)
    await seedNotification(a.user.id)
    await seedNotification(b.user.id)

    const res = await app.inject({
      method: 'GET',
      url: '/notifications/me',
      headers: { cookie: aCookies },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: { id: string }[]; total: number }>()

    // prove B's notification actually exists in DB before asserting A can't see it
    const bNotifs = await prisma.notification.findMany({ where: { userId: b.user.id } })
    expect(bNotifs).toHaveLength(1) // ของ B มีอยู่ใน DB จริง
    const bIds = new Set(bNotifs.map((n) => n.id))
    expect(body.data.every((n) => !bIds.has(n.id))).toBe(true) // A ไม่เห็นของ B
    expect(body.total).toBe(2)
  })

  it('GET /me returns correct unread count', async () => {
    const c = await createUser({ role: 'USER' })
    const { cookies: cCookies } = await loginAs(app, c.user.email, c.plainPassword)

    const past = new Date(Date.now() - 1000)
    await seedNotification(c.user.id, past) // read
    await seedNotification(c.user.id)       // unread
    await seedNotification(c.user.id)       // unread

    const res = await app.inject({
      method: 'GET',
      url: '/notifications/me',
      headers: { cookie: cCookies },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ total: number; unreadCount: number }>()
    expect(body.total).toBe(3)
    expect(body.unreadCount).toBe(2)
  })

  it('GET /me supports pagination (limit=1)', async () => {
    const d = await createUser({ role: 'USER' })
    const { cookies: dCookies } = await loginAs(app, d.user.email, d.plainPassword)
    await seedNotification(d.user.id)
    await seedNotification(d.user.id)

    const res = await app.inject({
      method: 'GET',
      url: '/notifications/me?page=1&limit=1',
      headers: { cookie: dCookies },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: unknown[]; total: number }>()
    expect(body.data).toHaveLength(1)
    expect(body.total).toBe(2)
  })

  // ─── PATCH /:id/read — happy path ─────────────────────────────────────────

  it('mark single notification as read → readAt is set, unreadCount decreases', async () => {
    const e = await createUser({ role: 'USER' })
    const { cookies: eCookies } = await loginAs(app, e.user.email, e.plainPassword)

    const n1 = await seedNotification(e.user.id) // unread
    await seedNotification(e.user.id)            // unread

    // before: unreadCount = 2
    const before = await app.inject({
      method: 'GET',
      url: '/notifications/me',
      headers: { cookie: eCookies },
    })
    expect(before.json<{ unreadCount: number }>().unreadCount).toBe(2)

    // mark one read
    const res = await app.inject({
      method: 'PATCH',
      url: `/notifications/${n1.id}/read`,
      headers: { cookie: eCookies },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ readAt: string | null }>()
    expect(body.readAt).not.toBeNull()

    // after: unreadCount = 1
    const after = await app.inject({
      method: 'GET',
      url: '/notifications/me',
      headers: { cookie: eCookies },
    })
    expect(after.json<{ unreadCount: number }>().unreadCount).toBe(1)
  })

  // ─── PATCH /:id/read — idempotent ─────────────────────────────────────────

  it('mark read is idempotent — marking already-read notification returns 200 without error', async () => {
    const f = await createUser({ role: 'USER' })
    const { cookies: fCookies } = await loginAs(app, f.user.email, f.plainPassword)
    const past = new Date(Date.now() - 5000)
    const n = await seedNotification(f.user.id, past) // already read

    const res1 = await app.inject({
      method: 'PATCH',
      url: `/notifications/${n.id}/read`,
      headers: { cookie: fCookies },
    })
    expect(res1.statusCode).toBe(200)
    expect(res1.json<{ readAt: string | null }>().readAt).not.toBeNull()

    // second mark — same result, no error
    const res2 = await app.inject({
      method: 'PATCH',
      url: `/notifications/${n.id}/read`,
      headers: { cookie: fCookies },
    })
    expect(res2.statusCode).toBe(200)
    expect(res2.json<{ readAt: string | null }>().readAt).toBe(
      res1.json<{ readAt: string }>().readAt,
    )
  })

  // ─── IDOR: mark read on another user's notification ───────────────────────

  it('IDOR: userA cannot mark userB\'s notification as read → 404, userB\'s notification unchanged', async () => {
    const a = await createUser({ role: 'USER' })
    const b = await createUser({ role: 'USER' })
    const { cookies: aCookies } = await loginAs(app, a.user.email, a.plainPassword)

    const bNotif = await seedNotification(b.user.id) // belongs to userB

    // userA tries to mark it
    const res = await app.inject({
      method: 'PATCH',
      url: `/notifications/${bNotif.id}/read`,
      headers: { cookie: aCookies },
    })
    expect(res.statusCode).toBe(404)

    // verify: userB's notification still exists AND is still unread
    const unchanged = await prisma.notification.findUnique({ where: { id: bNotif.id } })
    expect(unchanged).not.toBeNull()          // ของ B ยังอยู่ใน DB
    expect(unchanged!.readAt).toBeNull()      // readAt ไม่ถูกแตะ
  })

  // ─── PATCH /read-all ──────────────────────────────────────────────────────

  it('read-all marks all own unread as read; does not touch other user\'s', async () => {
    const g = await createUser({ role: 'USER' })
    const b = await createUser({ role: 'USER' })
    const { cookies: gCookies } = await loginAs(app, g.user.email, g.plainPassword)

    // 3 unread for userG, 1 unread for userB
    await seedNotification(g.user.id)
    await seedNotification(g.user.id)
    await seedNotification(g.user.id)
    const bNotifBefore = await seedNotification(b.user.id)

    const res = await app.inject({
      method: 'PATCH',
      url: '/notifications/read-all',
      headers: { cookie: gCookies },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json<{ count: number }>().count).toBe(3)

    // userG's notifications all read
    const gUnread = await prisma.notification.count({
      where: { userId: g.user.id, readAt: null },
    })
    expect(gUnread).toBe(0)

    // verify: userB's notification still exists AND was not marked read
    const bNotifAfter = await prisma.notification.findUnique({
      where: { id: bNotifBefore.id },
    })
    expect(bNotifAfter).not.toBeNull()        // ของ B ยังอยู่ใน DB
    expect(bNotifAfter!.readAt).toBeNull()    // read-all ของ G ไม่ไปแตะของ B
  })

  it('read-all when already all read → count 0, no error', async () => {
    const h = await createUser({ role: 'USER' })
    const { cookies: hCookies } = await loginAs(app, h.user.email, h.plainPassword)
    const past = new Date(Date.now() - 1000)
    await seedNotification(h.user.id, past) // already read

    const res = await app.inject({
      method: 'PATCH',
      url: '/notifications/read-all',
      headers: { cookie: hCookies },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json<{ count: number }>().count).toBe(0)
  })

  // ─── params validation ────────────────────────────────────────────────────

  it('invalid cuid in /:id/read → 400', async () => {
    const u = await createUser({ role: 'USER' })
    const { cookies } = await loginAs(app, u.user.email, u.plainPassword)

    const res = await app.inject({
      method: 'PATCH',
      url: '/notifications/not-a-cuid/read',
      headers: { cookie: cookies },
    })
    expect(res.statusCode).toBe(400)
  })
})
