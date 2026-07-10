import type { PrismaClient } from '@prisma/client'
import type {
  CoursePublicResponse,
  CourseAdminResponse,
  CreateCourseInput,
  UpdateCourseInput,
  UpdateCourseStatusInput,
} from '@btec-lms/shared'
import { coursePublicResponseSchema, courseAdminResponseSchema } from '@btec-lms/shared'
import { logAudit } from '../../lib/audit.js'
import { notFound, badRequest } from '../../lib/errors.js'
import { t, localizeField, type Locale } from '../../lib/i18n.js'
import { serializeByRole } from '../../lib/roleResponse.js'
import { getActiveQuiz } from '../quizzes/quizzes.service.js'
import type { CourseListQuery } from './courses.schema.js'

const COURSE_SELECT = {
  id: true,
  titleEn: true,
  titleTh: true,
  categoryEn: true,
  categoryTh: true,
  descriptionEn: true,
  descriptionTh: true,
  status: true,
  expiryMonths: true,
  enrollmentCloseAt: true,
  paperSavingSheets: true,
  allowSelfEnroll: true,
  createdById: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} as const

type CourseRecord = {
  id: string
  titleEn: string
  titleTh: string | null
  categoryEn: string
  categoryTh: string | null
  descriptionEn: string | null
  descriptionTh: string | null
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
  expiryMonths: number | null
  enrollmentCloseAt: Date | null
  paperSavingSheets: number | null
  allowSelfEnroll: boolean
  createdById: string | null
  version: number
  createdAt: Date
  updatedAt: Date
}

// สร้าง admin shape (superset) เสมอ — serializeByRole จะ strip ให้ถ้า caller เป็น USER
function toCourseAdminShape(course: CourseRecord, locale: Locale): CourseAdminResponse {
  return {
    id: course.id,
    title: localizeField(course.titleEn, course.titleTh, locale),
    titleEn: course.titleEn,
    titleTh: course.titleTh ?? null,
    category: localizeField(course.categoryEn, course.categoryTh, locale),
    categoryEn: course.categoryEn,
    categoryTh: course.categoryTh ?? null,
    description: localizeField(course.descriptionEn ?? '', course.descriptionTh, locale) || null,
    descriptionEn: course.descriptionEn ?? null,
    descriptionTh: course.descriptionTh ?? null,
    status: course.status,
    expiryMonths: course.expiryMonths,
    enrollmentCloseAt: course.enrollmentCloseAt?.toISOString() ?? null,
    paperSavingSheets: course.paperSavingSheets,
    allowSelfEnroll: course.allowSelfEnroll,
    createdById: course.createdById,
    version: course.version,
    createdAt: course.createdAt.toISOString(),
    updatedAt: course.updatedAt.toISOString(),
  }
}

function serializeCourse(
  course: CourseRecord,
  locale: Locale,
  role: string,
): CourseAdminResponse | CoursePublicResponse {
  return serializeByRole(
    role,
    toCourseAdminShape(course, locale),
    courseAdminResponseSchema,
    coursePublicResponseSchema,
  )
}

