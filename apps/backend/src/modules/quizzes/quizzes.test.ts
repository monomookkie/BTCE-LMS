import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildTestApp, createUser, loginAs, prisma } from '../../test/helpers.js'
import type { TestApp } from '../../test/helpers.js'

// Minimal shapes for API JSON responses (avoid any)
type ApiOption = { id: string; text: string; isCorrect?: boolean }
type ApiQuestion = { id: string; text: string; order: number; options: ApiOption[] }

// ─── Helpers ───────────────────────────────────────────────────────────────

type Actor = { cookies: string; userId: string }

async function setup(role: 'ADMIN' | 'USER' = 'USER'): Promise<Actor> {
  const { user, plainPassword } = await createUser({ role })
  const { cookies } = await loginAs(app, user.email, plainPassword)
  return { cookies, userId: user.id }
}

async function createCourse(adminCookies: string, passScore = 80): Promise<{ id: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/courses',
    headers: { cookie: adminCookies },
    payload: { titleEn: 'Test Course', categoryEn: 'Safety', passScore },
  })
  expect(res.statusCode).toBe(201)
  const course = res.json()

  await app.inject({
    method: 'PATCH',
    url: `/courses/${course.id}/status`,
    headers: { cookie: adminCookies },
    payload: { status: 'PUBLISHED' },
  })
  return course
}

