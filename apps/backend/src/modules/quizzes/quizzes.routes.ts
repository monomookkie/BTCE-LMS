import type { FastifyPluginAsync } from 'fastify'
import { type ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import {
  quizAdminResponseSchema,
  quizForUserResponseSchema,
  createQuizInputSchema,
  updateQuizInputSchema,
  createQuestionInputSchema,
  updateQuestionInputSchema,
  addOptionInputSchema,
  updateOptionInputSchema,
  submitQuizInputSchema,
  quizAttemptResponseSchema,
} from '@btec-lms/shared'
import {
  quizCourseParamsSchema,
  questionParamsSchema,
  optionParamsSchema,
  attemptsQuerySchema,
} from './quizzes.schema.js'
import {
  createQuiz,
  getQuizAdmin,
  updateQuiz,
  deleteQuiz,
  addQuestion,
  updateQuestion,
  deleteQuestion,
  addOption,
  updateOption,
  deleteOption,
  getQuizForUser,
  submitQuiz,
  getAttempts,
} from './quizzes.service.js'
import { resolveLocale } from '../../lib/i18n.js'

const quizzesRoutes: FastifyPluginAsync = async (app) => {
  const server = app.withTypeProvider<ZodTypeProvider>()

  // ── Admin: Quiz CRUD ──────────────────────────────────────────────────────

  // POST /:courseId/quiz — สร้าง quiz (1 course มี 1 quiz)
  server.post('/:courseId/quiz', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      params: quizCourseParamsSchema,
      body: createQuizInputSchema,
      response: { 201: quizAdminResponseSchema },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const quiz = await createQuiz(app.prisma, req.params.courseId, req.body, req.user.id, locale, req.ip)
    return reply.code(201).send(quiz)
  })

  // GET /:courseId/quiz — admin เห็น answer key (รวม isCorrect)
  server.get('/:courseId/quiz', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      params: quizCourseParamsSchema,
      response: { 200: quizAdminResponseSchema },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const quiz = await getQuizAdmin(app.prisma, req.params.courseId, locale)
    return reply.send(quiz)
  })

  // PATCH /:courseId/quiz — แก้ settings
  server.patch('/:courseId/quiz', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      params: quizCourseParamsSchema,
      body: updateQuizInputSchema,
      response: { 200: quizAdminResponseSchema },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const quiz = await updateQuiz(app.prisma, req.params.courseId, req.body, req.user.id, locale, req.ip)
    return reply.send(quiz)
  })

  // DELETE /:courseId/quiz — soft delete quiz + cascade questions
  server.delete('/:courseId/quiz', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      params: quizCourseParamsSchema,
      response: { 200: z.object({ message: z.string() }) },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    await deleteQuiz(app.prisma, req.params.courseId, req.user.id, locale, req.ip)
    return reply.send({ message: 'Quiz deleted' })
  })

  // ── Admin: Question CRUD ──────────────────────────────────────────────────

  // POST /:courseId/quiz/questions — เพิ่ม question พร้อม options
  server.post('/:courseId/quiz/questions', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      params: quizCourseParamsSchema,
      body: createQuestionInputSchema,
      response: { 201: quizAdminResponseSchema },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const quiz = await addQuestion(app.prisma, req.params.courseId, req.body, req.user.id, locale, req.ip)
    return reply.code(201).send(quiz)
  })

  // PATCH /:courseId/quiz/questions/:questionId
  server.patch('/:courseId/quiz/questions/:questionId', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      params: questionParamsSchema,
      body: updateQuestionInputSchema,
      response: { 200: quizAdminResponseSchema },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const quiz = await updateQuestion(
      app.prisma,
      req.params.courseId,
      req.params.questionId,
      req.body,
      req.user.id,
      locale,
      req.ip,
    )
    return reply.send(quiz)
  })

  // DELETE /:courseId/quiz/questions/:questionId — soft delete
  server.delete('/:courseId/quiz/questions/:questionId', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      params: questionParamsSchema,
      response: { 200: z.object({ message: z.string() }) },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    await deleteQuestion(
      app.prisma,
      req.params.courseId,
      req.params.questionId,
      req.user.id,
      locale,
      req.ip,
    )
    return reply.send({ message: 'Question deleted' })
  })

  // ── Admin: Option CRUD ────────────────────────────────────────────────────

  // POST /:courseId/quiz/questions/:questionId/options
  server.post('/:courseId/quiz/questions/:questionId/options', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      params: questionParamsSchema,
      body: addOptionInputSchema,
      response: { 201: quizAdminResponseSchema },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const quiz = await addOption(
      app.prisma,
      req.params.courseId,
      req.params.questionId,
      req.body,
      req.user.id,
      locale,
      req.ip,
    )
    return reply.code(201).send(quiz)
  })

  // PATCH /:courseId/quiz/questions/:questionId/options/:optionId
  server.patch('/:courseId/quiz/questions/:questionId/options/:optionId', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      params: optionParamsSchema,
      body: updateOptionInputSchema,
      response: { 200: quizAdminResponseSchema },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const quiz = await updateOption(
      app.prisma,
      req.params.courseId,
      req.params.questionId,
      req.params.optionId,
      req.body,
      req.user.id,
      locale,
      req.ip,
    )
    return reply.send(quiz)
  })

  // DELETE /:courseId/quiz/questions/:questionId/options/:optionId — hard delete
  server.delete('/:courseId/quiz/questions/:questionId/options/:optionId', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      params: optionParamsSchema,
      response: { 200: z.object({ message: z.string() }) },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    await deleteOption(
      app.prisma,
      req.params.courseId,
      req.params.questionId,
      req.params.optionId,
      req.user.id,
      locale,
      req.ip,
    )
    return reply.send({ message: 'Option deleted' })
  })

  // ── User: Take + Submit ───────────────────────────────────────────────────

  // GET /:courseId/quiz/take — enrolled USER เท่านั้น, ไม่มี isCorrect (layer 3: response schema)
  server.get('/:courseId/quiz/take', {
    preHandler: [app.verifyJwt],
    schema: {
      params: quizCourseParamsSchema,
      response: { 200: quizForUserResponseSchema }, // Zod strips unknown fields รวม isCorrect
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const quiz = await getQuizForUser(app.prisma, req.params.courseId, req.user.id, locale)
    return reply.send(quiz)
  })

  // POST /:courseId/quiz/submit — enrolled USER, auto-grade server-side
  server.post('/:courseId/quiz/submit', {
    preHandler: [app.verifyJwt],
    schema: {
      params: quizCourseParamsSchema,
      body: submitQuizInputSchema,
      response: { 201: quizAttemptResponseSchema },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const attempt = await submitQuiz(
      app.prisma,
      req.params.courseId,
      req.user.id,
      req.body,
      locale,
      req.ip,
    )
    return reply.code(201).send(attempt)
  })

  // GET /:courseId/quiz/attempts — ADMIN เห็นทุกคน, USER เห็นของตัวเอง
  server.get('/:courseId/quiz/attempts', {
    preHandler: [app.verifyJwt],
    schema: {
      params: quizCourseParamsSchema,
      querystring: attemptsQuerySchema,
      response: { 200: z.array(quizAttemptResponseSchema) },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const attempts = await getAttempts(
      app.prisma,
      req.params.courseId,
      req.user.id,
      req.user.role,
      req.query.userId,
      locale,
    )
    return reply.send(attempts)
  })
}

export default quizzesRoutes
