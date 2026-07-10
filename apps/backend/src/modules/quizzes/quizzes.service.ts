import type { PrismaClient } from '@prisma/client'
import type {
  QuizAdminResponse,
  QuizForUserResponse,
  QuizAttemptResponse,
  CreateQuizInput,
  UpdateQuizInput,
  CreateQuestionInput,
  UpdateQuestionInput,
  AddOptionInput,
  UpdateOptionInput,
  SubmitQuizInput,
} from '@btec-lms/shared'
import { logAudit } from '../../lib/audit.js'
import { notFound, badRequest, forbidden } from '../../lib/errors.js'
import { t, localizeField, type Locale } from '../../lib/i18n.js'

// ─── Helpers ───────────────────────────────────────────────────────────────

function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j]!, copy[i]!]
  }
  return copy
}

// Prisma select ที่ใช้ร่วมกันสำหรับ admin (รวม isCorrect)
const QUIZ_ADMIN_INCLUDE = {
  questions: {
    where: { deletedAt: null },
    orderBy: { order: 'asc' as const },
    include: {
      options: { select: { id: true, textEn: true, textTh: true, isCorrect: true } },
    },
  },
} as const

// Prisma select ที่ใช้สำหรับ USER — layer 1 protection: ไม่ดึง isCorrect จาก DB เลย
const QUIZ_USER_SELECT = {
  id: true,
  courseId: true,
  titleEn: true,
  titleTh: true,
  maxAttempts: true,
  shuffle: true,
  questions: {
    where: { deletedAt: null },
    orderBy: { order: 'asc' as const },
    select: {
      id: true,
      textEn: true,
      textTh: true,
      order: true,
      options: {
        select: {
          id: true,
          textEn: true,
          textTh: true,
          // isCorrect ไม่ select เด็ดขาด
        },
      },
    },
  },
} as const

type QuizWithQuestionsAdmin = {
  id: string
  courseId: string
  titleEn: string
  titleTh: string | null
  maxAttempts: number | null
  shuffle: boolean
  questions: Array<{
    id: string
    textEn: string
    textTh: string | null
    order: number
    options: Array<{ id: string; textEn: string; textTh: string | null; isCorrect: boolean }>
  }>
}

type QuizWithQuestionsUser = {
  id: string
  courseId: string
  titleEn: string
  titleTh: string | null
  maxAttempts: number | null
  shuffle: boolean
  questions: Array<{
    id: string
    textEn: string
    textTh: string | null
    order: number
    options: Array<{ id: string; textEn: string; textTh: string | null }>
  }>
}

// layer 2 protection: map ด้วยมือ — ไม่มีทางที่ isCorrect จะหลุดไปกับ user
function toQuizAdminResponse(quiz: QuizWithQuestionsAdmin, locale: Locale): QuizAdminResponse {
  return {
    id: quiz.id,
    courseId: quiz.courseId,
    title: localizeField(quiz.titleEn, quiz.titleTh, locale),
    titleEn: quiz.titleEn,
    titleTh: quiz.titleTh ?? null,
    maxAttempts: quiz.maxAttempts,
    shuffle: quiz.shuffle,
    questions: quiz.questions.map((q) => ({
      id: q.id,
      text: localizeField(q.textEn, q.textTh, locale),
      textEn: q.textEn,
      textTh: q.textTh ?? null,
      order: q.order,
      options: q.options.map((o) => ({
        id: o.id,
        text: localizeField(o.textEn, o.textTh, locale),
        textEn: o.textEn,
        textTh: o.textTh ?? null,
        isCorrect: o.isCorrect,
      })),
    })),
  }
}

function toQuizForUserResponse(quiz: QuizWithQuestionsUser, locale: Locale): QuizForUserResponse {
  let questions = quiz.questions.map((q) => ({
    id: q.id,
    text: localizeField(q.textEn, q.textTh, locale),
    order: q.order,
    options: q.options.map((o) => ({ id: o.id, text: localizeField(o.textEn, o.textTh, locale) })), // isCorrect ไม่ map เลย
  }))

  if (quiz.shuffle) {
    questions = shuffleArray(questions).map((q) => ({ ...q, options: shuffleArray(q.options) }))
  }

  return {
    id: quiz.id,
    courseId: quiz.courseId,
    title: localizeField(quiz.titleEn, quiz.titleTh, locale),
    maxAttempts: quiz.maxAttempts,
    questions,
  }
}

