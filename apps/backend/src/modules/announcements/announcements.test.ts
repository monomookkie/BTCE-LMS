import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildTestApp, createUser, loginAs, prisma } from '../../test/helpers.js'
import type { TestApp } from '../../test/helpers.js'
import { hashPassword } from '../../lib/password.js'

// ─── multipart builder ────────────────────────────────────────────────────────

function buildMultipart(
  boundary: string,
  fields: Record<string, string>,
  file?: { fieldname: string; filename: string; mimetype: string; content: Buffer },
): Buffer {
  const parts: Buffer[] = []
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`),
    )
  }
  if (file) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldname}"; filename="${file.filename}"\r\nContent-Type: ${file.mimetype}\r\n\r\n`,
      ),
    )
    parts.push(file.content)
    parts.push(Buffer.from('\r\n'))
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`))
  return Buffer.concat(parts)
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('Announcements module', () => {
  let app: TestApp
  let adminCookies: string
  let userCookies: string

  beforeAll(async () => {
    app = await buildTestApp()

    const admin = await createUser({ role: 'ADMIN' })
    ;({ cookies: adminCookies } = await loginAs(app, admin.user.email, admin.plainPassword))

    const user = await createUser({ role: 'USER' })
    ;({ cookies: userCookies } = await loginAs(app, user.user.email, user.plainPassword))
  })

  afterAll(async () => {
    await app.close()
  })

  // ─── Helper: POST /announcements (multipart) ──────────────────────────────

  async function createAnnouncement(
    fields: Record<string, string>,
    cookies = adminCookies,
    file?: { fieldname: string; filename: string; mimetype: string; content: Buffer },
  ) {
    const boundary = 'testbound'
    const body = buildMultipart(boundary, fields, file)
    return app.inject({
      method: 'POST',
      url: '/announcements',
      headers: {
        cookie: cookies,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    })
  }

  // ─── RBAC ─────────────────────────────────────────────────────────────────

  it('rejects unauthenticated GET /announcements', async () => {
    const res = await app.inject({ method: 'GET', url: '/announcements' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 403 when USER attempts POST', async () => {
    const res = await createAnnouncement(
      { titleEn: 'Test', contentEn: 'Body' },
      userCookies,
    )
    expect(res.statusCode).toBe(403)
  })

  it('returns 403 when USER attempts PATCH', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/announcements/cld000000000000000000001',
      headers: { cookie: userCookies },
      payload: { titleEn: 'New' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns 403 when USER attempts DELETE', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/announcements/cld000000000000000000001',
      headers: { cookie: userCookies },
    })
    expect(res.statusCode).toBe(403)
  })

  // ─── Create validation ────────────────────────────────────────────────────

  it('returns 400 when titleEn is missing', async () => {
    const res = await createAnnouncement({ contentEn: 'Body' })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when contentEn is missing', async () => {
    const res = await createAnnouncement({ titleEn: 'Title' })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when file MIME is not allowed', async () => {
    const res = await createAnnouncement(
      { titleEn: 'T', contentEn: 'C' },
      adminCookies,
      {
        fieldname: 'file',
        filename: 'bad.txt',
        mimetype: 'text/plain',
        content: Buffer.from('hello'),
      },
    )
    expect(res.statusCode).toBe(400)
  })

  // ─── Create + read back (ADMIN shape) ────────────────────────────────────

  it('ADMIN creates DRAFT announcement — returns admin shape', async () => {
    const res = await createAnnouncement({
      titleEn: 'Draft notice',
      titleTh: 'แจ้งฉบับร่าง',
      contentEn: 'Draft body',
      contentTh: 'เนื้อหาร่าง',
      status: 'DRAFT',
    })
    expect(res.statusCode).toBe(201)
    const body = res.json<{
      id: string; title: string; content: string; status: string
      titleEn: string; titleTh: string | null
      contentEn: string; contentTh: string | null
    }>()
    // localized (default locale = 'en')
    expect(body.title).toBe('Draft notice')
    expect(body.content).toBe('Draft body')
    // raw bilingual fields present in admin shape
    expect(body.titleEn).toBe('Draft notice')
    expect(body.titleTh).toBe('แจ้งฉบับร่าง')
    expect(body.contentEn).toBe('Draft body')
    expect(body.contentTh).toBe('เนื้อหาร่าง')
    expect(body.status).toBe('DRAFT')
    expect(body.id).toBeTruthy()
  })

  it('ADMIN creates PUBLISHED announcement — publishedAt is set', async () => {
    const res = await createAnnouncement({
      titleEn: 'Public notice',
      contentEn: 'Public body',
      status: 'PUBLISHED',
    })
    expect(res.statusCode).toBe(201)
    const body = res.json<{ status: string; publishedAt: string | null }>()
    expect(body.status).toBe('PUBLISHED')
    expect(body.publishedAt).not.toBeNull()
  })

  // ─── List: USER sees only PUBLISHED ──────────────────────────────────────

  it('USER sees only PUBLISHED in list, not DRAFT', async () => {
    // seed 1 draft + 1 published
    await createAnnouncement({ titleEn: 'Draft A', contentEn: 'D', status: 'DRAFT' })
    await createAnnouncement({ titleEn: 'Pub B', contentEn: 'P', status: 'PUBLISHED' })

    const res = await app.inject({
      method: 'GET',
      url: '/announcements',
      headers: { cookie: userCookies },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: { title: string; status?: string }[]; total: number }>()

    // USER: only PUBLISHED row visible
    expect(body.data.every((r) => !('status' in r))).toBe(true) // public schema — no status field
    const titles = body.data.map((r) => r.title)
    expect(titles).toContain('Pub B')
    expect(titles).not.toContain('Draft A')
  })

  it('ADMIN sees DRAFT + PUBLISHED in list, gets admin shape', async () => {
    await createAnnouncement({ titleEn: 'Draft X', contentEn: 'D', status: 'DRAFT' })
    await createAnnouncement({ titleEn: 'Pub Y', contentEn: 'P', status: 'PUBLISHED' })

    const res = await app.inject({
      method: 'GET',
      url: '/announcements',
      headers: { cookie: adminCookies },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: { title: string; status: string; titleEn: string }[] }>()

    // ADMIN shape — has raw fields
    expect(body.data.every((r) => 'status' in r && 'titleEn' in r)).toBe(true)
    const titles = body.data.map((r) => r.title)
    expect(titles).toContain('Draft X')
    expect(titles).toContain('Pub Y')
  })

  // ─── GET :id ──────────────────────────────────────────────────────────────

  it('USER cannot GET a DRAFT announcement → 404', async () => {
    const createRes = await createAnnouncement({
      titleEn: 'Hidden draft',
      contentEn: 'Secret',
      status: 'DRAFT',
    })
    const { id } = createRes.json<{ id: string }>()

    const res = await app.inject({
      method: 'GET',
      url: `/announcements/${id}`,
      headers: { cookie: userCookies },
    })
    expect(res.statusCode).toBe(404)
  })

  it('USER gets PUBLISHED announcement with public shape (no raw En/Th fields)', async () => {
    const createRes = await createAnnouncement({
      titleEn: 'Public one',
      titleTh: 'สาธารณะ',
      contentEn: 'Content',
      contentTh: 'เนื้อหา',
      status: 'PUBLISHED',
    })
    const { id } = createRes.json<{ id: string }>()

    const res = await app.inject({
      method: 'GET',
      url: `/announcements/${id}`,
      headers: { cookie: userCookies },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<Record<string, unknown>>()

    // localized title returned (en locale for default user)
    expect(body['title']).toBe('Public one')
    expect(body['content']).toBe('Content')
    // NO raw bilingual fields — public schema strips them
    expect(body).not.toHaveProperty('titleEn')
    expect(body).not.toHaveProperty('titleTh')
    expect(body).not.toHaveProperty('contentEn')
    expect(body).not.toHaveProperty('contentTh')
    expect(body).not.toHaveProperty('status')
    expect(body).not.toHaveProperty('createdById')
    expect(body).not.toHaveProperty('updatedAt')
  })

  it('ADMIN gets any announcement with admin shape (raw fields present)', async () => {
    const createRes = await createAnnouncement({
      titleEn: 'Admin view',
      titleTh: 'แอดมินดู',
      contentEn: 'Body',
      status: 'DRAFT',
    })
    const { id } = createRes.json<{ id: string }>()

    const res = await app.inject({
      method: 'GET',
      url: `/announcements/${id}`,
      headers: { cookie: adminCookies },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<Record<string, unknown>>()
    expect(body['titleEn']).toBe('Admin view')
    expect(body['titleTh']).toBe('แอดมินดู')
    expect(body['status']).toBe('DRAFT')
    expect(body).toHaveProperty('updatedAt')
    expect(body).toHaveProperty('createdById')
  })

  // ─── Bilingual fallback: Th empty + locale=th → returns En ───────────────

  it('locale=th + titleTh empty → falls back to titleEn in localized title', async () => {
    // สร้าง user ที่มี language='th' โดยตรงใน DB
    const thUser = await prisma.user.create({
      data: {
        email: `th-user-${Date.now()}@test.com`,
        password: await hashPassword('TestPass1!'),
        name: 'Thai User',
        role: 'USER',
        isActive: true,
        mustChangePassword: false,
        language: 'th', // locale='th' จะถูก resolve จากนี้
      },
      select: { id: true, email: true },
    })
    const { cookies: thCookies } = await loginAs(app, thUser.email, 'TestPass1!')

    // สร้าง announcement ที่ titleTh ว่าง (no Th translation)
    const createRes = await createAnnouncement({
      titleEn: 'English title only',
      contentEn: 'Content EN only',
      // titleTh not provided → null in DB
      status: 'PUBLISHED',
    })
    const { id } = createRes.json<{ id: string }>()

    const res = await app.inject({
      method: 'GET',
      url: `/announcements/${id}`,
      headers: { cookie: thCookies },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ title: string; content: string }>()

    // fallback: Th is null → return En value
    expect(body.title).toBe('English title only')
    expect(body.content).toBe('Content EN only')
  })

  it('locale=th + titleTh filled → returns Thai value', async () => {
    const thUser = await prisma.user.create({
      data: {
        email: `th-user2-${Date.now()}@test.com`,
        password: await hashPassword('TestPass1!'),
        name: 'Thai User 2',
        role: 'USER',
        isActive: true,
        mustChangePassword: false,
        language: 'th',
      },
      select: { id: true, email: true },
    })
    const { cookies: thCookies } = await loginAs(app, thUser.email, 'TestPass1!')

    const createRes = await createAnnouncement({
      titleEn: 'EN title',
      titleTh: 'หัวข้อภาษาไทย',
      contentEn: 'EN body',
      contentTh: 'เนื้อหาภาษาไทย',
      status: 'PUBLISHED',
    })
    const { id } = createRes.json<{ id: string }>()

    const res = await app.inject({
      method: 'GET',
      url: `/announcements/${id}`,
      headers: { cookie: thCookies },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ title: string; content: string }>()
    expect(body.title).toBe('หัวข้อภาษาไทย')
    expect(body.content).toBe('เนื้อหาภาษาไทย')
  })

  // ─── File attach → fileKey not base64 ────────────────────────────────────

  it('file attach stores fileKey (not base64) and returns signedUrl', async () => {
    const fakeImage = Buffer.from('GIF89a') // minimal GIF header
    const res = await createAnnouncement(
      { titleEn: 'With file', contentEn: 'Body', status: 'DRAFT' },
      adminCookies,
      {
        fieldname: 'file',
        filename: 'notice.jpg',
        mimetype: 'image/jpeg',
        content: fakeImage,
      },
    )
    expect(res.statusCode).toBe(201)
    const body = res.json<{
      fileKey: string | null
      fileSignedUrl: string | null
    }>()

    // fileKey must be stored (non-null), must NOT be base64
    expect(body.fileKey).not.toBeNull()
    expect(typeof body.fileKey).toBe('string')
    // base64 strings contain '/' or '+' or '==' — and are long
    // a fileKey (e.g. "announcements/uuid.jpg") should NOT be valid base64-encoded content
    expect(body.fileKey).not.toMatch(/^[A-Za-z0-9+/]+=*$/) // not pure base64
    expect(body.fileKey!.length).toBeLessThan(200)           // reasonable length

    // signedUrl returned (FakeStorage returns a fixed URL)
    expect(body.fileSignedUrl).not.toBeNull()
  })

  // ─── PATCH: publish / unpublish ───────────────────────────────────────────

  it('PATCH: publish a DRAFT → status becomes PUBLISHED, publishedAt set', async () => {
    const createRes = await createAnnouncement({
      titleEn: 'To publish',
      contentEn: 'Body',
      status: 'DRAFT',
    })
    const { id } = createRes.json<{ id: string }>()

    const res = await app.inject({
      method: 'PATCH',
      url: `/announcements/${id}`,
      headers: { cookie: adminCookies },
      payload: { status: 'PUBLISHED' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ status: string; publishedAt: string | null }>()
    expect(body.status).toBe('PUBLISHED')
    expect(body.publishedAt).not.toBeNull()
  })

  it('PATCH: unpublish (PUBLISHED → DRAFT) → publishedAt cleared', async () => {
    const createRes = await createAnnouncement({
      titleEn: 'To unpublish',
      contentEn: 'Body',
      status: 'PUBLISHED',
    })
    const { id } = createRes.json<{ id: string }>()

    const res = await app.inject({
      method: 'PATCH',
      url: `/announcements/${id}`,
      headers: { cookie: adminCookies },
      payload: { status: 'DRAFT' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ status: string; publishedAt: string | null }>()
    expect(body.status).toBe('DRAFT')
    expect(body.publishedAt).toBeNull()
  })

  it('PATCH: update content fields', async () => {
    const createRes = await createAnnouncement({
      titleEn: 'Old title',
      contentEn: 'Old body',
    })
    const { id } = createRes.json<{ id: string }>()

    const res = await app.inject({
      method: 'PATCH',
      url: `/announcements/${id}`,
      headers: { cookie: adminCookies },
      payload: { titleEn: 'New title', contentTh: 'เนื้อหาใหม่' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ titleEn: string; contentTh: string | null }>()
    expect(body.titleEn).toBe('New title')
    expect(body.contentTh).toBe('เนื้อหาใหม่')
  })

  it('PATCH returns 404 for non-existent announcement', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/announcements/claaaaaaaaaaaaaaaaaaaa01',
      headers: { cookie: adminCookies },
      payload: { titleEn: 'New' },
    })
    expect(res.statusCode).toBe(404)
  })

  // ─── Soft delete ──────────────────────────────────────────────────────────

  it('DELETE soft-deletes; subsequent GET returns 404 for ADMIN', async () => {
    const createRes = await createAnnouncement({
      titleEn: 'To delete',
      contentEn: 'Body',
      status: 'DRAFT',
    })
    const { id } = createRes.json<{ id: string }>()

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/announcements/${id}`,
      headers: { cookie: adminCookies },
    })
    expect(delRes.statusCode).toBe(200)
    const { message } = delRes.json<{ message: string }>()
    expect(typeof message).toBe('string')

    // Verify: ADMIN can no longer GET the deleted announcement
    const getRes = await app.inject({
      method: 'GET',
      url: `/announcements/${id}`,
      headers: { cookie: adminCookies },
    })
    expect(getRes.statusCode).toBe(404)
  })

  it('deleted announcement excluded from list', async () => {
    const createRes = await createAnnouncement({
      titleEn: 'Will be deleted',
      contentEn: 'Body',
      status: 'PUBLISHED',
    })
    const { id } = createRes.json<{ id: string }>()

    await app.inject({
      method: 'DELETE',
      url: `/announcements/${id}`,
      headers: { cookie: adminCookies },
    })

    const listRes = await app.inject({
      method: 'GET',
      url: '/announcements',
      headers: { cookie: adminCookies },
    })
    const body = listRes.json<{ data: { id: string }[] }>()
    expect(body.data.every((r) => r.id !== id)).toBe(true)
  })

  it('DELETE returns 404 for non-existent announcement', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/announcements/claaaaaaaaaaaaaaaaaaaa02',
      headers: { cookie: adminCookies },
    })
    expect(res.statusCode).toBe(404)
  })
})
