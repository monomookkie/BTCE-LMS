import type { PrismaClient } from '@prisma/client'
import type {
  EnrollmentResponse,
  AssignEnrollmentInput,
  SelfEnrollInput,
} from '@btec-lms/shared'
import { logAudit } from '../../lib/audit.js'
import { notFound, badRequest, forbidden } from '../../lib/errors.js'
import type { EnrollmentListQuery } from './enrollments.schema.js'

const ENROLLMENT_SELECT = {
  id: true,
  userId: true,
  courseId: true,
  status: true,
  progress: true,
  completedMaterials: true,
  assignedAt: true,
  dueAt: true,
  completedAt: true,
  createdAt: true,
} as const

function toEnrollmentResponse(e: {
  id: string
  userId: string
  courseId: string
  status: string
  progress: number
  completedMaterials: unknown
  assignedAt: Date
  dueAt: Date | null
  completedAt: Date | null
  createdAt: Date
}): EnrollmentResponse {
  return {
    id: e.id,
    userId: e.userId,
    courseId: e.courseId,
    status: e.status as EnrollmentResponse['status'],
    progress: e.progress,
    completedMaterials: (e.completedMaterials as string[]) ?? [],
    assignedAt: e.assignedAt.toISOString(),
    dueAt: e.dueAt?.toISOString() ?? null,
    completedAt: e.completedAt?.toISOString() ?? null,
    createdAt: e.createdAt.toISOString(),
  }
}

// คำนวณ progress % และ filter completedMaterials ที่ชี้ไป material ที่ลบแล้วออก
async function recalculateProgress(
  prisma: PrismaClient,
  courseId: string,
  rawCompleted: string[],
): Promise<{ progress: number; completedMaterials: string[]; isComplete: boolean }> {
  const activeMaterials = await prisma.material.findMany({
    where: { courseId, deletedAt: null },
    select: { id: true },
  })
  const activeIds = new Set(activeMaterials.map((m) => m.id))

  // กรองเฉพาะ materialId ที่ยังไม่ถูกลบ และ deduplicate
  const validCompleted = [...new Set(rawCompleted)].filter((id) => activeIds.has(id))

  const total = activeIds.size
  const progress = total === 0 ? 0 : Math.round((validCompleted.length / total) * 100)
  const isComplete = total > 0 && validCompleted.length >= total

  return { progress, completedMaterials: validCompleted, isComplete }
}

// ตรวจว่า enrollment สามารถ COMPLETED ได้: progress 100% + quiz passed (ถ้า course มี quiz)
async function checkCanComplete(
  prisma: PrismaClient,
  courseId: string,
  userId: string,
  progress: number,
): Promise<boolean> {
  if (progress < 100) return false

  const quiz = await prisma.quiz.findFirst({
    where: { courseId, deletedAt: null },
    select: { id: true },
  })

  if (quiz) {
    const passedAttempt = await prisma.quizAttempt.findFirst({
      where: { quizId: quiz.id, userId, passed: true },
    })
    if (!passedAttempt) return false
  }

  return true
}

// ดึง active enrollment เดียว (deletedAt: null) — ใช้แทน findUnique หลังเอา DB unique ออก
async function findActiveEnrollment(prisma: PrismaClient, userId: string, courseId: string) {
  return prisma.enrollment.findFirst({
    where: { userId, courseId, deletedAt: null },
  })
}

export async function assignEnrollment(
  prisma: PrismaClient,
  input: AssignEnrollmentInput,
  actorId: string,
  ip?: string,
): Promise<EnrollmentResponse> {
  const course = await prisma.course.findFirst({
    where: { id: input.courseId, deletedAt: null, status: 'PUBLISHED' },
    select: { id: true },
  })
  if (!course) throw notFound('Course not found or not published')

  const user = await prisma.user.findFirst({
    where: { id: input.userId, deletedAt: null },
    select: { id: true },
  })
  if (!user) throw notFound('User not found')

  // app-level uniqueness: ตรวจเฉพาะ active enrollment
  const existing = await findActiveEnrollment(prisma, input.userId, input.courseId)
  if (existing) throw badRequest('User is already enrolled in this course')

  const enrollment = await prisma.enrollment.create({
    data: {
      userId: input.userId,
      courseId: input.courseId,
      status: 'ASSIGNED',
      ...(input.dueAt != null && { dueAt: new Date(input.dueAt) }),
    },
    select: ENROLLMENT_SELECT,
  })

  await logAudit(prisma, {
    actorId,
    action: 'ENROLLMENT_ASSIGN',
    targetType: 'Enrollment',
    targetId: enrollment.id,
    metadata: { userId: input.userId, courseId: input.courseId },
    ...(ip != null && { ip }),
  })

  return toEnrollmentResponse(enrollment)
}

export async function selfEnroll(
  prisma: PrismaClient,
  input: SelfEnrollInput,
  userId: string,
  ip?: string,
): Promise<EnrollmentResponse> {
  const course = await prisma.course.findFirst({
    where: { id: input.courseId, deletedAt: null, status: 'PUBLISHED' },
    select: { id: true, allowSelfEnroll: true },
  })
  if (!course) throw notFound('Course not found or not published')
  if (!course.allowSelfEnroll) throw forbidden('This course does not allow self-enrollment')

  const existing = await findActiveEnrollment(prisma, userId, input.courseId)
  if (existing) throw badRequest('Already enrolled in this course')

  const enrollment = await prisma.enrollment.create({
    data: { userId, courseId: input.courseId, status: 'IN_PROGRESS' },
    select: ENROLLMENT_SELECT,
  })

  await logAudit(prisma, {
    actorId: userId,
    action: 'ENROLLMENT_SELF',
    targetType: 'Enrollment',
    targetId: enrollment.id,
    metadata: { courseId: input.courseId },
    ...(ip != null && { ip }),
  })

  return toEnrollmentResponse(enrollment)
}

