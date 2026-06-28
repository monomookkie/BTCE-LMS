import type { PrismaClient } from '@prisma/client'
import type {
  MaterialResponse,
  CreateLinkMaterialInput,
  CreateFileMaterialMeta,
  UpdateMaterialInput,
  ReorderMaterialsInput,
} from '@btec-lms/shared'
import { logAudit } from '../../lib/audit.js'
import { notFound, badRequest } from '../../lib/errors.js'
import { type StorageProvider } from '../../lib/storage.js'

const MATERIAL_SELECT = {
  id: true,
  courseId: true,
  type: true,
  title: true,
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
  title: string
  fileKey: string | null
  url: string | null
  mimeType: string | null
  sizeBytes: number | null
  order: number
  createdAt: Date
}

function toMaterialResponse(m: MaterialRecord, storage: StorageProvider): MaterialResponse {
  return {
    id: m.id,
    courseId: m.courseId,
    type: m.type as MaterialResponse['type'],
    title: m.title,
    fileKey: m.fileKey,
    url: m.url,
    signedUrl: m.fileKey != null ? storage.getSignedUrl(m.fileKey) : null,
    mimeType: m.mimeType,
    sizeBytes: m.sizeBytes,
    order: m.order,
    createdAt: m.createdAt.toISOString(),
  }
}

async function assertCourseExists(prisma: PrismaClient, courseId: string): Promise<void> {
  const course = await prisma.course.findFirst({ where: { id: courseId, deletedAt: null }, select: { id: true } })
  if (!course) throw notFound('Course not found')
}

export async function listMaterials(
  prisma: PrismaClient,
  courseId: string,
  storage: StorageProvider,
  actorId: string,
  ip?: string,
  requesterRole?: string,
): Promise<MaterialResponse[]> {
  await assertCourseExists(prisma, courseId)

  // USER ต้อง enrolled (active) จึงเข้าถึง materials ได้
  if (requesterRole === 'USER') {
    const enrollment = await prisma.enrollment.findFirst({
      where: { userId: actorId, courseId, deletedAt: null },
      select: { id: true },
    })
    if (!enrollment) {
      const { forbidden } = await import('../../lib/errors.js')
      throw forbidden('You must be enrolled in this course to view materials')
    }
  }

  const materials = await prisma.material.findMany({
    where: { courseId, deletedAt: null },
    select: MATERIAL_SELECT,
    orderBy: { order: 'asc' },
  })

  // บันทึกการเข้าถึง — signedUrl ถูก generate ณ จุดนี้ ถือเป็น "file access" event
  await logAudit(prisma, {
    actorId,
    action: 'MATERIAL_LIST',
    targetType: 'Course',
    targetId: courseId,
    metadata: { count: materials.length },
    ...(ip != null && { ip }),
  })

  return materials.map((m) => toMaterialResponse(m, storage))
}

export async function createLinkMaterial(
  prisma: PrismaClient,
  courseId: string,
  input: CreateLinkMaterialInput,
  actorId: string,
  storage: StorageProvider,
  ip?: string,
): Promise<MaterialResponse> {
  await assertCourseExists(prisma, courseId)

  // ถ้าไม่ระบุ order ให้ต่อท้าย
  const maxOrder = await prisma.material.aggregate({
    where: { courseId, deletedAt: null },
    _max: { order: true },
  })
  const order = input.order ?? (maxOrder._max.order ?? -1) + 1

  const material = await prisma.material.create({
    data: {
      courseId,
      type: input.type,
      title: input.title,
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
    metadata: { courseId, type: input.type, title: input.title },
    ...(ip != null && { ip }),
  })

  return toMaterialResponse(material, storage)
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
  ip?: string,
): Promise<MaterialResponse> {
  await assertCourseExists(prisma, courseId)

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
      title: meta.title,
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
    metadata: { courseId, type: meta.type, title: meta.title, fileKey },
    ...(ip != null && { ip }),
  })

  return toMaterialResponse(material, storage)
}

export async function updateMaterial(
  prisma: PrismaClient,
  courseId: string,
  materialId: string,
  input: UpdateMaterialInput,
  actorId: string,
  storage: StorageProvider,
  ip?: string,
): Promise<MaterialResponse> {
  const existing = await prisma.material.findFirst({
    where: { id: materialId, courseId, deletedAt: null },
  })
  if (!existing) throw notFound('Material not found')

  const material = await prisma.material.update({
    where: { id: materialId },
    data: {
      ...(input.title != null && { title: input.title }),
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

  return toMaterialResponse(material, storage)
}

export async function reorderMaterials(
  prisma: PrismaClient,
  courseId: string,
  input: ReorderMaterialsInput,
  actorId: string,
  ip?: string,
): Promise<void> {
  await assertCourseExists(prisma, courseId)

  // ยืนยันว่า materialIds ทั้งหมด belong to courseId
  const count = await prisma.material.count({
    where: { id: { in: input.materialIds }, courseId, deletedAt: null },
  })
  if (count !== input.materialIds.length) {
    throw badRequest('Some material IDs not found in this course')
  }

  // update order ตาม index ใน array
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
  ip?: string,
): Promise<void> {
  const existing = await prisma.material.findFirst({
    where: { id: materialId, courseId, deletedAt: null },
  })
  if (!existing) throw notFound('Material not found')

  // ไฟล์ใน Cloudinary ยังอยู่ — รอ cleanup job ทีหลัง
  await prisma.material.update({
    where: { id: materialId },
    data: { deletedAt: new Date() },
  })

  await logAudit(prisma, {
    actorId,
    action: 'MATERIAL_DELETE',
    targetType: 'Material',
    targetId: materialId,
    metadata: { courseId, title: existing.title, fileKey: existing.fileKey },
    ...(ip != null && { ip }),
  })
}
