import type { FastifyPluginAsync } from 'fastify'
import { type ZodTypeProvider } from 'fastify-type-provider-zod'
import { loginInputSchema, registerInputSchema, changePasswordInputSchema } from '@btec-lms/shared'
import {
  loginUser,
  registerUser,
  logoutUser,
  rotateRefreshToken,
  getMe,
  changePassword,
  ACCESS_COOKIE_OPTS,
  REFRESH_COOKIE_OPTS,
} from './auth.service.js'
import { meResponseSchema, authSuccessSchema } from './auth.schema.js'
import { unauthorized } from '../../lib/errors.js'
import { t, resolveLocale } from '../../lib/i18n.js'

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
      const locale = await resolveLocale(req, app.prisma)
      const { accessToken, refreshToken, user } = await loginUser(
        app.prisma,
        (p) => app.jwt.sign(p),
        req.body,
        locale,
        req.ip,
        req.headers['user-agent'],
      )

      reply
        .setCookie('access_token', accessToken, ACCESS_COOKIE_OPTS)
        .setCookie('refresh_token', refreshToken, REFRESH_COOKIE_OPTS)

      return reply.send(user)
    },
  )

  // POST /auth/register — public, self-registration. role hardcode USER ฝั่ง
  // service เสมอ, จำกัดเฉพาะอีเมล @redcross.or.th (validate ทั้ง schema + service)
  server.post(
    '/register',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        body: registerInputSchema,
        response: { 201: meResponseSchema },
      },
    },
    async (req, reply) => {
      const locale = await resolveLocale(req, app.prisma)
      const { accessToken, refreshToken, user } = await registerUser(
        app.prisma,
        (p) => app.jwt.sign(p),
        req.body,
        locale,
        req.ip,
        req.headers['user-agent'],
      )

      reply
        .setCookie('access_token', accessToken, ACCESS_COOKIE_OPTS)
        .setCookie('refresh_token', refreshToken, REFRESH_COOKIE_OPTS)

      return reply.status(201).send(user)
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
      const locale = await resolveLocale(req, app.prisma)
      if (!refreshRaw) throw unauthorized(t('error.auth.refreshTokenMissing', undefined, locale))

      const { accessToken, refreshToken } = await rotateRefreshToken(
        app.prisma,
        (p) => app.jwt.sign(p),
        refreshRaw,
        locale,
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
      const locale = await resolveLocale(req, app.prisma)
      const user = await getMe(app.prisma, req.user.id, locale)
      return reply.send(user)
    },
  )

  // POST /auth/change-password
  server.post(
    '/change-password',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      preHandler: [app.verifyJwt],
      schema: {
        body: changePasswordInputSchema,
        response: { 200: authSuccessSchema },
      },
    },
    async (req, reply) => {
      const locale = await resolveLocale(req, app.prisma)
      await changePassword(app.prisma, req.user.id, req.body, locale, req.ip)

      // clear cookies เพื่อบังคับ login ใหม่
      reply
        .clearCookie('access_token', { path: '/' })
        .clearCookie('refresh_token', { path: '/' })

      return reply.send({ message: 'ok' as const })
    },
  )
}

export default authRoutes
