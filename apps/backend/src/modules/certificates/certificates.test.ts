import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildTestApp, createUser, loginAs, prisma } from '../../test/helpers.js'
import type { TestApp } from '../../test/helpers.js'

// ─── multipart body builder ───────────────────────────────────────────────────
// สร้าง multipart/form-data buffer สำหรับ inject() — รองรับ optional file

function buildMultipart(
  boundary: string,
  fields: Record<string, string>,
  file?: { fieldname: string; filename: string; mimetype: string; content: Buffer },
): Buffer {
  const parts: Buffer[] = []

  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${name}"\r\n` +
        `\r\n${value}\r\n`,
      ),
    )
  }

  if (file) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${file.fieldname}"; filename="${file.filename}"\r\n` +
        `Content-Type: ${file.mimetype}\r\n\r\n`,
      ),
    )
    parts.push(file.content)
    parts.push(Buffer.from('\r\n'))
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`))
  return Buffer.concat(parts)
}

type ExtCertRes = { id: string; fileKey: string | null; signedUrl: string | null }

describe('External certificates', () => {
  let app: TestApp

  beforeAll(async () => {
    app = await buildTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  async function makeUser() {
    const { user, plainPassword } = await createUser({ role: 'USER' })
    const { cookies } = await loginAs(app, user.email, plainPassword)
    return { cookies, userId: user.id }
  }

  async function seedExternalCert(userId: string) {
    return prisma.externalCertificate.create({
      data: {
        userId,
        title: 'External Cert',
        issuer: 'Some Org',
        issuedAt: new Date(),
      },
      select: { id: true },
    })
  }

  it('POST (metadata only, no file) → 201, fileKey null, signedUrl null', async () => {
    const user = await makeUser()
    const boundary = `----B${Date.now()}`
    const res = await app.inject({
      method: 'POST',
      url: '/external-certs',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, cookie: user.cookies },
      payload: buildMultipart(boundary, {
        title: 'CPR Certification',
        issuer: 'Thai Red Cross',
        issuedAt: '2024-01-01T00:00:00.000Z',
      }),
    })
    expect(res.statusCode).toBe(201)
    const cert = res.json<ExtCertRes>()
    expect(cert.fileKey).toBeNull()
    expect(cert.signedUrl).toBeNull()
  })

  it('POST with PDF file → fileKey is storage path (not base64), signedUrl present', async () => {
    const user = await makeUser()
    const boundary = `----B${Date.now()}`
    const fakePdf = Buffer.from('%PDF-1.4 fake pdf content for test')
    const res = await app.inject({
      method: 'POST',
      url: '/external-certs',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, cookie: user.cookies },
      payload: buildMultipart(
        boundary,
        { title: 'Cert with File', issuer: 'Ministry', issuedAt: '2024-06-01T00:00:00.000Z' },
        { fieldname: 'file', filename: 'cert.pdf', mimetype: 'application/pdf', content: fakePdf },
      ),
    })
    expect(res.statusCode).toBe(201)
    const cert = res.json<ExtCertRes>()

    expect(cert.fileKey).not.toBeNull()
    // FakeStorageProvider ใน NODE_ENV=test ใช้ prefix fake/
    expect(cert.fileKey).toMatch(/^fake\/certificates\//)
    // ไม่ใช่ base64 raw ของเนื้อไฟล์
    expect(cert.fileKey).not.toEqual(fakePdf.toString('base64'))
    expect(cert.signedUrl).toMatch(/^https:\/\//)
  })

  it('GET /external-certs/:id → IDOR: other user → 404', async () => {
    const u1 = await makeUser()
    const u2 = await makeUser()
    const boundary = `----B${Date.now()}`
    const createRes = await app.inject({
      method: 'POST',
      url: '/external-certs',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, cookie: u1.cookies },
      payload: buildMultipart(boundary, { title: 'Private', issuer: 'Org', issuedAt: '2024-01-01T00:00:00.000Z' }),
    })
    const certId = createRes.json<ExtCertRes>().id

    const res = await app.inject({
      method: 'GET',
      url: `/external-certs/${certId}`,
      headers: { cookie: u2.cookies },
    })
    expect(res.statusCode).toBe(404)
  })

  it('DELETE → soft delete: GET returns 404; DB record has deletedAt set', async () => {
    const user = await makeUser()
    const boundary = `----B${Date.now()}`
    const createRes = await app.inject({
      method: 'POST',
      url: '/external-certs',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, cookie: user.cookies },
      payload: buildMultipart(boundary, { title: 'To Delete', issuer: 'Org', issuedAt: '2024-01-01T00:00:00.000Z' }),
    })
    const certId = createRes.json<ExtCertRes>().id

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/external-certs/${certId}`,
      headers: { cookie: user.cookies },
    })
    expect(delRes.statusCode).toBe(200)

    // GET after delete → 404
    expect(
      (await app.inject({ method: 'GET', url: `/external-certs/${certId}`, headers: { cookie: user.cookies } })).statusCode,
    ).toBe(404)

    // DB: soft delete — record exists with deletedAt set
    const record = await prisma.externalCertificate.findUnique({ where: { id: certId } })
    expect(record).not.toBeNull()
    expect(record!.deletedAt).not.toBeNull()
  })

  it('DELETE /external-certs/:id → IDOR: other user → 404, record unchanged', async () => {
    const u1 = await makeUser()
    const u2 = await makeUser()
    const boundary = `----B${Date.now()}`
    const createRes = await app.inject({
      method: 'POST',
      url: '/external-certs',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, cookie: u1.cookies },
      payload: buildMultipart(boundary, { title: 'Protected', issuer: 'Org', issuedAt: '2024-01-01T00:00:00.000Z' }),
    })
    const certId = createRes.json<ExtCertRes>().id

    expect(
      (await app.inject({ method: 'DELETE', url: `/external-certs/${certId}`, headers: { cookie: u2.cookies } })).statusCode,
    ).toBe(404)

    // ยังไม่ถูกลบ
    const record = await prisma.externalCertificate.findUnique({ where: { id: certId } })
    expect(record!.deletedAt).toBeNull()
  })

  it('ADMIN can view any user external certs via ?userId=', async () => {
    const { user: targetUser } = await createUser({ role: 'USER' })
    await seedExternalCert(targetUser.id)

    const { user: adminUser, plainPassword } = await createUser({ role: 'ADMIN' })
    const { cookies: adminCookies } = await loginAs(app, adminUser.email, plainPassword)

    const res = await app.inject({
      method: 'GET',
      url: `/external-certs?userId=${targetUser.id}`,
      headers: { cookie: adminCookies },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json<unknown[]>()).toHaveLength(1)
  })

  it('USER querying another user\'s userId still only gets own certs back (no leak)', async () => {
    const { user: targetUser } = await createUser({ role: 'USER' })
    await seedExternalCert(targetUser.id)

    const { user: otherUser, plainPassword } = await createUser({ role: 'USER' })
    const { cookies: otherCookies } = await loginAs(app, otherUser.email, plainPassword)

    const res = await app.inject({
      method: 'GET',
      url: `/external-certs?userId=${targetUser.id}`,
      headers: { cookie: otherCookies },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json<unknown[]>()).toHaveLength(0) // own certs (none), not targetUser's
  })
})
