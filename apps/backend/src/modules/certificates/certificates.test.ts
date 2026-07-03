import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { buildTestApp, createUser, loginAs, prisma } from '../../test/helpers.js'
import type { TestApp } from '../../test/helpers.js'
import type { CertificatePublicResponse, CertificateAdminResponse } from '@btec-lms/shared'

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
      courseTitleEn: course.titleEn,
      courseTitleTh: null,
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
    // revoke reason ต้องไม่โผล่ public verify response (เก็บแค่ audit log)
    expect(body.reason).toBeUndefined()
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
    expect(body.userName).toBeUndefined()
    expect(body.userEmail).toBeUndefined()
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
    expect(body.userName).toBeUndefined()
    expect(body.userEmail).toBeUndefined()
    expect(body.email).toBeUndefined()
    expect(body.score).toBeUndefined()
    expect(body.verifyHash).toBeUndefined()
    expect(body.enrollmentId).toBeUndefined()
    expect(body.fileKey).toBeUndefined()
  })

  // ─── userName/userEmail: admin-only field — ต้องไม่รั่วไปที่ USER (Convention #12) ──

  it('USER GET /certificates (own list) → public shape, ไม่มี userEmail/userName/userId', async () => {
    const { user, plainPassword } = await createUser({ role: 'USER', name: 'Somchai Jaidee' })
    const { cookies } = await loginAs(app, user.email, plainPassword)

    const course = await prisma.course.create({
      data: { titleEn: 'Own List Course', categoryEn: 'Safety', status: 'PUBLISHED' },
      select: { id: true, titleEn: true },
    })
    const enrollment = await prisma.enrollment.create({
      data: { userId: user.id, courseId: course.id, status: 'COMPLETED' },
      select: { id: true },
    })
    await prisma.certificate.create({
      data: {
        enrollmentId: enrollment.id,
        userId: user.id,
        courseId: course.id,
        courseTitleEn: course.titleEn,
        courseTitleTh: null,
        certNumber: `BTEC-PUB-${randomUUID().slice(0, 8).toUpperCase()}`,
        score: 90,
        verifyHash: randomUUID(),
        issuedAt: new Date(),
      },
    })

    const res = await app.inject({ method: 'GET', url: '/certificates', headers: { cookie: cookies } })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: Record<string, unknown>[] }>()
    expect(body.data).toHaveLength(1)
    const cert = body.data[0]!

    // public shape ต้องมีเฉพาะ localized/base fields
    expect(cert['certNumber']).toBeDefined()
    expect(cert['courseTitle']).toBeDefined()
    expect(cert['status']).toBeDefined()

    // admin-only fields ห้ามรั่วไปที่ USER — serializeByRole ต้อง strip จริง ไม่ใช่แค่ไม่ใส่ใน shape
    expect(cert['userId']).toBeUndefined()
    expect(cert['userName']).toBeUndefined()
    expect(cert['userEmail']).toBeUndefined()
    expect(cert['verifyHash']).toBeUndefined()
    expect(cert['fileKey']).toBeUndefined()
    expect(cert['revokedAt']).toBeUndefined()
    expect(cert['enrollmentId']).toBeUndefined()
  })
})

