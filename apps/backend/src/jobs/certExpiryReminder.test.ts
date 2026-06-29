import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { buildTestApp, createUser, prisma } from '../test/helpers.js'
import type { TestApp } from '../test/helpers.js'
import { runCertExpiryReminder } from './certExpiryReminder.js'
import { getMailer, type MailerProvider } from '../lib/mailer.js'

describe('certExpiryReminder + mailer', () => {
  let app: TestApp

  beforeAll(async () => {
    app = await buildTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  // ─── Helper: seed an expiring cert ───────────────────────────────────────

  async function seedExpiringCert(userId: string, daysUntilExpiry: number) {
    const course = await prisma.course.create({
      data: { titleEn: `Course ${randomUUID().slice(0, 6)}`, categoryEn: 'Safety', status: 'PUBLISHED' },
      select: { id: true },
    })
    const enrollment = await prisma.enrollment.create({
      data: { userId, courseId: course.id, status: 'COMPLETED' },
      select: { id: true },
    })
    return prisma.certificate.create({
      data: {
        enrollmentId: enrollment.id,
        userId,
        courseId: course.id,
        certNumber: `BTEC-MAIL-${randomUUID().slice(0, 8).toUpperCase()}`,
        score: 90,
        verifyHash: randomUUID(),
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + daysUntilExpiry * 24 * 60 * 60 * 1000),
      },
      select: { id: true, certNumber: true },
    })
  }

  // ─── 1. FakeMailer ใช้ใน test ──────────────────────────────────────────────

  it('getMailer() returns FakeMailer in test env — sendMail does not throw', async () => {
    const mailer = getMailer()
    // FakeMailer.sendMail แค่ log ไม่ throw — ต้อง resolve
    await expect(
      mailer.sendMail({ to: 'test@example.com', subject: 'Test', text: 'Hello' }),
    ).resolves.toBeUndefined()
  })

  // ─── 2. cron เรียก sendMail ตามจำนวน expiring certs ─────────────────────

  it('sendMail called once per expiring cert', async () => {
    const { user } = await createUser()
    await seedExpiringCert(user.id, 15) // expiring in 15 days (within 30-day window)

    const calls: string[] = []
    const capturingMailer: MailerProvider = {
      async sendMail(opts) { calls.push(opts.to) },
    }

    const count = await runCertExpiryReminder(prisma, 30, capturingMailer)
    expect(count).toBe(1)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toBe(user.email)
  })

  it('sendMail called once per each unique expiring cert (2 users → 2 calls)', async () => {
    const { user: u1 } = await createUser()
    const { user: u2 } = await createUser()
    await seedExpiringCert(u1.id, 10)
    await seedExpiringCert(u2.id, 20)

    const calls: string[] = []
    const capturingMailer: MailerProvider = {
      async sendMail(opts) { calls.push(opts.to) },
    }

    const count = await runCertExpiryReminder(prisma, 30, capturingMailer)
    expect(count).toBe(2)
    expect(calls).toHaveLength(2)
    expect(calls).toContain(u1.email)
    expect(calls).toContain(u2.email)
  })

  // ─── 3. email fail ไม่ทำ cron พัง ────────────────────────────────────────

  it('email failure does not crash cron — other users still processed, count still incremented', async () => {
    const { user: uFail } = await createUser()
    const { user: uOk } = await createUser()
    await seedExpiringCert(uFail.id, 12)
    await seedExpiringCert(uOk.id, 14)

    const okCalls: string[] = []
    const failingMailer: MailerProvider = {
      async sendMail(opts) {
        if (opts.to === uFail.email) throw new Error('SMTP connection refused')
        okCalls.push(opts.to)
      },
    }

    // ต้องไม่ throw — cron ต้องจบปกติ
    let count: number
    await expect(
      (async () => { count = await runCertExpiryReminder(prisma, 30, failingMailer) })(),
    ).resolves.not.toThrow()

    // count ยังนับทั้ง 2 (notification สร้าง แม้ email fail)
    expect(count!).toBe(2)

    // uOk ได้รับ email
    expect(okCalls).toContain(uOk.email)

    // notification ของทั้ง 2 user ถูกสร้าง (email fail ไม่กระทบ notification)
    const uFailNotif = await prisma.notification.findFirst({ where: { userId: uFail.id } })
    const uOkNotif = await prisma.notification.findFirst({ where: { userId: uOk.id } })
    expect(uFailNotif).not.toBeNull()
    expect(uOkNotif).not.toBeNull()
  })

  // ─── 4. dedupe — email ไม่ส่งซ้ำใน 7 วัน ────────────────────────────────

  it('second run within 7-day window → sendMail not called again (deduped)', async () => {
    const { user } = await createUser()
    await seedExpiringCert(user.id, 15)

    const calls: string[] = []
    const capturingMailer: MailerProvider = {
      async sendMail(opts) { calls.push(opts.to) },
    }

    // รันครั้งแรก → 1 email
    const count1 = await runCertExpiryReminder(prisma, 30, capturingMailer)
    expect(count1).toBe(1)
    expect(calls).toHaveLength(1)

    // รันครั้งที่สอง → deduped (notification ยังอยู่ใน 7-day window)
    const count2 = await runCertExpiryReminder(prisma, 30, capturingMailer)
    expect(count2).toBe(0)
    expect(calls).toHaveLength(1) // ไม่เพิ่ม
  })

  // ─── 5. email subject/body bilingual ─────────────────────────────────────

  it('Thai user receives Thai subject and body', async () => {
    const { user } = await createUser()
    // set language=th directly
    await prisma.user.update({ where: { id: user.id }, data: { language: 'th' } })
    await seedExpiringCert(user.id, 10)

    const captured: { subject: string; text: string }[] = []
    const capturingMailer: MailerProvider = {
      async sendMail(opts) { captured.push({ subject: opts.subject, text: opts.text }) },
    }

    await runCertExpiryReminder(prisma, 30, capturingMailer)
    expect(captured).toHaveLength(1)
    expect(captured[0]!.subject).toContain('ใกล้หมดอายุ')  // Thai subject
    expect(captured[0]!.text).toContain('เรียน')            // Thai body greeting
  })

  it('English user receives English subject and body', async () => {
    const { user } = await createUser() // default language='en'
    await seedExpiringCert(user.id, 10)

    const captured: { subject: string; text: string }[] = []
    const capturingMailer: MailerProvider = {
      async sendMail(opts) { captured.push({ subject: opts.subject, text: opts.text }) },
    }

    await runCertExpiryReminder(prisma, 30, capturingMailer)
    expect(captured).toHaveLength(1)
    expect(captured[0]!.subject).toContain('Expiring Soon') // English subject
    expect(captured[0]!.text).toContain('Dear')             // English body greeting
  })
})
