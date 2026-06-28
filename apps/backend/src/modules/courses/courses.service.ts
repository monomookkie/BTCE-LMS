import type { PrismaClient } from '@prisma/client'
import type {
  CourseResponse,
  CreateCourseInput,
  UpdateCourseInput,
  UpdateCourseStatusInput,
} from '@btec-lms/shared'
import { logAudit } from '../../lib/audit.js'
import { notFound, badRequest } from '../../lib/errors.js'
import type { CourseListQuery } from './courses.schema.js'

const COURSE_SELECT = {
  id: true,
  title: true,
  category: true,
  description: true,
  status: true,
  durationMin: true,
  passScore: true,
  expiryMonths: true,
  createdById: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} as const

function toCourseResponse(course: {
  id: string
  title: string
  category: string
  description: string | null
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
  durationMin: number | null
  passScore: number
  expiryMonths: number | null
  createdById: string | null
  version: number
  createdAt: Date
  updatedAt: Date
}): CourseResponse {
  return {
    ...course,
    createdAt: course.createdAt.toISOString(),
    updatedAt: course.updatedAt.toISOString(),
  }
}

export async function listCourses(
  prisma: PrismaClient,
  query: CourseListQuery,
  requesterRole: string,
  ip?: string,
  actorId?: string,
): Promise<{ data: CourseResponse[]; total: number; page: number; limit: number }> {
  const { page, limit, search, status, category } = query

  // USER เห็นเฉพาะ PUBLISHED — ADMIN/MANAGER เห็นทุก status
  const statusFilter =
    requesterRole === 'USER'
      ? { status: 'PUBLISHED' as const }
      : status != null
        ? { status }
        : {}

  const where = {
    deletedAt: null,
    ...statusFilter,
    ...(category != null && { category }),
    ...(search != null && {
      OR: [
        { title: { contains: search } },
        { category: { contains: search } },
        { description: { contains: search } },
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

  return { data: courses.map(toCourseResponse), total, page, limit }
}

export async function getCourse(
  prisma: PrismaClient,
  id: string,
  requesterRole: string,
): Promise<CourseResponse> {
  const statusFilter = requesterRole === 'USER' ? { status: 'PUBLISHED' as const } : {}

  const course = await prisma.course.findFirst({
    where: { id, deletedAt: null, ...statusFilter },
    select: COURSE_SELECT,
  })

  if (!course) throw notFound('Course not found')
  return toCourseResponse(course)
}

export async function createCourse(
  prisma: PrismaClient,
  input: CreateCourseInput,
  actorId: string,
  ip?: string,
): Promise<CourseResponse> {
  const course = await prisma.course.create({
    data: {
      title: input.title,
      category: input.category,
      ...(input.description != null && { description: input.description }),
      ...(input.durationMin != null && { durationMin: input.durationMin }),
      passScore: input.passScore,
      ...(input.expiryMonths != null && { expiryMonths: input.expiryMonths }),
      createdById: actorId,
    },
    select: COURSE_SELECT,
  })

  await logAudit(prisma, {
    actorId,
    action: 'COURSE_CREATE',
    targetType: 'Course',
    targetId: course.id,
    metadata: { title: input.title, category: input.category },
    ...(ip != null && { ip }),
  })

  return toCourseResponse(course)
}

export async function updateCourse(
  prisma: PrismaClient,
  id: string,
  input: UpdateCourseInput,
  actorId: string,
  ip?: string,
): Promise<CourseResponse> {
  const existing = await prisma.course.findFirst({ where: { id, deletedAt: null } })
  if (!existing) throw notFound('Course not found')

  const course = await prisma.course.update({
    where: { id },
    data: {
      ...(input.title != null && { title: input.title }),
      ...(input.category != null && { category: input.category }),
      ...('description' in input && { description: input.description ?? null }),
      ...('durationMin' in input && { durationMin: input.durationMin ?? null }),
      ...(input.passScore != null && { passScore: input.passScore }),
      ...('expiryMonths' in input && { expiryMonths: input.expiryMonths ?? null }),
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

  return toCourseResponse(course)
}

export async function updateCourseStatus(
  prisma: PrismaClient,
  id: string,
  input: UpdateCourseStatusInput,
  actorId: string,
  ip?: string,
): Promise<CourseResponse> {
  const existing = await prisma.course.findFirst({ where: { id, deletedAt: null } })
  if (!existing) throw notFound('Course not found')

  // ARCHIVED → ไม่ให้ publish กลับ (ต้องสร้างใหม่)
  if (existing.status === 'ARCHIVED') {
    throw badRequest('Archived course cannot change status')
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

  return toCourseResponse(course)
}

export async function softDeleteCourse(
  prisma: PrismaClient,
  id: string,
  actorId: string,
  ip?: string,
): Promise<void> {
  const existing = await prisma.course.findFirst({ where: { id, deletedAt: null } })
  if (!existing) throw notFound('Course not found')

  const now = new Date()

  // cascade soft delete materials ใต้ course ด้วย — ไฟล์จริงใน Cloudinary ยังอยู่ (รอ cleanup job)
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
    metadata: { title: existing.title },
    ...(ip != null && { ip }),
  })
}
