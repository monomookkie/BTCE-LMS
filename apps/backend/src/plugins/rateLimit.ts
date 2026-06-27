import fp from 'fastify-plugin'
import rateLimit from '@fastify/rate-limit'
import type { FastifyPluginAsync } from 'fastify'

const rateLimitPlugin: FastifyPluginAsync = fp(async (app) => {
  await app.register(rateLimit, {
    global: true,
    max: 200,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'คุณส่งคำขอมากเกินไป กรุณารอสักครู่แล้วลองใหม่',
    }),
  })
})

export default rateLimitPlugin
