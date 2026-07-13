import type { FastifyPluginAsync } from 'fastify'
import { type ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import {
  courseAdminResponseSchema,
  createCourseInputSchema,
  updateCourseInputSchema,
  updateCourseStatusSchema,
  setCoursePositionsInputSchema,
} from '@btec-lms/shared'
import { courseListQuerySchema, courseParamsSchema } from './courses.schema.js'
import {
  listCourses,
  getCourse,
  createCourse,
  updateCourse,
  updateCourseStatus,
  setCoursePositions,
  softDeleteCourse,
} from './courses.service.js'
import { resolveLocale } from '../../lib/i18n.js'

const coursesRoutes: FastifyPluginAsync = async (app) => {
  const server = app.withTypeProvider<ZodTypeProvider>()

  // GET /courses — USER เห็นเฉพาะ PUBLISHED, ADMIN เห็นทุก status
  // response schema ไม่ declare ที่ route เพราะ schema ขึ้นกับ role (service จัดการ)
  server.get('/', {
    preHandler: [app.verifyJwt],
    schema: {
      querystring: courseListQuerySchema,
    },
  }, async (req) => {
    const locale = await resolveLocale(req, app.prisma)
    return listCourses(app.prisma, req.query, req.user.role, locale, req.ip, req.user.id)
  })

  // POST /courses — ADMIN เท่านั้น → คืน admin schema เสมอ
  server.post('/', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      body: createCourseInputSchema,
      response: { 201: courseAdminResponseSchema },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const course = await createCourse(app.prisma, req.body, req.user.id, locale, req.ip)
    return reply.code(201).send(course)
  })

  // GET /courses/:id — USER เห็นเฉพาะ PUBLISHED; response schema ขึ้นกับ role
  server.get('/:id', {
    preHandler: [app.verifyJwt],
    schema: {
      params: courseParamsSchema,
    },
  }, async (req) => {
    const locale = await resolveLocale(req, app.prisma)
    return getCourse(app.prisma, req.params.id, req.user.role, locale)
  })

  // PATCH /courses/:id — ADMIN (metadata) → คืน admin schema
  server.patch('/:id', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      params: courseParamsSchema,
      body: updateCourseInputSchema,
      response: { 200: courseAdminResponseSchema },
    },
  }, async (req) => {
    const locale = await resolveLocale(req, app.prisma)
    return updateCourse(app.prisma, req.params.id, req.body, req.user.id, locale, req.ip)
  })

  // PATCH /courses/:id/status — ADMIN only → คืน admin schema
  server.patch('/:id/status', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      params: courseParamsSchema,
      body: updateCourseStatusSchema,
      response: { 200: courseAdminResponseSchema },
    },
  }, async (req) => {
    const locale = await resolveLocale(req, app.prisma)
    return updateCourseStatus(app.prisma, req.params.id, req.body, req.user.id, locale, req.ip)
  })

  // PUT /courses/:id/positions — ADMIN only, replace ทั้งชุด → คืน admin schema
  server.put('/:id/positions', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      params: courseParamsSchema,
      body: setCoursePositionsInputSchema,
      response: { 200: courseAdminResponseSchema },
    },
  }, async (req) => {
    const locale = await resolveLocale(req, app.prisma)
    return setCoursePositions(app.prisma, req.params.id, req.body, req.user.id, locale, req.ip)
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
