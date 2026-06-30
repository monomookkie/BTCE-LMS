import type { PrismaClient, Prisma } from '@prisma/client'
import { randomUUID } from 'crypto'
import type {
  CertStatus,
  CertificatePublicResponse,
  CertificateAdminResponse,
  CertificateVerifyResponse,
  ExternalCertResponse,
  CreateExternalCertInput,
} from '@btec-lms/shared'
import {
  certificatePublicResponseSchema,
  certificateAdminResponseSchema,
  certificateVerifyResponseSchema,
  externalCertResponseSchema,
} from '@btec-lms/shared'
import { serializeByRole } from '../../lib/roleResponse.js'
import { logAudit } from '../../lib/audit.js'
import { notFound, badRequest } from '../../lib/errors.js'
import { t, localizeField, type Locale } from '../../lib/i18n.js'
import type { StorageProvider } from '../../lib/storage.js'
import { generateCertificatePdf } from '../../lib/pdf.js'
import { env } from '../../config/env.js'

// ─── Types ───────────────────────────────────────────────────────────────────

type TX = Prisma.TransactionClient

const EXPIRING_SOON_DAYS = 30

// ─── Pure helpers ─────────────────────────────────────────────────────────────

export function getCertStatus(cert: {
  revokedAt: Date | null
  expiresAt: Date | null
}): CertStatus {
  if (cert.revokedAt) return 'revoked'
  if (!cert.expiresAt) return 'valid'
  const now = Date.now()
  const exp = cert.expiresAt.getTime()
  if (now >= exp) return 'expired'
  if (now >= exp - EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000) return 'expiring-soon'
  return 'valid'
}

// ─── certNumber — atomic via LAST_INSERT_ID trick (MariaDB/MySQL) ─────────────
// INSERT ... ON DUPLICATE KEY UPDATE last_seq = LAST_INSERT_ID(last_seq + 1)
// แต่ละ session เห็น LAST_INSERT_ID() ของตัวเอง → thread-safe ไม่ต้อง SELECT FOR UPDATE

async function getNextCertNumber(tx: TX, year: number): Promise<string> {
  await tx.$executeRaw`
    INSERT INTO certificate_counter (year, last_seq)
    VALUES (${year}, LAST_INSERT_ID(1))
    ON DUPLICATE KEY UPDATE last_seq = LAST_INSERT_ID(last_seq + 1)
  `
  const rows = await tx.$queryRaw<[{ seq: bigint }]>`SELECT LAST_INSERT_ID() AS seq`
  const seq = Number(rows[0]!.seq)
  return `BTEC-${year}-${String(seq).padStart(4, '0')}`
}

// ─── Core: issue certificate ──────────────────────────────────────────────────

async function issueCertificate(
  prisma: PrismaClient,
  enrollmentId: string,
  ip?: string,
): Promise<void> {
  // Pre-check outside transaction — fast exit for already-issued
  const existing = await prisma.certificate.findUnique({
    where: { enrollmentId },
    select: { id: true },
  })
  if (existing) return

  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    select: {
      id: true,
      userId: true,
      courseId: true,
      status: true,
      course: { select: { expiryMonths: true, titleEn: true, titleTh: true } },
    },
  })
  if (!enrollment || enrollment.status !== 'COMPLETED') return

  // Score: best passed quiz attempt สำหรับ course ที่มี quiz; ไม่มี quiz → 100
  const quiz = await prisma.quiz.findFirst({
    where: { courseId: enrollment.courseId, deletedAt: null },
    select: { id: true },
  })
  let score = 100
  if (quiz) {
    const best = await prisma.quizAttempt.findFirst({
      where: { quizId: quiz.id, userId: enrollment.userId, passed: true },
      orderBy: { score: 'desc' },
      select: { score: true },
    })
    if (best) score = best.score
  }

  const now = new Date()
  const year = now.getFullYear()
  const expiresAt =
    enrollment.course.expiryMonths != null
      ? new Date(now.getTime() + enrollment.course.expiryMonths * 30 * 24 * 60 * 60 * 1000)
      : null

  await prisma.$transaction(async (tx) => {
    // Re-check inside transaction — กัน TOCTOU race ระหว่าง concurrent issuance
    const doubleCheck = await tx.certificate.findUnique({
      where: { enrollmentId },
      select: { id: true },
    })
    if (doubleCheck) return

    const certNumber = await getNextCertNumber(tx, year)
    const verifyHash = randomUUID()

    const cert = await tx.certificate.create({
      data: {
        enrollmentId,
        userId: enrollment.userId,
        courseId: enrollment.courseId,
        courseTitleEn: enrollment.course.titleEn,
        courseTitleTh: enrollment.course.titleTh ?? null,
        certNumber,
        score,
        verifyHash,
        issuedAt: now,
        expiresAt,
      },
    })

    await tx.auditLog.create({
      data: {
        actorId: enrollment.userId,
        action: 'CERT_ISSUE',
        targetType: 'Certificate',
        targetId: cert.id,
        metadata: { certNumber, score, enrollmentId },
        ...(ip != null && { ip }),
      },
    })
  })
}

