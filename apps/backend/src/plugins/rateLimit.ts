import fp from 'fastify-plugin'
import rateLimit from '@fastify/rate-limit'
import type { FastifyPluginAsync } from 'fastify'
import { env } from '../config/env.js'

const rateLimitPlugin: FastifyPluginAsync = fp(async (app) => {
  await app.register(rateLimit, {
    global: true,
    max: 200,
    timeWindow: '1 minute',
    // inject() ใช้ 127.0.0.1 เสมอ — bypass ใน test เพื่อไม่ให้ชน login rate limit
    ...(env.NODE_ENV === 'test' && { allowList: ['127.0.0.1'] }),
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'คุณส่งคำขอมากเกินไป กรุณารอสักครู่แล้วลองใหม่',
    }),
  })
})

export default rateLimitPlugin
