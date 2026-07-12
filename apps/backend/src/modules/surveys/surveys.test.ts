import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildTestApp, createUser, loginAs, prisma } from '../../test/helpers.js'
import type { TestApp } from '../../test/helpers.js'

type Actor = { cookies: string; userId: string }

let app: TestApp

beforeAll(async () => {
  app = await buildTestApp()
})

afterAll(async () => {
  await app.close()
})

// ─── Helpers ───────────────────────────────────────────────────────────────

async function setup(role: 'ADMIN' | 'USER' = 'USER'): Promise<Actor> {
  const { user, plainPassword } = await createUser({ role })
  const { cookies } = await loginAs(app, user.email, plainPassword)
  return { cookies, userId: user.id }
}

async function createCourse(adminCookies: string): Promise<{ id: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/courses',
    headers: { cookie: adminCookies },
    payload: { titleEn: 'Test Course', categoryEn: 'Safety' },
  })
  expect(res.statusCode).toBe(201)
  return res.json()
}

// publish ต้องมี quiz ≥1 คำถามก่อนเสมอ (2A) — quiz ที่นี่ไม่เกี่ยวกับสิ่งที่ทดสอบ แค่ทำให้ enroll() ได้
async function publishWithThrowawayQuiz(adminCookies: string, courseId: string) {
  await app.inject({
    method: 'POST',
    url: `/courses/${courseId}/quiz`,
    headers: { cookie: adminCookies },
    payload: { titleEn: 'Throwaway Quiz', passScore: 50 },
  })
  await app.inject({
    method: 'POST',
    url: `/courses/${courseId}/quiz/questions`,
    headers: { cookie: adminCookies },
    payload: {
      textEn: 'Q1',
      options: [
        { textEn: 'A', isCorrect: true },
        { textEn: 'B', isCorrect: false },
      ],
    },
  })
  const res = await app.inject({
    method: 'PATCH',
    url: `/courses/${courseId}/status`,
    headers: { cookie: adminCookies },
    payload: { status: 'PUBLISHED' },
  })
  expect(res.statusCode).toBe(200)
}

async function enroll(adminCookies: string, userId: string, courseId: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/enrollments',
    headers: { cookie: adminCookies },
    payload: { userId, courseId },
  })
  expect(res.statusCode).toBe(201)
  return res.json()
}