// ─── Public hook — เรียกจาก enrollments + quizzes service ────────────────────
// idempotent: เรียกซ้ำได้ ถ้า cert ออกแล้ว return เงียบ

export async function onEnrollmentCompleted(
  prisma: PrismaClient,
  enrollmentId: string,
  ip?: string,
): Promise<void> {
  await issueCertificate(prisma, enrollmentId, ip)
  // เพิ่ม: ส่ง notification / email ที่นี่ใน Phase 5
}

// ─── Cron helper: หา cert ที่ใกล้หมดอายุ ─────────────────────────────────────

export interface ExpiringSoonCert {
  certId: string
  userId: string
  certNumber: string
  expiresAt: Date
  courseTitleEn: string
  courseTitleTh: string | null
}

export async function findExpiringSoon(
  prisma: PrismaClient,
  daysAhead = EXPIRING_SOON_DAYS,
): Promise<ExpiringSoonCert[]> {
  const now = new Date()
  const threshold = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000)

  const certs = await prisma.certificate.findMany({
    where: {
      expiresAt: { gte: now, lte: threshold },
      revokedAt: null,
    },
    select: {
      id: true,
      userId: true,
      certNumber: true,
      expiresAt: true,
      enrollment: {
        select: {
          course: { select: { titleEn: true, titleTh: true } },
        },
      },
    },
  })

  return certs.map((c) => ({
    certId: c.id,
    userId: c.userId,
    certNumber: c.certNumber,
    expiresAt: c.expiresAt!,
    courseTitleEn: c.enrollment.course.titleEn,
    courseTitleTh: c.enrollment.course.titleTh,
  }))
}

// ─── Serialization helpers ────────────────────────────────────────────────────

type CertRecord = {
  id: string
  enrollmentId: string
  userId: string
  courseId: string
  courseTitleEn: string
  courseTitleTh: string | null
  certNumber: string
  score: number
  fileKey: string | null
  verifyHash: string
  issuedAt: Date
  expiresAt: Date | null
  revokedAt: Date | null
}

function toCertAdminShape(c: CertRecord, locale: Locale = 'en'): CertificateAdminResponse {
  return {
    id: c.id,
    certNumber: c.certNumber,
    courseId: c.courseId,
    courseTitle: localizeField(c.courseTitleEn, c.courseTitleTh, locale),
    score: c.score,
    status: getCertStatus(c),
    issuedAt: c.issuedAt.toISOString(),
    expiresAt: c.expiresAt?.toISOString() ?? null,
    enrollmentId: c.enrollmentId,
    userId: c.userId,
    verifyHash: c.verifyHash,
    fileKey: c.fileKey,
    revokedAt: c.revokedAt?.toISOString() ?? null,
  }
}

function serializeCert(
  c: CertRecord,
  role: string,
  locale: Locale = 'en',
): CertificateAdminResponse | CertificatePublicResponse {
  return serializeByRole(
    role,
    toCertAdminShape(c, locale),
    certificateAdminResponseSchema,
    certificatePublicResponseSchema,
  )
}

const CERT_SELECT = {
  id: true,
  enrollmentId: true,
  userId: true,
  courseId: true,
  courseTitleEn: true,
  courseTitleTh: true,
  certNumber: true,
  score: true,
  fileKey: true,
  verifyHash: true,
  issuedAt: true,
  expiresAt: true,
  revokedAt: true,
} as const

// ─── CRUD: list + get ─────────────────────────────────────────────────────────

