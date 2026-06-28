import type { PrismaClient } from '@prisma/client'
import type {
  MaterialAdminResponse,
  MaterialPublicResponse,
  CreateLinkMaterialInput,
  CreateFileMaterialMeta,
  UpdateMaterialInput,
  ReorderMaterialsInput,
} from '@btec-lms/shared'
import { materialAdminResponseSchema, materialPublicResponseSchema } from '@btec-lms/shared'
import { logAudit } from '../../lib/audit.js'
import { notFound, badRequest, forbidden } from '../../lib/errors.js'
import { t, localizeField, type Locale } from '../../lib/i18n.js'
import { serializeByRole } from '../../lib/roleResponse.js'
import { type StorageProvider } from '../../lib/storage.js'

const MATERIAL_SELECT = {
  id: true,
  courseId: true,
  type: true,
  titleEn: true,
  titleTh: true,
  fileKey: true,
  url: true,
  mimeType: true,
  sizeBytes: true,
  order: true,
  createdAt: true,
} as const

type MaterialRecord = {
  id: string
  courseId: string
  type: string
  titleEn: string
  titleTh: string | null
  fileKey: string | null
  url: string | null
  mimeType: string | null
  sizeBytes: number | null
  order: number
  createdAt: Date
}

// สร้าง admin shape (superset) เสมอ — serializeByRole จะ strip ให้ถ้า caller เป็น USER
function toMaterialAdminShape(m: MaterialRecord, storage: StorageProvider, locale: Locale): MaterialAdminResponse {
  return {
    id: m.id,
    courseId: m.courseId,
    type: m.type as MaterialAdminResponse['type'],
    title: localizeField(m.titleEn, m.titleTh, locale),
    titleEn: m.titleEn,
    titleTh: m.titleTh ?? null,
    fileKey: m.fileKey,
    url: m.url,
    signedUrl: m.fileKey != null ? storage.getSignedUrl(m.fileKey) : null,
    mimeType: m.mimeType,
    sizeBytes: m.sizeBytes,
    order: m.order,
    createdAt: m.createdAt.toISOString(),
  }
}

function serializeMaterial(
  m: MaterialRecord,
  storage: StorageProvider,
  locale: Locale,
  role: string,
): MaterialAdminResponse | MaterialPublicResponse {
  return serializeByRole(
    role,
    toMaterialAdminShape(m, storage, locale),
    materialAdminResponseSchema,
    materialPublicResponseSchema,
  )
}

async function assertCourseExists(prisma: PrismaClient, courseId: string, locale: Locale = 'en'): Promise<void> {
  const course = await prisma.course.findFirst({ where: { id: courseId, deletedAt: null }, select: { id: true } })
  if (!course) throw notFound(t('error.course.notFound', undefined, locale))
}

export async function listMaterials(
  prisma: PrismaClient,
  courseId: string,
  storage: StorageProvider,
  actorId: string,
  locale: Locale = 'en',
  ip?: string,
  requesterRole: string = 'USER',
): Promise<(MaterialAdminResponse | MaterialPublicResponse)[]> {
  await assertCourseExists(prisma, courseId, locale)

  if (requesterRole === 'USER') {
    const enrollment = await prisma.enrollment.findFirst({
      where: { userId: actorId, courseId, deletedAt: null },
      select: { id: true },
    })
    if (!enrollment) {
      throw forbidden(t('error.material.notEnrolled', undefined, locale))
    }
  }

  const materials = await prisma.material.findMany({
    where: { courseId, deletedAt: null },
    select: MATERIAL_SELECT,
    orderBy: { order: 'asc' },
  })

  await logAudit(prisma, {
    actorId,
    action: 'MATERIAL_LIST',
    targetType: 'Course',
    targetId: courseId,
    metadata: { count: materials.length },
    ...(ip != null && { ip }),
  })

  return materials.map((m) => serializeMaterial(m, storage, locale, requesterRole))
}

export async function createLinkMaterial(
  prisma: PrismaClient,
  courseId: string,
  input: CreateLinkMaterialInput,
  actorId: string,
  storage: StorageProvider,
  locale: Locale = 'en',
  ip?: string,
): Promise<MaterialAdminResponse> {
  await assertCourseExists(prisma, courseId, locale)

  const maxOrder = await prisma.material.aggregate({
    where: { courseId, deletedAt: null },
    _max: { order: true },
  })
  const order = input.order ?? (maxOrder._max.order ?? -1) + 1

  const material = await prisma.material.create({
    data: {
      courseId,
      type: input.type,
      titleEn: input.titleEn,
      titleTh: input.titleTh ?? null,
      url: input.url,
      order,
    },
    select: MATERIAL_SELECT,
  })

  await logAudit(prisma, {
    actorId,
    action: 'MATERIAL_CREATE',
    targetType: 'Material',
    targetId: material.id,
    metadata: { courseId, type: input.type, titleEn: input.titleEn },
    ...(ip != null && { ip }),
  })

  // createLinkMaterial เรียกจาก ADMIN/MANAGER route เท่านั้น → คืน admin shape เสมอ
  return materialAdminResponseSchema.parse(toMaterialAdminShape(material, storage, locale))
}

