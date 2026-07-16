import { randomBytes } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { parse } from 'csv-parse/sync'
import type {
  CreateUserInput,
  UpdateUserInput,
  UpdateProfileInput,
  UserResponse,
  ConsentInput,
} from '@btec-lms/shared'
import { hashPassword } from '../../lib/password.js'
import { logAudit } from '../../lib/audit.js'
import { conflict, notFound, badRequest } from '../../lib/errors.js'
import { t, localizeField, type Locale } from '../../lib/i18n.js'
import { resolvePositionId } from '../positions/positions.service.js'
import type { UserListQuery, ImportResult } from './users.schema.js'

// 2C-5: createUser/updateUser รับ positionId ตรงๆ จาก dropdown จริงแล้ว — validate ว่ามีอยู่จริง
// (resolvePositionId แบบ find-or-create ยังใช้เฉพาะ CSV import ที่เป็น free-text โดยธรรมชาติ)
async function assertPositionExists(prisma: PrismaClient, positionId: string, locale: Locale): Promise<void> {
  const position = await prisma.position.findFirst({ where: { id: positionId, deletedAt: null }, select: { id: true } })
  if (!position) throw badRequest(t('error.position.notFound', undefined, locale))
}

function toUserResponse(
  user: {
    id: string
    employeeId: string | null
    name: string
    email: string
    role: string
    language: string
    positionId: string | null
    position: { nameEn: string; nameTh: string | null } | null
    avatarKey: string | null
    isActive: boolean
    lastLoginAt: Date | null
    createdAt: Date
  },
  locale: Locale,
): UserResponse {
  return {
    id: user.id,
    employeeId: user.employeeId,
    name: user.name,
    email: user.email,
    role: user.role as UserResponse['role'],
    language: (user.language === 'th' ? 'th' : 'en') as UserResponse['language'],
    position: user.position ? localizeField(user.position.nameEn, user.position.nameTh, locale) : null,
    positionId: user.positionId,
    avatarKey: user.avatarKey,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  }
}

const USER_SELECT = {
  id: true,
  employeeId: true,
  name: true,
  email: true,
  role: true,
  language: true,
  positionId: true,
  position: { select: { nameEn: true, nameTh: true } },
  avatarKey: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
} as const

export async function listUsers(
  prisma: PrismaClient,
  query: UserListQuery,
  requesterId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<{ data: UserResponse[]; total: number; page: number; limit: number }> {
  const { page, limit, search, role, positionId, isActive } = query
  const skip = (page - 1) * limit

  const where = {
    deletedAt: null,
    ...(search && {
      OR: [
        { name: { contains: search } },
        { email: { contains: search } },
        { employeeId: { contains: search } },
      ],
    }),
    ...(role != null && { role }),
    ...(positionId != null && { positionId }),
    ...(isActive !== undefined && { isActive }),
  }

  const [users, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      select: USER_SELECT,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.user.count({ where }),
  ])

  await logAudit(prisma, {
    actorId: requesterId,
    action: 'USER_LIST',
    metadata: {
      page,
      limit,
      ...(search != null && { search }),
      ...(role != null && { role }),
      ...(positionId != null && { positionId }),
    },
    ...(ip != null && { ip }),
  })

  return { data: users.map((u) => toUserResponse(u, locale)), total, page, limit }
}

