import type { FastifyPluginAsync } from 'fastify'
import { type ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import {
  courseResponseSchema,
  createCourseInputSchema,
  updateCourseInputSchema,
  updateCourseStatusSchema,
} from '@btec-lms/shared'
import { courseListQuerySchema, courseParamsSchema } from './courses.schema.js'
import {
  listCourses,
  getCourse,
  createCourse,
  updateCourse,
  updateCourseStatus,
  softDeleteCourse,
} from './courses.service.js'
import { resolveLocale } from '../../lib/i18n.js'

const coursesRoutes: FastifyPluginAsync = async (app) => {
  const server = app.withTypeProvider<ZodTypeProvider>()

  const courseListResponseSchema = z.object({
    data: z.array(courseResponseSchema),
    total: z.number().int(),
    page: z.number().int(),
    limit: z.number().int(),
  })

  // GET /courses — USER เห็นเฉพาะ PUBLISHED, ADMIN/MANAGER เห็นทุก status
  server.get('/', {
    preHandler: [app.verifyJwt],
    schema: {
      querystring: courseListQuerySchema,
      response: { 200: courseListResponseSchema },
    },
  }, async (req) => {
    return listCourses(app.prisma, req.query, req.user.role, req.ip, req.user.id)
  })

  // POST /courses — ADMIN/MANAGER เท่านั้น
  server.post('/', {
    preHandler: [app.requireRole(['ADMIN', 'MANAGER'])],
    schema: {
      body: createCourseInputSchema,
      response: { 201: courseResponseSchema },
    },
  }, async (req, reply) => {
    const course = await createCourse(app.prisma, req.body, req.user.id, req.ip)
    return reply.code(201).send(course)
  })

  // GET /courses/:id — USER เห็นเฉพาะ PUBLISHED
  server.get('/:id', {
    preHandler: [app.verifyJwt],
    schema: {
      params: courseParamsSchema,
      response: { 200: courseResponseSchema },
    },
  }, async (req) => {
    const locale = await resolveLocale(req, app.prisma)
    return getCourse(app.prisma, req.params.id, req.user.role, locale)
  })

  // PATCH /courses/:id — ADMIN/MANAGER (metadata เท่านั้น ไม่รวม status)
  server.patch('/:id', {
    preHandler: [app.requireRole(['ADMIN', 'MANAGER'])],
    schema: {
      params: courseParamsSchema,
      body: updateCourseInputSchema,
      response: { 200: courseResponseSchema },
    },
  }, async (req) => {
    const locale = await resolveLocale(req, app.prisma)
    return updateCourse(app.prisma, req.params.id, req.body, req.user.id, locale, req.ip)
  })

  // PATCH /courses/:id/status — ADMIN only (publish / archive)
  server.patch('/:id/status', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      params: courseParamsSchema,
      body: updateCourseStatusSchema,
      response: { 200: courseResponseSchema },
    },
  }, async (req) => {
    const locale = await resolveLocale(req, app.prisma)
    return updateCourseStatus(app.prisma, req.params.id, req.body, req.user.id, locale, req.ip)
  })

  // DELETE /courses/:id — ADMIN only (soft delete + cascade materials)
  server.delete('/:id', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      params: courseParamsSchema,
      response: { 200: z.object({ message: z.string() }) },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    await softDeleteCourse(app.prisma, req.params.id, req.user.id, locale, req.ip)
    return reply.send({ message: 'Course deleted' })
  })
}

export default coursesRoutes
