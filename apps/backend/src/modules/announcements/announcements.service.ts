import type { PrismaClient } from '@prisma/client'
import type {
  AnnouncementPublicResponse,
  AnnouncementAdminResponse,
  AnnouncementListPublic,
  AnnouncementListAdmin,
  CreateAnnouncementInput,
  UpdateAnnouncementInput,
  LatestAnnouncementResponse,
} from '@btec-lms/shared'
import {
  announcementPublicResponseSchema,
  announcementAdminResponseSchema,
} from '@btec-lms/shared'
import { serializeByRole } from '../../lib/roleResponse.js'
import { logAudit } from '../../lib/audit.js'
import { notFound, badRequest } from '../../lib/errors.js'
import { t, localizeField, type Locale } from '../../lib/i18n.js'
import type { StorageProvider } from '../../lib/storage.js'
import type { AnnouncementListQuery } from './announcements.schema.js'

// ─── Types ───────────────────────────────────────────────────────────────────

type AnnouncementRecord = {
  id: string
  titleEn: string
  titleTh: string | null
  contentEn: string | null
  contentTh: string | null
  status: 'DRAFT' | 'PUBLISHED'
  fileKey: string | null
  fileMimeType: string | null
  link: string | null
  publishedAt: Date | null
  createdById: string | null
  createdAt: Date
  updatedAt: Date
}

const ANNOUNCEMENT_SELECT = {
  id: true,
  titleEn: true,
  titleTh: true,
  contentEn: true,
  contentTh: true,
  status: true,
  fileKey: true,
  fileMimeType: true,
  link: true,
  publishedAt: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
} as const

// ─── Serializer ───────────────────────────────────────────────────────────────

function toAdminShape(
  a: AnnouncementRecord,
  locale: Locale,
  storage: StorageProvider,
): AnnouncementAdminResponse {
  // content เป็น "ข้อความเพิ่มเติม" ไม่บังคับ — ถ้าทั้ง en/th ไม่มีเลยให้เป็น null (ไม่ใช่ '')
  const content =
    a.contentEn != null || a.contentTh != null
      ? localizeField(a.contentEn ?? '', a.contentTh, locale)
      : null

  return {
    id: a.id,
    title: localizeField(a.titleEn, a.titleTh, locale),
    content,
    fileSignedUrl: a.fileKey != null ? storage.getSignedUrl(a.fileKey, undefined, a.fileMimeType) : null,
    link: a.link ?? null,
    publishedAt: a.publishedAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
    titleEn: a.titleEn,
    titleTh: a.titleTh ?? null,
    contentEn: a.contentEn,
    contentTh: a.contentTh ?? null,
    status: a.status,
    fileKey: a.fileKey ?? null,
    createdById: a.createdById ?? null,
    updatedAt: a.updatedAt.toISOString(),
  }
}

function serializeAnnouncement(
  a: AnnouncementRecord,
  role: string,
  locale: Locale,
  storage: StorageProvider,
): AnnouncementAdminResponse | AnnouncementPublicResponse {
  const adminShape = toAdminShape(a, locale, storage)
  return serializeByRole(role, adminShape, announcementAdminResponseSchema, announcementPublicResponseSchema)
}

// ─── listAnnouncements ────────────────────────────────────────────────────────
// USER → only PUBLISHED; ADMIN → all (DRAFT + PUBLISHED)

