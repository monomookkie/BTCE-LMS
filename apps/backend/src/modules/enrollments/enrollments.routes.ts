import type { FastifyPluginAsync } from 'fastify'
import { type ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { enrollmentResponseSchema, assignEnrollmentInputSchema, selfEnrollInputSchema } from '@btec-lms/shared'
import {
  enrollmentListQuerySchema,
  enrollmentParamsSchema,
  completeMaterialParamsSchema,
} from './enrollments.schema.js'
import {
  assignEnrollment,
  selfEnroll,
  listEnrollments,
  listMyEnrollments,
  getEnrollment,
  markMaterialComplete,
  cancelEnrollment,
} from './enrollments.service.js'
import { resolveLocale } from '../../lib/i18n.js'

const enrollmentsRoutes: FastifyPluginAsync = async (app) => {
  const server = app.withTypeProvider<ZodTypeProvider>()

  const enrollmentListResponseSchema = z.object({
    data: z.array(enrollmentResponseSchema),
    total: z.number().int(),
    page: z.number().int(),
    limit: z.number().int(),
  })

  // POST /enrollments — ADMIN/MANAGER assign user to course
  server.post('/', {
    preHandler: [app.requireRole(['ADMIN', 'MANAGER'])],
    schema: {
      body: assignEnrollmentInputSchema,
      response: { 201: enrollmentResponseSchema },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const enrollment = await assignEnrollment(
      app.prisma,
      req.body,
      req.user.id,
      locale,
      req.ip,
    )
    return reply.code(201).send(enrollment)
  })

  // POST /enrollments/self — USER self-enroll (allowSelfEnroll required)
  server.post('/self', {
    preHandler: [app.verifyJwt],
    schema: {
      body: selfEnrollInputSchema,
      response: { 201: enrollmentResponseSchema },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const enrollment = await selfEnroll(
      app.prisma,
      req.body,
      req.user.id,
      locale,
      req.ip,
    )
    return reply.code(201).send(enrollment)
  })

  // GET /enrollments — ADMIN/MANAGER list all
  server.get('/', {
    preHandler: [app.requireRole(['ADMIN', 'MANAGER'])],
    schema: {
      querystring: enrollmentListQuerySchema,
      response: { 200: enrollmentListResponseSchema },
    },
  }, async (req, reply) => {
    const result = await listEnrollments(app.prisma, req.query, req.user.id, req.ip)
    return reply.send(result)
  })

  // GET /enrollments/me — any authenticated user (own only)
  server.get('/me', {
    preHandler: [app.verifyJwt],
    schema: {
      querystring: enrollmentListQuerySchema,
      response: { 200: enrollmentListResponseSchema },
    },
  }, async (req, reply) => {
    const result = await listMyEnrollments(app.prisma, req.user.id, req.query)
    return reply.send(result)
  })

  // GET /enrollments/:id — owner or ADMIN/MANAGER
  server.get('/:id', {
    preHandler: [app.verifyJwt],
    schema: {
      params: enrollmentParamsSchema,
      response: { 200: enrollmentResponseSchema },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const enrollment = await getEnrollment(
      app.prisma,
      req.params.id,
      req.user.id,
      req.user.role,
      locale,
      req.ip,
    )
    return reply.send(enrollment)
  })

  // POST /enrollments/:id/complete-material/:materialId — USER (own only)
  server.post('/:id/complete-material/:materialId', {
    preHandler: [app.verifyJwt],
    schema: {
      params: completeMaterialParamsSchema,
      response: { 200: enrollmentResponseSchema },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const enrollment = await markMaterialComplete(
      app.prisma,
      req.params.id,
      req.params.materialId,
      req.user.id,
      locale,
      req.ip,
    )
    return reply.send(enrollment)
  })

  // DELETE /enrollments/:id — ADMIN/MANAGER cancel enrollment
  server.delete('/:id', {
    preHandler: [app.requireRole(['ADMIN', 'MANAGER'])],
    schema: {
      params: enrollmentParamsSchema,
      response: { 200: z.object({ message: z.string() }) },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    await cancelEnrollment(app.prisma, req.params.id, req.user.id, locale, req.ip)
    return reply.send({ message: 'Enrollment cancelled' })
  })
}

export default enrollmentsRoutes
