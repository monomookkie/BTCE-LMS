import type { PrismaClient } from '@prisma/client'
import type {
  DashboardSummary,
  ComplianceList,
  ComplianceRow,
  CourseReport,
  RatingStat,
  CourseCommentsList,
  CourseCommentRow,
  UserReport,
  UserReportRow,
} from '@btec-lms/shared'
import { logAudit } from '../../lib/audit.js'
import { notFound } from '../../lib/errors.js'
import { t, localizeField, type Locale } from '../../lib/i18n.js'
import type {
  ComplianceQuery,
  ComplianceExportQuery,
  CourseCommentsQuery,
} from './reports.schema.js'

// ─── getDashboardSummary ──────────────────────────────────────────────────────

export async function getDashboardSummary(
  prisma: PrismaClient,
  _requesterId: string,
  _role: string,
  _locale: Locale,
): Promise<DashboardSummary> {
  const [
    totalUsers,
    totalCourses,
    totalEnrollments,
    completedEnrollments,
    pendingEnrollments,
    mandatoryEnrollments,
    mandatoryCompleted,
    optionalEnrollments,
    optionalCompleted,
  ] = await Promise.all([
    prisma.user.count({ where: { deletedAt: null, isActive: true } }),
    prisma.course.count({ where: { status: 'PUBLISHED', deletedAt: null } }),
    prisma.enrollment.count({ where: { deletedAt: null } }),
    prisma.enrollment.count({ where: { deletedAt: null, status: 'COMPLETED' } }),
    prisma.enrollment.count({
      where: { deletedAt: null, status: { in: ['ASSIGNED', 'IN_PROGRESS'] } },
    }),
    // 2C-4: mandatory (POSITION_BASED) vs optional (PUBLIC) — snapshot จาก Enrollment.isMandatory
    prisma.enrollment.count({ where: { deletedAt: null, isMandatory: true } }),
    prisma.enrollment.count({ where: { deletedAt: null, isMandatory: true, status: 'COMPLETED' } }),
    prisma.enrollment.count({ where: { deletedAt: null, isMandatory: false } }),
    prisma.enrollment.count({ where: { deletedAt: null, isMandatory: false, status: 'COMPLETED' } }),
  ])

  return {
    totalUsers,
    totalCourses,
    totalEnrollments,
    completedEnrollments,
    pendingEnrollments,
    overallCompletionRate: totalEnrollments > 0 ? Math.round((completedEnrollments / totalEnrollments) * 100) : null,
    mandatoryEnrollments,
    mandatoryCompleted,
    mandatoryComplianceRate:
      mandatoryEnrollments > 0 ? Math.round((mandatoryCompleted / mandatoryEnrollments) * 100) : null,
    optionalEnrollments,
    optionalCompleted,
  }
}

// ─── buildComplianceWhere ─────────────────────────────────────────────────────
// สร้าง where clause ร่วมกันระหว่าง list + export

function buildComplianceWhere(
  courseId: string | undefined,
  status: 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'EXPIRED' | undefined,
  isMandatory: boolean | undefined,
) {
  return {
    deletedAt: null,
    ...(courseId !== undefined && { courseId }),
    ...(status !== undefined && { status }),
    ...(isMandatory !== undefined && { isMandatory }),
  }
}

// ─── toComplianceRow ──────────────────────────────────────────────────────────

type EnrollmentRaw = {
  id: string
  status: string
  progress: number
  isMandatory: boolean
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
    isMandatory: e.isMandatory,
    completedAt: e.completedAt?.toISOString() ?? null,
  }
}

const ENROLLMENT_SELECT = {
  id: true,
  status: true,
  progress: true,
  isMandatory: true,
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
  const { page, limit, courseId, status, isMandatory } = query

  const where = buildComplianceWhere(courseId, status, isMandatory)

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
  const where = buildComplianceWhere(query.courseId, query.status, query.isMandatory)

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
    'Mandatory',
  ].join(',')

  const lines = rows.map((r) =>
    [
      escapeCsv(r.userName),
      escapeCsv(r.courseTitle),
      escapeCsv(r.enrollmentStatus),
      escapeCsv(String(r.progress)),
      escapeCsv(r.isMandatory ? 'Yes' : 'No'),
    ].join(','),
  )

  // BOM + header + rows
  return '﻿' + [header, ...lines].join('\r\n')
}