function toAttemptResponse(a: {
  id: string
  quizId: string
  userId: string
  score: number
  passed: boolean
  answers: unknown
  createdAt: Date
}): QuizAttemptResponse {
  return {
    id: a.id,
    quizId: a.quizId,
    userId: a.userId,
    score: a.score,
    passed: a.passed,
    answers: a.answers as Record<string, string>,
    createdAt: a.createdAt.toISOString(),
  }
}

// ─── Internal: ดึง active quiz + ตรวจ course ───────────────────────────────

async function getActiveQuiz(prisma: PrismaClient, courseId: string) {
  const quiz = await prisma.quiz.findFirst({
    where: { courseId, deletedAt: null },
  })
  return quiz
}

async function requireActiveQuiz(prisma: PrismaClient, courseId: string, locale: Locale = 'en') {
  const quiz = await getActiveQuiz(prisma, courseId)
  if (!quiz) throw notFound(t('error.quiz.notFound', undefined, locale))
  return quiz
}

// ─── Admin: Quiz CRUD ──────────────────────────────────────────────────────

export async function createQuiz(
  prisma: PrismaClient,
  courseId: string,
  input: CreateQuizInput,
  actorId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<QuizAdminResponse> {
  const course = await prisma.course.findFirst({
    where: { id: courseId, deletedAt: null },
    select: { id: true },
  })
  if (!course) throw notFound(t('error.course.notFound', undefined, locale))

  const existing = await getActiveQuiz(prisma, courseId)
  if (existing) throw badRequest(t('error.quiz.alreadyExists', undefined, locale))

  const quiz = await prisma.quiz.create({
    data: {
      courseId,
      titleEn: input.titleEn,
      titleTh: input.titleTh ?? null,
      maxAttempts: input.maxAttempts ?? null,
      shuffle: input.shuffle,
    },
    include: QUIZ_ADMIN_INCLUDE,
  })

  await logAudit(prisma, {
    actorId,
    action: 'QUIZ_CREATE',
    targetType: 'Quiz',
    targetId: quiz.id,
    metadata: { courseId, titleEn: input.titleEn },
    ...(ip != null && { ip }),
  })

  return toQuizAdminResponse(quiz, locale)
}

export async function getQuizAdmin(
  prisma: PrismaClient,
  courseId: string,
  locale: Locale = 'en',
): Promise<QuizAdminResponse> {
  const quiz = await prisma.quiz.findFirst({
    where: { courseId, deletedAt: null },
    include: QUIZ_ADMIN_INCLUDE,
  })
  if (!quiz) throw notFound(t('error.quiz.notFound', undefined, locale))
  return toQuizAdminResponse(quiz, locale)
}

export async function updateQuiz(
  prisma: PrismaClient,
  courseId: string,
  input: UpdateQuizInput,
  actorId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<QuizAdminResponse> {
  const existing = await requireActiveQuiz(prisma, courseId, locale)

  const quiz = await prisma.quiz.update({
    where: { id: existing.id },
    data: {
      ...(input.titleEn != null && { titleEn: input.titleEn }),
      ...('titleTh' in input && { titleTh: input.titleTh ?? null }),
      ...('maxAttempts' in input && { maxAttempts: input.maxAttempts ?? null }),
      ...(input.shuffle != null && { shuffle: input.shuffle }),
    },
    include: QUIZ_ADMIN_INCLUDE,
  })

  await logAudit(prisma, {
    actorId,
    action: 'QUIZ_UPDATE',
    targetType: 'Quiz',
    targetId: quiz.id,
    metadata: input as Record<string, unknown>,
    ...(ip != null && { ip }),
  })

  return toQuizAdminResponse(quiz, locale)
}

export async function deleteQuiz(
  prisma: PrismaClient,
  courseId: string,
  actorId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<void> {
  const quiz = await requireActiveQuiz(prisma, courseId, locale)
  const now = new Date()

  // cascade soft delete questions ด้วย (options ยังอยู่ใน DB แต่ไม่ถูกแสดง)
  await prisma.$transaction([
    prisma.question.updateMany({
      where: { quizId: quiz.id, deletedAt: null },
      data: { deletedAt: now },
    }),
    prisma.quiz.update({
      where: { id: quiz.id },
      data: { deletedAt: now },
    }),
  ])

  await logAudit(prisma, {
    actorId,
    action: 'QUIZ_DELETE',
    targetType: 'Quiz',
    targetId: quiz.id,
    metadata: { courseId },
    ...(ip != null && { ip }),
  })
}

// ─── Admin: Question CRUD ──────────────────────────────────────────────────

export async function addQuestion(
  prisma: PrismaClient,
  courseId: string,
  input: CreateQuestionInput,
  actorId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<QuizAdminResponse> {
  const quiz = await requireActiveQuiz(prisma, courseId, locale)

  // หา order ถัดไปถ้าไม่ได้ระบุมา
  const order =
    input.order ??
    (await prisma.question.count({ where: { quizId: quiz.id, deletedAt: null } }))

  const question = await prisma.question.create({
    data: {
      quizId: quiz.id,
      textEn: input.textEn,
      textTh: input.textTh ?? null,
      order,
      options: { create: input.options.map((o) => ({ textEn: o.textEn, textTh: o.textTh ?? null, isCorrect: o.isCorrect })) },
    },
    select: { id: true },
  })

  await logAudit(prisma, {
    actorId,
    action: 'QUESTION_CREATE',
    targetType: 'Question',
    targetId: question.id,
    metadata: { quizId: quiz.id, courseId },
    ...(ip != null && { ip }),
  })

  // คืน quiz ทั้งหมดอัปเดตแล้ว
  return getQuizAdmin(prisma, courseId, locale)
}

export async function updateQuestion(
  prisma: PrismaClient,
  courseId: string,
  questionId: string,
  input: UpdateQuestionInput,
  actorId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<QuizAdminResponse> {
  const quiz = await requireActiveQuiz(prisma, courseId, locale)
  const question = await prisma.question.findFirst({
    where: { id: questionId, quizId: quiz.id, deletedAt: null },
    select: { id: true },
  })
  if (!question) throw notFound(t('error.question.notFound', undefined, locale))

  await prisma.question.update({
    where: { id: questionId },
    data: {
      ...(input.textEn != null && { textEn: input.textEn }),
      ...('textTh' in input && { textTh: input.textTh ?? null }),
      ...(input.order != null && { order: input.order }),
    },
  })

  await logAudit(prisma, {
    actorId,
    action: 'QUESTION_UPDATE',
    targetType: 'Question',
    targetId: questionId,
    metadata: input as Record<string, unknown>,
    ...(ip != null && { ip }),
  })

  return getQuizAdmin(prisma, courseId, locale)
}

export async function deleteQuestion(
  prisma: PrismaClient,
  courseId: string,
  questionId: string,
  actorId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<void> {
  const quiz = await requireActiveQuiz(prisma, courseId, locale)
  const question = await prisma.question.findFirst({
    where: { id: questionId, quizId: quiz.id, deletedAt: null },
    select: { id: true },
  })
  if (!question) throw notFound(t('error.question.notFound', undefined, locale))

  // soft delete เท่านั้น — ไม่แตะ options (สอดคล้องกับ quiz soft delete)
  await prisma.question.update({
    where: { id: questionId },
    data: { deletedAt: new Date() },
  })

  await logAudit(prisma, {
    actorId,
    action: 'QUESTION_DELETE',
    targetType: 'Question',
    targetId: questionId,
    metadata: { quizId: quiz.id, courseId },
    ...(ip != null && { ip }),
  })
}

// ─── Admin: Option CRUD ────────────────────────────────────────────────────

async function requireQuestionInQuiz(
  prisma: PrismaClient,
  courseId: string,
  questionId: string,
  locale: Locale = 'en',
) {
  const quiz = await requireActiveQuiz(prisma, courseId, locale)
  const question = await prisma.question.findFirst({
    where: { id: questionId, quizId: quiz.id, deletedAt: null },
    select: { id: true },
  })
  if (!question) throw notFound(t('error.question.notFound', undefined, locale))
  return { quiz, question }
}

export async function addOption(
  prisma: PrismaClient,
  courseId: string,
  questionId: string,
  input: AddOptionInput,
  actorId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<QuizAdminResponse> {
  await requireQuestionInQuiz(prisma, courseId, questionId, locale)

  const option = await prisma.option.create({
    data: { questionId, textEn: input.textEn, textTh: input.textTh ?? null, isCorrect: input.isCorrect },
    select: { id: true },
  })

  await logAudit(prisma, {
    actorId,
    action: 'OPTION_CREATE',
    targetType: 'Option',
    targetId: option.id,
    metadata: { questionId, courseId },
    ...(ip != null && { ip }),
  })

  return getQuizAdmin(prisma, courseId, locale)
}

export async function updateOption(
  prisma: PrismaClient,
  courseId: string,
  questionId: string,
  optionId: string,
  input: UpdateOptionInput,
  actorId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<QuizAdminResponse> {
  await requireQuestionInQuiz(prisma, courseId, questionId, locale)

  const option = await prisma.option.findFirst({
    where: { id: optionId, questionId },
    select: { id: true },
  })
  if (!option) throw notFound(t('error.option.notFound', undefined, locale))

  await prisma.option.update({
    where: { id: optionId },
    data: {
      ...(input.textEn != null && { textEn: input.textEn }),
      ...('textTh' in input && { textTh: input.textTh ?? null }),
      ...(input.isCorrect != null && { isCorrect: input.isCorrect }),
    },
  })

  await logAudit(prisma, {
    actorId,
    action: 'OPTION_UPDATE',
    targetType: 'Option',
    targetId: optionId,
    metadata: input as Record<string, unknown>,
    ...(ip != null && { ip }),
  })

  return getQuizAdmin(prisma, courseId, locale)
}

export async function deleteOption(
  prisma: PrismaClient,
  courseId: string,
  questionId: string,
  optionId: string,
  actorId: string,
  locale: Locale = 'en',
  ip?: string,
): Promise<void> {
  await requireQuestionInQuiz(prisma, courseId, questionId, locale)

  const option = await prisma.option.findFirst({
    where: { id: optionId, questionId },
    select: { id: true },
  })
  if (!option) throw notFound(t('error.option.notFound', undefined, locale))

  // hard delete — Option ไม่มี deletedAt (Options ไม่มีความหมายเดี่ยว)
  await prisma.option.delete({ where: { id: optionId } })

  await logAudit(prisma, {
    actorId,
    action: 'OPTION_DELETE',
    targetType: 'Option',
    targetId: optionId,
    metadata: { questionId, courseId },
    ...(ip != null && { ip }),
  })
}

// ─── User: Take + Submit ───────────────────────────────────────────────────

export async function getQuizForUser(
  prisma: PrismaClient,
  courseId: string,
  userId: string,
  locale: Locale = 'en',
): Promise<QuizForUserResponse> {
  // enrollment gate → 403 (ไม่ใช่ 404 — IDOR กัน enumeration quiz ไม่ใช่ประเด็นหลัก)
  const enrollment = await prisma.enrollment.findFirst({
    where: { userId, courseId, deletedAt: null },
    select: { id: true },
  })
  if (!enrollment) throw forbidden(t('error.enrollment.notEnrolled', undefined, locale))

  // layer 1: Prisma select ไม่ดึง isCorrect จาก DB
  const quiz = await prisma.quiz.findFirst({
    where: { courseId, deletedAt: null },
    select: QUIZ_USER_SELECT,
  })
  if (!quiz) throw notFound(t('error.quiz.notFound', undefined, locale))

  // layer 2: toQuizForUserResponse ไม่ map isCorrect
  return toQuizForUserResponse(quiz, locale)
}

export async function submitQuiz(
  prisma: PrismaClient,
  courseId: string,
  userId: string,
  input: SubmitQuizInput,
  locale: Locale = 'en',
  ip?: string,
): Promise<QuizAttemptResponse> {
  // 1. enrollment gate → 403
  const enrollment = await prisma.enrollment.findFirst({
    where: { userId, courseId, deletedAt: null },
    select: { id: true, progress: true, status: true },
  })
  if (!enrollment) throw forbidden(t('error.enrollment.notEnrolled', undefined, locale))

  // 2. ดึง quiz + course.passScore
  const quizWithCourse = await prisma.quiz.findFirst({
    where: { courseId, deletedAt: null },
    select: {
      id: true,
      maxAttempts: true,
      course: { select: { passScore: true } },
      questions: {
        where: { deletedAt: null },
        select: {
          id: true,
          options: { select: { id: true, isCorrect: true } }, // isCorrect สำหรับ grading ภายใน เท่านั้น
        },
      },
    },
  })
  if (!quizWithCourse) throw notFound(t('error.quiz.notFound', undefined, locale))

  // 3. maxAttempts check — นับก่อนสอบ
  if (quizWithCourse.maxAttempts != null) {
    const attemptCount = await prisma.quizAttempt.count({
      where: { quizId: quizWithCourse.id, userId },
    })
    if (attemptCount >= quizWithCourse.maxAttempts) {
      throw badRequest(t('error.quiz.maxAttemptsReached', { count: quizWithCourse.maxAttempts }, locale))
    }
  }

  // 4. สร้าง map ของ valid (questionId → Set<optionId>) สำหรับ validate + grade
  const questionMap = new Map<
    string,
    { options: Map<string, { isCorrect: boolean }> }
  >()
  for (const q of quizWithCourse.questions) {
    const optMap = new Map<string, { isCorrect: boolean }>()
    for (const o of q.options) optMap.set(o.id, { isCorrect: o.isCorrect })
    questionMap.set(q.id, { options: optMap })
  }

  // 5. validate submitted answers — ทุก optionId ต้องเป็นของ questionId ใน quiz นี้จริง
  for (const [qId, oId] of Object.entries(input.answers)) {
    const q = questionMap.get(qId)
    if (!q) throw badRequest(t('error.answer.wrongQuestion', { questionId: qId }, locale))
    if (!q.options.has(oId))
      throw badRequest(t('error.option.wrongQuestion', { optionId: oId, questionId: qId }, locale))
  }

  // 6. auto-grade — ข้อที่ไม่ตอบ = ผิด
  let correct = 0
  for (const [qId, qData] of questionMap) {
    const submittedOptionId = input.answers[qId]
    if (submittedOptionId != null) {
      const opt = qData.options.get(submittedOptionId)
      if (opt?.isCorrect) correct++
    }
    // else: ไม่ตอบ → ผิด
  }

  const total = questionMap.size
  const score = total === 0 ? 0 : Math.round((correct / total) * 100)
  const passScore = quizWithCourse.course.passScore
  const passed = score >= passScore

  // 7. บันทึก attempt
  const attempt = await prisma.quizAttempt.create({
    data: {
      quizId: quizWithCourse.id,
      userId,
      score,
      passed,
      answers: input.answers as object,
    },
  })

  await logAudit(prisma, {
    actorId: userId,
    action: 'QUIZ_SUBMIT',
    targetType: 'QuizAttempt',
    targetId: attempt.id,
    metadata: { quizId: quizWithCourse.id, courseId, score, passed },
    ...(ip != null && { ip }),
  })

  // 8. ถ้าผ่าน + progress 100% → mark enrollment COMPLETED แล้ว auto-issue cert
  if (passed && enrollment.progress >= 100 && enrollment.status !== 'COMPLETED') {
    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    })
    await logAudit(prisma, {
      actorId: userId,
      action: 'ENROLLMENT_COMPLETE',
      targetType: 'Enrollment',
      targetId: enrollment.id,
      metadata: { quizId: quizWithCourse.id, score },
      ...(ip != null && { ip }),
    })
  }

  return toAttemptResponse(attempt)
}

export async function getAttempts(
  prisma: PrismaClient,
  courseId: string,
  requesterId: string,
  requesterRole: string,
  filterUserId?: string,
  locale: Locale = 'en',
): Promise<QuizAttemptResponse[]> {
  const quiz = await getActiveQuiz(prisma, courseId)
  if (!quiz) throw notFound(t('error.quiz.notFound', undefined, locale))

  // USER เห็นแค่ของตัวเอง เสมอ — ไม่สนใจ filterUserId จาก query
  const userId = requesterRole === 'USER' ? requesterId : filterUserId

  // IDOR: ถ้า USER พยายาม filter เป็น userId คนอื่น → 404
  if (requesterRole === 'USER' && filterUserId != null && filterUserId !== requesterId) {
    throw notFound(t('error.quiz.attemptsNotFound', undefined, locale))
  }

  const attempts = await prisma.quizAttempt.findMany({
    where: {
      quizId: quiz.id,
      ...(userId != null && { userId }),
    },
    orderBy: { createdAt: 'desc' },
  })

  // PDPA: log admin access to other users' attempt data (behavioral personal data)
  if (requesterRole !== 'USER') {
    await logAudit(prisma, {
      actorId: requesterId,
      action: 'QUIZ_ATTEMPTS_VIEW',
      targetType: 'QuizAttempt',
      targetId: quiz.id,
      metadata: { courseId, filterUserId: filterUserId ?? 'all' },
    })
  }

  return attempts.map(toAttemptResponse)
}