export async function listCertificates(
  prisma: PrismaClient,
  requesterId: string,
  role: string,
  query: { userId?: string; page: number; limit: number },
  locale: Locale = 'en',
): Promise<{ data: (CertificateAdminResponse | CertificatePublicResponse)[]; total: number; page: number; limit: number }> {
  // USER ดูเฉพาะของตัวเอง — ไม่สนใจ query.userId
  const targetUserId = role === 'USER' ? requesterId : query.userId

  const where = { ...(targetUserId != null && { userId: targetUserId }) }
  const { page, limit } = query

  const [certs, total] = await prisma.$transaction([
    prisma.certificate.findMany({
      where,
      select: CERT_SELECT,
      orderBy: { issuedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.certificate.count({ where }),
  ])

  return {
    data: certs.map((c) => serializeCert(c, role, locale)),
    total,
    page,
    limit,
  }
}

export async function getCertificate(
  prisma: PrismaClient,
  id: string,
  requesterId: string,
  role: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<CertificateAdminResponse | CertificatePublicResponse> {
  const cert = await prisma.certificate.findUnique({ where: { id }, select: CERT_SELECT })

  // notFound ทั้งกรณี "ไม่มี" และ "IDOR" — กัน enumeration
  if (!cert) throw notFound(t('error.cert.notFound', undefined, locale))
  if (role === 'USER' && cert.userId !== requesterId) {
    throw notFound(t('error.cert.notFound', undefined, locale))
  }

  // PDPA: log เมื่อ ADMIN/MANAGER ดู cert ของ user อื่น
  if (role !== 'USER' && cert.userId !== requesterId) {
    await logAudit(prisma, {
      actorId: requesterId,
      action: 'CERT_VIEW',
      targetType: 'Certificate',
      targetId: id,
      metadata: { targetUserId: cert.userId },
      ...(ip != null && { ip }),
    })
  }

  return serializeCert(cert, role, locale)
}

// ─── Revoke ───────────────────────────────────────────────────────────────────

export async function revokeCertificate(
  prisma: PrismaClient,
  id: string,
  actorId: string,
  reason: string | undefined,
  locale: Locale = 'en',
  ip?: string,
): Promise<CertificateAdminResponse> {
  const cert = await prisma.certificate.findUnique({ where: { id }, select: CERT_SELECT })
  if (!cert) throw notFound(t('error.cert.notFound', undefined, locale))
  if (cert.revokedAt) throw badRequest(t('error.cert.alreadyRevoked', undefined, locale))

  const updated = await prisma.certificate.update({
    where: { id },
    data: { revokedAt: new Date() },
    select: CERT_SELECT,
  })

  await logAudit(prisma, {
    actorId,
    action: 'CERT_REVOKE',
    targetType: 'Certificate',
    targetId: id,
    metadata: { reason: reason ?? null, userId: cert.userId },
    ...(ip != null && { ip }),
  })

  return toCertAdminShape(updated, locale)
}

// ─── Public verify by verifyHash (UUID) ──────────────────────────────────────
// ไม่แยกแยะ "ไม่มี" vs "revoked" เพื่อกัน enumeration

export async function verifyByHash(
  prisma: PrismaClient,
  hash: string,
  locale: Locale = 'en',
  ip?: string,
  actorId?: string,
): Promise<CertificateVerifyResponse> {
  const cert = await prisma.certificate.findUnique({
    where: { verifyHash: hash },
    select: {
      ...CERT_SELECT,
      user: { select: { name: true } },
    },
  })

  // 404 เฉพาะ hash ไม่มีจริง — revoked คืน 200 status='revoked' เพื่อ UX ที่ดีกว่า
  if (!cert) throw notFound(t('error.cert.notFound', undefined, locale))

  await logAudit(prisma, {
    ...(actorId != null && { actorId }),
    action: 'CERT_VERIFY',
    targetType: 'Certificate',
    targetId: cert.id,
    metadata: { verifyHash: hash },
    ...(ip != null && { ip }),
  })

  const courseName = localizeField(cert.courseTitleEn, cert.courseTitleTh, locale)

  return certificateVerifyResponseSchema.parse({
    certNumber: cert.certNumber,
    holderName: cert.user.name,
    courseName,
    issuedAt: cert.issuedAt.toISOString(),
    expiresAt: cert.expiresAt?.toISOString() ?? null,
    status: getCertStatus(cert),
  })
}

// ─── PDF generation ───────────────────────────────────────────────────────────

export async function generateCertPdf(
  prisma: PrismaClient,
  id: string,
  requesterId: string,
  role: string,
  locale: Locale = 'en',
): Promise<Buffer> {
  const cert = await prisma.certificate.findUnique({
    where: { id },
    select: {
      ...CERT_SELECT,
      user: { select: { name: true } },
    },
  })
  if (!cert) throw notFound(t('error.cert.notFound', undefined, locale))
  if (role === 'USER' && cert.userId !== requesterId) {
    throw notFound(t('error.cert.notFound', undefined, locale))
  }
  if (cert.revokedAt) throw badRequest(t('error.cert.revoked', undefined, locale))

  // PDPA: log เมื่อ ADMIN/MANAGER ดาวน์โหลด cert PDF ของ user อื่น — personal data export
  if (role !== 'USER' && cert.userId !== requesterId) {
    await logAudit(prisma, {
      actorId: requesterId,
      action: 'CERT_PDF_DOWNLOAD',
      targetType: 'Certificate',
      targetId: id,
      metadata: { targetUserId: cert.userId },
    })
  }

  const courseTitle = localizeField(cert.courseTitleEn, cert.courseTitleTh, locale)

  return generateCertificatePdf({
    holderName: cert.user.name,
    courseTitle,
    certNumber: cert.certNumber,
    score: cert.score,
    issuedAt: cert.issuedAt,
    expiresAt: cert.expiresAt,
    verifyUrl: `${env.APP_URL}/verify/${cert.verifyHash}`,
  })
}

// ─── External Certificate ─────────────────────────────────────────────────────

type ExternalCertRecord = {
  id: string
  title: string
  issuer: string
  issuedAt: Date
  expiresAt: Date | null
  fileKey: string | null
  createdAt: Date
}

function toExternalCertResponse(
  c: ExternalCertRecord,
  storage: StorageProvider,
): ExternalCertResponse {
  return externalCertResponseSchema.parse({
    id: c.id,
    title: c.title,
    issuer: c.issuer,
    issuedAt: c.issuedAt.toISOString(),
    expiresAt: c.expiresAt?.toISOString() ?? null,
    fileKey: c.fileKey,
    signedUrl: c.fileKey != null ? storage.getSignedUrl(c.fileKey) : null,
    createdAt: c.createdAt.toISOString(),
  })
}

const EXT_CERT_SELECT = {
  id: true,
  title: true,
  issuer: true,
  issuedAt: true,
  expiresAt: true,
  fileKey: true,
  createdAt: true,
} as const

export async function createExternalCert(
  prisma: PrismaClient,
  userId: string,
  input: CreateExternalCertInput,
  fileKey: string | null,
  storage: StorageProvider,
  ip?: string,
): Promise<ExternalCertResponse> {
  const cert = await prisma.externalCertificate.create({
    data: {
      userId,
      title: input.title,
      issuer: input.issuer,
      issuedAt: new Date(input.issuedAt),
      expiresAt: input.expiresAt != null ? new Date(input.expiresAt) : null,
      fileKey,
    },
    select: EXT_CERT_SELECT,
  })

  await logAudit(prisma, {
    actorId: userId,
    action: 'EXT_CERT_CREATE',
    targetType: 'ExternalCertificate',
    targetId: cert.id,
    ...(ip != null && { ip }),
  })

  return toExternalCertResponse(cert, storage)
}

export async function listExternalCerts(
  prisma: PrismaClient,
  userId: string,
  storage: StorageProvider,
): Promise<ExternalCertResponse[]> {
  const certs = await prisma.externalCertificate.findMany({
    where: { userId, deletedAt: null },
    select: EXT_CERT_SELECT,
    orderBy: { issuedAt: 'desc' },
  })
  return certs.map((c) => toExternalCertResponse(c, storage))
}

export async function getExternalCert(
  prisma: PrismaClient,
  id: string,
  requesterId: string,
  storage: StorageProvider,
  locale: Locale = 'en',
): Promise<ExternalCertResponse> {
  const cert = await prisma.externalCertificate.findFirst({
    where: { id, deletedAt: null },
    select: { ...EXT_CERT_SELECT, userId: true },
  })
  // notFound ทั้ง "ไม่มี" และ "IDOR" — กัน enumeration
  if (!cert || cert.userId !== requesterId) {
    throw notFound(t('error.externalCert.notFound', undefined, locale))
  }
  return toExternalCertResponse(cert, storage)
}

export async function deleteExternalCert(
  prisma: PrismaClient,
  id: string,
  requesterId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<void> {
  const cert = await prisma.externalCertificate.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, userId: true },
  })
  if (!cert || cert.userId !== requesterId) {
    throw notFound(t('error.externalCert.notFound', undefined, locale))
  }

  await prisma.externalCertificate.update({
    where: { id },
    data: { deletedAt: new Date() },
  })

  await logAudit(prisma, {
    actorId: requesterId,
    action: 'EXT_CERT_DELETE',
    targetType: 'ExternalCertificate',
    targetId: id,
    ...(ip != null && { ip }),
  })
}