export async function createFileMaterial(
  prisma: PrismaClient,
  courseId: string,
  buffer: Buffer,
  filename: string,
  mimeType: string,
  meta: CreateFileMaterialMeta,
  actorId: string,
  storage: StorageProvider,
  locale: Locale = 'en',
  ip?: string,
): Promise<MaterialAdminResponse> {
  await assertCourseExists(prisma, courseId, locale)

  const { fileKey, mimeType: resolvedMime, sizeBytes } = await storage.upload(
    buffer,
    'materials',
    filename,
    mimeType,
  )

  const maxOrder = await prisma.material.aggregate({
    where: { courseId, deletedAt: null },
    _max: { order: true },
  })
  const order = meta.order ?? (maxOrder._max.order ?? -1) + 1

  const material = await prisma.material.create({
    data: {
      courseId,
      type: meta.type,
      titleEn: meta.titleEn,
      titleTh: meta.titleTh ?? null,
      fileKey,
      mimeType: resolvedMime,
      sizeBytes,
      order,
    },
    select: MATERIAL_SELECT,
  })

  await logAudit(prisma, {
    actorId,
    action: 'MATERIAL_CREATE',
    targetType: 'Material',
    targetId: material.id,
    metadata: { courseId, type: meta.type, titleEn: meta.titleEn, fileKey },
    ...(ip != null && { ip }),
  })

  return materialAdminResponseSchema.parse(toMaterialAdminShape(material, storage, locale))
}

export async function updateMaterial(
  prisma: PrismaClient,
  courseId: string,
  materialId: string,
  input: UpdateMaterialInput,
  actorId: string,
  storage: StorageProvider,
  locale: Locale = 'en',
  ip?: string,
): Promise<MaterialAdminResponse> {
  const existing = await prisma.material.findFirst({
    where: { id: materialId, courseId, deletedAt: null },
  })
  if (!existing) throw notFound(t('error.material.notFound', undefined, locale))

  const material = await prisma.material.update({
    where: { id: materialId },
    data: {
      ...(input.titleEn != null && { titleEn: input.titleEn }),
      ...('titleTh' in input && { titleTh: input.titleTh ?? null }),
      ...(input.url != null && { url: input.url }),
      ...(input.order != null && { order: input.order }),
    },
    select: MATERIAL_SELECT,
  })

  await logAudit(prisma, {
    actorId,
    action: 'MATERIAL_UPDATE',
    targetType: 'Material',
    targetId: materialId,
    metadata: input as Record<string, unknown>,
    ...(ip != null && { ip }),
  })

  return materialAdminResponseSchema.parse(toMaterialAdminShape(material, storage, locale))
}

export async function reorderMaterials(
  prisma: PrismaClient,
  courseId: string,
  input: ReorderMaterialsInput,
  actorId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<void> {
  await assertCourseExists(prisma, courseId, locale)

  const count = await prisma.material.count({
    where: { id: { in: input.materialIds }, courseId, deletedAt: null },
  })
  if (count !== input.materialIds.length) {
    throw badRequest(t('error.material.someNotFound', undefined, locale))
  }

  await prisma.$transaction(
    input.materialIds.map((id: string, index: number) =>
      prisma.material.update({ where: { id }, data: { order: index } }),
    ),
  )

  await logAudit(prisma, {
    actorId,
    action: 'MATERIAL_REORDER',
    targetType: 'Course',
    targetId: courseId,
    metadata: { materialIds: input.materialIds },
    ...(ip != null && { ip }),
  })
}

export async function softDeleteMaterial(
  prisma: PrismaClient,
  courseId: string,
  materialId: string,
  actorId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<void> {
  const existing = await prisma.material.findFirst({
    where: { id: materialId, courseId, deletedAt: null },
  })
  if (!existing) throw notFound(t('error.material.notFound', undefined, locale))

  await prisma.material.update({
    where: { id: materialId },
    data: { deletedAt: new Date() },
  })

  await logAudit(prisma, {
    actorId,
    action: 'MATERIAL_DELETE',
    targetType: 'Material',
    targetId: materialId,
    metadata: { courseId, titleEn: existing.titleEn, fileKey: existing.fileKey },
    ...(ip != null && { ip }),
  })
}
