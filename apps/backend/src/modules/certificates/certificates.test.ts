import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { buildTestApp, createUser, loginAs, prisma } from '../../test/helpers.js'
import type { TestApp } from '../../test/helpers.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** สร้าง user + course + enrollment + cert ตรงใน DB โดยไม่ผ่าน API
 *  ให้ควบคุม expiresAt / revokedAt ได้อิสระ สำหรับทดสอบทุก status
 */
async function seedCert(opts: {
  expiresAt?: Date | null
  revokedAt?: Date | null
  holderName?: string
}) {
  const holderName = opts.holderName ?? 'Test Holder'
  const { user } = await createUser({ name: holderName })

  const course = await prisma.course.create({
    data: { titleEn: 'Verify Test Course', categoryEn: 'Safety', status: 'PUBLISHED' },
    select: { id: true, titleEn: true },
  })

  const enrollment = await prisma.enrollment.create({
    data: { userId: user.id, courseId: course.id, status: 'COMPLETED' },
    select: { id: true },
  })

  const verifyHash = randomUUID()
  const certNumber = `BTEC-TEST-${randomUUID().slice(0, 8).toUpperCase()}`

  const cert = await prisma.certificate.create({
    data: {
      enrollmentId: enrollment.id,
      userId: user.id,
      courseId: course.id,
      certNumber,
      score: 90,
      verifyHash,
      issuedAt: new Date(),
      expiresAt: opts.expiresAt ?? null,
      revokedAt: opts.revokedAt ?? null,
    },
    select: { id: true },
  })

  return {
    certId: cert.id,
    verifyHash,
    certNumber,
    holderName,
    courseName: course.titleEn,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /verify/:hash — certificate public verification', () => {
  let app: TestApp
  let adminCookies: string

  beforeAll(async () => {
    app = await buildTestApp()
    const { user, plainPassword } = await createUser({ role: 'ADMIN' })
    const res = await loginAs(app, user.email, plainPassword)
    adminCookies = res.cookies
  })

  afterAll(async () => {
    await app.close()
  })

  // ─── Status: valid ─────────────────────────────────────────────────────────

  it('cert with no expiry → status=valid', async () => {
    const { verifyHash } = await seedCert({ expiresAt: null })
    const res = await app.inject({ method: 'GET', url: `/verify/${verifyHash}` })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('valid')
  })

  it('cert expiring in 60 days → status=valid (outside 30-day window)', async () => {
    const future60 = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
    const { verifyHash } = await seedCert({ expiresAt: future60 })
    const res = await app.inject({ method: 'GET', url: `/verify/${verifyHash}` })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('valid')
  })

  // ─── Status: expiring-soon ─────────────────────────────────────────────────

  it('cert expiring in 15 days → status=expiring-soon', async () => {
    const soon = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)
    const { verifyHash } = await seedCert({ expiresAt: soon })
    const res = await app.inject({ method: 'GET', url: `/verify/${verifyHash}` })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('expiring-soon')
  })

  // ─── Status: expired ───────────────────────────────────────────────────────

  it('cert expired yesterday → status=expired', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const { verifyHash } = await seedCert({ expiresAt: yesterday })
    const res = await app.inject({ method: 'GET', url: `/verify/${verifyHash}` })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('expired')
  })

  // ─── Status: revoked (full API flow) ───────────────────────────────────────

  it('revoked cert → 200 status=revoked (not 404, not valid)', async () => {
    const { certId, verifyHash } = await seedCert({ expiresAt: null })

    // revoke via admin API
    const revokeRes = await app.inject({
      method: 'POST',
      url: `/certificates/${certId}/revoke`,
      headers: { cookie: adminCookies },
      payload: { reason: 'Terminated employment' },
    })
    expect(revokeRes.statusCode).toBe(200)
    expect(revokeRes.json().revokedAt).toBeTruthy() // admin response มี revokedAt

    // verify หลัง revoke — ต้องได้ 200 ไม่ใช่ 404
    const res = await app.inject({ method: 'GET', url: `/verify/${verifyHash}` })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.status).toBe('revoked')
    expect(body.status).not.toBe('valid')
    expect(body.status).not.toBe('expired')
  })

  it('revoked cert ที่มี expiresAt ในอนาคต → status ยังคง revoked (ไม่ใช่ valid หรือ expiring-soon)', async () => {
    const future15 = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)
    // revokedAt set ตรงในDB — กัน edge case ที่ revokedAt + expiresAt มีทั้งคู่
    const { verifyHash } = await seedCert({ expiresAt: future15, revokedAt: new Date() })
    const res = await app.inject({ method: 'GET', url: `/verify/${verifyHash}` })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('revoked')
  })

  // ─── Not found ─────────────────────────────────────────────────────────────

  it('unknown hash (valid UUID format) → 404', async () => {
    const res = await app.inject({ method: 'GET', url: `/verify/${randomUUID()}` })
    expect(res.statusCode).toBe(404)
  })

  it('non-UUID hash → 400 validation error', async () => {
    const res = await app.inject({ method: 'GET', url: '/verify/not-a-uuid-at-all' })
    expect(res.statusCode).toBe(400)
  })

  // ─── Response shape: ไม่มี PII เกิน ──────────────────────────────────────

  it('valid cert response: มีเฉพาะ field ที่อนุญาต — ไม่มี email, userId, score, verifyHash ฯลฯ', async () => {
    const { verifyHash, certNumber, holderName, courseName } = await seedCert({
      expiresAt: null,
      holderName: 'Somchai Jaidee',
    })
    const res = await app.inject({ method: 'GET', url: `/verify/${verifyHash}` })
    expect(res.statusCode).toBe(200)
    const body = res.json()

    // fields ที่ต้องมี
    expect(body.certNumber).toBe(certNumber)
    expect(body.holderName).toBe(holderName)
    expect(body.courseName).toBe(courseName)
    expect(body.issuedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(body.status).toBe('valid')
    expect(body.expiresAt).toBeNull()

    // PII / internal fields ที่ห้ามมีใน response
    expect(body.email).toBeUndefined()
    expect(body.employeeId).toBeUndefined()
    expect(body.userId).toBeUndefined()
    expect(body.enrollmentId).toBeUndefined()
    expect(body.score).toBeUndefined()
    expect(body.verifyHash).toBeUndefined()
    expect(body.revokedAt).toBeUndefined()
    expect(body.fileKey).toBeUndefined()
  })

  it('revoked cert response: ไม่รั่ว PII แม้ status ไม่ใช่ 404', async () => {
    const { certId, verifyHash, holderName, courseName, certNumber } = await seedCert({ expiresAt: null })

    await app.inject({
      method: 'POST',
      url: `/certificates/${certId}/revoke`,
      headers: { cookie: adminCookies },
      payload: {},
    })

    const res = await app.inject({ method: 'GET', url: `/verify/${verifyHash}` })
    expect(res.statusCode).toBe(200)
    const body = res.json()

    // fields ที่ต้องมี
    expect(body.certNumber).toBe(certNumber)
    expect(body.holderName).toBe(holderName)
    expect(body.courseName).toBe(courseName)
    expect(body.status).toBe('revoked')

    // ห้ามรั่ว revokedAt หรือ PII ใด ๆ
    expect(body.revokedAt).toBeUndefined()
    expect(body.userId).toBeUndefined()
    expect(body.email).toBeUndefined()
    expect(body.score).toBeUndefined()
    expect(body.verifyHash).toBeUndefined()
    expect(body.enrollmentId).toBeUndefined()
    expect(body.fileKey).toBeUndefined()
  })
})
