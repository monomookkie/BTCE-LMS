import type { PrismaClient } from '@prisma/client'
import type {
  PositionPublicResponse,
  PositionAdminResponse,
  CreatePositionInput,
  UpdatePositionInput,
  MergePositionInput,
} from '@btec-lms/shared'
import { logAudit } from '../../lib/audit.js'
import { notFound, conflict, badRequest } from '../../lib/errors.js'
import { t, localizeField, type Locale } from '../../lib/i18n.js'

// ─── Transition helper — 2C-1 ────────────────────────────────────────────────
// users.service.ts / auth.service.ts ยังรับ position เป็น free-text string จาก
// frontend ที่ยังไม่ได้แก้ (RegisterPage/UserDirectoryPage จะเปลี่ยนใน 2C-5)
// helper นี้ find-or-create Position จาก string เพื่อ resolve เป็น positionId —
// exact-string match เท่านั้น (ไม่ fuzzy) ตรงกับ decision ที่ยืนยันไว้ตอน migrate backfill
export async function resolvePositionId(
  prisma: PrismaClient,
  positionName: string | null | undefined,
): Promise<string | null> {
  if (positionName == null) return null
  const trimmed = positionName.trim()
  if (trimmed === '') return null

  // upsert แทน findFirst+create — กัน race (สอง request resolve string ใหม่พร้อมกันชน
  // unique constraint) และกัน edge case ที่ Position เคย soft-delete ไปแล้ว (unique index
  // ไม่สน deletedAt เลยชนอยู่ดีถ้าใช้ create ตรงๆ) — revive กลับมาแทนถ้าเจอ row เดิมที่ลบไปแล้ว
  const position = await prisma.position.upsert({
    where: { nameEn: trimmed },
    create: { nameEn: trimmed },
    update: { deletedAt: null },
    select: { id: true },
  })
  return position.id
}

// ─── Serialization ────────────────────────────────────────────────────────

function toPublicResponse(
  position: { id: string; nameEn: string; nameTh: string | null },
  locale: Locale,
): PositionPublicResponse {
  return {
    id: position.id,
    name: localizeField(position.nameEn, position.nameTh, locale),
  }
}

function toAdminResponse(
  position: { id: string; nameEn: string; nameTh: string | null; isSystemOnly: boolean },
  locale: Locale,
  counts: { userCount: number; courseCount: number },
): PositionAdminResponse {
  return {
    id: position.id,
    name: localizeField(position.nameEn, position.nameTh, locale),
    nameEn: position.nameEn,
    nameTh: position.nameTh,
    userCount: counts.userCount,
    courseCount: counts.courseCount,
    isSystemOnly: position.isSystemOnly,
  }
}

async function getPositionCounts(prisma: PrismaClient, positionId: string): Promise<{ userCount: number; courseCount: number }> {
  const [userCount, courseCount] = await Promise.all([
    prisma.user.count({ where: { positionId, deletedAt: null } }),
    prisma.coursePosition.count({ where: { positionId } }),
  ])
  return { userCount, courseCount }
}

// ─── Public: list (unauthenticated — ใช้ใน self-registration) ──────────────

export async function listPositionsPublic(
  prisma: PrismaClient,
  locale: Locale = 'en',
): Promise<PositionPublicResponse[]> {
  const positions = await prisma.position.findMany({
    // isSystemOnly=true (เช่น "Administrator") ห้ามขึ้นให้เลือกในหน้า self-register สาธารณะ —
    // ADMIN ยัง assign ให้ user อื่นได้ปกติผ่าน /positions/admin (ไม่ถูก filter นี้)
    where: { deletedAt: null, isSystemOnly: false },
    orderBy: { nameEn: 'asc' },
  })
  return positions.map((p) => toPublicResponse(p, locale))
}

// ─── Admin CRUD ───────────────────────────────────────────────────────────

export async function listPositionsAdmin(
  prisma: PrismaClient,
  locale: Locale = 'en',
): Promise<PositionAdminResponse[]> {
  const positions = await prisma.position.findMany({
    where: { deletedAt: null },
    orderBy: { nameEn: 'asc' },
  })
  const counts = await Promise.all(positions.map((p) => getPositionCounts(prisma, p.id)))
  return positions.map((p, i) => toAdminResponse(p, locale, counts[i]!))
}

