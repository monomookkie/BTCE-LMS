import { Prisma } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'
import type {
  EnrollmentResponse,
  SelfEnrollInput,
  SetEnrollmentDueDateInput,
} from '@btec-lms/shared'
import {
  MIN_READ_SECONDS,
  MIN_WATCHED_PERCENT,
  PROGRESS_CEILING_BUFFER_PERCENT,
  MIN_ASSUMED_VIDEO_DURATION_SECONDS,
} from '@btec-lms/shared'
import { logAudit } from '../../lib/audit.js'
import { notFound, badRequest, forbidden } from '../../lib/errors.js'
import { t, localizeField, type Locale } from '../../lib/i18n.js'
import type { EnrollmentListQuery, MaterialProgressResponse } from './enrollments.schema.js'

// เพดานกันเผื่อ — activeSeconds ไม่จำเป็นต้องสะสมเกินเกณฑ์ที่ใช้ตรวจสอบ (MIN_READ_SECONDS)
const ACTIVE_SECONDS_CAP = MIN_READ_SECONDS

const ENROLLMENT_SELECT = {
  id: true,
  userId: true,
  courseId: true,
  status: true,
  progress: true,
  completedMaterials: true,
  isMandatory: true,
  bonusQuizAttempts: true,
  assignedAt: true,
  dueAt: true,
  completedAt: true,
  createdAt: true,
  course: { select: { titleEn: true, titleTh: true } },
} as const

type EnrollmentRecord = {
  id: string
  userId: string
  courseId: string
  status: string
  progress: number
  completedMaterials: unknown
  isMandatory: boolean
  bonusQuizAttempts: number
  assignedAt: Date
  dueAt: Date | null
  completedAt: Date | null
  createdAt: Date
  course: { titleEn: string; titleTh: string | null }
}

function toEnrollmentResponse(e: EnrollmentRecord, locale: Locale = 'en'): EnrollmentResponse {
  return {
    id: e.id,
    userId: e.userId,
    courseId: e.courseId,
    courseTitle: localizeField(e.course.titleEn, e.course.titleTh, locale),
    status: e.status as EnrollmentResponse['status'],
    progress: e.progress,
    completedMaterials: (e.completedMaterials as string[]) ?? [],
    isMandatory: e.isMandatory,
    bonusQuizAttempts: e.bonusQuizAttempts,
    assignedAt: e.assignedAt.toISOString(),
    dueAt: e.dueAt?.toISOString() ?? null,
    completedAt: e.completedAt?.toISOString() ?? null,
    createdAt: e.createdAt.toISOString(),
  }
}

// เช็คว่า material ทั้งหมดของ course (ที่ยังไม่ถูกลบ) เรียนจบครบหรือยัง — ใช้ gate การเข้าทำ quiz
// (2C-6: quiz เป็น item สุดท้าย ต้องเรียน material ให้ครบก่อน ไม่ใช่กระโดดไปสอบได้เลย)
// course ที่ไม่มี material เลย (total=0) ถือว่าผ่าน gate นี้เสมอ (ไม่มีอะไรให้เรียนก่อน)
export async function areAllMaterialsCompleted(
  prisma: PrismaClient,
  courseId: string,
  rawCompleted: string[],
): Promise<boolean> {
  const activeMaterials = await prisma.material.findMany({
    where: { courseId, deletedAt: null },
    select: { id: true },
  })
  if (activeMaterials.length === 0) return true

  const completedSet = new Set(rawCompleted)
  return activeMaterials.every((m) => completedSet.has(m.id))
}

