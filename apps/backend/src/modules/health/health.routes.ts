import type { FastifyPluginAsync } from 'fastify'

const APP_VERSION = process.env['npm_package_version'] ?? '0.0.0'

const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            version: { type: 'string' },
            timestamp: { type: 'string' },
            uptime: { type: 'number' },
            db: { type: 'string' },
          },
        },
        503: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            version: { type: 'string' },
            timestamp: { type: 'string' },
            uptime: { type: 'number' },
            db: { type: 'string' },
          },
        },
      },
    },
  }, async (_req, reply) => {
    let dbStatus: 'ok' | 'unreachable' = 'ok'
    try {
      await app.prisma.$queryRaw`SELECT 1`
    } catch {
      dbStatus = 'unreachable'
    }

    const body = {
      status: dbStatus === 'ok' ? 'ok' : 'degraded',
      version: APP_VERSION,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      db: dbStatus,
    }

    return reply.code(dbStatus === 'ok' ? 200 : 503).send(body)
  })
}

export default healthRoutes
