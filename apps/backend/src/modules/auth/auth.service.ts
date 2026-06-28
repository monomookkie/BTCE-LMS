import { createHash, randomBytes } from 'node:crypto'
import type { PrismaClient, Role } from '@prisma/client'
import type { LoginInput, ChangePasswordInput } from '@btec-lms/shared'
import { verifyPassword, hashPassword } from '../../lib/password.js'
import { logAudit } from '../../lib/audit.js'
import { unauthorized, notFound, badRequest } from '../../lib/errors.js'
import { env } from '../../config/env.js'
import type { MeResponse } from './auth.schema.js'

// access token: 15m, refresh token: 7d (seconds)
const ACCESS_MAX_AGE = 15 * 60
const REFRESH_MAX_AGE = 7 * 24 * 60 * 60

type SignFn = (payload: { sub: string; role: Role }) => string

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

function generateRefreshToken(): string {
  return randomBytes(32).toString('hex')
}

export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: env.NODE_ENV === 'production' ? ('none' as const) : ('lax' as const),
    path: '/',
    maxAge,
  }
}

export const ACCESS_COOKIE_OPTS = cookieOptions(ACCESS_MAX_AGE)
export const REFRESH_COOKIE_OPTS = cookieOptions(REFRESH_MAX_AGE)

export async function loginUser(
  prisma: PrismaClient,
  sign: SignFn,
  input: LoginInput,
  ip?: string,
  userAgent?: string,
): Promise<{ accessToken: string; refreshToken: string; user: MeResponse }> {
  const user = await prisma.user.findFirst({
    where: { email: input.email, deletedAt: null },
  })

  // ตรวจ password ก่อน isActive เพื่อให้ timing สม่ำเสมอ
  const passwordValid = user != null && (await verifyPassword(user.password, input.password))

  if (!passwordValid) {
    // metadata: email เท่านั้น — ห้ามบันทึก password ที่กรอกมา
    await logAudit(prisma, {
      action: 'USER_LOGIN_FAILED',
      ...(user != null && { actorId: user.id, targetType: 'User', targetId: user.id }),
      metadata: {
        email: input.email,
        reason: user == null ? 'user_not_found' : 'wrong_password',
      },
      ...(ip != null && { ip }),
    })
    throw unauthorized('อีเมลหรือรหัสผ่านไม่ถูกต้อง')
  }

  if (!user.isActive) {
    // log แยกเพื่อให้ admin เห็นในรายงาน แต่ผู้ใช้เห็น message เดียวกัน (ไม่ leak)
    await logAudit(prisma, {
      actorId: user.id,
      action: 'USER_LOGIN_SUSPENDED',
      targetType: 'User',
      targetId: user.id,
      ...(ip != null && { ip }),
    })
    throw unauthorized('อีเมลหรือรหัสผ่านไม่ถูกต้อง')
  }

  const accessToken = sign({ sub: user.id, role: user.role })
  const refreshRaw = generateRefreshToken()
  const tokenHash = hashToken(refreshRaw)
  const expiresAt = new Date(Date.now() + REFRESH_MAX_AGE * 1000)

  await prisma.$transaction([
    prisma.refreshToken.create({ data: { userId: user.id, tokenHash, expiresAt } }),
    prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
  ])

  await logAudit(prisma, {
    actorId: user.id,
    action: 'USER_LOGIN',
    targetType: 'User',
    targetId: user.id,
    ...(ip != null && { ip }),
    ...(userAgent != null && { userAgent }),
  })

  return {
    accessToken,
    refreshToken: refreshRaw,
    user: {
      id: user.id,
      employeeId: user.employeeId,
      name: user.name,
      email: user.email,
      role: user.role,
      language: (user.language === 'th' ? 'th' : 'en') as 'en' | 'th',
      departmentId: user.departmentId,
      position: user.position,
      avatarKey: user.avatarKey,
      isActive: user.isActive,
      mustChangePassword: user.mustChangePassword,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
    },
  }
}

export async function logoutUser(
  prisma: PrismaClient,
  userId: string,
  refreshRaw: string,
  ip?: string,
): Promise<void> {
  const tokenHash = hashToken(refreshRaw)

  await prisma.refreshToken.updateMany({
    where: { userId, tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  })

  await logAudit(prisma, {
    actorId: userId,
    action: 'USER_LOGOUT',
    targetType: 'User',
    targetId: userId,
    ...(ip != null && { ip }),
  })
}

export async function rotateRefreshToken(
  prisma: PrismaClient,
  sign: SignFn,
  refreshRaw: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const tokenHash = hashToken(refreshRaw)

  const stored = await prisma.refreshToken.findFirst({
    where: {
      tokenHash,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: { user: true },
  })

  if (!stored) {
    throw unauthorized('Refresh token หมดอายุหรือไม่ถูกต้อง')
  }

  if (!stored.user.isActive || stored.user.deletedAt) {
    throw unauthorized('บัญชีนี้ถูกระงับการใช้งาน')
  }

  const newRefreshRaw = generateRefreshToken()
  const newTokenHash = hashToken(newRefreshRaw)
  const expiresAt = new Date(Date.now() + REFRESH_MAX_AGE * 1000)

  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    }),
    prisma.refreshToken.create({
      data: { userId: stored.userId, tokenHash: newTokenHash, expiresAt },
    }),
  ])

  const accessToken = sign({ sub: stored.userId, role: stored.user.role })

  return { accessToken, refreshToken: newRefreshRaw }
}

export async function getMe(prisma: PrismaClient, userId: string): Promise<MeResponse> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
  })

  if (!user) throw notFound('User not found')

  return {
    id: user.id,
    employeeId: user.employeeId,
    name: user.name,
    email: user.email,
    role: user.role,
    language: (user.language === 'th' ? 'th' : 'en') as 'en' | 'th',
    departmentId: user.departmentId,
    position: user.position,
    avatarKey: user.avatarKey,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  }
}

export async function changePassword(
  prisma: PrismaClient,
  userId: string,
  input: ChangePasswordInput,
  ip?: string,
): Promise<void> {
  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } })
  if (!user) throw notFound('User not found')

  const valid = await verifyPassword(user.password, input.currentPassword)
  if (!valid) throw badRequest('รหัสผ่านปัจจุบันไม่ถูกต้อง')

  const newHash = await hashPassword(input.newPassword)

  await prisma.user.update({
    where: { id: userId },
    data: {
      password: newHash,
      mustChangePassword: false,
      passwordChangedAt: new Date(),
    },
  })

  // revoke tokens ทั้งหมดเพื่อบังคับ login ใหม่บนอุปกรณ์อื่น
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  })

  await logAudit(prisma, {
    actorId: userId,
    action: 'USER_CHANGE_PASSWORD',
    targetType: 'User',
    targetId: userId,
    ...(ip != null && { ip }),
  })
}
