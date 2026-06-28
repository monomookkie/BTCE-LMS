import type { PrismaClient } from '@prisma/client'
import { findExpiringSoon } from '../modules/certificates/certificates.service.js'
import { logAudit } from '../lib/audit.js'

// ─── runCertExpiryReminder ────────────────────────────────────────────────────
// Standalone, testable function — ไม่รอ real cron เพื่อ test ได้ง่าย
// คืน count ของ Notification ที่สร้างใหม่

export async function runCertExpiryReminder(
  prisma: PrismaClient,
  daysAhead = 30,
): Promise<number> {
  const expiring = await findExpiringSoon(prisma, daysAhead)
  if (expiring.length === 0) return 0

  const now = new Date()
  // ตัด-off: ไม่ notify ถ้าส่งไปแล้วใน 7 วันที่ผ่านมา (กัน spam)
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

    await prisma.notification.create({
      data: {
        userId: cert.userId,
        title: `Certificate expiring soon: ${cert.certNumber}`,
        body: `Your certificate for "${cert.courseTitleEn}" expires on ${cert.expiresAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}. Please renew before the deadline.`,
        link: `/certificates/${cert.certId}`,
      },
    })

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
