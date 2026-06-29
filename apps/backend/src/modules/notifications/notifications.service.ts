import type { PrismaClient } from '@prisma/client'
import { notFound } from '../../lib/errors.js'
import { t, type Locale } from '../../lib/i18n.js'
import type { NotificationListQuery } from './notifications.schema.js'

// ─── Types ───────────────────────────────────────────────────────────────────

type NotificationRow = {
  id: string
  title: string
  body: string | null
  link: string | null
  readAt: Date | null
  createdAt: Date
}

type NotificationResponse = {
  id: string
  title: string
  body: string | null
  link: string | null
  readAt: string | null
  createdAt: string
}

const NOTIFICATION_SELECT = {
  id: true,
  title: true,
  body: true,
  link: true,
  readAt: true,
  createdAt: true,
} as const

function toResponse(n: NotificationRow): NotificationResponse {
  return {
    id: n.id,
    title: n.title,
    body: n.body,
    link: n.link,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  }
}

// ─── listNotifications ────────────────────────────────────────────────────────
// คืนเฉพาะ notification ของ userId นั้น + unread count

export async function listNotifications(
  prisma: PrismaClient,
  userId: string,
  query: NotificationListQuery,
) {
  const { page, limit } = query
  const where = { userId }

  const [total, unreadCount, rows] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, readAt: null } }),
    prisma.notification.findMany({
      where,
      select: NOTIFICATION_SELECT,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ])

  return {
    data: rows.map(toResponse),
    total,
    unreadCount,
    page,
    limit,
  }
}

// ─── markOneRead ──────────────────────────────────────────────────────────────
// IDOR: ตรวจ userId ก่อนเสมอ — notification ของคนอื่น → 404
// Idempotent: ถ้า readAt set แล้วก็ return ค่าเดิมได้เลย

export async function markOneRead(
  prisma: PrismaClient,
  userId: string,
  notificationId: string,
  locale: Locale,
): Promise<NotificationResponse> {
  const existing = await prisma.notification.findFirst({
    where: { id: notificationId, userId },
    select: NOTIFICATION_SELECT,
  })
  if (!existing) throw notFound(t('error.notification.notFound', undefined, locale))

  // idempotent — skip DB write ถ้า read แล้ว
  if (existing.readAt !== null) return toResponse(existing)

  const updated = await prisma.notification.update({
    where: { id: notificationId },
    data: { readAt: new Date() },
    select: NOTIFICATION_SELECT,
  })
  return toResponse(updated)
}

// ─── markAllRead ──────────────────────────────────────────────────────────────
// updateMany กรอง userId เข้มงวด — ไม่แตะ notification ของคนอื่น

export async function markAllRead(
  prisma: PrismaClient,
  userId: string,
): Promise<{ count: number }> {
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  })
  return { count: result.count }
}
