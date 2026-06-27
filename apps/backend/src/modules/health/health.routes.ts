import type { FastifyPluginAsync } from 'fastify'

const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string' },
            uptime: { type: 'number' },
          },
        },
      },
    },
  }, async (_req, reply) => {
    // ตรวจ DB connection ด้วย
    await app.prisma.$queryRaw`SELECT 1`
    return reply.send({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    })
  })
}

export default healthRoutes