async function createQuizWithQuestions(
  adminCookies: string,
  courseId: string,
  opts: { maxAttempts?: number | null; shuffle?: boolean } = {},
) {
  // create quiz
  const quizRes = await app.inject({
    method: 'POST',
    url: `/courses/${courseId}/quiz`,
    headers: { cookie: adminCookies },
    payload: { titleEn: 'Test Quiz', maxAttempts: opts.maxAttempts ?? null, shuffle: opts.shuffle ?? false },
  })
  expect(quizRes.statusCode).toBe(201)

  // Q1: correct = O1a
  const q1Res = await app.inject({
    method: 'POST',
    url: `/courses/${courseId}/quiz/questions`,
    headers: { cookie: adminCookies },
    payload: {
      textEn: 'Question 1',
      options: [
        { textEn: 'O1a - correct', isCorrect: true },
        { textEn: 'O1b - wrong', isCorrect: false },
      ],
    },
  })
  expect(q1Res.statusCode).toBe(201)

  // Q2: correct = O2b
  const q2Res = await app.inject({
    method: 'POST',
    url: `/courses/${courseId}/quiz/questions`,
    headers: { cookie: adminCookies },
    payload: {
      textEn: 'Question 2',
      options: [
        { textEn: 'O2a - wrong', isCorrect: false },
        { textEn: 'O2b - correct', isCorrect: true },
      ],
    },
  })
  expect(q2Res.statusCode).toBe(201)
  const updatedQuiz = q2Res.json()

  const q1 = updatedQuiz.questions.find((q: ApiQuestion) => q.text === 'Question 1')!
  const q2 = updatedQuiz.questions.find((q: ApiQuestion) => q.text === 'Question 2')!

  return {
    quizId: updatedQuiz.id as string,
    q1Id: q1.id,
    q2Id: q2.id,
    q1CorrectOptionId: q1.options.find((o: ApiOption) => o.isCorrect)!.id,
    q1WrongOptionId: q1.options.find((o: ApiOption) => !o.isCorrect)!.id,
    q2CorrectOptionId: q2.options.find((o: ApiOption) => o.isCorrect)!.id,
    q2WrongOptionId: q2.options.find((o: ApiOption) => !o.isCorrect)!.id,
  }
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

async function submitQuiz(
  userCookies: string,
  courseId: string,
  answers: Record<string, string>,
) {
  return app.inject({
    method: 'POST',
    url: `/courses/${courseId}/quiz/submit`,
    headers: { cookie: userCookies },
    payload: { answers },
  })
}

// ─── Tests ─────────────────────────────────────────────────────────────────

let app: TestApp

beforeAll(async () => {
  app = await buildTestApp()
})

afterAll(async () => {
  await app.close()
})

describe('Quizzes module', () => {
  // ── Admin CRUD ────────────────────────────────────────────────────────────

  describe('Admin: Quiz CRUD', () => {
    it('creates quiz for course → 201 with admin response (includes isCorrect field)', async () => {
      const admin = await setup('ADMIN')
      const course = await createCourse(admin.cookies)

      const res = await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/quiz`,
        headers: { cookie: admin.cookies },
        payload: { titleEn: 'My Quiz', maxAttempts: 3, shuffle: true },
      })
      expect(res.statusCode).toBe(201)
      const body = res.json()
      expect(body.title).toBe('My Quiz')
      expect(body.maxAttempts).toBe(3)
      expect(body.shuffle).toBe(true)
      expect(body.questions).toEqual([])
    })

    it('rejects duplicate quiz for same course → 400', async () => {
      const admin = await setup('ADMIN')
      const course = await createCourse(admin.cookies)

      await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/quiz`,
        headers: { cookie: admin.cookies },
        payload: { titleEn: 'Quiz 1', shuffle: false },
      })
      const res = await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/quiz`,
        headers: { cookie: admin.cookies },
        payload: { titleEn: 'Quiz 2', shuffle: false },
      })
      expect(res.statusCode).toBe(400)
    })

    it('USER cannot create quiz → 403', async () => {
      const admin = await setup('ADMIN')
      const user = await setup('USER')
      const course = await createCourse(admin.cookies)

      const res = await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/quiz`,
        headers: { cookie: user.cookies },
        payload: { titleEn: 'Quiz', shuffle: false },
      })
      expect(res.statusCode).toBe(403)
    })

    it('adds question with options → returns updated quiz with isCorrect (admin)', async () => {
      const admin = await setup('ADMIN')
      const course = await createCourse(admin.cookies)
      await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/quiz`,
        headers: { cookie: admin.cookies },
        payload: { titleEn: 'Q', shuffle: false },
      })

      const res = await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/quiz/questions`,
        headers: { cookie: admin.cookies },
        payload: {
          textEn: 'Capital of Thailand?',
          options: [
            { textEn: 'Bangkok', isCorrect: true },
            { textEn: 'Chiang Mai', isCorrect: false },
          ],
        },
      })
      expect(res.statusCode).toBe(201)
      const quiz = res.json()
      expect(quiz.questions).toHaveLength(1)
      const q = quiz.questions[0]
      expect(q.options).toHaveLength(2)
      expect(q.options.every((o: ApiOption) => 'isCorrect' in o)).toBe(true) // admin sees answer key
    })

    it('rejects question with zero correct options → 400', async () => {
      const admin = await setup('ADMIN')
      const course = await createCourse(admin.cookies)
      await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/quiz`,
        headers: { cookie: admin.cookies },
        payload: { titleEn: 'Q', shuffle: false },
      })

      const res = await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/quiz/questions`,
        headers: { cookie: admin.cookies },
        payload: {
          textEn: 'No correct answer',
          options: [
            { textEn: 'Wrong 1', isCorrect: false },
            { textEn: 'Wrong 2', isCorrect: false },
          ],
        },
      })
      expect(res.statusCode).toBe(400)
    })

    it('updates quiz settings → 200', async () => {
      const admin = await setup('ADMIN')
      const course = await createCourse(admin.cookies)
      await createQuizWithQuestions(admin.cookies, course.id)

      const res = await app.inject({
        method: 'PATCH',
        url: `/courses/${course.id}/quiz`,
        headers: { cookie: admin.cookies },
        payload: { titleEn: 'Renamed', maxAttempts: 5 },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().title).toBe('Renamed') // localized field
      expect(res.json().maxAttempts).toBe(5)
    })

    it('soft-deletes quiz → 404 on subsequent GET', async () => {
      const admin = await setup('ADMIN')
      const course = await createCourse(admin.cookies)
      await createQuizWithQuestions(admin.cookies, course.id)

      await app.inject({
        method: 'DELETE',
        url: `/courses/${course.id}/quiz`,
        headers: { cookie: admin.cookies },
      })

      const getRes = await app.inject({
        method: 'GET',
        url: `/courses/${course.id}/quiz`,
        headers: { cookie: admin.cookies },
      })
      expect(getRes.statusCode).toBe(404)
    })

    it('soft-deletes question → question gone, other questions remain', async () => {
      const admin = await setup('ADMIN')
      const course = await createCourse(admin.cookies)
      const { q1Id } = await createQuizWithQuestions(admin.cookies, course.id)

      await app.inject({
        method: 'DELETE',
        url: `/courses/${course.id}/quiz/questions/${q1Id}`,
        headers: { cookie: admin.cookies },
      })

      const quiz = (
        await app.inject({
          method: 'GET',
          url: `/courses/${course.id}/quiz`,
          headers: { cookie: admin.cookies },
        })
      ).json()
      expect(quiz.questions.find((q: ApiQuestion) => q.id === q1Id)).toBeUndefined()
      expect(quiz.questions).toHaveLength(1) // Q2 ยังอยู่
    })

    it('updates question text → 200', async () => {
      const admin = await setup('ADMIN')
      const course = await createCourse(admin.cookies)
      const { q1Id } = await createQuizWithQuestions(admin.cookies, course.id)

      const res = await app.inject({
        method: 'PATCH',
        url: `/courses/${course.id}/quiz/questions/${q1Id}`,
        headers: { cookie: admin.cookies },
        payload: { textEn: 'Updated Q1' },
      })
      expect(res.statusCode).toBe(200)
      const found = (res.json().questions as ApiQuestion[]).find((q) => q.id === q1Id)
      expect(found?.text).toBe('Updated Q1')
    })

    it('add/update/hard-delete option → 201/200/200', async () => {
      const admin = await setup('ADMIN')
      const course = await createCourse(admin.cookies)
      const { q1Id, q1CorrectOptionId } = await createQuizWithQuestions(admin.cookies, course.id)

      const addRes = await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/quiz/questions/${q1Id}/options`,
        headers: { cookie: admin.cookies },
        payload: { textEn: 'New Option', isCorrect: false },
      })
      expect(addRes.statusCode).toBe(201)

      const updRes = await app.inject({
        method: 'PATCH',
        url: `/courses/${course.id}/quiz/questions/${q1Id}/options/${q1CorrectOptionId}`,
        headers: { cookie: admin.cookies },
        payload: { textEn: 'Correct updated' },
      })
      expect(updRes.statusCode).toBe(200)

      const delRes = await app.inject({
        method: 'DELETE',
        url: `/courses/${course.id}/quiz/questions/${q1Id}/options/${q1CorrectOptionId}`,
        headers: { cookie: admin.cookies },
      })
      expect(delRes.statusCode).toBe(200)
    })
  })

  // ── isCorrect — 3-layer leak prevention ──────────────────────────────────

  describe('isCorrect — 3-layer leak prevention', () => {
    it('GET /take: payload does NOT contain "isCorrect" at any depth', async () => {
      const admin = await setup('ADMIN')
      const user = await setup('USER')
      const course = await createCourse(admin.cookies)
      await createQuizWithQuestions(admin.cookies, course.id)
      await enroll(admin.cookies, user.userId, course.id)

      const res = await app.inject({
        method: 'GET',
        url: `/courses/${course.id}/quiz/take`,
        headers: { cookie: user.cookies },
      })
      expect(res.statusCode).toBe(200)

      // layer 3 check: serialized response must never contain the key name
      expect(res.payload).not.toContain('"isCorrect"')

      // deep object walk as belt-and-suspenders
      function hasIsCorrectKey(obj: unknown): boolean {
        if (obj === null || typeof obj !== 'object') return false
        if ('isCorrect' in (obj as object)) return true
        return Object.values(obj as Record<string, unknown>).some(hasIsCorrectKey)
      }
      expect(hasIsCorrectKey(res.json())).toBe(false)
    })

    it('GET /quiz (admin): response includes isCorrect on options', async () => {
      const admin = await setup('ADMIN')
      const course = await createCourse(admin.cookies)
      await createQuizWithQuestions(admin.cookies, course.id)

      const res = await app.inject({
        method: 'GET',
        url: `/courses/${course.id}/quiz`,
        headers: { cookie: admin.cookies },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().questions[0].options[0]).toHaveProperty('isCorrect')
    })

    it('shuffle=false: question order is deterministic across calls', async () => {
      const admin = await setup('ADMIN')
      const user = await setup('USER')
      const course = await createCourse(admin.cookies)
      await createQuizWithQuestions(admin.cookies, course.id, { shuffle: false })
      await enroll(admin.cookies, user.userId, course.id)

      const r1 = (await app.inject({ method: 'GET', url: `/courses/${course.id}/quiz/take`, headers: { cookie: user.cookies } })).json()
      const r2 = (await app.inject({ method: 'GET', url: `/courses/${course.id}/quiz/take`, headers: { cookie: user.cookies } })).json()

      expect((r1.questions as ApiQuestion[]).map((q) => q.id)).toEqual(
        (r2.questions as ApiQuestion[]).map((q) => q.id),
      )
    })
  })

  // ── Enrollment gate ───────────────────────────────────────────────────────

  describe('Enrollment gate', () => {
    it('GET /take without enrollment → 403', async () => {
      const admin = await setup('ADMIN')
      const user = await setup('USER')
      const course = await createCourse(admin.cookies)
      await createQuizWithQuestions(admin.cookies, course.id)

      const res = await app.inject({
        method: 'GET',
        url: `/courses/${course.id}/quiz/take`,
        headers: { cookie: user.cookies },
      })
      expect(res.statusCode).toBe(403)
    })

    it('POST /submit without enrollment → 403', async () => {
      const admin = await setup('ADMIN')
      const user = await setup('USER')
      const course = await createCourse(admin.cookies)
      const { q1Id, q1CorrectOptionId, q2Id, q2CorrectOptionId } =
        await createQuizWithQuestions(admin.cookies, course.id)

      const res = await submitQuiz(user.cookies, course.id, {
        [q1Id]: q1CorrectOptionId,
        [q2Id]: q2CorrectOptionId,
      })
      expect(res.statusCode).toBe(403)
    })
  })

  // ── Auto-grade ────────────────────────────────────────────────────────────

  describe('Auto-grade', () => {
    it('all correct → score=100, passed=true (passScore=80)', async () => {
      const admin = await setup('ADMIN')
      const user = await setup('USER')
      const course = await createCourse(admin.cookies, 80)
      const { q1Id, q1CorrectOptionId, q2Id, q2CorrectOptionId } =
        await createQuizWithQuestions(admin.cookies, course.id)
      await enroll(admin.cookies, user.userId, course.id)

      const res = await submitQuiz(user.cookies, course.id, {
        [q1Id]: q1CorrectOptionId,
        [q2Id]: q2CorrectOptionId,
      })
      expect(res.statusCode).toBe(201)
      expect(res.json().score).toBe(100)
      expect(res.json().passed).toBe(true)
    })

    it('half correct, passScore=80 → score=50, passed=false', async () => {
      const admin = await setup('ADMIN')
      const user = await setup('USER')
      const course = await createCourse(admin.cookies, 80)
      const { q1Id, q1CorrectOptionId, q2Id, q2WrongOptionId } =
        await createQuizWithQuestions(admin.cookies, course.id)
      await enroll(admin.cookies, user.userId, course.id)

      const res = await submitQuiz(user.cookies, course.id, {
        [q1Id]: q1CorrectOptionId,
        [q2Id]: q2WrongOptionId,
      })
      expect(res.statusCode).toBe(201)
      expect(res.json().score).toBe(50)
      expect(res.json().passed).toBe(false)
    })

    it('half correct, passScore=50 → score=50, passed=true (boundary >=)', async () => {
      const admin = await setup('ADMIN')
      const user = await setup('USER')
      const course = await createCourse(admin.cookies, 50)
      const { q1Id, q1CorrectOptionId, q2Id, q2WrongOptionId } =
        await createQuizWithQuestions(admin.cookies, course.id)
      await enroll(admin.cookies, user.userId, course.id)

      const res = await submitQuiz(user.cookies, course.id, {
        [q1Id]: q1CorrectOptionId,
        [q2Id]: q2WrongOptionId,
      })
      expect(res.statusCode).toBe(201)
      expect(res.json().score).toBe(50)
      expect(res.json().passed).toBe(true) // score (50) >= passScore (50)
    })

    it('all wrong → score=0, passed=false', async () => {
      const admin = await setup('ADMIN')
      const user = await setup('USER')
      const course = await createCourse(admin.cookies, 80)
      const { q1Id, q1WrongOptionId, q2Id, q2WrongOptionId } =
        await createQuizWithQuestions(admin.cookies, course.id)
      await enroll(admin.cookies, user.userId, course.id)

      const res = await submitQuiz(user.cookies, course.id, {
        [q1Id]: q1WrongOptionId,
        [q2Id]: q2WrongOptionId,
      })
      expect(res.statusCode).toBe(201)
      expect(res.json().score).toBe(0)
      expect(res.json().passed).toBe(false)
    })

    it('unanswered question counts as wrong (answer only Q1, skip Q2)', async () => {
      const admin = await setup('ADMIN')
      const user = await setup('USER')
      const course = await createCourse(admin.cookies, 80)
      const { q1Id, q1CorrectOptionId } = await createQuizWithQuestions(admin.cookies, course.id)
      await enroll(admin.cookies, user.userId, course.id)

      const res = await submitQuiz(user.cookies, course.id, { [q1Id]: q1CorrectOptionId })
      expect(res.statusCode).toBe(201)
      expect(res.json().score).toBe(50) // 1/2
      expect(res.json().passed).toBe(false) // 50 < 80
    })

    it('client-injected score field is stripped by Zod — server score is authoritative', async () => {
      const admin = await setup('ADMIN')
      const user = await setup('USER')
      const course = await createCourse(admin.cookies, 80)
      const { q1Id, q1WrongOptionId, q2Id, q2WrongOptionId } =
        await createQuizWithQuestions(admin.cookies, course.id)
      await enroll(admin.cookies, user.userId, course.id)

      const res = await app.inject({
        method: 'POST',
        url: `/courses/${course.id}/quiz/submit`,
        headers: { cookie: user.cookies },
        payload: {
          answers: { [q1Id]: q1WrongOptionId, [q2Id]: q2WrongOptionId },
          score: 9999, // attacker tries to inject score
        },
      })
      expect(res.statusCode).toBe(201)
      expect(res.json().score).toBe(0) // server computed 0, not 9999
      expect(res.json().passed).toBe(false)
    })
  })

  // ── Answer validation ─────────────────────────────────────────────────────

  describe('Answer validation', () => {
    it('optionId from wrong question in same quiz → 400', async () => {
      const admin = await setup('ADMIN')
      const user = await setup('USER')
      const course = await createCourse(admin.cookies)
      const { q1Id, q2CorrectOptionId } = await createQuizWithQuestions(admin.cookies, course.id)
      await enroll(admin.cookies, user.userId, course.id)

      // Q1 answered with Q2's option → cross-question assignment rejected
      const res = await submitQuiz(user.cookies, course.id, { [q1Id]: q2CorrectOptionId })
      expect(res.statusCode).toBe(400)
    })

    it('optionId that does not belong to quiz → 400', async () => {
      const admin = await setup('ADMIN')
      const user = await setup('USER')
      const course = await createCourse(admin.cookies)
      const { q1Id } = await createQuizWithQuestions(admin.cookies, course.id)
      await enroll(admin.cookies, user.userId, course.id)

      const res = await submitQuiz(user.cookies, course.id, {
        [q1Id]: 'cm0000000000000000000000a', // non-existent cuid
      })
      expect(res.statusCode).toBe(400)
    })
  })

  // ── maxAttempts ───────────────────────────────────────────────────────────

  describe('maxAttempts', () => {
    it('first attempt succeeds (attempts < maxAttempts)', async () => {
      const admin = await setup('ADMIN')
      const user = await setup('USER')
      const course = await createCourse(admin.cookies, 80)
      const { q1Id, q1WrongOptionId, q2Id, q2WrongOptionId } =
        await createQuizWithQuestions(admin.cookies, course.id, { maxAttempts: 2 })
      await enroll(admin.cookies, user.userId, course.id)

      const res = await submitQuiz(user.cookies, course.id, {
        [q1Id]: q1WrongOptionId,
        [q2Id]: q2WrongOptionId,
      })
      expect(res.statusCode).toBe(201)
    })

    it('attempt when maxAttempts exhausted → 400 with message', async () => {
      const admin = await setup('ADMIN')
      const user = await setup('USER')
      const course = await createCourse(admin.cookies, 80)
      const { q1Id, q1WrongOptionId, q2Id, q2WrongOptionId } =
        await createQuizWithQuestions(admin.cookies, course.id, { maxAttempts: 1 })
      await enroll(admin.cookies, user.userId, course.id)

      const payload = { [q1Id]: q1WrongOptionId, [q2Id]: q2WrongOptionId }
      await submitQuiz(user.cookies, course.id, payload)

      const r2 = await submitQuiz(user.cookies, course.id, payload)
      expect(r2.statusCode).toBe(400)
      expect(r2.json().message).toContain('Maximum attempts')
    })
  })

  // ── COMPLETED after quiz ──────────────────────────────────────────────────

  describe('COMPLETED after quiz', () => {
    it('progress=100 + passed → enrollment becomes COMPLETED', async () => {
      const admin = await setup('ADMIN')
      const user = await setup('USER')
      const course = await createCourse(admin.cookies, 80)
      const { q1Id, q1CorrectOptionId, q2Id, q2CorrectOptionId } =
        await createQuizWithQuestions(admin.cookies, course.id)
      const enrollment = await enroll(admin.cookies, user.userId, course.id)

      // force progress to 100 directly (no materials in this test)
      await prisma.enrollment.update({
        where: { id: enrollment.id },
        data: { progress: 100 },
      })

      const res = await submitQuiz(user.cookies, course.id, {
        [q1Id]: q1CorrectOptionId,
        [q2Id]: q2CorrectOptionId,
      })
      expect(res.statusCode).toBe(201)
      expect(res.json().passed).toBe(true)

      const updated = await prisma.enrollment.findUnique({
        where: { id: enrollment.id },
        select: { status: true, completedAt: true },
      })
      expect(updated?.status).toBe('COMPLETED')
      expect(updated?.completedAt).not.toBeNull()
    })

    it('progress=100 + failed → enrollment stays IN_PROGRESS', async () => {
      const admin = await setup('ADMIN')
      const user = await setup('USER')
      const course = await createCourse(admin.cookies, 80)
      const { q1Id, q1WrongOptionId, q2Id, q2WrongOptionId } =
        await createQuizWithQuestions(admin.cookies, course.id)
      const enrollment = await enroll(admin.cookies, user.userId, course.id)

      await prisma.enrollment.update({ where: { id: enrollment.id }, data: { progress: 100 } })

      const res = await submitQuiz(user.cookies, course.id, {
        [q1Id]: q1WrongOptionId,
        [q2Id]: q2WrongOptionId,
      })
      expect(res.statusCode).toBe(201)
      expect(res.json().passed).toBe(false)

      const updated = await prisma.enrollment.findUnique({
        where: { id: enrollment.id },
        select: { status: true },
      })
      expect(updated?.status).not.toBe('COMPLETED')
    })

    it('passed but progress < 100 → enrollment stays not COMPLETED', async () => {
      const admin = await setup('ADMIN')
      const user = await setup('USER')
      const course = await createCourse(admin.cookies, 50)
      const { q1Id, q1CorrectOptionId, q2Id, q2WrongOptionId } =
        await createQuizWithQuestions(admin.cookies, course.id)
      const enrollment = await enroll(admin.cookies, user.userId, course.id)

      // progress stays at default 0
      const res = await submitQuiz(user.cookies, course.id, {
        [q1Id]: q1CorrectOptionId,
        [q2Id]: q2WrongOptionId,
      })
      expect(res.statusCode).toBe(201)
      expect(res.json().passed).toBe(true) // score=50 >= passScore=50

      const updated = await prisma.enrollment.findUnique({
        where: { id: enrollment.id },
        select: { status: true },
      })
      expect(updated?.status).not.toBe('COMPLETED') // progress 0 < 100
    })
  })

  // ── Attempts — IDOR ───────────────────────────────────────────────────────

  describe('Attempts — IDOR', () => {
    it('USER gets own attempts → 200, list contains only own', async () => {
      const admin = await setup('ADMIN')
      const user = await setup('USER')
      const course = await createCourse(admin.cookies, 80)
      const { q1Id, q1WrongOptionId, q2Id, q2WrongOptionId } =
        await createQuizWithQuestions(admin.cookies, course.id)
      await enroll(admin.cookies, user.userId, course.id)

      await submitQuiz(user.cookies, course.id, {
        [q1Id]: q1WrongOptionId,
        [q2Id]: q2WrongOptionId,
      })

      const res = await app.inject({
        method: 'GET',
        url: `/courses/${course.id}/quiz/attempts`,
        headers: { cookie: user.cookies },
      })
      expect(res.statusCode).toBe(200)
      const attempts = res.json()
      expect(attempts).toHaveLength(1)
      expect(attempts[0].userId).toBe(user.userId)
    })

    it('USER passes ?userId=other → 404 (prevents IDOR enumeration)', async () => {
      const admin = await setup('ADMIN')
      const user1 = await setup('USER')
      const user2 = await setup('USER')
      const course = await createCourse(admin.cookies)
      await createQuizWithQuestions(admin.cookies, course.id)
      await enroll(admin.cookies, user1.userId, course.id)

      const res = await app.inject({
        method: 'GET',
        url: `/courses/${course.id}/quiz/attempts?userId=${user2.userId}`,
        headers: { cookie: user1.cookies },
      })
      expect(res.statusCode).toBe(404)
    })

    it('ADMIN sees all attempts from all users', async () => {
      const admin = await setup('ADMIN')
      const user1 = await setup('USER')
      const user2 = await setup('USER')
      const course = await createCourse(admin.cookies, 80)
      const { q1Id, q1WrongOptionId, q2Id, q2WrongOptionId } =
        await createQuizWithQuestions(admin.cookies, course.id)
      await enroll(admin.cookies, user1.userId, course.id)
      await enroll(admin.cookies, user2.userId, course.id)

      const payload = { [q1Id]: q1WrongOptionId, [q2Id]: q2WrongOptionId }
      await submitQuiz(user1.cookies, course.id, payload)
      await submitQuiz(user2.cookies, course.id, payload)

      const res = await app.inject({
        method: 'GET',
        url: `/courses/${course.id}/quiz/attempts`,
        headers: { cookie: admin.cookies },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toHaveLength(2)
    })

    it('ADMIN filters by ?userId → only that user\'s attempts', async () => {
      const admin = await setup('ADMIN')
      const user1 = await setup('USER')
      const user2 = await setup('USER')
      const course = await createCourse(admin.cookies, 80)
      const { q1Id, q1WrongOptionId, q2Id, q2WrongOptionId } =
        await createQuizWithQuestions(admin.cookies, course.id)
      await enroll(admin.cookies, user1.userId, course.id)
      await enroll(admin.cookies, user2.userId, course.id)

      const payload = { [q1Id]: q1WrongOptionId, [q2Id]: q2WrongOptionId }
      await submitQuiz(user1.cookies, course.id, payload)
      await submitQuiz(user2.cookies, course.id, payload)

      const res = await app.inject({
        method: 'GET',
        url: `/courses/${course.id}/quiz/attempts?userId=${user1.userId}`,
        headers: { cookie: admin.cookies },
      })
      expect(res.statusCode).toBe(200)
      const attempts = res.json()
      expect(attempts).toHaveLength(1)
      expect(attempts[0].userId).toBe(user1.userId)
    })
  })
})
