import type { FastifyPluginAsync } from 'fastify'
import { type ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import {
  positionPublicResponseSchema,
  positionAdminResponseSchema,
  createPositionInputSchema,
  updatePositionInputSchema,
} from '@btec-lms/shared'
import { positionParamsSchema } from './positions.schema.js'
import {
  listPositionsPublic,
  listPositionsAdmin,
  createPosition,
  updatePosition,
  deletePosition,
} from './positions.service.js'
import { resolveLocale } from '../../lib/i18n.js'

const positionsRoutes: FastifyPluginAsync = async (app) => {
  const server = app.withTypeProvider<ZodTypeProvider>()

  // GET /positions — public, unauthenticated (self-registration page ยังไม่ login)
  // ส่งแค่ localized name — ไม่มี raw en/th (สงวนไว้ให้ admin เท่านั้นผ่าน /positions/admin)
  server.get('/', {
    schema: {
      response: { 200: z.array(positionPublicResponseSchema) },
    },
  }, async (req) => {
    const locale = await resolveLocale(req, app.prisma)
    return listPositionsPublic(app.prisma, locale)
  })

  // GET /positions/admin — ADMIN, raw bilingual fields สำหรับ Manage Positions
  server.get('/admin', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      response: { 200: z.array(positionAdminResponseSchema) },
    },
  }, async (req) => {
    const locale = await resolveLocale(req, app.prisma)
    return listPositionsAdmin(app.prisma, locale)
  })

  // POST /positions — ADMIN
  server.post('/', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      body: createPositionInputSchema,
      response: { 201: positionAdminResponseSchema },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const position = await createPosition(app.prisma, req.body, req.user.id, locale, req.ip)
    return reply.code(201).send(position)
  })

  // PATCH /positions/:id — ADMIN
  server.patch('/:id', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      params: positionParamsSchema,
      body: updatePositionInputSchema,
      response: { 200: positionAdminResponseSchema },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const position = await updatePosition(app.prisma, req.params.id, req.body, req.user.id, locale, req.ip)
    return reply.send(position)
  })

  // DELETE /positions/:id — ADMIN, soft delete (บล็อกถ้ายังมี user assign อยู่)
  server.delete('/:id', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      params: positionParamsSchema,
      response: { 200: z.object({ message: z.literal('ok') }) },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    await deletePosition(app.prisma, req.params.id, req.user.id, locale, req.ip)
    return reply.send({ message: 'ok' as const })
  })
}

export default positionsRoutes
