import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import { env } from './config/env.js'
import { logger } from './lib/logger.js'

// plugins
import prismaPlugin from './plugins/prisma.js'
import securityPlugin from './plugins/security.js'
import rateLimitPlugin from './plugins/rateLimit.js'

// modules
import healthRoutes from './modules/health/health.routes.js'

export async function buildApp() {
  const app = Fastify({
    logger,
    trustProxy: true, // Railway / Vercel ส่ง X-Forwarded-For มา
  })

  // --- Core plugins (ลงทะเบียนก่อน route) ---
  await app.register(cookie, {
    secret: env.COOKIE_SECRET,
    hook: 'onRequest',
  })

  await app.register(securityPlugin)
  await app.register(rateLimitPlugin)
  await app.register(prismaPlugin)

  // --- Global error handler ---
  app.setErrorHandler((error, _req, reply) => {
    logger.error(error)

    if (error.validation) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Validation Error',
        message: error.message,
        details: error.validation,
      })
    }

    const statusCode = error.statusCode ?? 500
    return reply.status(statusCode).send({
      statusCode,
      error: error.name,
      message:
        statusCode >= 500 && env.NODE_ENV === 'production'
          ? 'เกิดข้อผิดพลาดภายในระบบ'
          : error.message,
    })
  })

  // --- Routes ---
  await app.register(healthRoutes)

  return app
}
