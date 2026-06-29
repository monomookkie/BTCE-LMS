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
  requesterId: string,
  role: string,
  locale: Locale,
): Promise<DashboardSummary> {
  // MANAGER scope: กรองตาม departmentId ของตัวเอง
  let managerDeptId: string | null | undefined = undefined // undefined = ADMIN (ไม่จำกัด)

  if (role === 'MANAGER') {
    const self = await prisma.user.findUnique({
      where: { id: requesterId },
      select: { departmentId: true },
    })
    managerDeptId = self?.departmentId ?? null // null = MANAGER ไม่มี dept

    if (managerDeptId === null) {
      await logAudit(prisma, {
        actorId: requesterId,
        action: 'REPORT_DASHBOARD',
        metadata: { warning: 'manager_no_department', locale },
      })
      return {
        totalUsers: 0,
        totalCourses: 0,
        totalEnrollments: 0,
        completedEnrollments: 0,
        pendingEnrollments: 0,
        certsIssued: 0,
        certsExpiringSoon: 0,
        certsExpired: 0,
      }
    }
  }

  const now = new Date()
  const expirySoon = new Date(now.getTime() + EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000)

  // Dept scoping: ADMIN → undefined (ไม่ filter), MANAGER → departmentId ของตัวเอง
  const deptId = managerDeptId // undefined | string

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
    prisma.user.count({
      where: {
        deletedAt: null,
        isActive: true,
        ...(deptId !== undefined && { departmentId: deptId }),
      },
    }),
    // หลักสูตรไม่ผูก dept — คืน global PUBLISHED count เสมอ
    prisma.course.count({ where: { status: 'PUBLISHED', deletedAt: null } }),
    prisma.enrollment.count({
      where: {
        deletedAt: null,
        ...(deptId !== undefined && { user: { departmentId: deptId } }),
      },
    }),
    prisma.enrollment.count({
      where: {
        deletedAt: null,
        status: 'COMPLETED',
        ...(deptId !== undefined && { user: { departmentId: deptId } }),
      },
    }),
    prisma.enrollment.count({
      where: {
        deletedAt: null,
        status: { in: ['ASSIGNED', 'IN_PROGRESS'] },
        ...(deptId !== undefined && { user: { departmentId: deptId } }),
      },
    }),
    prisma.certificate.count({
      where: {
        ...(deptId !== undefined && { user: { departmentId: deptId } }),
      },
    }),
    prisma.certificate.count({
      where: {
        expiresAt: { gte: now, lte: expirySoon },
        revokedAt: null,
        ...(deptId !== undefined && { user: { departmentId: deptId } }),
      },
    }),
    prisma.certificate.count({
      where: {
        expiresAt: { lt: now },
        revokedAt: null,
        ...(deptId !== undefined && { user: { departmentId: deptId } }),
      },
    }),
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
  deptId: string | undefined,  // undefined = ADMIN (all), string = scoped
  courseId: string | undefined,
  additionalDeptFilter?: string, // query-level departmentId filter
) {
  // กรอง dept ตาม role scope ก่อน แล้วค่อย intersect กับ query filter
  // ใช้ dept ที่แคบกว่าเสมอ
  const effectiveDeptId = deptId ?? additionalDeptFilter

  return {
    deletedAt: null,
    ...(effectiveDeptId !== undefined && { user: { departmentId: effectiveDeptId } }),
    ...(courseId !== undefined && { courseId }),
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
    department: { nameEn: string; nameTh: string | null } | null
  }
  course: { id: string; titleEn: string; titleTh: string | null }
  certificate: { certNumber: string; expiresAt: Date | null; revokedAt: Date | null } | null
}

function toRow(e: EnrollmentRaw, locale: Locale): ComplianceRow {
  return {
    enrollmentId: e.id,
    userId: e.user.id,
    userName: e.user.name,
    department: e.user.department
      ? localizeField(e.user.department.nameEn, e.user.department.nameTh, locale)
      : null,
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
      department: { select: { nameEn: true, nameTh: true } },
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
  requesterId: string,
  role: string,
  query: ComplianceQuery,
  locale: Locale,
): Promise<ComplianceList> {
  const { page, limit, courseId } = query

  // Resolve dept scope
  let scopeDeptId: string | undefined = undefined // ADMIN: undefined

  if (role === 'MANAGER') {
    const self = await prisma.user.findUnique({
      where: { id: requesterId },
      select: { departmentId: true },
    })
    if (!self?.departmentId) {
      await logAudit(prisma, {
        actorId: requesterId,
        action: 'REPORT_COMPLIANCE',
        metadata: { warning: 'manager_no_department', locale },
      })
      return { data: [], total: 0, page, limit }
    }
    scopeDeptId = self.departmentId
  }

  // ADMIN ใช้ query.departmentId filter ได้โดยตรง, MANAGER ถูก override ด้วย scope ตัวเอง
  const effectiveDeptId = role === 'MANAGER' ? scopeDeptId : query.departmentId

  const where = buildComplianceWhere(effectiveDeptId, courseId)

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
  role: string,
  query: ComplianceExportQuery,
  locale: Locale,
  ip: string | undefined,
): Promise<string> {
  let scopeDeptId: string | undefined = undefined

  if (role === 'MANAGER') {
    const self = await prisma.user.findUnique({
      where: { id: requesterId },
      select: { departmentId: true },
    })
    if (!self?.departmentId) {
      await logAudit(prisma, {
        actorId: requesterId,
        action: 'REPORT_EXPORT',
        metadata: { warning: 'manager_no_department', rows: 0 },
        ...(ip != null && { ip }),
      })
      return buildCsv([])
    }
    scopeDeptId = self.departmentId
  }

  const effectiveDeptId = role === 'MANAGER' ? scopeDeptId : query.departmentId
  const where = buildComplianceWhere(effectiveDeptId, query.courseId)

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
      scope: role === 'MANAGER' ? 'department' : 'all',
      rows: rows.length,
      departmentId: effectiveDeptId ?? null,
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
    'Department',
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
      escapeCsv(r.department),
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