export async function listCourses(
  prisma: PrismaClient,
  query: CourseListQuery,
  requesterRole: string,
  locale: Locale = 'en',
  ip?: string,
  actorId?: string,
): Promise<{ data: (CourseAdminResponse | CoursePublicResponse)[]; total: number; page: number; limit: number }> {
  const { page, limit, search, status, category } = query

  const statusFilter =
    requesterRole === 'USER'
      ? { status: 'PUBLISHED' as const }
      : status != null
        ? { status }
        : {}

  const where = {
    deletedAt: null,
    ...statusFilter,
    ...(category != null && { categoryEn: { contains: category } }),
    ...(search != null && {
      OR: [
        { titleEn: { contains: search } },
        { titleTh: { contains: search } },
        { categoryEn: { contains: search } },
        { categoryTh: { contains: search } },
        { descriptionEn: { contains: search } },
        { descriptionTh: { contains: search } },
      ],
    }),
  }

  const [courses, total] = await prisma.$transaction([
    prisma.course.findMany({
      where,
      select: COURSE_SELECT,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.course.count({ where }),
  ])

  if (actorId != null) {
    await logAudit(prisma, {
      actorId,
      action: 'COURSE_LIST',
      metadata: { page, limit, ...(search != null && { search }), ...(status != null && { status }) },
      ...(ip != null && { ip }),
    })
  }

  return {
    data: courses.map((c) => serializeCourse(c, locale, requesterRole)),
    total,
    page,
    limit,
  }
}

export async function getCourse(
  prisma: PrismaClient,
  id: string,
  requesterRole: string,
  locale: Locale = 'en',
): Promise<CourseAdminResponse | CoursePublicResponse> {
  const statusFilter = requesterRole === 'USER' ? { status: 'PUBLISHED' as const } : {}

  const course = await prisma.course.findFirst({
    where: { id, deletedAt: null, ...statusFilter },
    select: COURSE_SELECT,
  })

  if (!course) throw notFound(t('error.course.notFound', undefined, locale))
  return serializeCourse(course, locale, requesterRole)
}

export async function createCourse(
  prisma: PrismaClient,
  input: CreateCourseInput,
  actorId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<CourseAdminResponse> {
  const course = await prisma.course.create({
    data: {
      titleEn: input.titleEn,
      titleTh: input.titleTh ?? null,
      categoryEn: input.categoryEn,
      categoryTh: input.categoryTh ?? null,
      descriptionEn: input.descriptionEn ?? null,
      descriptionTh: input.descriptionTh ?? null,
      ...(input.expiryMonths != null && { expiryMonths: input.expiryMonths }),
      ...(input.enrollmentCloseAt != null && { enrollmentCloseAt: new Date(input.enrollmentCloseAt) }),
      ...(input.paperSavingSheets != null && { paperSavingSheets: input.paperSavingSheets }),
      allowSelfEnroll: input.allowSelfEnroll,
      createdById: actorId,
    },
    select: COURSE_SELECT,
  })

  await logAudit(prisma, {
    actorId,
    action: 'COURSE_CREATE',
    targetType: 'Course',
    targetId: course.id,
    metadata: { titleEn: input.titleEn, categoryEn: input.categoryEn },
    ...(ip != null && { ip }),
  })

  // createCourse เรียกได้จาก ADMIN route เท่านั้น → คืน admin shape เสมอ
  return courseAdminResponseSchema.parse(toCourseAdminShape(course, locale))
}

export async function updateCourse(
  prisma: PrismaClient,
  id: string,
  input: UpdateCourseInput,
  actorId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<CourseAdminResponse> {
  const existing = await prisma.course.findFirst({ where: { id, deletedAt: null } })
  if (!existing) throw notFound(t('error.course.notFound', undefined, locale))

  const course = await prisma.course.update({
    where: { id },
    data: {
      ...(input.titleEn != null && { titleEn: input.titleEn }),
      ...('titleTh' in input && { titleTh: input.titleTh ?? null }),
      ...(input.categoryEn != null && { categoryEn: input.categoryEn }),
      ...('categoryTh' in input && { categoryTh: input.categoryTh ?? null }),
      ...('descriptionEn' in input && { descriptionEn: input.descriptionEn ?? null }),
      ...('descriptionTh' in input && { descriptionTh: input.descriptionTh ?? null }),
      ...('expiryMonths' in input && { expiryMonths: input.expiryMonths ?? null }),
      ...('enrollmentCloseAt' in input && {
        enrollmentCloseAt: input.enrollmentCloseAt != null ? new Date(input.enrollmentCloseAt) : null,
      }),
      ...('paperSavingSheets' in input && { paperSavingSheets: input.paperSavingSheets ?? null }),
      ...(input.allowSelfEnroll != null && { allowSelfEnroll: input.allowSelfEnroll }),
      version: { increment: 1 },
    },
    select: COURSE_SELECT,
  })

  await logAudit(prisma, {
    actorId,
    action: 'COURSE_UPDATE',
    targetType: 'Course',
    targetId: id,
    metadata: input as Record<string, unknown>,
    ...(ip != null && { ip }),
  })

  return courseAdminResponseSchema.parse(toCourseAdminShape(course, locale))
}

export async function updateCourseStatus(
  prisma: PrismaClient,
  id: string,
  input: UpdateCourseStatusInput,
  actorId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<CourseAdminResponse> {
  const existing = await prisma.course.findFirst({ where: { id, deletedAt: null } })
  if (!existing) throw notFound(t('error.course.notFound', undefined, locale))

  if (existing.status === 'ARCHIVED') {
    throw badRequest(t('error.course.archivedCannotChange', undefined, locale))
  }

  // ทุกหลักสูตรที่ publish ต้องมี quiz อย่างน้อย 1 ข้อ — กัน dead-end course ที่จบไม่ได้ (2A)
  if (input.status === 'PUBLISHED') {
    const quiz = await getActiveQuiz(prisma, id)
    const questionCount = quiz
      ? await prisma.question.count({ where: { quizId: quiz.id, deletedAt: null } })
      : 0
    if (!quiz || questionCount === 0) {
      throw badRequest(t('error.course.quizRequiredToPublish', undefined, locale))
    }
  }

  const course = await prisma.course.update({
    where: { id },
    data: { status: input.status },
    select: COURSE_SELECT,
  })

  const action = input.status === 'PUBLISHED' ? 'COURSE_PUBLISH' : 'COURSE_ARCHIVE'
  await logAudit(prisma, {
    actorId,
    action,
    targetType: 'Course',
    targetId: id,
    metadata: { previousStatus: existing.status, newStatus: input.status },
    ...(ip != null && { ip }),
  })

  return courseAdminResponseSchema.parse(toCourseAdminShape(course, locale))
}

export async function softDeleteCourse(
  prisma: PrismaClient,
  id: string,
  actorId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<void> {
  const existing = await prisma.course.findFirst({ where: { id, deletedAt: null } })
  if (!existing) throw notFound(t('error.course.notFound', undefined, locale))

  const now = new Date()

  await prisma.$transaction([
    prisma.material.updateMany({
      where: { courseId: id, deletedAt: null },
      data: { deletedAt: now },
    }),
    prisma.course.update({
      where: { id },
      data: { deletedAt: now },
    }),
  ])

  await logAudit(prisma, {
    actorId,
    action: 'COURSE_DELETE',
    targetType: 'Course',
    targetId: id,
    metadata: { titleEn: existing.titleEn },
    ...(ip != null && { ip }),
  })
}