export async function listEnrollments(
  prisma: PrismaClient,
  query: EnrollmentListQuery,
  actorId: string,
  ip?: string,
): Promise<{ data: EnrollmentResponse[]; total: number; page: number; limit: number }> {
  const { page, limit, userId, courseId, status } = query
  const where = {
    deletedAt: null,
    ...(userId != null && { userId }),
    ...(courseId != null && { courseId }),
    ...(status != null && { status }),
  }

  const [enrollments, total] = await prisma.$transaction([
    prisma.enrollment.findMany({
      where,
      select: ENROLLMENT_SELECT,
      orderBy: { assignedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.enrollment.count({ where }),
  ])

  await logAudit(prisma, {
    actorId,
    action: 'ENROLLMENT_LIST',
    metadata: { page, limit, ...(userId != null && { userId }), ...(courseId != null && { courseId }) },
    ...(ip != null && { ip }),
  })

  return { data: enrollments.map(toEnrollmentResponse), total, page, limit }
}

export async function listMyEnrollments(
  prisma: PrismaClient,
  userId: string,
  query: EnrollmentListQuery,
): Promise<{ data: EnrollmentResponse[]; total: number; page: number; limit: number }> {
  const { page, limit, status } = query
  const where = { userId, deletedAt: null, ...(status != null && { status }) }

  const [enrollments, total] = await prisma.$transaction([
    prisma.enrollment.findMany({
      where,
      select: ENROLLMENT_SELECT,
      orderBy: { assignedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.enrollment.count({ where }),
  ])

  return { data: enrollments.map(toEnrollmentResponse), total, page, limit }
}

export async function getEnrollment(
  prisma: PrismaClient,
  id: string,
  requesterId: string,
  requesterRole: string,
  ip?: string,
): Promise<EnrollmentResponse> {
  const enrollment = await prisma.enrollment.findFirst({
    where: { id, deletedAt: null },
    select: ENROLLMENT_SELECT,
  })
  // ใช้ notFound เสมอ ทั้ง "ไม่มี" และ "ไม่ใช่ของตัวเอง" — กัน enumeration
  if (!enrollment) throw notFound('Enrollment not found')

  if (requesterRole === 'USER' && enrollment.userId !== requesterId) {
    throw notFound('Enrollment not found')
  }

  // PDPA: log เมื่อ ADMIN/MANAGER ดู enrollment ของ user อื่น
  if (requesterRole !== 'USER' && enrollment.userId !== requesterId) {
    await logAudit(prisma, {
      actorId: requesterId,
      action: 'ENROLLMENT_VIEW',
      targetType: 'Enrollment',
      targetId: id,
      metadata: { targetUserId: enrollment.userId },
      ...(ip != null && { ip }),
    })
  }

  return toEnrollmentResponse(enrollment)
}

export async function markMaterialComplete(
  prisma: PrismaClient,
  enrollmentId: string,
  materialId: string,
  userId: string,
  ip?: string,
): Promise<EnrollmentResponse> {
  const enrollment = await prisma.enrollment.findFirst({
    where: { id: enrollmentId, deletedAt: null },
    select: ENROLLMENT_SELECT,
  })
  // notFound เสมอ — กัน enumeration ของ enrollment ID
  if (!enrollment) throw notFound('Enrollment not found')
  if (enrollment.userId !== userId) throw notFound('Enrollment not found')
  if (enrollment.status === 'COMPLETED') throw badRequest('Course already completed')

  const material = await prisma.material.findFirst({
    where: { id: materialId, courseId: enrollment.courseId, deletedAt: null },
    select: { id: true },
  })
  if (!material) throw notFound('Material not found in this course')

  const currentCompleted = (enrollment.completedMaterials as string[]) ?? []
  const newCompleted = [...new Set([...currentCompleted, materialId])]

  const { progress, completedMaterials, isComplete } = await recalculateProgress(
    prisma,
    enrollment.courseId,
    newCompleted,
  )

  const canComplete = isComplete
    ? await checkCanComplete(prisma, enrollment.courseId, userId, progress)
    : false

  const updated = await prisma.enrollment.update({
    where: { id: enrollmentId },
    data: {
      completedMaterials,
      progress,
      status: canComplete
        ? 'COMPLETED'
        : enrollment.status === 'ASSIGNED'
          ? 'IN_PROGRESS'
          : enrollment.status,
      ...(canComplete && { completedAt: new Date() }),
    },
    select: ENROLLMENT_SELECT,
  })

  await logAudit(prisma, {
    actorId: userId,
    action: 'MATERIAL_COMPLETE',
    targetType: 'Enrollment',
    targetId: enrollmentId,
    metadata: { materialId, progress, status: updated.status },
    ...(ip != null && { ip }),
  })

  return toEnrollmentResponse(updated)
}

export async function cancelEnrollment(
  prisma: PrismaClient,
  id: string,
  actorId: string,
  ip?: string,
): Promise<void> {
  const enrollment = await prisma.enrollment.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, userId: true, courseId: true },
  })
  if (!enrollment) throw notFound('Enrollment not found')

  // soft delete — ไม่ลบจริง ให้ audit trail ยังอยู่ใน DB
  await prisma.enrollment.update({
    where: { id },
    data: { deletedAt: new Date() },
  })

  await logAudit(prisma, {
    actorId,
    action: 'ENROLLMENT_CANCEL',
    targetType: 'Enrollment',
    targetId: id,
    metadata: { userId: enrollment.userId, courseId: enrollment.courseId },
    ...(ip != null && { ip }),
  })
}
