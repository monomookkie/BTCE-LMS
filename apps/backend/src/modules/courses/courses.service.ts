import type { PrismaClient, Prisma } from '@prisma/client'
import type {
  CoursePublicResponse,
  CourseAdminResponse,
  CreateCourseInput,
  UpdateCourseInput,
  UpdateCourseStatusInput,
  SetCoursePositionsInput,
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
  accessType: true,
  createdById: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  positions: {
    select: { position: { select: { id: true, nameEn: true, nameTh: true } } },
  },
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
  accessType: 'POSITION_BASED' | 'PUBLIC'
  createdById: string | null
  version: number
  createdAt: Date
  updatedAt: Date
  positions: Array<{ position: { id: string; nameEn: string; nameTh: string | null } }>
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
    accessType: course.accessType,
    positions: course.positions.map((cp) => ({
      id: cp.position.id,
      name: localizeField(cp.position.nameEn, cp.position.nameTh, locale),
    })),
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

  // 2C-5: USER เห็นเฉพาะ PUBLIC หรือ POSITION_BASED ที่ user.positionId ตรงกับ course.positions —
  // enforce ที่ server (ไม่ใช่แค่ client filter) กันข้อมูล/ชื่อ course ที่ไม่เกี่ยวกับตำแหน่งตัวเองรั่วออกไป
  // ADMIN เห็นทุก course เหมือนเดิม ไม่ถูก filter นี้
  //
  // ใช้ AND แยกจาก search's OR — ถ้าใส่ OR ปนกันในระดับเดียวกันของ where object เดียว key OR
  // จะถูก spread ทับกันเงียบๆ (object literal, key ซ้ำ = ตัวหลังชนะ) ทำให้ access filter หายไปจริง
  const andClauses: Prisma.CourseWhereInput[] = []

  if (requesterRole === 'USER') {
    const requester = actorId != null
      ? await prisma.user.findFirst({ where: { id: actorId, deletedAt: null }, select: { positionId: true } })
      : null
    const positionId = requester?.positionId ?? null
    andClauses.push({
      OR: [
        { accessType: 'PUBLIC' },
        ...(positionId != null
          ? [{ accessType: 'POSITION_BASED' as const, positions: { some: { positionId } } }]
          : []),
      ],
    })
  }

  if (search != null) {
    andClauses.push({
      OR: [
        { titleEn: { contains: search } },
        { titleTh: { contains: search } },
        { categoryEn: { contains: search } },
        { categoryTh: { contains: search } },
        { descriptionEn: { contains: search } },
        { descriptionTh: { contains: search } },
      ],
    })
  }

  const where = {
    deletedAt: null,
    ...statusFilter,
    ...(category != null && { categoryEn: { contains: category } }),
    ...(andClauses.length > 0 && { AND: andClauses }),
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
  actorId?: string,
): Promise<CourseAdminResponse | CoursePublicResponse> {
  const statusFilter = requesterRole === 'USER' ? { status: 'PUBLISHED' as const } : {}

  const course = await prisma.course.findFirst({
    where: { id, deletedAt: null, ...statusFilter },
    select: COURSE_SELECT,
  })

  if (!course) throw notFound(t('error.course.notFound', undefined, locale))

  // 2C-5: consistency กับ listCourses — USER เข้าลิงก์ตรงของ course POSITION_BASED ที่ตัวเอง
  // ไม่มีสิทธิ์ไม่ได้ (ไม่งั้น list ซ่อนไว้แต่ direct link ยังดูได้ ขัดกับเหตุผลที่เลือก enforce server-side)
  // notFound เหมือน IDOR pattern อื่นในระบบ — ไม่บอกว่า "มีอยู่แต่ไม่มีสิทธิ์" กัน enumeration
  if (requesterRole === 'USER' && course.accessType === 'POSITION_BASED') {
    const requester = actorId != null
      ? await prisma.user.findFirst({ where: { id: actorId, deletedAt: null }, select: { positionId: true } })
      : null
    const eligible =
      requester?.positionId != null &&
      course.positions.some((cp) => cp.position.id === requester.positionId)
    if (!eligible) throw notFound(t('error.course.notFound', undefined, locale))
  }

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
      accessType: input.accessType,
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

  // accessType-lock: มี enrollment ที่ active (ไม่นับ soft-deleted) ≥1 → ห้ามเปลี่ยน accessType
  // ทั้ง 2 ทิศ — ถอนหมดแล้วแก้ได้ตามปกติ (ตัดสินใจยืนยันแล้วว่านับเฉพาะ active)
  //
  // lock แถว Course ด้วย FOR UPDATE ก่อนเช็ค — ปิด race กับ selfEnroll (2C-3) ที่ lock แถวเดียวกัน
  // เช่นกัน: ฝั่งไหนถึงก่อนจะกันอีกฝั่งรอ commit แล้วอ่านค่าที่ถูก ไม่ใช่แค่ fresh-read คนละ
  // transaction ซึ่งยังมี window ให้ interleave กันได้ (จุดที่ 2C-2 ปิดไม่สมบูรณ์)
  const changingAccessType = input.accessType != null && input.accessType !== existing.accessType

  const course = await prisma.$transaction(async (tx) => {
    if (changingAccessType) {
      await tx.$queryRaw`SELECT id FROM Course WHERE id = ${id} FOR UPDATE`

      const activeEnrollmentCount = await tx.enrollment.count({
        where: { courseId: id, deletedAt: null },
      })
      if (activeEnrollmentCount > 0) {
        throw badRequest(t('error.course.accessTypeLocked', undefined, locale))
      }
    }

    return tx.course.update({
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
        ...(input.accessType != null && { accessType: input.accessType }),
        version: { increment: 1 },
      },
      select: COURSE_SELECT,
    })
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

    // POSITION_BASED ต้องผูก position ไว้อย่างน้อย 1 อัน ถึง publish ได้ — คู่กับ quiz-gate ด้านบน
    if (existing.accessType === 'POSITION_BASED') {
      const positionCount = await prisma.coursePosition.count({ where: { courseId: id } })
      if (positionCount === 0) {
        throw badRequest(t('error.course.positionRequiredToPublish', undefined, locale))
      }
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

// PUT /courses/:id/positions — replace ทั้งชุด
export async function setCoursePositions(
  prisma: PrismaClient,
  id: string,
  input: SetCoursePositionsInput,
  actorId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<CourseAdminResponse> {
  const existing = await prisma.course.findFirst({ where: { id, deletedAt: null } })
  if (!existing) throw notFound(t('error.course.notFound', undefined, locale))

  if (existing.accessType !== 'POSITION_BASED') {
    throw badRequest(t('error.course.positionsOnlyForPositionBased', undefined, locale))
  }

  const positionIds = [...new Set(input.positionIds)]

  // course-position-removal-gate: mirror ตรงกับ quiz/question delete-gate ของ 2A —
  // published + POSITION_BASED ต้องเหลือ position ≥1 เสมอ กัน dead-end course ย้อนหลัง
  if (positionIds.length === 0 && existing.status === 'PUBLISHED') {
    throw badRequest(t('error.course.cannotRemoveLastPosition', undefined, locale))
  }

  if (positionIds.length > 0) {
    const activeCount = await prisma.position.count({
      where: { id: { in: positionIds }, deletedAt: null },
    })
    if (activeCount !== positionIds.length) {
      throw badRequest(t('error.position.notFound', undefined, locale))
    }
  }

  await prisma.$transaction([
    prisma.coursePosition.deleteMany({ where: { courseId: id } }),
    ...(positionIds.length > 0
      ? [
          prisma.coursePosition.createMany({
            data: positionIds.map((positionId) => ({ courseId: id, positionId })),
          }),
        ]
      : []),
  ])

  await logAudit(prisma, {
    actorId,
    action: 'COURSE_POSITIONS_UPDATE',
    targetType: 'Course',
    targetId: id,
    metadata: { positionIds },
    ...(ip != null && { ip }),
  })

  const course = await prisma.course.findFirstOrThrow({ where: { id }, select: COURSE_SELECT })
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