export async function createUser(
  prisma: PrismaClient,
  input: CreateUserInput,
  actorId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<UserResponse> {
  const exists = await prisma.user.findFirst({
    where: { email: input.email, deletedAt: null },
  })
  if (exists) throw conflict(t('error.user.emailConflict', undefined, locale))

  if (input.positionId != null) {
    await assertPositionExists(prisma, input.positionId, locale)
  }

  const password = await hashPassword(input.password)

  const user = await prisma.user.create({
    data: {
      email: input.email,
      password,
      name: input.name,
      role: input.role ?? 'USER',
      mustChangePassword: true,
      // conditional spread เพื่อหลีกเลี่ยง exactOptionalPropertyTypes + Prisma conflict
      ...(input.employeeId != null && { employeeId: input.employeeId }),
      ...(input.positionId !== undefined && { positionId: input.positionId }),
    },
    select: USER_SELECT,
  })

  await logAudit(prisma, {
    actorId,
    action: 'USER_CREATE',
    targetType: 'User',
    targetId: user.id,
    metadata: { email: user.email, role: user.role },
    ...(ip != null && { ip }),
  })

  return toUserResponse(user, locale)
}

export async function getUser(
  prisma: PrismaClient,
  id: string,
  requesterId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<UserResponse> {
  const user = await prisma.user.findFirst({
    where: { id, deletedAt: null },
    select: USER_SELECT,
  })
  if (!user) throw notFound(t('error.user.notFound', undefined, locale))

  await logAudit(prisma, {
    actorId: requesterId,
    action: 'USER_VIEW',
    targetType: 'User',
    targetId: id,
    ...(ip != null && { ip }),
  })

  return toUserResponse(user, locale)
}

export async function updateUser(
  prisma: PrismaClient,
  id: string,
  input: UpdateUserInput,
  actorId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<UserResponse> {
  const exists = await prisma.user.findFirst({ where: { id, deletedAt: null } })
  if (!exists) throw notFound(t('error.user.notFound', undefined, locale))

  // input.positionId === undefined → ไม่แตะ positionId เดิม; null → เคลียร์; string → ต้องมีอยู่จริง
  if (input.positionId != null) {
    await assertPositionExists(prisma, input.positionId, locale)
  }

  const user = await prisma.user.update({
    where: { id },
    data: {
      ...(input.name != null && { name: input.name }),
      ...(input.role != null && { role: input.role }),
      ...(input.positionId !== undefined && { positionId: input.positionId }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
    },
    select: USER_SELECT,
  })

  await logAudit(prisma, {
    actorId,
    action: 'USER_UPDATE',
    targetType: 'User',
    targetId: id,
    metadata: input as Record<string, unknown>,
    ...(ip != null && { ip }),
  })

  return toUserResponse(user, locale)
}

export async function softDeleteUser(
  prisma: PrismaClient,
  id: string,
  actorId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<void> {
  const user = await prisma.user.findFirst({ where: { id, deletedAt: null } })
  if (!user) throw notFound(t('error.user.notFound', undefined, locale))
  if (id === actorId) throw badRequest(t('error.user.cannotDeleteSelf', undefined, locale))

  await prisma.$transaction([
    prisma.user.update({ where: { id }, data: { deletedAt: new Date() } }),
    prisma.refreshToken.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ])

  await logAudit(prisma, {
    actorId,
    action: 'USER_DELETE',
    targetType: 'User',
    targetId: id,
    metadata: { email: user.email },
    ...(ip != null && { ip }),
  })
}

// admin สุ่มรหัสผ่านชั่วคราวให้ user คนอื่น (ไม่รับรหัสจาก client — เข้ารหัสได้ทางเดียว ไม่มีที่ไหน
// เก็บ plaintext ไว้เลยนอกจาก response ครั้งนี้ครั้งเดียว) บังคับเปลี่ยนรอบแรกที่ login + revoke
// session เดิมทุกอุปกรณ์ทันที (pattern เดียวกับ changePassword ใน auth.service.ts)
export async function resetUserPassword(
  prisma: PrismaClient,
  id: string,
  actorId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<{ temporaryPassword: string }> {
  const user = await prisma.user.findFirst({ where: { id, deletedAt: null } })
  if (!user) throw notFound(t('error.user.notFound', undefined, locale))

  const temporaryPassword = randomBytes(6).toString('hex')
  const password = await hashPassword(temporaryPassword)

  await prisma.$transaction([
    prisma.user.update({
      where: { id },
      data: { password, mustChangePassword: true, passwordChangedAt: new Date() },
    }),
    prisma.refreshToken.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ])

  await logAudit(prisma, {
    actorId,
    action: 'USER_PASSWORD_RESET',
    targetType: 'User',
    targetId: id,
    metadata: { email: user.email },
    ...(ip != null && { ip }),
  })

  return { temporaryPassword }
}

export async function importFromCsv(
  prisma: PrismaClient,
  buffer: Buffer,
  actorId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<ImportResult> {
  let records: Record<string, string>[]

  try {
    records = parse(buffer.toString('utf-8'), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Record<string, string>[]
  } catch {
    throw badRequest(t('error.file.invalidCsv', undefined, locale))
  }

  const errors: ImportResult['errors'] = []
  const tempPasswords: ImportResult['tempPasswords'] = []
  let created = 0
  let skipped = 0

  for (let i = 0; i < records.length; i++) {
    const row = records[i]!
    const rowNum = i + 2

    const email = row['email']?.trim()
    const name = row['name']?.trim()

    if (!email || !name) {
      errors.push({ row: rowNum, email: email ?? '', reason: t('error.user.importRowMissingFields', undefined, locale) })
      continue
    }

    const exists = await prisma.user.findFirst({ where: { email } })
    if (exists) {
      errors.push({ row: rowNum, email, reason: t('error.user.emailConflict', undefined, locale) })
      skipped++
      continue
    }

    const tempPassword = randomBytes(6).toString('hex')
    const password = await hashPassword(tempPassword)

    const roleRaw = row['role']?.trim().toUpperCase()
    const role = roleRaw === 'ADMIN' || roleRaw === 'USER' ? roleRaw : ('USER' as const)
    const positionId = await resolvePositionId(prisma, row['position'])

    try {
      await prisma.user.create({
        data: {
          email,
          name,
          password,
          role,
          mustChangePassword: true,
          ...(row['employeeId']?.trim() && { employeeId: row['employeeId']!.trim() }),
          ...(positionId != null && { positionId }),
        },
      })

      created++
      tempPasswords.push({ email, tempPassword })
    } catch {
      errors.push({ row: rowNum, email, reason: t('error.user.importRowFailed', undefined, locale) })
    }
  }

  await logAudit(prisma, {
    actorId,
    action: 'USER_IMPORT_CSV',
    metadata: { created, skipped, errors: errors.length },
    ...(ip != null && { ip }),
  })

  return { created, skipped, errors, tempPasswords }
}

export async function getProfile(
  prisma: PrismaClient,
  userId: string,
  locale: Locale = 'en',
): Promise<UserResponse> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: USER_SELECT,
  })
  if (!user) throw notFound(t('error.user.notFound', undefined, locale))
  return toUserResponse(user, locale)
}

export async function updateProfile(
  prisma: PrismaClient,
  userId: string,
  input: UpdateProfileInput,
  locale: Locale = 'en',
  ip?: string,
): Promise<UserResponse> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.name != null && { name: input.name }),
      ...(input.language != null && { language: input.language }),
    },
    select: USER_SELECT,
  })

  await logAudit(prisma, {
    actorId: userId,
    action: 'USER_UPDATE_PROFILE',
    targetType: 'User',
    targetId: userId,
    metadata: input as Record<string, unknown>,
    ...(ip != null && { ip }),
  })

  return toUserResponse(user, locale)
}

export async function recordConsent(
  prisma: PrismaClient,
  userId: string,
  input: ConsentInput,
  ip?: string,
): Promise<void> {
  await prisma.consent.create({
    data: { userId, type: input.type, granted: input.granted, version: input.version },
  })

  await logAudit(prisma, {
    actorId: userId,
    action: 'USER_CONSENT',
    targetType: 'User',
    targetId: userId,
    metadata: { type: input.type, granted: input.granted, version: input.version },
    ...(ip != null && { ip }),
  })
}
