import type { FastifyPluginAsync } from 'fastify'
import { type ZodTypeProvider } from 'fastify-type-provider-zod'
import { loginInputSchema, changePasswordInputSchema } from '@btec-lms/shared'
import {
  loginUser,
  logoutUser,
  rotateRefreshToken,
  getMe,
  changePassword,
  ACCESS_COOKIE_OPTS,
  REFRESH_COOKIE_OPTS,
} from './auth.service.js'
import { meResponseSchema, authSuccessSchema } from './auth.schema.js'
import { unauthorized } from '../../lib/errors.js'

const authRoutes: FastifyPluginAsync = async (app) => {
  const server = app.withTypeProvider<ZodTypeProvider>()

  // POST /auth/login
  server.post(
    '/login',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        body: loginInputSchema,
        response: { 200: meResponseSchema },
      },
    },
    async (req, reply) => {
      const { accessToken, refreshToken, user } = await loginUser(
        app.prisma,
        (p) => app.jwt.sign(p),
        req.body,
        req.ip,
        req.headers['user-agent'],
      )

      reply
        .setCookie('access_token', accessToken, ACCESS_COOKIE_OPTS)
        .setCookie('refresh_token', refreshToken, REFRESH_COOKIE_OPTS)

      return reply.send(user)
    },
  )

  // POST /auth/logout
  server.post(
    '/logout',
    {
      preHandler: [app.verifyJwt],
      schema: { response: { 200: authSuccessSchema } },
    },
    async (req, reply) => {
      const refreshRaw = req.cookies['refresh_token']
      if (refreshRaw) {
        await logoutUser(app.prisma, req.user.id, refreshRaw, req.ip)
      }

      reply
        .clearCookie('access_token', { path: '/' })
        .clearCookie('refresh_token', { path: '/' })

      return reply.send({ message: 'ok' as const })
    },
  )

  // POST /auth/refresh — ต้องการ refresh_token cookie เท่านั้น (ไม่ต้องส่ง access token)
  server.post(
    '/refresh',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { response: { 200: authSuccessSchema } },
    },
    async (req, reply) => {
      const refreshRaw = req.cookies['refresh_token']
      if (!refreshRaw) throw unauthorized('Refresh token missing')

      const { accessToken, refreshToken } = await rotateRefreshToken(
        app.prisma,
        (p) => app.jwt.sign(p),
        refreshRaw,
      )

      reply
        .setCookie('access_token', accessToken, ACCESS_COOKIE_OPTS)
        .setCookie('refresh_token', refreshToken, REFRESH_COOKIE_OPTS)

      return reply.send({ message: 'ok' as const })
    },
  )

  // GET /auth/me
  server.get(
    '/me',
    {
      preHandler: [app.verifyJwt],
      schema: { response: { 200: meResponseSchema } },
    },
    async (req, reply) => {
      const user = await getMe(app.prisma, req.user.id)
      return reply.send(user)
    },
  )

  // POST /auth/change-password
  server.post(
    '/change-password',
    {
      preHandler: [app.verifyJwt],
      schema: {
        body: changePasswordInputSchema,
        response: { 200: authSuccessSchema },
      },
    },
    async (req, reply) => {
      await changePassword(app.prisma, req.user.id, req.body, req.ip)

      // clear cookies เพื่อบังคับ login ใหม่
      reply
        .clearCookie('access_token', { path: '/' })
        .clearCookie('refresh_token', { path: '/' })

      return reply.send({ message: 'ok' as const })
    },
  )
}

export default authRoutes
