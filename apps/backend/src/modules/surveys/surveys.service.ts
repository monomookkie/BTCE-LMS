import { Prisma } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'
import type {
  SurveyAdminResponse,
  SurveyForUserResponse,
  CreateSurveyQuestionInput,
  UpdateSurveyQuestionInput,
  SubmitSurveyInput,
  SurveyResponseRecord,
} from '@btec-lms/shared'
import { logAudit } from '../../lib/audit.js'
import { notFound, badRequest, forbidden } from '../../lib/errors.js'
import { t, localizeField, type Locale } from '../../lib/i18n.js'
import { checkCanComplete } from '../enrollments/enrollments.service.js'

// ─── Internal: ดึง active survey ของ course ──────────────────────────────────

export async function getActiveSurvey(prisma: PrismaClient, courseId: string) {
  return prisma.survey.findFirst({ where: { courseId, deletedAt: null } })
}

async function requireActiveSurvey(prisma: PrismaClient, courseId: string, locale: Locale = 'en') {
  const survey = await getActiveSurvey(prisma, courseId)
  if (!survey) throw notFound(t('error.survey.notFound', undefined, locale))
  return survey
}

// ─── Serialization ────────────────────────────────────────────────────────

const SURVEY_ADMIN_INCLUDE = {
  questions: {
    where: { deletedAt: null },
    orderBy: { order: 'asc' as const },
  },
} as const

type SurveyWithQuestions = {
  id: string
  courseId: string
  questions: Array<{
    id: string
    type: 'RATING' | 'TEXT'
    textEn: string
    textTh: string | null
    order: number
  }>
}

function toSurveyAdminResponse(survey: SurveyWithQuestions, locale: Locale): SurveyAdminResponse {
  return {
    id: survey.id,
    courseId: survey.courseId,
    questions: survey.questions.map((q) => ({
      id: q.id,
      type: q.type,
      text: localizeField(q.textEn, q.textTh, locale),
      textEn: q.textEn,
      textTh: q.textTh ?? null,
      order: q.order,
    })),
  }
}

function toSurveyForUserResponse(
  survey: SurveyWithQuestions,
  locale: Locale,
  alreadySubmitted: boolean,
): SurveyForUserResponse {
  return {
    id: survey.id,
    courseId: survey.courseId,
    questions: survey.questions.map((q) => ({
      id: q.id,
      type: q.type,
      text: localizeField(q.textEn, q.textTh, locale),
      order: q.order,
    })),
    alreadySubmitted,
  }
}

function toResponseRecord(r: {
  id: string
  surveyId: string
  userId: string
  answers: unknown
  createdAt: Date
}): SurveyResponseRecord {
  return {
    id: r.id,
    surveyId: r.surveyId,
    userId: r.userId,
    answers: r.answers as Record<string, number | string>,
    createdAt: r.createdAt.toISOString(),
  }
}

// ─── Admin: Survey CRUD ─────────────────────────────────────────────────────

