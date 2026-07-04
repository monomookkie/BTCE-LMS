import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { buildTestApp, createUser, loginAs, prisma } from '../../test/helpers.js'
import type { TestApp } from '../../test/helpers.js'
import { onEnrollmentCompleted } from './certificates.service.js'
import { runCertExpiryReminder } from '../../jobs/certExpiryReminder.js'

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

// ─── Local types (response shapes) ───────────────────────────────────────────

type CertPublic = { id: string; certNumber: string; status: string; expiresAt: string | null }
type CertList = { data: CertPublic[]; total: number }
type EnrollmentRes = { id: string; status: string }
type ExtCertRes = { id: string; fileKey: string | null; signedUrl: string | null }

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('Phase 4 — Certificate issuance, compliance, cron', () => {
  let app: TestApp

  beforeAll(async () => {
    app = await buildTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  // ─── Shared helpers ────────────────────────────────────────────────────────

  async function makeAdmin() {
    const { user, plainPassword } = await createUser({ role: 'ADMIN' })
    const { cookies } = await loginAs(app, user.email, plainPassword)
    return { cookies, userId: user.id }
  }

  async function makeUser() {
    const { user, plainPassword } = await createUser({ role: 'USER' })
    const { cookies } = await loginAs(app, user.email, plainPassword)
    return { cookies, userId: user.id }
  }

  /**
   * สร้าง published course + 1 LINK material
   * withQuiz: เพิ่ม quiz 1 ข้อ — return correctOptionId
   */
  async function setupCourse(
    adminCookies: string,
    opts: { withQuiz?: boolean; passScore?: number; expiryMonths?: number | null } = {},
  ) {
    const payload: Record<string, unknown> = {
      titleEn: `Course-${randomUUID().slice(0, 6)}`,
      categoryEn: 'Safety',
      passScore: opts.passScore ?? 80,
    }
    if (opts.expiryMonths !== undefined) payload['expiryMonths'] = opts.expiryMonths

    const courseRes = await app.inject({
      method: 'POST',
      url: '/courses',
      headers: { cookie: adminCookies },
      payload,
    })
    expect(courseRes.statusCode).toBe(201)
    const course = courseRes.json<{ id: string }>()

    // add 1 LINK material
    const matRes = await app.inject({
      method: 'POST',
      url: `/courses/${course.id}/materials/link`,
      headers: { cookie: adminCookies },
      payload: { type: 'LINK', titleEn: 'Lesson', url: 'https://example.com' },
    })
    expect(matRes.statusCode).toBe(201)
    const material = matRes.json<{ id: string }>()

    // publish
    await app.inject({
      method: 'PATCH',
      url: `/courses/${course.id}/status`,
      headers: { cookie: adminCookies },
      payload: { status: 'PUBLISHED' },
    })

    let quizInfo: { questionId: string; correctOptionId: string } | undefined

    if (opts.withQuiz) {
      await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/quiz`,
        headers: { cookie: adminCookies },
        payload: { titleEn: 'Test Quiz', maxAttempts: null, shuffle: false },
      })

      // POST question → ส่งคืน full quiz (quizAdminResponseSchema)
      const qRes = await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/quiz/questions`,
        headers: { cookie: adminCookies },
        payload: {
          textEn: 'What is correct?',
          options: [
            { textEn: 'Correct answer', isCorrect: true },
            { textEn: 'Wrong answer', isCorrect: false },
          ],
        },
      })
      expect(qRes.statusCode).toBe(201)
      type QuizAdmin = {
        questions: { id: string; options: { id: string; isCorrect: boolean }[] }[]
      }
      const quiz = qRes.json<QuizAdmin>()
      const q = quiz.questions[0]!
      quizInfo = {
        questionId: q.id,
        correctOptionId: q.options.find((o) => o.isCorrect)!.id,
      }
    }

    return { courseId: course.id, materialId: material.id, quizInfo }
  }

  /** Assign user → return enrollmentId */
  async function assign(adminCookies: string, userId: string, courseId: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/enrollments',
      headers: { cookie: adminCookies },
      payload: { userId, courseId },
    })
    expect(res.statusCode).toBe(201)
    return res.json<{ id: string }>().id
  }

  /** Mark material complete → return enrollment response
   *  ต้อง open ก่อน (Tier 2/3 view gate) — backdate openedAt เพื่อผ่านเกณฑ์เวลาขั้นต่ำโดยไม่ต้องรอจริง */
  async function completeMaterial(userCookies: string, enrollmentId: string, materialId: string) {
    await app.inject({
      method: 'POST',
      url: `/enrollments/${enrollmentId}/materials/${materialId}/open`,
      headers: { cookie: userCookies },
    })
    await prisma.materialProgress.updateMany({
      where: { enrollmentId, materialId },
      data: { openedAt: new Date(Date.now() - 301_000) },
    })

    return app.inject({
      method: 'POST',
      url: `/enrollments/${enrollmentId}/complete-material/${materialId}`,
      headers: { cookie: userCookies },
    })
  }

  // ─── 1. Auto-issue: course without quiz ────────────────────────────────────

  describe('1. auto-issue (no quiz)', () => {
    it('mark last material → enrollment=COMPLETED → cert issued with certNumber', async () => {
      const admin = await makeAdmin()
      const { courseId, materialId } = await setupCourse(admin.cookies, { expiryMonths: null })
      const user = await makeUser()
      const eid = await assign(admin.cookies, user.userId, courseId)

      const res = await completeMaterial(user.cookies, eid, materialId)
      expect(res.statusCode).toBe(200)
      expect(res.json<EnrollmentRes>().status).toBe('COMPLETED')

      const certRes = await app.inject({
        method: 'GET',
        url: '/certificates',
        headers: { cookie: user.cookies },
      })
      const list = certRes.json<CertList>()
      expect(list.total).toBe(1)
      expect(list.data[0]!.certNumber).toMatch(/^BTEC-\d{4}-\d{4}$/)
      expect(list.data[0]!.expiresAt).toBeNull()
      expect(list.data[0]!.status).toBe('valid')
    })
  })

  // ─── 2. Auto-issue: course with quiz ──────────────────────────────────────

  describe('2. auto-issue (with quiz)', () => {
    it('material alone does NOT complete enrollment; passing quiz does', async () => {
      const admin = await makeAdmin()
      const { courseId, materialId, quizInfo } = await setupCourse(admin.cookies, { withQuiz: true })
      const user = await makeUser()
      const eid = await assign(admin.cookies, user.userId, courseId)

      // mark material → progress 100% but quiz not passed → IN_PROGRESS
      const matRes = await completeMaterial(user.cookies, eid, materialId)
      expect(matRes.statusCode).toBe(200)
      expect(matRes.json<EnrollmentRes>().status).toBe('IN_PROGRESS')

      // no cert yet
      const noCertRes = await app.inject({
        method: 'GET',
        url: '/certificates',
        headers: { cookie: user.cookies },
      })
      expect(noCertRes.json<CertList>().total).toBe(0)

      // submit quiz (correct) → COMPLETED → cert issued
      const submitRes = await app.inject({
        method: 'POST',
        url: `/courses/${courseId}/quiz/submit`,
        headers: { cookie: user.cookies },
        payload: { answers: { [quizInfo!.questionId]: quizInfo!.correctOptionId } },
      })
      expect(submitRes.statusCode).toBe(201)
      expect(submitRes.json<{ passed: boolean }>().passed).toBe(true)

      const certRes = await app.inject({
        method: 'GET',
        url: '/certificates',
        headers: { cookie: user.cookies },
      })
      expect(certRes.json<CertList>().total).toBe(1)
    })

    it('failing quiz does NOT issue cert', async () => {
      const admin = await makeAdmin()
      const { courseId, materialId, quizInfo } = await setupCourse(admin.cookies, { withQuiz: true })
      const user = await makeUser()
      const eid = await assign(admin.cookies, user.userId, courseId)

      await completeMaterial(user.cookies, eid, materialId)

      // submit with wrong option (pick the non-correct one)
      const wrongOptionId = (
        await app.inject({
          method: 'GET',
          url: `/courses/${courseId}/quiz`,
          headers: { cookie: admin.cookies },
        })
      ).json<{ questions: { options: { id: string; isCorrect: boolean }[] }[] }>()
        .questions[0]!.options.find((o) => !o.isCorrect)!.id

      const submitRes = await app.inject({
        method: 'POST',
        url: `/courses/${courseId}/quiz/submit`,
        headers: { cookie: user.cookies },
        payload: { answers: { [quizInfo!.questionId]: wrongOptionId } },
      })
      expect(submitRes.json<{ passed: boolean }>().passed).toBe(false)

      const certRes = await app.inject({
        method: 'GET',
        url: '/certificates',
        headers: { cookie: user.cookies },
      })
      expect(certRes.json<CertList>().total).toBe(0)
    })
  })

  // ─── 3. Idempotent: calling onEnrollmentCompleted twice → 1 cert ───────────

  describe('3. cert issuance idempotency', () => {
    it('completing enrollment twice → exactly 1 cert', async () => {
      const admin = await makeAdmin()
      const { courseId, materialId } = await setupCourse(admin.cookies)
      const user = await makeUser()
      const eid = await assign(admin.cookies, user.userId, courseId)

      await completeMaterial(user.cookies, eid, materialId)

      // call onEnrollmentCompleted directly again — simulates retry / race
      await onEnrollmentCompleted(prisma, eid)

      const count = await prisma.certificate.count({ where: { enrollmentId: eid } })
      expect(count).toBe(1)
    })
  })

  // ─── 4. Concurrent certNumber uniqueness ──────────────────────────────────

  describe('4. concurrent issuance — certNumbers unique', () => {
    it('2 users complete the same course simultaneously → no duplicate certNumber', async () => {
      const admin = await makeAdmin()
      const { courseId, materialId } = await setupCourse(admin.cookies)

      const u1 = await makeUser()
      const u2 = await makeUser()
      const eid1 = await assign(admin.cookies, u1.userId, courseId)
      const eid2 = await assign(admin.cookies, u2.userId, courseId)

      // fire both completions concurrently
      const [r1, r2] = await Promise.all([
        completeMaterial(u1.cookies, eid1, materialId),
        completeMaterial(u2.cookies, eid2, materialId),
      ])
      expect(r1.statusCode).toBe(200)
      expect(r2.statusCode).toBe(200)

      const certs = await prisma.certificate.findMany({
        where: { courseId },
        select: { certNumber: true },
        orderBy: { issuedAt: 'asc' },
      })
      expect(certs).toHaveLength(2)
      // ต้องไม่ซ้ำกัน
      expect(certs[0]!.certNumber).not.toBe(certs[1]!.certNumber)
      // ทั้งคู่ต้องขึ้นต้นด้วย BTEC-YYYY-
      for (const c of certs) {
        expect(c.certNumber).toMatch(/^BTEC-\d{4}-\d{4}$/)
      }
    })
  })

  // ─── 5. expiresAt calculation ─────────────────────────────────────────────

  describe('5. expiresAt from expiryMonths', () => {
    it('expiryMonths: 6 → expiresAt ≈ issuedAt + 180 days (±5 s)', async () => {
      const admin = await makeAdmin()
      const { courseId, materialId } = await setupCourse(admin.cookies, { expiryMonths: 6 })
      const user = await makeUser()
      const eid = await assign(admin.cookies, user.userId, courseId)

      const before = Date.now()
      await completeMaterial(user.cookies, eid, materialId)
      const after = Date.now()

      const cert = await prisma.certificate.findFirst({ where: { enrollmentId: eid } })
      expect(cert?.expiresAt).not.toBeNull()

      const expectedMin = before + 6 * 30 * 24 * 60 * 60 * 1000 - 5_000
      const expectedMax = after + 6 * 30 * 24 * 60 * 60 * 1000 + 5_000
      expect(cert!.expiresAt!.getTime()).toBeGreaterThanOrEqual(expectedMin)
      expect(cert!.expiresAt!.getTime()).toBeLessThanOrEqual(expectedMax)
    })

    it('expiryMonths: null → expiresAt null', async () => {
      const admin = await makeAdmin()
      const { courseId, materialId } = await setupCourse(admin.cookies, { expiryMonths: null })
      const user = await makeUser()
      const eid = await assign(admin.cookies, user.userId, courseId)

      await completeMaterial(user.cookies, eid, materialId)

      const cert = await prisma.certificate.findFirst({ where: { enrollmentId: eid } })
      expect(cert?.expiresAt).toBeNull()
    })
  })

  // ─── 6. IDOR: USER ดู/โหลด PDF cert ของคนอื่น → 404 ────────────────────

  describe('6. IDOR protection', () => {
    it('USER cannot GET cert of another user → 404; same for PDF', async () => {
      const admin = await makeAdmin()
      const { courseId, materialId } = await setupCourse(admin.cookies)
      const owner = await makeUser()
      const other = await makeUser()

      const eid = await assign(admin.cookies, owner.userId, courseId)
      await completeMaterial(owner.cookies, eid, materialId)

      // admin lists certs to get certId
      const adminList = await app.inject({
        method: 'GET',
        url: `/certificates?userId=${owner.userId}`,
        headers: { cookie: admin.cookies },
      })
      const certId = adminList.json<{ data: { id: string }[] }>().data[0]!.id

      // other user → GET cert → 404
      expect(
        (await app.inject({ method: 'GET', url: `/certificates/${certId}`, headers: { cookie: other.cookies } })).statusCode,
      ).toBe(404)

      // other user → GET PDF → 404
      expect(
        (await app.inject({ method: 'GET', url: `/certificates/${certId}/pdf`, headers: { cookie: other.cookies } })).statusCode,
      ).toBe(404)
    })
  })

  // ─── 7. External certificates ─────────────────────────────────────────────

  describe('7. external certificates', () => {
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
  })

  // ─── 8. PDF endpoint ──────────────────────────────────────────────────────

  describe('8. GET /certificates/:id/pdf', () => {
    it('owner → 200 application/pdf with Content-Disposition attachment', async () => {
      const admin = await makeAdmin()
      const { courseId, materialId } = await setupCourse(admin.cookies)
      const user = await makeUser()
      const eid = await assign(admin.cookies, user.userId, courseId)
      await completeMaterial(user.cookies, eid, materialId)

      const certId = (
        await app.inject({ method: 'GET', url: '/certificates', headers: { cookie: user.cookies } })
      ).json<CertList>().data[0]!.id

      const pdfRes = await app.inject({
        method: 'GET',
        url: `/certificates/${certId}/pdf`,
        headers: { cookie: user.cookies },
      })
      expect(pdfRes.statusCode).toBe(200)
      expect(pdfRes.headers['content-type']).toBe('application/pdf')
      expect(pdfRes.headers['content-disposition']).toContain('attachment')
      expect(pdfRes.rawPayload.length).toBeGreaterThan(100) // PDF ต้องมีเนื้อ
    }, 30_000) // PDF rendering อาจช้า — 30 s timeout
  })

  // ─── 9. Cron: certExpiryReminder ──────────────────────────────────────────

  describe('9. runCertExpiryReminder', () => {
    it('cert expiring in 15 days → Notification created; second run → deduped', async () => {
      // seed cert directly (no need to go through full API flow)
      const { user } = await createUser()
      const course = await prisma.course.create({
        data: { titleEn: 'Expiry Test Course', categoryEn: 'Safety', status: 'PUBLISHED' },
        select: { id: true, titleEn: true },
      })
      const enrollment = await prisma.enrollment.create({
        data: { userId: user.id, courseId: course.id, status: 'COMPLETED' },
        select: { id: true },
      })
      const cert = await prisma.certificate.create({
        data: {
          enrollmentId: enrollment.id,
          userId: user.id,
          courseId: course.id,
          courseTitleEn: course.titleEn,
          courseTitleTh: null,
          certNumber: `BTEC-CRON-${randomUUID().slice(0, 8).toUpperCase()}`,
          score: 90,
          verifyHash: randomUUID(),
          issuedAt: new Date(),
          expiresAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // 15 วัน
        },
        select: { id: true },
      })

      // รันครั้งแรก → 1 notification
      const count1 = await runCertExpiryReminder(prisma, 30)
      expect(count1).toBe(1)

      const notif = await prisma.notification.findFirst({
        where: { userId: user.id, link: `/certificates/${cert.id}` },
      })
      expect(notif).not.toBeNull()
      expect(notif!.title.toLowerCase()).toContain('expiring soon')

      // รันทันทีอีกครั้ง → deduped (ยังอยู่ใน 7-day window)
      const count2 = await runCertExpiryReminder(prisma, 30)
      expect(count2).toBe(0)

      const total = await prisma.notification.count({
        where: { userId: user.id, link: `/certificates/${cert.id}` },
      })
      expect(total).toBe(1) // ไม่สร้างซ้ำ
    })

    it('cert expiring in 60 days → outside 30-day window → no notification', async () => {
      const { user } = await createUser()
      const course = await prisma.course.create({
        data: { titleEn: 'Far Future Course', categoryEn: 'Safety', status: 'PUBLISHED' },
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
          certNumber: `BTEC-FAR-${randomUUID().slice(0, 8).toUpperCase()}`,
          score: 90,
          verifyHash: randomUUID(),
          issuedAt: new Date(),
          expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), // 60 วัน
        },
      })

      const count = await runCertExpiryReminder(prisma, 30)
      expect(count).toBe(0)
    })
  })
})