// คำนวณ progress % และ filter completedMaterials ที่ชี้ไป material ที่ลบแล้วออก
// quiz (ถ้า course มี) นับเป็น 1 item ในตัวหารร่วมกับ material ทั้งหมด — "ผ่าน" ก็ต่อเมื่อมี
// QuizAttempt.passed=true อย่างน้อย 1 ครั้งเท่านั้น ถึงจะนับเป็น item ที่เสร็จ ไม่งั้น progress จะขึ้น
// 100% ทั้งที่ยังไม่สอบผ่าน (survey ไม่นับรวมตรงนี้ — เป็นเงื่อนไขแยกสำหรับ COMPLETED เท่านั้น ดู checkCanComplete)
export async function recalculateProgress(
  prisma: PrismaClient,
  courseId: string,
  userId: string,
  rawCompleted: string[],
): Promise<{ progress: number; completedMaterials: string[]; isComplete: boolean }> {
  const activeMaterials = await prisma.material.findMany({
    where: { courseId, deletedAt: null },
    select: { id: true },
  })
  const activeIds = new Set(activeMaterials.map((m) => m.id))

  // กรองเฉพาะ materialId ที่ยังไม่ถูกลบ และ deduplicate
  const validCompleted = [...new Set(rawCompleted)].filter((id) => activeIds.has(id))

  const quiz = await prisma.quiz.findFirst({
    where: { courseId, deletedAt: null },
    select: { id: true },
  })
  const quizPassed = quiz != null
    ? (await prisma.quizAttempt.findFirst({ where: { quizId: quiz.id, userId, passed: true }, select: { id: true } })) != null
    : false

  const total = activeIds.size + (quiz != null ? 1 : 0)
  const completedCount = validCompleted.length + (quiz != null && quizPassed ? 1 : 0)
  const progress = total === 0 ? 0 : Math.round((completedCount / total) * 100)
  const isComplete = total > 0 && completedCount >= total

  return { progress, completedMaterials: validCompleted, isComplete }
}

// ตรวจว่า enrollment สามารถ COMPLETED ได้: progress 100% + quiz passed (ถ้า course มี quiz) + survey ตอบแล้ว (ถ้า course มี survey)
// export ไว้ให้ quizzes.service.ts / surveys.service.ts เรียกใช้ร่วมกัน — กัน logic แยกกันแล้ว drift
export async function checkCanComplete(
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

  // survey เป็น optional ต่อ course (2B) — ถ้ามี survey ต้องตอบก่อน COMPLETED
  // ถ้าไม่มี survey ไม่ gate เลย (เหมือนเดิมก่อนมี survey — ไม่ retroactive กับ enrollment ที่ COMPLETED ไปแล้ว
  // เพราะฟังก์ชันนี้เช็คแค่ตอนกำลังจะเปลี่ยนสถานะเท่านั้น)
  const survey = await prisma.survey.findFirst({
    where: { courseId, deletedAt: null },
    select: { id: true },
  })

  if (survey) {
    const response = await prisma.surveyResponse.findFirst({
      where: { surveyId: survey.id, userId },
    })
    if (!response) return false
  }

  return true
}

// ดึง active enrollment เดียว (deletedAt: null) — ใช้แทน findUnique หลังเอา DB unique ออก
// รับ Prisma.TransactionClient ด้วย — selfEnroll เรียกจากใน $transaction (2C-3)
async function findActiveEnrollment(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
  courseId: string,
) {
  return prisma.enrollment.findFirst({
    where: { userId, courseId, deletedAt: null },
  })
}

function toMaterialProgressResponse(p: {
  materialId: string
  openedAt: Date | null
  watchedPercent: number
  embedFailed: boolean
  activeSeconds: number
}): MaterialProgressResponse {
  return {
    materialId: p.materialId,
    openedAt: p.openedAt?.toISOString() ?? null,
    watchedPercent: p.watchedPercent,
    embedFailed: p.embedFailed,
    activeSeconds: p.activeSeconds,
  }
}

// ตรวจ ownership ร่วมของ enrollment + material แล้ว return ทั้งคู่ (ใช้ซ้ำใน open/progress/complete)
async function loadOwnedEnrollmentAndMaterial(
  prisma: PrismaClient,
  enrollmentId: string,
  materialId: string,
  userId: string,
  locale: Locale,
) {
  const enrollment = await prisma.enrollment.findFirst({
    where: { id: enrollmentId, deletedAt: null },
    select: { id: true, userId: true, courseId: true, status: true, completedMaterials: true },
  })
  // notFound เสมอ — กัน enumeration ของ enrollment ID
  if (!enrollment) throw notFound(t('error.enrollment.notFound', undefined, locale))
  if (enrollment.userId !== userId) throw notFound(t('error.enrollment.notFound', undefined, locale))

  const material = await prisma.material.findFirst({
    where: { id: materialId, courseId: enrollment.courseId, deletedAt: null },
    select: { id: true, type: true },
  })
  if (!material) throw notFound(t('error.material.notFound', undefined, locale))

  return { enrollment, material }
}

