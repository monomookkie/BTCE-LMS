import fp from 'fastify-plugin'
import helmet from '@fastify/helmet'
import cors from '@fastify/cors'
import type { FastifyPluginAsync } from 'fastify'
import { env } from '../config/env.js'

const securityPlugin: FastifyPluginAsync = fp(async (app) => {
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https://res.cloudinary.com'],
        connectSrc: ["'self'"],
      },
    },
  })

  await app.register(cors, {
    origin: env.CORS_ORIGIN,
    credentials: true, // ต้องเปิดไว้เพราะใช้ cookie
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })
})

export default securityPlugin