async function createSurveyWithQuestions(adminCookies: string, courseId: string) {
  const surveyRes = await app.inject({
    method: 'POST',
    url: `/courses/${courseId}/survey`,
    headers: { cookie: adminCookies },
  })
  expect(surveyRes.statusCode).toBe(201)

  const q1Res = await app.inject({
    method: 'POST',
    url: `/courses/${courseId}/survey/questions`,
    headers: { cookie: adminCookies },
    payload: { type: 'RATING', textEn: 'How would you rate this course?' },
  })
  expect(q1Res.statusCode).toBe(201)

  const q2Res = await app.inject({
    method: 'POST',
    url: `/courses/${courseId}/survey/questions`,
    headers: { cookie: adminCookies },
    payload: { type: 'TEXT', textEn: 'Any comments?' },
  })
  expect(q2Res.statusCode).toBe(201)
  const survey = q2Res.json()

  const ratingQ = survey.questions.find((q: { type: string }) => q.type === 'RATING')
  const textQ = survey.questions.find((q: { type: string }) => q.type === 'TEXT')

  return { surveyId: survey.id as string, ratingQId: ratingQ.id as string, textQId: textQ.id as string }
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('Surveys module', () => {
  describe('Admin: Survey CRUD', () => {
    it('creates survey for course → 201', async () => {
      const admin = await setup('ADMIN')
      const course = await createCourse(admin.cookies)

      const res = await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/survey`,
        headers: { cookie: admin.cookies },
      })
      expect(res.statusCode).toBe(201)
      expect(res.json().questions).toEqual([])
    })

    it('rejects duplicate survey for same course → 400', async () => {
      const admin = await setup('ADMIN')
      const course = await createCourse(admin.cookies)

      await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/survey`,
        headers: { cookie: admin.cookies },
      })
      const res = await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/survey`,
        headers: { cookie: admin.cookies },
      })
      expect(res.statusCode).toBe(400)
    })

    it('USER cannot create survey → 403', async () => {
      const admin = await setup('ADMIN')
      const user = await setup('USER')
      const course = await createCourse(admin.cookies)

      const res = await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/survey`,
        headers: { cookie: user.cookies },
      })
      expect(res.statusCode).toBe(403)
    })

    it('adds RATING and TEXT questions → returns updated survey', async () => {
      const admin = await setup('ADMIN')
      const course = await createCourse(admin.cookies)
      const { ratingQId, textQId } = await createSurveyWithQuestions(admin.cookies, course.id)

      expect(ratingQId).toBeTruthy()
      expect(textQId).toBeTruthy()
    })

    it('updates survey question text → 200', async () => {
      const admin = await setup('ADMIN')
      const course = await createCourse(admin.cookies)
      const { ratingQId } = await createSurveyWithQuestions(admin.cookies, course.id)

      const res = await app.inject({
        method: 'PATCH',
        url: `/courses/${course.id}/survey/questions/${ratingQId}`,
        headers: { cookie: admin.cookies },
        payload: { textEn: 'Updated rating question' },
      })
      expect(res.statusCode).toBe(200)
      const found = res.json().questions.find((q: { id: string }) => q.id === ratingQId)
      expect(found.text).toBe('Updated rating question')
    })

    it('soft-deletes survey question → gone, other questions remain', async () => {
      const admin = await setup('ADMIN')
      const course = await createCourse(admin.cookies)
      const { ratingQId } = await createSurveyWithQuestions(admin.cookies, course.id)

      const delRes = await app.inject({
        method: 'DELETE',
        url: `/courses/${course.id}/survey/questions/${ratingQId}`,
        headers: { cookie: admin.cookies },
      })
      expect(delRes.statusCode).toBe(200)

      const getRes = await app.inject({
        method: 'GET',
        url: `/courses/${course.id}/survey`,
        headers: { cookie: admin.cookies },
      })
      const survey = getRes.json()
      expect(survey.questions.find((q: { id: string }) => q.id === ratingQId)).toBeUndefined()
      expect(survey.questions).toHaveLength(1) // TEXT question remains
    })

    it('soft-deletes survey → 404 on subsequent GET', async () => {
      const admin = await setup('ADMIN')
      const course = await createCourse(admin.cookies)
      await createSurveyWithQuestions(admin.cookies, course.id)

      await app.inject({
        method: 'DELETE',
        url: `/courses/${course.id}/survey`,
        headers: { cookie: admin.cookies },
      })

      const getRes = await app.inject({
        method: 'GET',
        url: `/courses/${course.id}/survey`,
        headers: { cookie: admin.cookies },
      })
      expect(getRes.statusCode).toBe(404)
    })
  })

  describe('Enrollment gate', () => {
    it('GET /survey/take without enrollment → 403', async () => {
      const admin = await setup('ADMIN')
      const user = await setup('USER')
      const course = await createCourse(admin.cookies)
      await createSurveyWithQuestions(admin.cookies, course.id)

      const res = await app.inject({
        method: 'GET',
        url: `/courses/${course.id}/survey/take`,
        headers: { cookie: user.cookies },
      })
      expect(res.statusCode).toBe(403)
    })

    it('POST /survey/submit without enrollment → 403', async () => {
      const admin = await setup('ADMIN')
      const user = await setup('USER')
      const course = await createCourse(admin.cookies)
      const { ratingQId } = await createSurveyWithQuestions(admin.cookies, course.id)

      const res = await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/survey/submit`,
        headers: { cookie: user.cookies },
        payload: { answers: { [ratingQId]: 5 } },
      })
      expect(res.statusCode).toBe(403)
    })
  })

  describe('Submit validation', () => {
    it('missing RATING answer → 400', async () => {
      const admin = await setup('ADMIN')
      const user = await setup('USER')
      const course = await createCourse(admin.cookies)
      const { textQId } = await createSurveyWithQuestions(admin.cookies, course.id)
      await publishWithThrowawayQuiz(admin.cookies, course.id)
      await enroll(admin.cookies, user.userId, course.id)

      const res = await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/survey/submit`,
        headers: { cookie: user.cookies },
        payload: { answers: { [textQId]: 'nice course' } }, // no rating
      })
      expect(res.statusCode).toBe(400)
    })

    it('TEXT question omitted (optional) → 201, still accepted', async () => {
      const admin = await setup('ADMIN')
      const user = await setup('USER')
      const course = await createCourse(admin.cookies)
      const { ratingQId } = await createSurveyWithQuestions(admin.cookies, course.id)
      await publishWithThrowawayQuiz(admin.cookies, course.id)
      await enroll(admin.cookies, user.userId, course.id)

      const res = await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/survey/submit`,
        headers: { cookie: user.cookies },
        payload: { answers: { [ratingQId]: 4 } }, // TEXT omitted
      })
      expect(res.statusCode).toBe(201)
    })

    it('answer references a foreign questionId → 400', async () => {
      const admin = await setup('ADMIN')
      const user = await setup('USER')
      const course = await createCourse(admin.cookies)
      await createSurveyWithQuestions(admin.cookies, course.id)
      await publishWithThrowawayQuiz(admin.cookies, course.id)
      await enroll(admin.cookies, user.userId, course.id)

      const res = await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/survey/submit`,
        headers: { cookie: user.cookies },
        payload: { answers: { 'cm0000000000000000000000a': 5 } },
      })
      expect(res.statusCode).toBe(400)
    })

    it('submitting twice → second attempt 400 (already submitted)', async () => {
      const admin = await setup('ADMIN')
      const user = await setup('USER')
      const course = await createCourse(admin.cookies)
      const { ratingQId } = await createSurveyWithQuestions(admin.cookies, course.id)
      await publishWithThrowawayQuiz(admin.cookies, course.id)
      await enroll(admin.cookies, user.userId, course.id)

      const first = await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/survey/submit`,
        headers: { cookie: user.cookies },
        payload: { answers: { [ratingQId]: 5 } },
      })
      expect(first.statusCode).toBe(201)

      const second = await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/survey/submit`,
        headers: { cookie: user.cookies },
        payload: { answers: { [ratingQId]: 3 } },
      })
      expect(second.statusCode).toBe(400)
    })

    it('GET /survey/take reflects alreadySubmitted flag before/after submit', async () => {
      const admin = await setup('ADMIN')
      const user = await setup('USER')
      const course = await createCourse(admin.cookies)
      const { ratingQId } = await createSurveyWithQuestions(admin.cookies, course.id)
      await publishWithThrowawayQuiz(admin.cookies, course.id)
      await enroll(admin.cookies, user.userId, course.id)

      const before = await app.inject({
        method: 'GET',
        url: `/courses/${course.id}/survey/take`,
        headers: { cookie: user.cookies },
      })
      expect(before.json().alreadySubmitted).toBe(false)

      await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/survey/submit`,
        headers: { cookie: user.cookies },
        payload: { answers: { [ratingQId]: 5 } },
      })

      const after = await app.inject({
        method: 'GET',
        url: `/courses/${course.id}/survey/take`,
        headers: { cookie: user.cookies },
      })
      expect(after.json().alreadySubmitted).toBe(true)
    })

    it('USER /survey/take response has no textEn/textTh raw fields', async () => {
      const admin = await setup('ADMIN')
      const user = await setup('USER')
      const course = await createCourse(admin.cookies)
      await createSurveyWithQuestions(admin.cookies, course.id)
      await publishWithThrowawayQuiz(admin.cookies, course.id)
      await enroll(admin.cookies, user.userId, course.id)

      const res = await app.inject({
        method: 'GET',
        url: `/courses/${course.id}/survey/take`,
        headers: { cookie: user.cookies },
      })
      const q = res.json().questions[0]
      expect(q.text).toBeDefined()
      expect('textEn' in q).toBe(false)
      expect('textTh' in q).toBe(false)
    })
  })

  describe('Responses — IDOR', () => {
    it('USER gets own responses → 200, list contains only own', async () => {
      const admin = await setup('ADMIN')
      const user = await setup('USER')
      const course = await createCourse(admin.cookies)
      const { ratingQId } = await createSurveyWithQuestions(admin.cookies, course.id)
      await publishWithThrowawayQuiz(admin.cookies, course.id)
      await enroll(admin.cookies, user.userId, course.id)

      await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/survey/submit`,
        headers: { cookie: user.cookies },
        payload: { answers: { [ratingQId]: 5 } },
      })

      const res = await app.inject({
        method: 'GET',
        url: `/courses/${course.id}/survey/responses`,
        headers: { cookie: user.cookies },
      })
      expect(res.statusCode).toBe(200)
      const responses = res.json()
      expect(responses).toHaveLength(1)
      expect(responses[0].userId).toBe(user.userId)
    })

    it('USER passes ?userId=other → 404 (prevents IDOR enumeration)', async () => {
      const admin = await setup('ADMIN')
      const user1 = await setup('USER')
      const user2 = await setup('USER')
      const course = await createCourse(admin.cookies)
      await createSurveyWithQuestions(admin.cookies, course.id)
      await publishWithThrowawayQuiz(admin.cookies, course.id)
      await enroll(admin.cookies, user1.userId, course.id)

      const res = await app.inject({
        method: 'GET',
        url: `/courses/${course.id}/survey/responses?userId=${user2.userId}`,
        headers: { cookie: user1.cookies },
      })
      expect(res.statusCode).toBe(404)
    })

    it('ADMIN sees all responses from all users', async () => {
      const admin = await setup('ADMIN')
      const user1 = await setup('USER')
      const user2 = await setup('USER')
      const course = await createCourse(admin.cookies)
      const { ratingQId } = await createSurveyWithQuestions(admin.cookies, course.id)
      await publishWithThrowawayQuiz(admin.cookies, course.id)
      await enroll(admin.cookies, user1.userId, course.id)
      await enroll(admin.cookies, user2.userId, course.id)

      await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/survey/submit`,
        headers: { cookie: user1.cookies },
        payload: { answers: { [ratingQId]: 5 } },
      })
      await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/survey/submit`,
        headers: { cookie: user2.cookies },
        payload: { answers: { [ratingQId]: 2 } },
      })

      const res = await app.inject({
        method: 'GET',
        url: `/courses/${course.id}/survey/responses`,
        headers: { cookie: admin.cookies },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toHaveLength(2)
    })

    it('ADMIN filters by ?userId → only that user\'s response', async () => {
      const admin = await setup('ADMIN')
      const user1 = await setup('USER')
      const user2 = await setup('USER')
      const course = await createCourse(admin.cookies)
      const { ratingQId } = await createSurveyWithQuestions(admin.cookies, course.id)
      await publishWithThrowawayQuiz(admin.cookies, course.id)
      await enroll(admin.cookies, user1.userId, course.id)
      await enroll(admin.cookies, user2.userId, course.id)

      await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/survey/submit`,
        headers: { cookie: user1.cookies },
        payload: { answers: { [ratingQId]: 5 } },
      })
      await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/survey/submit`,
        headers: { cookie: user2.cookies },
        payload: { answers: { [ratingQId]: 2 } },
      })

      const res = await app.inject({
        method: 'GET',
        url: `/courses/${course.id}/survey/responses?userId=${user1.userId}`,
        headers: { cookie: admin.cookies },
      })
      expect(res.statusCode).toBe(200)
      const responses = res.json()
      expect(responses).toHaveLength(1)
      expect(responses[0].userId).toBe(user1.userId)
    })
  })

  // ─── COMPLETED gate — 2B: survey optional, only gates if course has one ────

  describe('COMPLETED gate (survey optional)', () => {
    it('course WITH survey: quiz passed but survey not submitted → stays IN_PROGRESS; submitting survey → COMPLETED', async () => {
      const admin = await setup('ADMIN')
      const user = await setup('USER')
      const course = await createCourse(admin.cookies)

      // quiz (with a question) so publish gate is satisfiable (2A) — course must be PUBLISHED before enroll() works
      const quizRes = await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/quiz`,
        headers: { cookie: admin.cookies },
        payload: { titleEn: 'Quiz', passScore: 50 },
      })
      expect(quizRes.statusCode).toBe(201)
      const qRes = await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/quiz/questions`,
        headers: { cookie: admin.cookies },
        payload: {
          textEn: 'Q1',
          options: [
            { textEn: 'Correct', isCorrect: true },
            { textEn: 'Wrong', isCorrect: false },
          ],
        },
      })
      const quiz = qRes.json()
      const question = quiz.questions[0]
      const correctOptionId = question.options.find((o: { isCorrect: boolean }) => o.isCorrect).id

      const { ratingQId } = await createSurveyWithQuestions(admin.cookies, course.id)

      const publishRes = await app.inject({
        method: 'PATCH',
        url: `/courses/${course.id}/status`,
        headers: { cookie: admin.cookies },
        payload: { status: 'PUBLISHED' },
      })
      expect(publishRes.statusCode).toBe(200)

      const enrollment = await enroll(admin.cookies, user.userId, course.id)
      await prisma.enrollment.update({ where: { id: enrollment.id }, data: { progress: 100 } })

      // pass the quiz
      const quizSubmitRes = await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/quiz/submit`,
        headers: { cookie: user.cookies },
        payload: { answers: { [question.id]: correctOptionId } },
      })
      expect(quizSubmitRes.json().passed).toBe(true)

      // enrollment must NOT be COMPLETED yet — survey still outstanding
      const afterQuiz = await prisma.enrollment.findUnique({ where: { id: enrollment.id }, select: { status: true } })
      expect(afterQuiz?.status).not.toBe('COMPLETED')

      // submit survey → now COMPLETED
      const surveySubmitRes = await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/survey/submit`,
        headers: { cookie: user.cookies },
        payload: { answers: { [ratingQId]: 5 } },
      })
      expect(surveySubmitRes.statusCode).toBe(201)

      const afterSurvey = await prisma.enrollment.findUnique({
        where: { id: enrollment.id },
        select: { status: true, completedAt: true },
      })
      expect(afterSurvey?.status).toBe('COMPLETED')
      expect(afterSurvey?.completedAt).not.toBeNull()
    })

    it('course WITHOUT survey: quiz passed + progress 100% → COMPLETED immediately (unchanged from 2A)', async () => {
      const admin = await setup('ADMIN')
      const user = await setup('USER')
      const course = await createCourse(admin.cookies)

      const quizRes = await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/quiz`,
        headers: { cookie: admin.cookies },
        payload: { titleEn: 'Quiz', passScore: 50 },
      })
      expect(quizRes.statusCode).toBe(201)
      const qRes = await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/quiz/questions`,
        headers: { cookie: admin.cookies },
        payload: {
          textEn: 'Q1',
          options: [
            { textEn: 'Correct', isCorrect: true },
            { textEn: 'Wrong', isCorrect: false },
          ],
        },
      })
      const quiz = qRes.json()
      const question = quiz.questions[0]
      const correctOptionId = question.options.find((o: { isCorrect: boolean }) => o.isCorrect).id

      // no survey created for this course

      const publishRes = await app.inject({
        method: 'PATCH',
        url: `/courses/${course.id}/status`,
        headers: { cookie: admin.cookies },
        payload: { status: 'PUBLISHED' },
      })
      expect(publishRes.statusCode).toBe(200)

      const enrollment = await enroll(admin.cookies, user.userId, course.id)
      await prisma.enrollment.update({ where: { id: enrollment.id }, data: { progress: 100 } })

      const quizSubmitRes = await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/quiz/submit`,
        headers: { cookie: user.cookies },
        payload: { answers: { [question.id]: correctOptionId } },
      })
      expect(quizSubmitRes.json().passed).toBe(true)

      const updated = await prisma.enrollment.findUnique({
        where: { id: enrollment.id },
        select: { status: true, completedAt: true },
      })
      expect(updated?.status).toBe('COMPLETED')
      expect(updated?.completedAt).not.toBeNull()
    })
  })
})