// ─── getCourseReport (item 4) ──────────────────────────────────────────────
// enrollment/pass count + survey rating aggregation (avg + distribution ต่อ RATING question)
// ratingStats เป็น aggregate ล้วน — ไม่มีปัญหา PDPA (ต่างจาก comments ซึ่งเป็น free-text ผูกกับคน)

export async function getCourseReport(
  prisma: PrismaClient,
  courseId: string,
  requesterId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<CourseReport> {
  const course = await prisma.course.findFirst({
    where: { id: courseId, deletedAt: null },
    select: { id: true, titleEn: true, titleTh: true },
  })
  if (!course) throw notFound(t('error.course.notFound', undefined, locale))

  const [enrollmentCount, passUsers, survey] = await Promise.all([
    prisma.enrollment.count({ where: { courseId, deletedAt: null } }),
    // "ผ่าน" = มี QuizAttempt.passed=true อย่างน้อย 1 ครั้ง (ตาม semantics เดิมจาก checkCanComplete
    // ใน enrollments.service.ts — ไม่ใช่ latest/best attempt)
    prisma.quizAttempt.findMany({
      where: { passed: true, quiz: { courseId } },
      distinct: ['userId'],
      select: { userId: true },
    }),
    prisma.survey.findFirst({
      where: { courseId, deletedAt: null },
      include: { questions: { where: { deletedAt: null }, orderBy: { order: 'asc' } } },
    }),
  ])

  let ratingStats: RatingStat[] = []
  if (survey) {
    const ratingQuestions = survey.questions.filter((q) => q.type === 'RATING')
    if (ratingQuestions.length > 0) {
      // ไม่ select userId เลย — ratingStats เป็น aggregate เท่านั้น ไม่ต้องใช้ตัวตนผู้ตอบ
      const responses = await prisma.surveyResponse.findMany({
        where: { surveyId: survey.id },
        select: { answers: true },
      })
      ratingStats = ratingQuestions.map((q) => {
        const values = responses
          .map((r) => (r.answers as Record<string, unknown>)[q.id])
          .filter((v): v is number => typeof v === 'number')
        const distribution = [1, 2, 3, 4, 5].map((rating) => ({
          rating,
          count: values.filter((v) => v === rating).length,
        }))
        const responseCount = values.length
        const average = responseCount > 0
          ? Math.round((values.reduce((a, b) => a + b, 0) / responseCount) * 10) / 10
          : 0
        return {
          questionId: q.id,
          text: localizeField(q.textEn, q.textTh, locale),
          average,
          responseCount,
          distribution,
        }
      })
    }
  }

  await logAudit(prisma, {
    actorId: requesterId,
    action: 'REPORT_BY_COURSE_VIEW',
    targetType: 'Course',
    targetId: courseId,
    metadata: { enrollmentCount },
    ...(ip != null && { ip }),
  })

  return {
    courseId: course.id,
    courseTitle: localizeField(course.titleEn, course.titleTh, locale),
    enrollmentCount,
    passCount: passUsers.length,
    passRate: enrollmentCount > 0 ? Math.round((passUsers.length / enrollmentCount) * 100) : null,
    hasSurvey: survey != null,
    ratingStats,
  }
}

// ─── getCourseComments (item 4) ─────────────────────────────────────────────
// PDPA: anonymous by design — ไม่ query userId เลย (defense-in-depth ตั้งแต่ระดับ Prisma select
// ไม่ใช่แค่ strip ที่ response) และไม่คืน createdAt (timestamp ละเอียด + คอมเมนต์น้อย = เดาตัวตนได้
// จาก cross-reference กับ enrollment/audit log อื่น) เรียงตาม questionId แล้ว alphabetical ตาม
// เนื้อหาคอมเมนต์ — ไม่ใช้ id/createdAt เพราะ cuid ฝัง timestamp อยู่ในตัว จะกลายเป็นเรียงตามเวลาซ่อนๆ

export async function getCourseComments(
  prisma: PrismaClient,
  query: CourseCommentsQuery,
  requesterId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<CourseCommentsList> {
  const { courseId, page, limit } = query

  const course = await prisma.course.findFirst({ where: { id: courseId, deletedAt: null }, select: { id: true } })
  if (!course) throw notFound(t('error.course.notFound', undefined, locale))

  const survey = await prisma.survey.findFirst({
    where: { courseId, deletedAt: null },
    include: {
      questions: { where: { deletedAt: null, type: 'TEXT' }, orderBy: { order: 'asc' } },
    },
  })

  let allComments: CourseCommentRow[] = []
  if (survey && survey.questions.length > 0) {
    const responses = await prisma.surveyResponse.findMany({
      where: { surveyId: survey.id },
      select: { answers: true }, // ไม่ select userId
    })

    for (const q of survey.questions) {
      const questionText = localizeField(q.textEn, q.textTh, locale)
      for (const r of responses) {
        const value = (r.answers as Record<string, unknown>)[q.id]
        if (typeof value === 'string' && value.trim().length > 0) {
          allComments.push({ questionId: q.id, questionText, comment: value.trim() })
        }
      }
    }
    allComments = allComments.sort((a, b) => a.comment.localeCompare(b.comment))
  }

  const total = allComments.length
  const start = (page - 1) * limit
  const data = allComments.slice(start, start + limit)

  await logAudit(prisma, {
    actorId: requesterId,
    action: 'REPORT_BY_COURSE_VIEW',
    targetType: 'Course',
    targetId: courseId,
    metadata: { section: 'comments', total },
    ...(ip != null && { ip }),
  })

  return { data, total, page, limit }
}

// ─── getUserReport (item 4) ──────────────────────────────────────────────────
// ไม่ anonymous (admin เลือก user ตรงๆ อยู่แล้ว) — ไม่รวม soft-deleted enrollment

export async function getUserReport(
  prisma: PrismaClient,
  userId: string,
  requesterId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<UserReport> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, name: true },
  })
  if (!user) throw notFound(t('error.user.notFound', undefined, locale))

  const enrollments = await prisma.enrollment.findMany({
    where: { userId, deletedAt: null },
    select: {
      id: true,
      courseId: true,
      status: true,
      progress: true,
      isMandatory: true,
      completedAt: true,
      dueAt: true,
      course: { select: { titleEn: true, titleTh: true } },
    },
    orderBy: { assignedAt: 'desc' },
  })

  const courseIds = enrollments.map((e) => e.courseId)
  const quizzes = courseIds.length > 0
    ? await prisma.quiz.findMany({
        where: { courseId: { in: courseIds }, deletedAt: null },
        select: { id: true, courseId: true },
      })
    : []
  const quizIdByCourseId = new Map(quizzes.map((q) => [q.courseId, q.id]))
  const quizIds = quizzes.map((q) => q.id)

  // "ผ่าน" = มี attempt ไหนก็ได้ที่ passed=true (ตาม checkCanComplete semantics เดิม) —
  // ไม่ใช่ latest attempt เพราะระบบไม่มี concept "attempt ล่าสุด" ที่ authoritative
  const attempts = quizIds.length > 0
    ? await prisma.quizAttempt.findMany({
        where: { quizId: { in: quizIds }, userId },
        select: { quizId: true, score: true, passed: true },
      })
    : []
  const attemptStatByQuizId = new Map<string, { passed: boolean; bestScore: number }>()
  for (const a of attempts) {
    const cur = attemptStatByQuizId.get(a.quizId)
    attemptStatByQuizId.set(a.quizId, {
      passed: (cur?.passed ?? false) || a.passed,
      bestScore: Math.max(cur?.bestScore ?? 0, a.score),
    })
  }

  const mandatory: UserReportRow[] = []
  const optional: UserReportRow[] = []
  for (const e of enrollments) {
    const quizId = quizIdByCourseId.get(e.courseId)
    const attemptStat = quizId ? attemptStatByQuizId.get(quizId) : undefined
    const row: UserReportRow = {
      enrollmentId: e.id,
      courseId: e.courseId,
      courseTitle: localizeField(e.course.titleEn, e.course.titleTh, locale),
      status: e.status,
      progress: e.progress,
      quizPassed: quizId != null ? (attemptStat?.passed ?? false) : null,
      quizBestScore: quizId != null ? (attemptStat?.bestScore ?? null) : null,
      completedAt: e.completedAt?.toISOString() ?? null,
      dueAt: e.dueAt?.toISOString() ?? null,
    }
    ;(e.isMandatory ? mandatory : optional).push(row)
  }

  await logAudit(prisma, {
    actorId: requesterId,
    action: 'REPORT_BY_USER_VIEW',
    targetType: 'User',
    targetId: userId,
    metadata: { enrollmentCount: enrollments.length },
    ...(ip != null && { ip }),
  })

  return { userId: user.id, userName: user.name, mandatory, optional }
}
