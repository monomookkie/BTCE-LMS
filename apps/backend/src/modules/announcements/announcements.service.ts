import type { PrismaClient } from '@prisma/client'
import type {
  AnnouncementPublicResponse,
  AnnouncementAdminResponse,
  AnnouncementListPublic,
  AnnouncementListAdmin,
  CreateAnnouncementInput,
  UpdateAnnouncementInput,
} from '@btec-lms/shared'
import {
  announcementPublicResponseSchema,
  announcementAdminResponseSchema,
} from '@btec-lms/shared'
import { serializeByRole } from '../../lib/roleResponse.js'
import { logAudit } from '../../lib/audit.js'
import { notFound } from '../../lib/errors.js'
import { t, localizeField, type Locale } from '../../lib/i18n.js'
import type { StorageProvider } from '../../lib/storage.js'
import type { AnnouncementListQuery } from './announcements.schema.js'

// ─── Types ───────────────────────────────────────────────────────────────────

type AnnouncementRecord = {
  id: string
  titleEn: string
  titleTh: string | null
  contentEn: string
  contentTh: string | null
  type: string
  status: 'DRAFT' | 'PUBLISHED'
  fileKey: string | null
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
  type: true,
  status: true,
  fileKey: true,
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
  return {
    id: a.id,
    title: localizeField(a.titleEn, a.titleTh, locale),
    content: localizeField(a.contentEn, a.contentTh, locale),
    type: a.type,
    fileSignedUrl: a.fileKey != null ? storage.getSignedUrl(a.fileKey) : null,
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
// USER → only PUBLISHED; ADMIN/MANAGER → all (DRAFT + PUBLISHED)

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

// ─── getAnnouncement ──────────────────────────────────────────────────────────
// USER → only PUBLISHED; ADMIN/MANAGER → any status

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
  locale: Locale,
  storage: StorageProvider,
  ip?: string,
): Promise<AnnouncementAdminResponse> {
  const publishedAt = input.status === 'PUBLISHED' ? new Date() : null

  const row = await prisma.announcement.create({
    data: {
      titleEn: input.titleEn,
      titleTh: input.titleTh ?? null,
      contentEn: input.contentEn,
      contentTh: input.contentTh ?? null,
      type: input.type,
      status: input.status,
      fileKey,
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
    select: { id: true, status: true, publishedAt: true },
  })
  if (!existing) throw notFound(t('error.announcement.notFound', undefined, locale))

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
      ...(input.type !== undefined && { type: input.type }),
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