// เกณฑ์เวลาขั้นต่ำ (LINK/PDF/IMAGE/DOC — และ VIDEO ที่ embed ล้มเหลว, ดู checkViewGate)
// ใช้ activeSeconds (สะสมจาก heartbeat ตอนอยู่หน้าจริง) แทน wall-clock diff จาก openedAt เดิม —
// ออกจากหน้าแล้วเวลาต้องหยุดนับ ไม่ใช่นับต่อไปเรื่อยๆ ตามเวลาจริง
function checkMinReadTime(activeSeconds: number, locale: Locale): void {
  if (activeSeconds < MIN_READ_SECONDS) {
    throw badRequest(t('error.material.watchTimeInsufficient', undefined, locale))
  }
}

// Tier 2/3 gate: ตรวจว่า "เปิดดูจริง" มาก่อนจึงอนุญาต mark-complete
async function checkViewGate(
  prisma: PrismaClient,
  enrollmentId: string,
  material: { id: string; type: string },
  locale: Locale,
): Promise<void> {
  const progress = await prisma.materialProgress.findUnique({
    where: { enrollmentId_materialId: { enrollmentId, materialId: material.id } },
  })
  if (!progress || progress.openedAt == null) {
    throw badRequest(t('error.material.notYetViewed', undefined, locale))
  }

  if (material.type === 'VIDEO') {
    // Fallback: YouTube embed โหลดไม่สำเร็จ (network/CSP/timeout) — client รายงาน embedFailed มาเอง
    // เปลี่ยนไปใช้ time-gate แบบ LINK แทน percent-gate เพื่อไม่ปิดกั้นการเรียนจบทั้งที่ดูวิดีโอไม่ได้จริงๆ
    // หมายเหตุ: embedFailed เป็นค่าที่ client รายงานเอง — ผู้ใช้ที่ตั้งใจโกงสามารถอ้างเท็จเพื่อลดเกณฑ์
    // จาก "ต้องดูถึง 90%" เหลือแค่ "รอ 300 วิ" ยอมรับ trade-off นี้เพราะดีกว่าปิดกั้นคนที่ network บล็อกจริง
    if (progress.embedFailed) {
      checkMinReadTime(progress.activeSeconds, locale)
      return
    }
    if (progress.watchedPercent < MIN_WATCHED_PERCENT) {
      throw badRequest(t('error.material.watchTimeInsufficient', undefined, locale))
    }
    return
  }

  checkMinReadTime(progress.activeSeconds, locale)
}

