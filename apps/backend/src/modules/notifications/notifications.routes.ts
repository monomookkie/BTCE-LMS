import type { FastifyPluginAsync } from 'fastify'
import { type ZodTypeProvider } from 'fastify-type-provider-zod'
import {
  notificationParamsSchema,
  notificationListQuerySchema,
  notificationListResponseSchema,
  notificationResponseSchema,
} from './notifications.schema.js'
import {
  listNotifications,
  markOneRead,
  markAllRead,
} from './notifications.service.js'
import { resolveLocale } from '../../lib/i18n.js'
import { z } from 'zod'

const notificationsRoutes: FastifyPluginAsync = async (app) => {
  const server = app.withTypeProvider<ZodTypeProvider>()

  // ─── GET /notifications/me ────────────────────────────────────────────────
  // User ดู notification ของตัวเอง (paginated + unread count)
  server.get('/me', {
    preHandler: [app.verifyJwt],
    schema: {
      querystring: notificationListQuerySchema,
      response: { 200: notificationListResponseSchema },
    },
  }, async (req) => {
    return listNotifications(app.prisma, req.user.id, req.query)
  })

  // ─── PATCH /notifications/:id/read ───────────────────────────────────────
  // Mark single notification as read — IDOR: ตรวจ userId ใน service
  server.patch('/:id/read', {
    preHandler: [app.verifyJwt],
    schema: {
      params: notificationParamsSchema,
      response: { 200: notificationResponseSchema },
    },
  }, async (req) => {
    const locale = await resolveLocale(req, app.prisma)
    return markOneRead(app.prisma, req.user.id, req.params.id, locale)
  })

  // ─── PATCH /notifications/read-all ───────────────────────────────────────
  // Mark ALL of this user's unread notifications as read
  server.patch('/read-all', {
    preHandler: [app.verifyJwt],
    schema: {
      response: { 200: z.object({ count: z.number() }) },
    },
  }, async (req) => {
    return markAllRead(app.prisma, req.user.id)
  })
}

export default notificationsRoutes
