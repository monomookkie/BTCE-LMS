import type { PrismaClient } from '@prisma/client'
import { findExpiringSoon } from '../modules/certificates/certificates.service.js'
import { logAudit } from '../lib/audit.js'
import { getMailer, type MailerProvider } from '../lib/mailer.js'
import { t, localizeField } from '../lib/i18n.js'
import { env } from '../config/env.js'
import { logger } from '../lib/logger.js'

// ─── runCertExpiryReminder ────────────────────────────────────────────────────
// Standalone, testable function — ไม่รอ real cron เพื่อ test ได้ง่าย
// คืน count ของ Notification ที่สร้างใหม่
// mailer param ใช้ inject ใน test (e.g. throwing mailer) โดยไม่ต้อง mock module

export async function runCertExpiryReminder(
  prisma: PrismaClient,
  daysAhead = 30,
  mailer: MailerProvider = getMailer(),
): Promise<number> {
  const expiring = await findExpiringSoon(prisma, daysAhead)
  if (expiring.length === 0) return 0

  const now = new Date()
  // dedupe: ไม่ notify ถ้าส่งไปแล้วใน 7 วันที่ผ่านมา (ใช้ร่วมกับ notification + email)
  const dedupeWindow = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  let notified = 0

  for (const cert of expiring) {
    const recent = await prisma.notification.findFirst({
      where: {
        userId: cert.userId,
        link: `/certificates/${cert.certId}`,
        createdAt: { gte: dedupeWindow },
      },
      select: { id: true },
    })
    if (recent) continue

    // ─── Notification (in-app) ───────────────────────────────────────────────
    await prisma.notification.create({
      data: {
        userId: cert.userId,
        title: `Certificate expiring soon: ${cert.certNumber}`,
        body: `Your certificate for "${cert.courseTitleEn}" expires on ${cert.expiresAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}. Please renew before the deadline.`,
        link: `/certificates/${cert.certId}`,
      },
    })

    // ─── Email ────────────────────────────────────────────────────────────────
    // ดึง user email + language — try-catch per user เพื่อไม่ให้ cron พังทั้งหมด
    try {
      const user = await prisma.user.findUnique({
        where: { id: cert.userId },
        select: { email: true, name: true, language: true },
      })

      if (user) {
        const locale = user.language === 'th' ? 'th' : 'en'
        const courseTitle = localizeField(cert.courseTitleEn, cert.courseTitleTh, locale)
        const expiresAt = cert.expiresAt.toLocaleDateString(
          locale === 'th' ? 'th-TH' : 'en-GB',
          { day: '2-digit', month: 'short', year: 'numeric' },
        )
        const link = `${env.APP_URL}/certificates/${cert.certId}`

        await mailer.sendMail({
          to: user.email,
          subject: t('email.cert.expiry.subject', { certNumber: cert.certNumber }, locale),
          text: t('email.cert.expiry.body', {
            name: user.name,
            courseTitle,
            certNumber: cert.certNumber,
            expiresAt,
            link,
          }, locale),
        })

        // log userId เท่านั้น — ไม่ dump email content (PDPA)
        logger.info({ userId: cert.userId, certId: cert.certId }, 'cert expiry email sent')
      }
    } catch (err) {
      // email fail ไม่ทำ cron พัง — log แล้วไปต่อ
      logger.error({ userId: cert.userId, certId: cert.certId, err }, 'cert expiry email failed')
    }

    await logAudit(prisma, {
      action: 'CERT_EXPIRY_REMINDER',
      targetType: 'Certificate',
      targetId: cert.certId,
      metadata: { expiresAt: cert.expiresAt.toISOString(), daysAhead },
    })

    notified++
  }

  return notified
}