// upsert ที่ทนต่อ race: สอง endpoint (open, embed-failed) อาจยิงพร้อมกันตอน material ยังไม่มี
// MaterialProgress row เลย — ทั้งคู่พยายาม CREATE แล้วชน unique constraint ได้ (Prisma upsert ไม่ atomic
// ข้าม request ใน MySQL) เมื่อชนแล้วแปลว่าอีกฝั่งสร้างสำเร็จไปแล้ว retry เป็น update แทน
async function upsertMaterialProgressSafe(
  prisma: PrismaClient,
  enrollmentId: string,
  materialId: string,
  create: Prisma.MaterialProgressUncheckedCreateInput,
  update: Prisma.MaterialProgressUpdateInput,
) {
  try {
    return await prisma.materialProgress.upsert({
      where: { enrollmentId_materialId: { enrollmentId, materialId } },
      update,
      create,
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return prisma.materialProgress.update({
        where: { enrollmentId_materialId: { enrollmentId, materialId } },
        data: update,
      })
    }
    throw err
  }
}

export async function openMaterial(
  prisma: PrismaClient,
  enrollmentId: string,
  materialId: string,
  userId: string,
  locale: Locale = 'en',
): Promise<MaterialProgressResponse> {
  await loadOwnedEnrollmentAndMaterial(prisma, enrollmentId, materialId, userId, locale)

  // idempotent — เปิดซ้ำไม่ reset openedAt เดิม
  const progress = await upsertMaterialProgressSafe(
    prisma,
    enrollmentId,
    materialId,
    { enrollmentId, materialId, openedAt: new Date() },
    {},
  )

  return toMaterialProgressResponse(progress)
}

// ให้ frontend hydrate % ที่ดูถึงแล้วตอนโหลดหน้าใหม่ — ไม่งั้น UI จะโชว์ 0% ทั้งที่ server จำ max ไว้แล้ว
export async function getMaterialProgress(
  prisma: PrismaClient,
  enrollmentId: string,
  materialId: string,
  userId: string,
  locale: Locale = 'en',
): Promise<MaterialProgressResponse> {
  await loadOwnedEnrollmentAndMaterial(prisma, enrollmentId, materialId, userId, locale)

  const progress = await prisma.materialProgress.findUnique({
    where: { enrollmentId_materialId: { enrollmentId, materialId } },
  })

  return progress != null
    ? toMaterialProgressResponse(progress)
    : { materialId, openedAt: null, watchedPercent: 0, embedFailed: false, activeSeconds: 0 }
}

// Tier 2 heartbeat: client ยิงทุก ~HEARTBEAT_INTERVAL_SECONDS วิระหว่างอยู่หน้า material + tab visible
// (ดู useTimeGate ฝั่ง frontend) — เพิ่ม activeSeconds สะสม ใช้แทน wall-clock diff จาก openedAt เดิม
// ออกจากหน้า/สลับแท็บแล้วเวลาต้องหยุดนับ ไม่ใช่นับต่อไปเรื่อยๆ ตามเวลาจริง
export async function recordMaterialHeartbeat(
  prisma: PrismaClient,
  enrollmentId: string,
  materialId: string,
  userId: string,
  deltaSeconds: number,
  locale: Locale = 'en',
): Promise<MaterialProgressResponse> {
  await loadOwnedEnrollmentAndMaterial(prisma, enrollmentId, materialId, userId, locale)

  const existing = await prisma.materialProgress.findUnique({
    where: { enrollmentId_materialId: { enrollmentId, materialId } },
  })
  // ต้อง /open มาก่อนเสมอ — heartbeat ที่มาก่อน openedAt ถือว่าผิดปกติ (client ควรเรียก /open ก่อนเริ่มนับ)
  if (!existing || existing.openedAt == null) {
    throw badRequest(t('error.material.notYetViewed', undefined, locale))
  }

  const nextActiveSeconds = Math.min(ACTIVE_SECONDS_CAP, existing.activeSeconds + deltaSeconds)
  const progress = await prisma.materialProgress.update({
    where: { id: existing.id },
    data: { activeSeconds: nextActiveSeconds },
  })

  return toMaterialProgressResponse(progress)
}

// Client รายงานว่า YouTube embed โหลดไม่สำเร็จ — ให้ checkViewGate fallback เป็น time-gate แบบ LINK
// upsert (ไม่ require ว่า /open ต้องสำเร็จมาก่อน) — กัน race condition ระหว่าง open กับ embed-failed
// ที่ยิงใกล้กันมาก (embed ล้มเหลวเร็วกว่า open mutation จะ commit เสร็จ) ไม่งั้น flag จะเงียบๆ ไม่ถูกบันทึก
export async function markEmbedFailed(
  prisma: PrismaClient,
  enrollmentId: string,
  materialId: string,
  userId: string,
  locale: Locale = 'en',
): Promise<MaterialProgressResponse> {
  await loadOwnedEnrollmentAndMaterial(prisma, enrollmentId, materialId, userId, locale)

  const progress = await upsertMaterialProgressSafe(
    prisma,
    enrollmentId,
    materialId,
    { enrollmentId, materialId, openedAt: new Date(), embedFailed: true },
    { embedFailed: true },
  )

  return toMaterialProgressResponse(progress)
}

// Sanity check: watchedPercent ที่อ้างมาต้องสมเหตุสมผลกับเวลาจริงที่ผ่านไปตั้งแต่ openedAt
// ไม่ใช่การพิสูจน์ 100% ว่าไม่โกง (durationSeconds เป็นค่าที่ client รายงานเอง) แต่ยกระดับจาก
// "ยิง POST เดียวจบ" เป็น "ต้องรอเวลาจริงประมาณเท่าที่อ้างว่าดู" — เพดานคำนวณจากเวลาที่ผ่านมา ไม่ใช่จำนวนครั้งที่เรียก
function computeMaxReasonablePercent(openedAt: Date, durationSeconds: number | null): number {
  const elapsedSeconds = (Date.now() - openedAt.getTime()) / 1000
  const effectiveDuration = durationSeconds ?? MIN_ASSUMED_VIDEO_DURATION_SECONDS
  const ceiling = (elapsedSeconds / effectiveDuration) * 100 + PROGRESS_CEILING_BUFFER_PERCENT
  return Math.min(100, Math.max(0, Math.round(ceiling)))
}

export async function updateMaterialProgress(
  prisma: PrismaClient,
  enrollmentId: string,
  materialId: string,
  userId: string,
  watchedPercent: number,
  durationSeconds: number | undefined,
  locale: Locale = 'en',
): Promise<MaterialProgressResponse> {
  await loadOwnedEnrollmentAndMaterial(prisma, enrollmentId, materialId, userId, locale)

  const existing = await prisma.materialProgress.findUnique({
    where: { enrollmentId_materialId: { enrollmentId, materialId } },
  })
  if (!existing || existing.openedAt == null) {
    throw badRequest(t('error.material.notYetViewed', undefined, locale))
  }

  // lock duration ที่ค่าแรกที่ได้รับ — ไม่ยอมให้เปลี่ยนภายหลัง (กันปั่น ceiling ให้หลวมขึ้นทีหลัง)
  const lockedDuration = existing.durationSeconds ?? durationSeconds ?? null
  const maxReasonablePercent = computeMaxReasonablePercent(existing.openedAt, lockedDuration)
  const sanitizedPercent = Math.min(watchedPercent, maxReasonablePercent)

  const progress = await prisma.materialProgress.update({
    where: { id: existing.id },
    data: {
      // เก็บค่าสูงสุดเท่านั้น — กันไถ progress ถอยหลัง (เช่น seek ย้อนวิดีโอ)
      watchedPercent: Math.max(existing.watchedPercent, sanitizedPercent),
      lastProgressAt: new Date(),
      ...(existing.durationSeconds == null && lockedDuration != null && { durationSeconds: lockedDuration }),
    },
  })

  return toMaterialProgressResponse(progress)
}

// USER เริ่มเรียนเอง — PUBLIC เข้าได้ทุกคน, POSITION_BASED ต้อง user.positionId ตรงกับ position
// ที่ course ผูกไว้ (2C-3) ทำทั้งหมดใน $transaction เดียว + lock แถว Course ด้วย FOR UPDATE —
// ปิด race กับ courses.service.ts's updateCourse (accessType-lock check) ที่ 2C-2 ปิดไม่สมบูรณ์:
// ฝั่งไหนถึงก่อนจะ lock แถว Course ไว้ อีกฝั่งต้องรอ commit ก่อนถึงจะอ่านค่าที่ถูกต้องจริง
// (ไม่ใช่แค่ read fresh คนละ transaction ซึ่งยังมี window ให้ interleave กันได้อยู่ดี)
export async function selfEnroll(
  prisma: PrismaClient,
  input: SelfEnrollInput,
  userId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<EnrollmentResponse> {
  const enrollment = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM Course WHERE id = ${input.courseId} FOR UPDATE`

    const course = await tx.course.findFirst({
      where: { id: input.courseId, deletedAt: null, status: 'PUBLISHED' },
      select: {
        id: true,
        accessType: true,
        enrollmentCloseAt: true,
        positions: { select: { positionId: true } },
      },
    })
    if (!course) throw notFound(t('error.course.notFound', undefined, locale))
    if (course.enrollmentCloseAt != null && course.enrollmentCloseAt < new Date()) {
      throw badRequest(t('error.course.enrollmentClosed', undefined, locale))
    }

    const isMandatory = course.accessType === 'POSITION_BASED'

    if (isMandatory) {
      const user = await tx.user.findFirst({
        where: { id: userId, deletedAt: null },
        select: { positionId: true },
      })
      // positionId = null (เลือก "Others" ตอนสมัคร) → เข้า POSITION_BASED course ไม่ได้เลย
      // จนกว่า admin จะตั้ง position ให้ — ข้อความต่างจากกรณี "ตั้งแล้วแต่ไม่ตรง" เพื่อบอก user
      // ว่าต้องรอ admin ไม่ใช่ปัญหาที่ตัวเอง
      if (user?.positionId == null) {
        throw forbidden(t('error.enrollment.positionRequired', undefined, locale))
      }
      const allowedPositionIds = new Set(course.positions.map((p) => p.positionId))
      if (!allowedPositionIds.has(user.positionId)) {
        throw forbidden(t('error.enrollment.positionNotAllowed', undefined, locale))
      }
    }

    const existing = await findActiveEnrollment(tx, userId, input.courseId)
    if (existing) throw badRequest(t('error.enrollment.alreadyEnrolled', undefined, locale))

    const created = await tx.enrollment.create({
      data: { userId, courseId: input.courseId, status: 'IN_PROGRESS', isMandatory },
      select: ENROLLMENT_SELECT,
    })

    await logAudit(tx, {
      actorId: userId,
      action: 'ENROLLMENT_SELF',
      targetType: 'Enrollment',
      targetId: created.id,
      metadata: { courseId: input.courseId, isMandatory },
      ...(ip != null && { ip }),
    })

    return created
  })

  return toEnrollmentResponse(enrollment, locale)
}

// ADMIN ตั้ง/เคลียร์วันครบกำหนดของ enrollment ที่มีอยู่แล้ว — แทนที่ assignEnrollment เดิม
// ที่ถูกลบใน 2C-3 (ไม่มี frontend ใช้ + bypass access-gating โดยไม่ตั้งใจ) แต่ยังเก็บความสามารถ
// "ตั้ง due date ให้ user" ไว้ตามที่ยืนยันแล้วว่าเป็น requirement เดิมของโปรเจกต์
export async function setEnrollmentDueDate(
  prisma: PrismaClient,
  id: string,
  input: SetEnrollmentDueDateInput,
  actorId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<EnrollmentResponse> {
  const existing = await prisma.enrollment.findFirst({ where: { id, deletedAt: null } })
  if (!existing) throw notFound(t('error.enrollment.notFound', undefined, locale))

  const enrollment = await prisma.enrollment.update({
    where: { id },
    data: { dueAt: input.dueAt != null ? new Date(input.dueAt) : null },
    select: ENROLLMENT_SELECT,
  })

  await logAudit(prisma, {
    actorId,
    action: 'ENROLLMENT_SET_DUE_DATE',
    targetType: 'Enrollment',
    targetId: id,
    metadata: { dueAt: input.dueAt },
    ...(ip != null && { ip }),
  })

  return toEnrollmentResponse(enrollment, locale)
}

// ADMIN ให้สิทธิ์สอบ quiz เพิ่ม 1 ครั้งเป็นกรณีพิเศษ (เช่น สอบไม่ผ่านครบ maxAttempts แต่อยากให้โอกาสอีก)
// บวกเพิ่มเฉพาะ enrollment นี้เท่านั้น ไม่กระทบ quiz.maxAttempts ที่ใช้ร่วมกับ user คนอื่น
export async function grantQuizAttempt(
  prisma: PrismaClient,
  id: string,
  actorId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<EnrollmentResponse> {
  const existing = await prisma.enrollment.findFirst({ where: { id, deletedAt: null } })
  if (!existing) throw notFound(t('error.enrollment.notFound', undefined, locale))

  const enrollment = await prisma.enrollment.update({
    where: { id },
    data: { bonusQuizAttempts: { increment: 1 } },
    select: ENROLLMENT_SELECT,
  })

  await logAudit(prisma, {
    actorId,
    action: 'ENROLLMENT_GRANT_QUIZ_ATTEMPT',
    targetType: 'Enrollment',
    targetId: id,
    metadata: { bonusQuizAttempts: enrollment.bonusQuizAttempts },
    ...(ip != null && { ip }),
  })

  return toEnrollmentResponse(enrollment, locale)
}

export async function listEnrollments(
  prisma: PrismaClient,
  query: EnrollmentListQuery,
  actorId: string,
  locale: Locale = 'en',
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

  return { data: enrollments.map((e) => toEnrollmentResponse(e, locale)), total, page, limit }
}

export async function listMyEnrollments(
  prisma: PrismaClient,
  userId: string,
  query: EnrollmentListQuery,
  locale: Locale = 'en',
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

  return { data: enrollments.map((e) => toEnrollmentResponse(e, locale)), total, page, limit }
}

export async function getEnrollment(
  prisma: PrismaClient,
  id: string,
  requesterId: string,
  requesterRole: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<EnrollmentResponse> {
  const enrollment = await prisma.enrollment.findFirst({
    where: { id, deletedAt: null },
    select: ENROLLMENT_SELECT,
  })
  // ใช้ notFound เสมอ ทั้ง "ไม่มี" และ "ไม่ใช่ของตัวเอง" — กัน enumeration
  if (!enrollment) throw notFound(t('error.enrollment.notFound', undefined, locale))

  if (requesterRole === 'USER' && enrollment.userId !== requesterId) {
    throw notFound(t('error.enrollment.notFound', undefined, locale))
  }

  // PDPA: log เมื่อ ADMIN ดู enrollment ของ user อื่น
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

  return toEnrollmentResponse(enrollment, locale)
}

export async function markMaterialComplete(
  prisma: PrismaClient,
  enrollmentId: string,
  materialId: string,
  userId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<EnrollmentResponse> {
  const enrollment = await prisma.enrollment.findFirst({
    where: { id: enrollmentId, deletedAt: null },
    select: ENROLLMENT_SELECT,
  })
  // notFound เสมอ — กัน enumeration ของ enrollment ID
  if (!enrollment) throw notFound(t('error.enrollment.notFound', undefined, locale))
  if (enrollment.userId !== userId) throw notFound(t('error.enrollment.notFound', undefined, locale))
  if (enrollment.status === 'COMPLETED') throw badRequest(t('error.enrollment.alreadyCompleted', undefined, locale))

  const material = await prisma.material.findFirst({
    where: { id: materialId, courseId: enrollment.courseId, deletedAt: null },
    select: { id: true, type: true },
  })
  if (!material) throw notFound(t('error.material.notFound', undefined, locale))

  const currentCompleted = (enrollment.completedMaterials as string[]) ?? []

  // gate เฉพาะครั้งแรกที่ complete material นี้ — legacy completedMaterials (ก่อน migration
  // นี้มี) grandfather ผ่านอัตโนมัติเพราะอยู่ใน currentCompleted แล้ว ไม่ถูกเรียกเช็คซ้ำ
  if (!currentCompleted.includes(materialId)) {
    await checkViewGate(prisma, enrollmentId, material, locale)
  }

  const newCompleted = [...new Set([...currentCompleted, materialId])]

  const { progress, completedMaterials, isComplete } = await recalculateProgress(
    prisma,
    enrollment.courseId,
    userId,
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

  return toEnrollmentResponse(updated, locale)
}

export async function cancelEnrollment(
  prisma: PrismaClient,
  id: string,
  actorId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<void> {
  const enrollment = await prisma.enrollment.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, userId: true, courseId: true },
  })
  if (!enrollment) throw notFound(t('error.enrollment.notFound', undefined, locale))

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