export async function createSurvey(
  prisma: PrismaClient,
  courseId: string,
  actorId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<SurveyAdminResponse> {
  const course = await prisma.course.findFirst({
    where: { id: courseId, deletedAt: null },
    select: { id: true },
  })
  if (!course) throw notFound(t('error.course.notFound', undefined, locale))

  const existing = await getActiveSurvey(prisma, courseId)
  if (existing) throw badRequest(t('error.survey.alreadyExists', undefined, locale))

  // courseId มี unique constraint — ถ้าเคยสร้าง survey ให้ course นี้มาก่อนแล้วถูกลบ (soft-delete)
  // row เก่ายังอยู่ใน DB (เพื่อรักษา SurveyResponse ประวัติไว้ให้ report) การ create ใหม่จะชน unique constraint
  // ต้อง "revive" row เดิมแทนแทนการ insert ใหม่
  const existingAny = await prisma.survey.findUnique({ where: { courseId } })
  const survey = existingAny
    ? await prisma.survey.update({
        where: { id: existingAny.id },
        data: { deletedAt: null },
        include: SURVEY_ADMIN_INCLUDE,
      })
    : await prisma.survey.create({
        data: { courseId },
        include: SURVEY_ADMIN_INCLUDE,
      })

  await logAudit(prisma, {
    actorId,
    action: 'SURVEY_CREATE',
    targetType: 'Survey',
    targetId: survey.id,
    metadata: { courseId },
    ...(ip != null && { ip }),
  })

  return toSurveyAdminResponse(survey, locale)
}

export async function getSurveyAdmin(
  prisma: PrismaClient,
  courseId: string,
  locale: Locale = 'en',
): Promise<SurveyAdminResponse> {
  const survey = await prisma.survey.findFirst({
    where: { courseId, deletedAt: null },
    include: SURVEY_ADMIN_INCLUDE,
  })
  if (!survey) throw notFound(t('error.survey.notFound', undefined, locale))
  return toSurveyAdminResponse(survey, locale)
}

export async function deleteSurvey(
  prisma: PrismaClient,
  courseId: string,
  actorId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<void> {
  const survey = await requireActiveSurvey(prisma, courseId, locale)
  const now = new Date()

  await prisma.$transaction([
    prisma.surveyQuestion.updateMany({
      where: { surveyId: survey.id, deletedAt: null },
      data: { deletedAt: now },
    }),
    prisma.survey.update({
      where: { id: survey.id },
      data: { deletedAt: now },
    }),
  ])

  await logAudit(prisma, {
    actorId,
    action: 'SURVEY_DELETE',
    targetType: 'Survey',
    targetId: survey.id,
    metadata: { courseId },
    ...(ip != null && { ip }),
  })
}

// ─── Admin: Question CRUD ───────────────────────────────────────────────────

export async function addSurveyQuestion(
  prisma: PrismaClient,
  courseId: string,
  input: CreateSurveyQuestionInput,
  actorId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<SurveyAdminResponse> {
  const survey = await requireActiveSurvey(prisma, courseId, locale)

  const order =
    input.order ??
    (await prisma.surveyQuestion.count({ where: { surveyId: survey.id, deletedAt: null } }))

  const question = await prisma.surveyQuestion.create({
    data: {
      surveyId: survey.id,
      type: input.type,
      textEn: input.textEn,
      textTh: input.textTh ?? null,
      order,
    },
    select: { id: true },
  })

  await logAudit(prisma, {
    actorId,
    action: 'SURVEY_QUESTION_CREATE',
    targetType: 'SurveyQuestion',
    targetId: question.id,
    metadata: { surveyId: survey.id, courseId },
    ...(ip != null && { ip }),
  })

  return getSurveyAdmin(prisma, courseId, locale)
}

export async function updateSurveyQuestion(
  prisma: PrismaClient,
  courseId: string,
  questionId: string,
  input: UpdateSurveyQuestionInput,
  actorId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<SurveyAdminResponse> {
  const survey = await requireActiveSurvey(prisma, courseId, locale)
  const question = await prisma.surveyQuestion.findFirst({
    where: { id: questionId, surveyId: survey.id, deletedAt: null },
    select: { id: true },
  })
  if (!question) throw notFound(t('error.surveyQuestion.notFound', undefined, locale))

  await prisma.surveyQuestion.update({
    where: { id: questionId },
    data: {
      ...(input.type != null && { type: input.type }),
      ...(input.textEn != null && { textEn: input.textEn }),
      ...('textTh' in input && { textTh: input.textTh ?? null }),
      ...(input.order != null && { order: input.order }),
    },
  })

  await logAudit(prisma, {
    actorId,
    action: 'SURVEY_QUESTION_UPDATE',
    targetType: 'SurveyQuestion',
    targetId: questionId,
    metadata: input as Record<string, unknown>,
    ...(ip != null && { ip }),
  })

  return getSurveyAdmin(prisma, courseId, locale)
}

export async function deleteSurveyQuestion(
  prisma: PrismaClient,
  courseId: string,
  questionId: string,
  actorId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<void> {
  const survey = await requireActiveSurvey(prisma, courseId, locale)
  const question = await prisma.surveyQuestion.findFirst({
    where: { id: questionId, surveyId: survey.id, deletedAt: null },
    select: { id: true },
  })
  if (!question) throw notFound(t('error.surveyQuestion.notFound', undefined, locale))

  await prisma.surveyQuestion.update({
    where: { id: questionId },
    data: { deletedAt: new Date() },
  })

  await logAudit(prisma, {
    actorId,
    action: 'SURVEY_QUESTION_DELETE',
    targetType: 'SurveyQuestion',
    targetId: questionId,
    metadata: { surveyId: survey.id, courseId },
    ...(ip != null && { ip }),
  })
}

// ─── User: Take + Submit ─────────────────────────────────────────────────────

export async function getSurveyForUser(
  prisma: PrismaClient,
  courseId: string,
  userId: string,
  locale: Locale = 'en',
): Promise<SurveyForUserResponse> {
  const enrollment = await prisma.enrollment.findFirst({
    where: { userId, courseId, deletedAt: null },
    select: { id: true },
  })
  if (!enrollment) throw forbidden(t('error.enrollment.notEnrolled', undefined, locale))

  const survey = await prisma.survey.findFirst({
    where: { courseId, deletedAt: null },
    include: SURVEY_ADMIN_INCLUDE,
  })
  if (!survey) throw notFound(t('error.survey.notFound', undefined, locale))

  const existing = await prisma.surveyResponse.findFirst({
    where: { surveyId: survey.id, userId },
    select: { id: true },
  })

  return toSurveyForUserResponse(survey, locale, existing != null)
}

export async function submitSurvey(
  prisma: PrismaClient,
  courseId: string,
  userId: string,
  input: SubmitSurveyInput,
  locale: Locale = 'en',
  ip?: string,
): Promise<SurveyResponseRecord> {
  // 1. enrollment gate → 403
  const enrollment = await prisma.enrollment.findFirst({
    where: { userId, courseId, deletedAt: null },
    select: { id: true, status: true, progress: true },
  })
  if (!enrollment) throw forbidden(t('error.enrollment.notEnrolled', undefined, locale))

  // 2. ดึง survey + questions
  const survey = await prisma.survey.findFirst({
    where: { courseId, deletedAt: null },
    select: {
      id: true,
      questions: {
        where: { deletedAt: null },
        select: { id: true, type: true },
      },
    },
  })
  if (!survey) throw notFound(t('error.survey.notFound', undefined, locale))

  // 3. ตอบได้ครั้งเดียว
  const existing = await prisma.surveyResponse.findFirst({
    where: { surveyId: survey.id, userId },
    select: { id: true },
  })
  if (existing) throw badRequest(t('error.survey.alreadySubmitted', undefined, locale))

  // 4. validate: ทุก RATING question ต้องตอบ (1-5), TEXT ไม่บังคับ
  //    answers ที่ไม่ตรงกับ questionId ในแบบสำรวจนี้ → reject (กัน cross-survey injection)
  const validQuestionIds = new Set(survey.questions.map((q) => q.id))
  for (const qId of Object.keys(input.answers)) {
    if (!validQuestionIds.has(qId)) {
      throw badRequest(t('error.answer.wrongQuestion', { questionId: qId }, locale))
    }
  }

  const ratingQuestions = survey.questions.filter((q) => q.type === 'RATING')
  for (const q of ratingQuestions) {
    const answer = input.answers[q.id]
    if (typeof answer !== 'number') {
      throw badRequest(t('error.survey.ratingRequired', undefined, locale))
    }
  }

  // 5. บันทึก response — กัน race condition: ถ้าสอง request ชนกันจนหลุด check ข้อ 3 ไป
  //    DB unique constraint (surveyId, userId) จะ throw P2002 แทน ต้อง catch ให้เป็น 400 ที่เข้าใจง่าย
  let response
  try {
    response = await prisma.surveyResponse.create({
      data: {
        surveyId: survey.id,
        userId,
        answers: input.answers as object,
      },
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw badRequest(t('error.survey.alreadySubmitted', undefined, locale))
    }
    throw err
  }

  await logAudit(prisma, {
    actorId: userId,
    action: 'SURVEY_SUBMIT',
    targetType: 'SurveyResponse',
    targetId: response.id,
    metadata: { surveyId: survey.id, courseId },
    ...(ip != null && { ip }),
  })

  // 6. ถ้า status ยังไม่ COMPLETED → เช็คเงื่อนไขรวม (progress 100% + quiz passed ถ้ามี + survey ตอบแล้ว)
  //    survey มักเป็นขั้นตอนสุดท้าย — เป็น trigger ที่ 3 คู่กับ markMaterialComplete และ submitQuiz
  if (enrollment.status !== 'COMPLETED') {
    const canComplete = await checkCanComplete(prisma, courseId, userId, enrollment.progress)
    if (canComplete) {
      await prisma.enrollment.update({
        where: { id: enrollment.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      })
      await logAudit(prisma, {
        actorId: userId,
        action: 'ENROLLMENT_COMPLETE',
        targetType: 'Enrollment',
        targetId: enrollment.id,
        metadata: { surveyId: survey.id },
        ...(ip != null && { ip }),
      })
    }
  }

  return toResponseRecord(response)
}

// ─── Admin: view responses (report) ──────────────────────────────────────────

export async function getSurveyResponses(
  prisma: PrismaClient,
  courseId: string,
  requesterId: string,
  requesterRole: string,
  filterUserId: string | undefined,
  locale: Locale = 'en',
): Promise<SurveyResponseRecord[]> {
  // ไม่กรอง deletedAt: response ของแบบสำรวจที่ถูกลบไปแล้วยังต้องดูได้ (เพื่อ report ข้อ 4 ไม่เสีย)
  const survey = await prisma.survey.findUnique({ where: { courseId } })
  if (!survey) throw notFound(t('error.survey.notFound', undefined, locale))

  // USER เห็นแค่ของตัวเอง เสมอ — ไม่สนใจ filterUserId จาก query
  const userId = requesterRole === 'USER' ? requesterId : filterUserId

  // IDOR: ถ้า USER พยายาม filter เป็น userId คนอื่น → 404
  if (requesterRole === 'USER' && filterUserId != null && filterUserId !== requesterId) {
    throw notFound(t('error.survey.responsesNotFound', undefined, locale))
  }

  const responses = await prisma.surveyResponse.findMany({
    where: {
      surveyId: survey.id,
      ...(userId != null && { userId }),
    },
    orderBy: { createdAt: 'desc' },
  })

  // PDPA: log admin access to other users' survey answers
  if (requesterRole !== 'USER') {
    await logAudit(prisma, {
      actorId: requesterId,
      action: 'SURVEY_RESPONSES_VIEW',
      targetType: 'SurveyResponse',
      targetId: survey.id,
      metadata: { courseId, filterUserId: filterUserId ?? 'all' },
    })
  }

  return responses.map(toResponseRecord)
}
