import type { PrismaClient } from '@prisma/client'
import type { DashboardSummary, ComplianceList, ComplianceRow } from '@btec-lms/shared'
import { logAudit } from '../../lib/audit.js'
import { localizeField, type Locale } from '../../lib/i18n.js'
import type { ComplianceQuery, ComplianceExportQuery } from './reports.schema.js'

// ─── Helper: cert status ──────────────────────────────────────────────────────

const EXPIRING_SOON_DAYS = 30

function certStatus(
  cert: { expiresAt: Date | null; revokedAt: Date | null } | null,
): ComplianceRow['certStatus'] {
  if (!cert) return null
  if (cert.revokedAt) return 'revoked'
  if (!cert.expiresAt) return 'valid'
  const now = new Date()
  if (cert.expiresAt < now) return 'expired'
  if (cert.expiresAt.getTime() - now.getTime() <= EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000) {
    return 'expiring-soon'
  }
  return 'valid'
}

// ─── getDashboardSummary ──────────────────────────────────────────────────────

export async function getDashboardSummary(
  prisma: PrismaClient,
  _requesterId: string,
  _role: string,
  _locale: Locale,
): Promise<DashboardSummary> {
  const now = new Date()
  const expirySoon = new Date(now.getTime() + EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000)

  const [
    totalUsers,
    totalCourses,
    totalEnrollments,
    completedEnrollments,
    pendingEnrollments,
    certsIssued,
    certsExpiringSoon,
    certsExpired,
  ] = await Promise.all([
    prisma.user.count({ where: { deletedAt: null, isActive: true } }),
    prisma.course.count({ where: { status: 'PUBLISHED', deletedAt: null } }),
    prisma.enrollment.count({ where: { deletedAt: null } }),
    prisma.enrollment.count({ where: { deletedAt: null, status: 'COMPLETED' } }),
    prisma.enrollment.count({
      where: { deletedAt: null, status: { in: ['ASSIGNED', 'IN_PROGRESS'] } },
    }),
    prisma.certificate.count(),
    prisma.certificate.count({
      where: { expiresAt: { gte: now, lte: expirySoon }, revokedAt: null },
    }),
    prisma.certificate.count({ where: { expiresAt: { lt: now }, revokedAt: null } }),
  ])

  return {
    totalUsers,
    totalCourses,
    totalEnrollments,
    completedEnrollments,
    pendingEnrollments,
    certsIssued,
    certsExpiringSoon,
    certsExpired,
  }
}

// ─── buildComplianceWhere ─────────────────────────────────────────────────────
// สร้าง where clause ร่วมกันระหว่าง list + export

function buildComplianceWhere(
  courseId: string | undefined,
  status: 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'EXPIRED' | undefined,
) {
  return {
    deletedAt: null,
    ...(courseId !== undefined && { courseId }),
    ...(status !== undefined && { status }),
  }
}

// ─── toComplianceRow ──────────────────────────────────────────────────────────

type EnrollmentRaw = {
  id: string
  status: string
  progress: number
  completedAt: Date | null
  user: {
    id: string
    name: string
  }
  course: { id: string; titleEn: string; titleTh: string | null }
  certificate: { certNumber: string; expiresAt: Date | null; revokedAt: Date | null } | null
}

function toRow(e: EnrollmentRaw, locale: Locale): ComplianceRow {
  return {
    enrollmentId: e.id,
    userId: e.user.id,
    userName: e.user.name,
    courseId: e.course.id,
    courseTitle: localizeField(e.course.titleEn, e.course.titleTh, locale),
    enrollmentStatus: e.status as ComplianceRow['enrollmentStatus'],
    progress: e.progress,
    completedAt: e.completedAt?.toISOString() ?? null,
    certNumber: e.certificate?.certNumber ?? null,
    certStatus: certStatus(e.certificate ?? null),
    certExpiresAt: e.certificate?.expiresAt?.toISOString() ?? null,
  }
}

const ENROLLMENT_SELECT = {
  id: true,
  status: true,
  progress: true,
  completedAt: true,
  user: {
    select: {
      id: true,
      name: true,
    },
  },
  course: { select: { id: true, titleEn: true, titleTh: true } },
  certificate: {
    select: { certNumber: true, expiresAt: true, revokedAt: true },
  },
} as const

// ─── getComplianceList ────────────────────────────────────────────────────────

export async function getComplianceList(
  prisma: PrismaClient,
  _requesterId: string,
  _role: string,
  query: ComplianceQuery,
  locale: Locale,
): Promise<ComplianceList> {
  const { page, limit, courseId, status } = query

  const where = buildComplianceWhere(courseId, status)

  const [total, rows] = await Promise.all([
    prisma.enrollment.count({ where }),
    prisma.enrollment.findMany({
      where,
      select: ENROLLMENT_SELECT,
      orderBy: [{ user: { name: 'asc' } }, { course: { titleEn: 'asc' } }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ])

  return {
    data: rows.map((r) => toRow(r as EnrollmentRaw, locale)),
    total,
    page,
    limit,
  }
}

// ─── getComplianceCsv ─────────────────────────────────────────────────────────

const CSV_MAX_ROWS = 10_000

export async function getComplianceCsv(
  prisma: PrismaClient,
  requesterId: string,
  _role: string,
  query: ComplianceExportQuery,
  locale: Locale,
  ip: string | undefined,
): Promise<string> {
  const where = buildComplianceWhere(query.courseId, query.status)

  const rows = await prisma.enrollment.findMany({
    where,
    select: ENROLLMENT_SELECT,
    orderBy: [{ user: { name: 'asc' } }, { course: { titleEn: 'asc' } }],
    take: CSV_MAX_ROWS,
  })

  await logAudit(prisma, {
    actorId: requesterId,
    action: 'REPORT_EXPORT',
    metadata: {
      rows: rows.length,
      courseId: query.courseId ?? null,
    },
    ...(ip != null && { ip }),
  })

  return buildCsv(rows.map((r) => toRow(r as EnrollmentRaw, locale)))
}

// ─── CSV builder ──────────────────────────────────────────────────────────────
// UTF-8 with BOM (﻿) — Excel ไทยต้องการ BOM เพื่อรู้ว่าเป็น UTF-8

function escapeCsv(value: string | null | undefined): string {
  if (value == null) return ''
  const str = String(value)
  // ถ้ามี comma, double-quote หรือ newline → wrap ด้วย double-quote + escape internal quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function buildCsv(rows: ComplianceRow[]): string {
  const header = [
    'Name',
    'Course',
    'Enrollment Status',
    'Progress (%)',
    'Cert Number',
    'Cert Status',
    'Cert Expires At',
  ].join(',')

  const lines = rows.map((r) =>
    [
      escapeCsv(r.userName),
      escapeCsv(r.courseTitle),
      escapeCsv(r.enrollmentStatus),
      escapeCsv(String(r.progress)),
      escapeCsv(r.certNumber),
      escapeCsv(r.certStatus),
      escapeCsv(r.certExpiresAt ? new Date(r.certExpiresAt).toLocaleDateString('en-GB') : null),
    ].join(','),
  )

  // BOM + header + rows
  return '﻿' + [header, ...lines].join('\r\n')
}
