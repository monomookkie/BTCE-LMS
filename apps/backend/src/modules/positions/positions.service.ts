import type { PrismaClient } from '@prisma/client'
import type {
  PositionPublicResponse,
  PositionAdminResponse,
  CreatePositionInput,
  UpdatePositionInput,
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
  position: { id: string; nameEn: string; nameTh: string | null },
  locale: Locale,
): PositionAdminResponse {
  return {
    id: position.id,
    name: localizeField(position.nameEn, position.nameTh, locale),
    nameEn: position.nameEn,
    nameTh: position.nameTh,
  }
}

// ─── Public: list (unauthenticated — ใช้ใน self-registration) ──────────────

export async function listPositionsPublic(
  prisma: PrismaClient,
  locale: Locale = 'en',
): Promise<PositionPublicResponse[]> {
  const positions = await prisma.position.findMany({
    where: { deletedAt: null },
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
  return positions.map((p) => toAdminResponse(p, locale))
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

  return toAdminResponse(position, locale)
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

  return toAdminResponse(position, locale)
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