describe('GET /certificates — list + courseTitle (snapshot)', () => {
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

  it('cert issued via API → courseTitle is snapshot of course name at issue time', async () => {
    // Create course + user + enroll + complete → cert issued automatically
    const { user, plainPassword } = await createUser({ role: 'USER' })
    const { cookies: userCookies } = await loginAs(app, user.email, plainPassword)

    // Create + publish course
    const courseRes = await app.inject({
      method: 'POST',
      url: '/courses',
      headers: { cookie: adminCookies },
      payload: { titleEn: 'Original Course Name', categoryEn: 'Safety', passScore: 80 },
    })
    const courseId = courseRes.json<{ id: string }>().id
    await app.inject({
      method: 'PATCH',
      url: `/courses/${courseId}/status`,
      headers: { cookie: adminCookies },
      payload: { status: 'PUBLISHED' },
    })

    // Assign + complete (no materials, no quiz → completes immediately)
    const assignRes = await app.inject({
      method: 'POST',
      url: '/enrollments',
      headers: { cookie: adminCookies },
      payload: { userId: user.id, courseId },
    })
    const enrollmentId = assignRes.json<{ id: string }>().id

    // Force enrollment to COMPLETED status directly in DB to trigger cert issuance
    await prisma.enrollment.update({
      where: { id: enrollmentId },
      data: { status: 'COMPLETED', progress: 100, completedAt: new Date() },
    })
    // Trigger cert issuance via API: mark a non-existent material (service will complete anyway if status already COMPLETED)
    // Better: use the complete-material route to trigger onEnrollmentCompleted
    // Simpler: call the quiz pass route — but there's no quiz. Use seedCert-like direct cert creation via the API flow.
    // Use issueCertificate through the service hook directly
    const { onEnrollmentCompleted } = await import('./certificates.service.js')
    await onEnrollmentCompleted(prisma, enrollmentId)

    // Cert should be issued — find it
    const cert = await prisma.certificate.findFirst({
      where: { enrollmentId },
      select: { id: true, courseTitleEn: true, courseTitleTh: true },
    })
    expect(cert).not.toBeNull()
    expect(cert!.courseTitleEn).toBe('Original Course Name') // snapshot stored

    // Now rename the course
    await app.inject({
      method: 'PATCH',
      url: `/courses/${courseId}`,
      headers: { cookie: adminCookies },
      payload: { titleEn: 'Renamed Course Name' },
    })

    // Cert via API should still show ORIGINAL name (snapshot, not join-live)
    const certRes = await app.inject({
      method: 'GET',
      url: `/certificates/${cert!.id}`,
      headers: { cookie: userCookies },
    })
    expect(certRes.statusCode).toBe(200)
    expect(certRes.json<CertificatePublicResponse>().courseTitle).toBe('Original Course Name')
  })

  it('rename course after issue → /verify/:hash still shows original name', async () => {
    const { certId, verifyHash } = await seedCert({ expiresAt: null })
    // seedCert stores courseTitleEn = 'Verify Test Course'

    // Find the courseId from the cert
    const certRow = await prisma.certificate.findUnique({
      where: { id: certId },
      select: { courseId: true, courseTitleEn: true },
    })
    expect(certRow!.courseTitleEn).toBe('Verify Test Course') // snapshot confirmed

    // Rename the course directly in DB (simulating admin rename after cert issuance)
    await prisma.course.update({
      where: { id: certRow!.courseId },
      data: { titleEn: 'Course Name Changed After Issue' },
    })

    // Public verify still shows the original snapshot name
    const res = await app.inject({ method: 'GET', url: `/verify/${verifyHash}` })
    expect(res.statusCode).toBe(200)
    expect(res.json().courseName).toBe('Verify Test Course') // snapshot, not 'Course Name Changed After Issue'
  })

  it('GET /certificates list → courseTitle present, no raw En/Th in response', async () => {
    const { certId } = await seedCert({ expiresAt: null })
    const userId = (await prisma.certificate.findUnique({ where: { id: certId }, select: { userId: true } }))!.userId

    const res = await app.inject({
      method: 'GET',
      url: `/certificates?page=1&limit=50&userId=${userId}`,
      headers: { cookie: adminCookies },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: CertificateAdminResponse[] }>()
    const found = body.data.find((c) => c.id === certId)
    expect(found).toBeDefined()
    expect(found!.courseTitle).toBe('Verify Test Course')
    expect(found!.userId).toBeDefined() // admin sees userId
    expect((found as Record<string, unknown>).courseTitleEn).toBeUndefined() // no raw snapshot fields in response
    expect((found as Record<string, unknown>).courseTitleTh).toBeUndefined()
  })
})

describe('GET /certificates — ADMIN list/search/filter', () => {
  let app: TestApp

  beforeAll(async () => {
    app = await buildTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  /** สร้าง cert สำหรับ user คนหนึ่ง */
  async function seedCertForUser(name: string) {
    const { user } = await createUser({ name })

    const course = await prisma.course.create({
      data: { titleEn: `Scope Course ${randomUUID().slice(0, 6)}`, categoryEn: 'Safety', status: 'PUBLISHED' },
      select: { id: true, titleEn: true },
    })
    const enrollment = await prisma.enrollment.create({
      data: { userId: user.id, courseId: course.id, status: 'COMPLETED' },
      select: { id: true },
    })
    await prisma.certificate.create({
      data: {
        enrollmentId: enrollment.id,
        userId: user.id,
        courseId: course.id,
        courseTitleEn: course.titleEn,
        courseTitleTh: null,
        certNumber: `BTEC-SCOPE-${randomUUID().slice(0, 8).toUpperCase()}`,
        score: 90,
        verifyHash: randomUUID(),
        issuedAt: new Date(),
      },
    })
    return { userId: user.id }
  }

  it('ADMIN can search any holder by name', async () => {
    const uniqueName = `Unique-Holder-${randomUUID().slice(0, 8)}`
    await seedCertForUser(uniqueName)

    const { user: adminUser, plainPassword } = await createUser({ role: 'ADMIN' })
    const { cookies: adminCookies } = await loginAs(app, adminUser.email, plainPassword)

    const res = await app.inject({
      method: 'GET',
      url: `/certificates?search=${encodeURIComponent(uniqueName)}`,
      headers: { cookie: adminCookies },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: unknown[]; total: number }>()
    expect(body.total).toBe(1)
  })

  it('ADMIN can filter by explicit userId', async () => {
    const { userId } = await seedCertForUser(`Holder-${randomUUID().slice(0, 6)}`)

    const { user: adminUser, plainPassword } = await createUser({ role: 'ADMIN' })
    const { cookies: adminCookies } = await loginAs(app, adminUser.email, plainPassword)

    const res = await app.inject({
      method: 'GET',
      url: `/certificates?userId=${userId}`,
      headers: { cookie: adminCookies },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json<{ total: number }>().total).toBe(1)
  })

  it('ADMIN sees the full list', async () => {
    await seedCertForUser(`Holder-${randomUUID().slice(0, 6)}`)

    const { user: adminUser, plainPassword } = await createUser({ role: 'ADMIN' })
    const { cookies: adminCookies } = await loginAs(app, adminUser.email, plainPassword)

    const res = await app.inject({
      method: 'GET',
      url: '/certificates',
      headers: { cookie: adminCookies },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: unknown[]; total: number }>()
    expect(body.total).toBeGreaterThanOrEqual(1)
  })
})

describe('GET /external-certs — admin scoped access', () => {
  let app: TestApp

  beforeAll(async () => {
    app = await buildTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

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