export async function createPosition(
  prisma: PrismaClient,
  input: CreatePositionInput,
  actorId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<PositionAdminResponse> {
  const existingActive = await prisma.position.findFirst({
    where: { nameEn: input.nameEn, deletedAt: null },
  })
  if (existingActive) throw conflict(t('error.position.nameConflict', undefined, locale))

  // upsert แทน create ตรงๆ — nameEn unique constraint ไม่สน deletedAt เลย ถ้าเคย soft-delete
  // ชื่อเดียวกันไปก่อนหน้า create ตรงๆ จะชน P2002 (500) แทน — revive กลับมาแทน
  const position = await prisma.position.upsert({
    where: { nameEn: input.nameEn },
    create: { nameEn: input.nameEn, nameTh: input.nameTh ?? null },
    update: { nameTh: input.nameTh ?? null, deletedAt: null },
  })

  await logAudit(prisma, {
    actorId,
    action: 'POSITION_CREATE',
    targetType: 'Position',
    targetId: position.id,
    metadata: { nameEn: position.nameEn },
    ...(ip != null && { ip }),
  })

  // สร้างใหม่หรือ revive จาก soft-delete เสมอเริ่มที่ 0 usage — delete ถูก block ไว้ตอนยังมี
  // ref อยู่แล้ว จึง soft-delete ได้ก็ต่อเมื่อ 0 ref อยู่ก่อนแล้วเท่านั้น
  return toAdminResponse(position, locale, { userCount: 0, courseCount: 0 })
}

export async function updatePosition(
  prisma: PrismaClient,
  id: string,
  input: UpdatePositionInput,
  actorId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<PositionAdminResponse> {
  const existing = await prisma.position.findFirst({ where: { id, deletedAt: null } })
  if (!existing) throw notFound(t('error.position.notFound', undefined, locale))

  if (input.nameEn != null && input.nameEn !== existing.nameEn) {
    const conflicting = await prisma.position.findFirst({
      where: { nameEn: input.nameEn, deletedAt: null, id: { not: id } },
    })
    if (conflicting) throw conflict(t('error.position.nameConflict', undefined, locale))
  }

  const position = await prisma.position.update({
    where: { id },
    data: {
      ...(input.nameEn != null && { nameEn: input.nameEn }),
      ...('nameTh' in input && { nameTh: input.nameTh ?? null }),
    },
  })

  await logAudit(prisma, {
    actorId,
    action: 'POSITION_UPDATE',
    targetType: 'Position',
    targetId: id,
    metadata: input as Record<string, unknown>,
    ...(ip != null && { ip }),
  })

  const counts = await getPositionCounts(prisma, id)
  return toAdminResponse(position, locale, counts)
}

export async function deletePosition(
  prisma: PrismaClient,
  id: string,
  actorId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<void> {
  const existing = await prisma.position.findFirst({ where: { id, deletedAt: null } })
  if (!existing) throw notFound(t('error.position.notFound', undefined, locale))

  // กัน orphan: user ที่ยัง assign position นี้อยู่จะหา match ไม่เจอ (query กรอง
  // deletedAt: null เสมอ) ทำให้ profile แสดง position ว่างเปล่าและหลุดจาก
  // POSITION_BASED course targeting (2C-2) แบบไม่รู้ตัว — บล็อกลบไว้ก่อน
  const inUseCount = await prisma.user.count({
    where: { positionId: id, deletedAt: null },
  })
  if (inUseCount > 0) throw badRequest(t('error.position.inUse', { count: inUseCount }, locale))

  // กัน course หลุด invariant: ลบ Position ที่ยังผูกกับ course (2C-2) จะทำให้
  // POSITION_BASED course ที่ published อาจเหลือ 0 position แบบไม่ตั้งใจ — บล็อกไว้ก่อน
  // (ไม่ cascade เพราะจะขัด publish-gate ของ course เอง ให้ admin ไปเอา position
  // ออกจาก course ก่อนตั้งใจผ่าน PUT /courses/:id/positions)
  const linkedCourseCount = await prisma.coursePosition.count({ where: { positionId: id } })
  if (linkedCourseCount > 0) {
    throw badRequest(t('error.position.linkedToCourse', { count: linkedCourseCount }, locale))
  }

  await prisma.position.update({
    where: { id },
    data: { deletedAt: new Date() },
  })

  await logAudit(prisma, {
    actorId,
    action: 'POSITION_DELETE',
    targetType: 'Position',
    targetId: id,
    metadata: { nameEn: existing.nameEn },
    ...(ip != null && { ip }),
  })
}

// ─── Merge (2C-5) ───────────────────────────────────────────────────────────
// รวมตำแหน่งซ้ำ — ย้าย user + course ทั้งหมดจาก source ไป target แล้ว soft-delete source
// ทำทั้งหมดใน $transaction เดียว กัน state ค้างครึ่งๆ กลางๆ ถ้าล้มระหว่างทาง
export async function mergePositions(
  prisma: PrismaClient,
  sourceId: string,
  input: MergePositionInput,
  actorId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<void> {
  const targetId = input.targetPositionId
  if (targetId === sourceId) throw badRequest(t('error.position.mergeSameTarget', undefined, locale))

  const [source, target] = await Promise.all([
    prisma.position.findFirst({ where: { id: sourceId, deletedAt: null } }),
    prisma.position.findFirst({ where: { id: targetId, deletedAt: null } }),
  ])
  if (!source) throw notFound(t('error.position.notFound', undefined, locale))
  if (!target) throw badRequest(t('error.position.mergeTargetNotFound', undefined, locale))

  await prisma.$transaction(async (tx) => {
    // re-check target ใน tx เอง — กัน race ที่ target ถูก soft-delete ไปแล้วในช่วงระหว่าง
    // fetch ด้านบนกับตอนเริ่ม transaction จริง (TOCTOU)
    const targetStillActive = await tx.position.findFirst({ where: { id: targetId, deletedAt: null }, select: { id: true } })
    if (!targetStillActive) throw badRequest(t('error.position.mergeTargetNotFound', undefined, locale))

    const movedUsers = await tx.user.updateMany({
      where: { positionId: sourceId },
      data: { positionId: targetId },
    })

    // CoursePosition มี unique(courseId, positionId) — ถ้า target ผูก course เดียวกันอยู่แล้ว
    // ย้าย source's row ไปทับไม่ได้ (ชน constraint) ต้องลบทิ้งแทน (target ครอบคลุมอยู่แล้ว)
    const sourceLinks = await tx.coursePosition.findMany({
      where: { positionId: sourceId },
      select: { id: true, courseId: true },
    })
    const targetLinks = await tx.coursePosition.findMany({
      where: { positionId: targetId },
      select: { courseId: true },
    })
    const targetCourseIds = new Set(targetLinks.map((l) => l.courseId))
    const toDeleteIds = sourceLinks.filter((l) => targetCourseIds.has(l.courseId)).map((l) => l.id)
    const toRepointIds = sourceLinks.filter((l) => !targetCourseIds.has(l.courseId)).map((l) => l.id)

    if (toDeleteIds.length > 0) {
      await tx.coursePosition.deleteMany({ where: { id: { in: toDeleteIds } } })
    }
    if (toRepointIds.length > 0) {
      await tx.coursePosition.updateMany({ where: { id: { in: toRepointIds } }, data: { positionId: targetId } })
    }

    // defensive check ก่อน soft-delete จริง — ยืนยันว่า source ไม่มี ref เหลือค้าง (0 orphan)
    // กัน bug ในอนาคตที่อาจทำให้ logic ย้ายด้านบน drift ไปแบบไม่ครบ แล้ว soft-delete ไปทั้งที่ยังมีคนอ้างอิงอยู่
    const [remainingUsers, remainingCourseLinks] = await Promise.all([
      tx.user.count({ where: { positionId: sourceId } }),
      tx.coursePosition.count({ where: { positionId: sourceId } }),
    ])
    if (remainingUsers > 0 || remainingCourseLinks > 0) {
      throw badRequest(t('error.position.mergeIncomplete', undefined, locale))
    }

    await tx.position.update({ where: { id: sourceId }, data: { deletedAt: new Date() } })

    await logAudit(tx, {
      actorId,
      action: 'POSITION_MERGE',
      targetType: 'Position',
      targetId: sourceId,
      metadata: {
        sourceNameEn: source.nameEn,
        targetPositionId: targetId,
        targetNameEn: target.nameEn,
        usersMoved: movedUsers.count,
        coursesMoved: toRepointIds.length,
        coursesSkippedDuplicate: toDeleteIds.length,
      },
      ...(ip != null && { ip }),
    })
  })
}
