import type { FastifyPluginAsync } from 'fastify'
import { type ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import {
  surveyAdminResponseSchema,
  surveyForUserResponseSchema,
  createSurveyQuestionInputSchema,
  updateSurveyQuestionInputSchema,
  submitSurveyInputSchema,
  surveyResponseRecordSchema,
} from '@btec-lms/shared'
import {
  surveyCourseParamsSchema,
  surveyQuestionParamsSchema,
  surveyResponsesQuerySchema,
} from './surveys.schema.js'
import {
  createSurvey,
  getSurveyAdmin,
  deleteSurvey,
  addSurveyQuestion,
  updateSurveyQuestion,
  deleteSurveyQuestion,
  getSurveyForUser,
  submitSurvey,
  getSurveyResponses,
} from './surveys.service.js'
import { resolveLocale } from '../../lib/i18n.js'

const surveysRoutes: FastifyPluginAsync = async (app) => {
  const server = app.withTypeProvider<ZodTypeProvider>()

  // ── Admin: Survey CRUD ────────────────────────────────────────────────────

  // POST /:courseId/survey — สร้าง survey (1 course มี 1 survey, ไม่มี metadata นอกจาก courseId)
  server.post('/:courseId/survey', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      params: surveyCourseParamsSchema,
      response: { 201: surveyAdminResponseSchema },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const survey = await createSurvey(app.prisma, req.params.courseId, req.user.id, locale, req.ip)
    return reply.code(201).send(survey)
  })

  // GET /:courseId/survey — admin ดูคำถามทั้งหมด
  server.get('/:courseId/survey', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      params: surveyCourseParamsSchema,
      response: { 200: surveyAdminResponseSchema },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const survey = await getSurveyAdmin(app.prisma, req.params.courseId, locale)
    return reply.send(survey)
  })

  // DELETE /:courseId/survey — soft delete survey + cascade questions
  server.delete('/:courseId/survey', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      params: surveyCourseParamsSchema,
      response: { 200: z.object({ message: z.string() }) },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    await deleteSurvey(app.prisma, req.params.courseId, req.user.id, locale, req.ip)
    return reply.send({ message: 'Survey deleted' })
  })

  // ── Admin: Question CRUD ──────────────────────────────────────────────────

  // POST /:courseId/survey/questions
  server.post('/:courseId/survey/questions', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      params: surveyCourseParamsSchema,
      body: createSurveyQuestionInputSchema,
      response: { 201: surveyAdminResponseSchema },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const survey = await addSurveyQuestion(app.prisma, req.params.courseId, req.body, req.user.id, locale, req.ip)
    return reply.code(201).send(survey)
  })

  // PATCH /:courseId/survey/questions/:questionId
  server.patch('/:courseId/survey/questions/:questionId', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      params: surveyQuestionParamsSchema,
      body: updateSurveyQuestionInputSchema,
      response: { 200: surveyAdminResponseSchema },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const survey = await updateSurveyQuestion(
      app.prisma,
      req.params.courseId,
      req.params.questionId,
      req.body,
      req.user.id,
      locale,
      req.ip,
    )
    return reply.send(survey)
  })

  // DELETE /:courseId/survey/questions/:questionId — soft delete
  server.delete('/:courseId/survey/questions/:questionId', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      params: surveyQuestionParamsSchema,
      response: { 200: z.object({ message: z.string() }) },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    await deleteSurveyQuestion(app.prisma, req.params.courseId, req.params.questionId, req.user.id, locale, req.ip)
    return reply.send({ message: 'Survey question deleted' })
  })

  // ── User: Take + Submit ───────────────────────────────────────────────────

  // GET /:courseId/survey/take — enrolled USER เท่านั้น
  server.get('/:courseId/survey/take', {
    preHandler: [app.verifyJwt],
    schema: {
      params: surveyCourseParamsSchema,
      response: { 200: surveyForUserResponseSchema },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const survey = await getSurveyForUser(app.prisma, req.params.courseId, req.user.id, locale)
    return reply.send(survey)
  })

  // POST /:courseId/survey/submit — enrolled USER, ตอบได้ครั้งเดียว
  server.post('/:courseId/survey/submit', {
    preHandler: [app.verifyJwt],
    schema: {
      params: surveyCourseParamsSchema,
      body: submitSurveyInputSchema,
      response: { 201: surveyResponseRecordSchema },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const response = await submitSurvey(app.prisma, req.params.courseId, req.user.id, req.body, locale, req.ip)
    return reply.code(201).send(response)
  })

  // GET /:courseId/survey/responses — ADMIN เห็นทุกคน, USER เห็นของตัวเอง (สำหรับ report)
  server.get('/:courseId/survey/responses', {
    preHandler: [app.verifyJwt],
    schema: {
      params: surveyCourseParamsSchema,
      querystring: surveyResponsesQuerySchema,
      response: { 200: z.array(surveyResponseRecordSchema) },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const responses = await getSurveyResponses(
      app.prisma,
      req.params.courseId,
      req.user.id,
      req.user.role,
      req.query.userId,
      locale,
    )
    return reply.send(responses)
  })
}

export default surveysRoutes
