import type { PrismaClient } from '@prisma/client'
import type { ExternalCertResponse, CreateExternalCertInput } from '@btec-lms/shared'
import { externalCertResponseSchema } from '@btec-lms/shared'
import { logAudit } from '../../lib/audit.js'
import { notFound } from '../../lib/errors.js'
import { t, type Locale } from '../../lib/i18n.js'
import type { StorageProvider } from '../../lib/storage.js'

// ─── External Certificate ─────────────────────────────────────────────────────

type ExternalCertRecord = {
  id: string
  title: string
  issuer: string
  issuedAt: Date
  expiresAt: Date | null
  fileKey: string | null
  mimeType: string | null
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
    signedUrl: c.fileKey != null ? storage.getSignedUrl(c.fileKey, undefined, c.mimeType) : null,
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
  mimeType: true,
  createdAt: true,
} as const

export async function createExternalCert(
  prisma: PrismaClient,
  userId: string,
  input: CreateExternalCertInput,
  fileKey: string | null,
  mimeType: string | null,
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
      mimeType,
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

// ─── Scoped list for ADMIN viewing another user's external certs ────────────
// ADMIN: userId ใดก็ได้
// USER: เห็นเฉพาะของตัวเอง — query.userId ถูก ignore
export async function listExternalCertsScoped(
  prisma: PrismaClient,
  requesterId: string,
  role: string,
  queryUserId: string | undefined,
  storage: StorageProvider,
  locale: Locale = 'en',
  ip?: string,
): Promise<ExternalCertResponse[]> {
  if (queryUserId == null || queryUserId === requesterId || role === 'USER') {
    return listExternalCerts(prisma, requesterId, storage)
  }

  if (role !== 'ADMIN') {
    throw notFound(t('error.user.notFound', undefined, locale))
  }

  // PDPA: audit เมื่อ ADMIN ดู external cert ของ user อื่น
  await logAudit(prisma, {
    actorId: requesterId,
    action: 'EXT_CERT_VIEW',
    targetType: 'ExternalCertificate',
    targetId: queryUserId,
    metadata: { targetUserId: queryUserId },
    ...(ip != null && { ip }),
  })

  return listExternalCerts(prisma, queryUserId, storage)
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
