import type { PrismaClient } from '@prisma/client'
import type { DashboardSummary, ComplianceList, ComplianceRow } from '@btec-lms/shared'
import { logAudit } from '../../lib/audit.js'
import { localizeField, type Locale } from '../../lib/i18n.js'
import type { ComplianceQuery, ComplianceExportQuery } from './reports.schema.js'

// ─── getDashboardSummary ──────────────────────────────────────────────────────

export async function getDashboardSummary(
  prisma: PrismaClient,
  _requesterId: string,
  _role: string,
  _locale: Locale,
): Promise<DashboardSummary> {
  const [totalUsers, totalCourses, totalEnrollments, completedEnrollments, pendingEnrollments] =
    await Promise.all([
      prisma.user.count({ where: { deletedAt: null, isActive: true } }),
      prisma.course.count({ where: { status: 'PUBLISHED', deletedAt: null } }),
      prisma.enrollment.count({ where: { deletedAt: null } }),
      prisma.enrollment.count({ where: { deletedAt: null, status: 'COMPLETED' } }),
      prisma.enrollment.count({
        where: { deletedAt: null, status: { in: ['ASSIGNED', 'IN_PROGRESS'] } },
      }),
    ])

  return {
    totalUsers,
    totalCourses,
    totalEnrollments,
    completedEnrollments,
    pendingEnrollments,
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
} as const

// ─── getComplianceList ────────────────────────────────────────────────────────

export async function getComplianceList(
  prisma: PrismaClient,
  requesterId: string,
  _role: string,
  query: ComplianceQuery,
  locale: Locale,
  ip?: string,
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

  // PDPA: ADMIN อ่าน PII ก้อนใหญ่ (row-level user name ทุกคน) ต้อง audit เหมือน export
  await logAudit(prisma, {
    actorId: requesterId,
    action: 'REPORT_COMPLIANCE_VIEW',
    metadata: {
      rows: rows.length,
      courseId: query.courseId ?? null,
    },
    ...(ip != null && { ip }),
  })

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
  ].join(',')

  const lines = rows.map((r) =>
    [
      escapeCsv(r.userName),
      escapeCsv(r.courseTitle),
      escapeCsv(r.enrollmentStatus),
      escapeCsv(String(r.progress)),
    ].join(','),
  )

  // BOM + header + rows
  return '﻿' + [header, ...lines].join('\r\n')
}