export async function listAnnouncements(
  prisma: PrismaClient,
  role: string,
  query: AnnouncementListQuery,
  locale: Locale,
  storage: StorageProvider,
): Promise<AnnouncementListPublic | AnnouncementListAdmin> {
  const { page, limit } = query

  const statusFilter = role === 'USER' ? { status: 'PUBLISHED' as const } : {}

  const where = { deletedAt: null, ...statusFilter }

  const [total, rows] = await Promise.all([
    prisma.announcement.count({ where }),
    prisma.announcement.findMany({
      where,
      select: ANNOUNCEMENT_SELECT,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ])

  const data = rows.map((r) =>
    serializeAnnouncement(r as AnnouncementRecord, role, locale, storage),
  )

  return { data, total, page, limit } as AnnouncementListPublic | AnnouncementListAdmin
}

// ─── getLatestAnnouncement ────────────────────────────────────────────────────
// ล่าสุดที่ PUBLISHED เท่านั้น (publishedAt desc) — คืน public shape เสมอไม่ว่า role ไหน
// เพราะใช้กับ dashboard board + login popup ของ USER เท่านั้น ไม่ใช่หน้า admin
// null เมื่อไม่มีประกาศ PUBLISHED เลย (ระบบยังไม่เคย publish อะไร)

export async function getLatestAnnouncement(
  prisma: PrismaClient,
  locale: Locale,
  storage: StorageProvider,
): Promise<LatestAnnouncementResponse> {
  const row = await prisma.announcement.findFirst({
    where: { deletedAt: null, status: 'PUBLISHED' },
    select: ANNOUNCEMENT_SELECT,
    orderBy: { publishedAt: 'desc' },
  })
  if (!row) return null

  return serializeAnnouncement(row as AnnouncementRecord, 'USER', locale, storage) as AnnouncementPublicResponse
}

// ─── getAnnouncement ──────────────────────────────────────────────────────────
// USER → only PUBLISHED; ADMIN → any status

export async function getAnnouncement(
  prisma: PrismaClient,
  id: string,
  role: string,
  locale: Locale,
  storage: StorageProvider,
): Promise<AnnouncementAdminResponse | AnnouncementPublicResponse> {
  const where =
    role === 'USER'
      ? { id, deletedAt: null, status: 'PUBLISHED' as const }
      : { id, deletedAt: null }

  const row = await prisma.announcement.findFirst({ where, select: ANNOUNCEMENT_SELECT })
  if (!row) throw notFound(t('error.announcement.notFound', undefined, locale))

  return serializeAnnouncement(row as AnnouncementRecord, role, locale, storage)
}

// ─── createAnnouncement ───────────────────────────────────────────────────────

export async function createAnnouncement(
  prisma: PrismaClient,
  actorId: string,
  input: CreateAnnouncementInput,
  fileKey: string | null,
  fileMimeType: string | null,
  locale: Locale,
  storage: StorageProvider,
  ip?: string,
): Promise<AnnouncementAdminResponse> {
  const publishedAt = input.status === 'PUBLISHED' ? new Date() : null

  const row = await prisma.announcement.create({
    data: {
      titleEn: input.titleEn,
      titleTh: input.titleTh ?? null,
      contentEn: input.contentEn ?? null,
      contentTh: input.contentTh ?? null,
      status: input.status,
      fileKey,
      fileMimeType,
      link: input.link ?? null,
      publishedAt,
      createdById: actorId,
    },
    select: ANNOUNCEMENT_SELECT,
  })

  await logAudit(prisma, {
    actorId,
    action: 'ANNOUNCEMENT_CREATE',
    targetType: 'Announcement',
    targetId: row.id,
    metadata: { status: row.status, titleEn: row.titleEn },
    ...(ip != null && { ip }),
  })

  return toAdminShape(row as AnnouncementRecord, locale, storage)
}

// ─── updateAnnouncement ───────────────────────────────────────────────────────

export async function updateAnnouncement(
  prisma: PrismaClient,
  id: string,
  actorId: string,
  input: UpdateAnnouncementInput,
  locale: Locale,
  storage: StorageProvider,
  ip?: string,
): Promise<AnnouncementAdminResponse> {
  const existing = await prisma.announcement.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, status: true, publishedAt: true, fileKey: true },
  })
  if (!existing) throw notFound(t('error.announcement.notFound', undefined, locale))

  // ต้องมีรูปภาพถึง publish ได้ — PATCH ไม่รองรับแนบไฟล์ใหม่ (multipart) เลยเช็คจาก fileKey เดิมที่มีอยู่แล้วเท่านั้น
  if (input.status === 'PUBLISHED' && existing.status === 'DRAFT' && !existing.fileKey) {
    throw badRequest(t('error.announcement.imageRequiredToPublish', undefined, locale))
  }

  // publishedAt: ตั้งเมื่อเปลี่ยนจาก DRAFT → PUBLISHED เท่านั้น
  let publishedAt: Date | null | undefined = undefined
  if (input.status === 'PUBLISHED' && existing.status === 'DRAFT') {
    publishedAt = new Date()
  } else if (input.status === 'DRAFT') {
    publishedAt = null
  }

  const updated = await prisma.announcement.update({
    where: { id },
    data: {
      ...(input.titleEn !== undefined && { titleEn: input.titleEn }),
      ...(input.titleTh !== undefined && { titleTh: input.titleTh }),
      ...(input.contentEn !== undefined && { contentEn: input.contentEn }),
      ...(input.contentTh !== undefined && { contentTh: input.contentTh }),
      ...(input.link !== undefined && { link: input.link }),
      ...(input.status !== undefined && { status: input.status }),
      ...(publishedAt !== undefined && { publishedAt }),
    },
    select: ANNOUNCEMENT_SELECT,
  })

  await logAudit(prisma, {
    actorId,
    action: 'ANNOUNCEMENT_UPDATE',
    targetType: 'Announcement',
    targetId: id,
    metadata: { changes: Object.keys(input) },
    ...(ip != null && { ip }),
  })

  return toAdminShape(updated as AnnouncementRecord, locale, storage)
}

// ─── deleteAnnouncement ───────────────────────────────────────────────────────

export async function deleteAnnouncement(
  prisma: PrismaClient,
  id: string,
  actorId: string,
  locale: Locale,
  ip?: string,
): Promise<void> {
  const existing = await prisma.announcement.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  })
  if (!existing) throw notFound(t('error.announcement.notFound', undefined, locale))

  await prisma.announcement.update({
    where: { id },
    data: { deletedAt: new Date() },
  })

  await logAudit(prisma, {
    actorId,
    action: 'ANNOUNCEMENT_DELETE',
    targetType: 'Announcement',
    targetId: id,
    ...(ip != null && { ip }),
  })
}
