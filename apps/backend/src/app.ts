import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { env } from './config/env.js'
import { logger } from './lib/logger.js'

// plugins
import prismaPlugin from './plugins/prisma.js'
import securityPlugin from './plugins/security.js'
import rateLimitPlugin from './plugins/rateLimit.js'
import authPlugin from './plugins/auth.js'

// modules
import healthRoutes from './modules/health/health.routes.js'
import authRoutes from './modules/auth/auth.routes.js'
import usersRoutes from './modules/users/users.routes.js'
import coursesRoutes from './modules/courses/courses.routes.js'
import materialsRoutes from './modules/materials/materials.routes.js'
import enrollmentsRoutes from './modules/enrollments/enrollments.routes.js'
import quizzesRoutes from './modules/quizzes/quizzes.routes.js'

export async function buildApp() {
  const app = Fastify({
    logger,
    trustProxy: true, // Railway / Vercel ส่ง X-Forwarded-For มา
  })

  // Zod type provider — ต้องตั้งก่อน register routes
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  // --- Core plugins (ลงทะเบียนก่อน route) ---
  await app.register(cookie, {
    secret: env.COOKIE_SECRET,
    hook: 'onRequest',
  })

  await app.register(multipart, {
    limits: {
      fileSize: 5 * 1024 * 1024, // 5 MB
      files: 1,
    },
  })

  await app.register(securityPlugin)
  await app.register(rateLimitPlugin)
  await app.register(prismaPlugin)
  await app.register(authPlugin)

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
  await app.register(authRoutes, { prefix: '/auth' })
  await app.register(usersRoutes, { prefix: '/users' })
  await app.register(coursesRoutes, { prefix: '/courses' })
  await app.register(materialsRoutes, { prefix: '/courses' })
  await app.register(enrollmentsRoutes, { prefix: '/enrollments' })
  await app.register(quizzesRoutes, { prefix: '/courses' })

  return app
}
