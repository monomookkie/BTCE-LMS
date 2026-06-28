import type { FastifyPluginAsync } from 'fastify'
import { type ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import {
  userResponseSchema,
  createUserInputSchema,
  updateUserInputSchema,
  updateProfileInputSchema,
  consentInputSchema,
} from '@btec-lms/shared'
import { userListQuerySchema, importResultSchema } from './users.schema.js'
import {
  listUsers,
  createUser,
  getUser,
  updateUser,
  softDeleteUser,
  importFromCsv,
  getProfile,
  updateProfile,
  recordConsent,
} from './users.service.js'
import { badRequest } from '../../lib/errors.js'

const usersRoutes: FastifyPluginAsync = async (app) => {
  const server = app.withTypeProvider<ZodTypeProvider>()

  const userListResponseSchema = z.object({
    data: z.array(userResponseSchema),
    total: z.number(),
    page: z.number(),
    limit: z.number(),
  })

  // GET /users — ADMIN/MANAGER
  server.get(
    '/',
    {
      preHandler: [app.requireRole(['ADMIN', 'MANAGER'])],
      schema: {
        querystring: userListQuerySchema,
        response: { 200: userListResponseSchema },
      },
    },
    async (req, reply) => {
      const result = await listUsers(app.prisma, req.query, req.user.id, req.ip)
      return reply.send(result)
    },
  )

  // POST /users — ADMIN
  server.post(
    '/',
    {
      preHandler: [app.requireRole(['ADMIN'])],
      schema: {
        body: createUserInputSchema,
        response: { 201: userResponseSchema },
      },
    },
    async (req, reply) => {
      const user = await createUser(app.prisma, req.body, req.user.id, req.ip)
      return reply.status(201).send(user)
    },
  )

  // GET /users/me — ต้องมาก่อน /:id เพื่อป้องกัน route conflict
  server.get(
    '/me',
    {
      preHandler: [app.verifyJwt],
      schema: { response: { 200: userResponseSchema } },
    },
    async (req, reply) => {
      const user = await getProfile(app.prisma, req.user.id)
      return reply.send(user)
    },
  )

  // PATCH /users/me
  server.patch(
    '/me',
    {
      preHandler: [app.verifyJwt],
      schema: {
        body: updateProfileInputSchema,
        response: { 200: userResponseSchema },
      },
    },
    async (req, reply) => {
      const user = await updateProfile(app.prisma, req.user.id, req.body, req.ip)
      return reply.send(user)
    },
  )

  // POST /users/me/consent — บันทึก PDPA consent
  server.post(
    '/me/consent',
    {
      preHandler: [app.verifyJwt],
      schema: {
        body: consentInputSchema,
        response: { 200: z.object({ message: z.literal('ok') }) },
      },
    },
    async (req, reply) => {
      await recordConsent(app.prisma, req.user.id, req.body, req.ip)
      return reply.send({ message: 'ok' as const })
    },
  )

  // POST /users/import — CSV bulk import, ADMIN only, rate limited to 3/min
  server.post(
    '/import',
    {
      config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
      preHandler: [app.requireRole(['ADMIN'])],
      schema: { response: { 200: importResultSchema } },
    },
    async (req, reply) => {
      const file = await req.file()
      if (!file) throw badRequest('No file uploaded')

      const mimeOk =
        file.mimetype === 'text/csv' ||
        file.mimetype === 'text/plain' ||
        file.mimetype === 'application/vnd.ms-excel'
      if (!mimeOk) throw badRequest('กรุณาอัปโหลดไฟล์ CSV')

      const buffer = await file.toBuffer()
      const result = await importFromCsv(app.prisma, buffer, req.user.id, req.ip)
      return reply.send(result)
    },
  )

  // GET /users/:id — ADMIN/MANAGER
  server.get(
    '/:id',
    {
      preHandler: [app.requireRole(['ADMIN', 'MANAGER'])],
      schema: {
        params: z.object({ id: z.string().cuid() }),
        response: { 200: userResponseSchema },
      },
    },
    async (req, reply) => {
      const user = await getUser(app.prisma, req.params.id, req.user.id, req.ip)
      return reply.send(user)
    },
  )

  // PATCH /users/:id — ADMIN
  server.patch(
    '/:id',
    {
      preHandler: [app.requireRole(['ADMIN'])],
      schema: {
        params: z.object({ id: z.string().cuid() }),
        body: updateUserInputSchema,
        response: { 200: userResponseSchema },
      },
    },
    async (req, reply) => {
      const user = await updateUser(app.prisma, req.params.id, req.body, req.user.id, req.ip)
      return reply.send(user)
    },
  )

  // DELETE /users/:id — ADMIN, soft delete
  server.delete(
    '/:id',
    {
      preHandler: [app.requireRole(['ADMIN'])],
      schema: {
        params: z.object({ id: z.string().cuid() }),
        response: { 200: z.object({ message: z.literal('ok') }) },
      },
    },
    async (req, reply) => {
      await softDeleteUser(app.prisma, req.params.id, req.user.id, req.ip)
      return reply.send({ message: 'ok' as const })
    },
  )
}

export default usersRoutes
