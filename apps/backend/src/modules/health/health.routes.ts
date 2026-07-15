import type { FastifyPluginAsync } from 'fastify'
import { type ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

const APP_VERSION = process.env['npm_package_version'] ?? '0.0.0'

// serializer compiler ทั่วแอปเป็น fastify-type-provider-zod (ดู plugins/) — schema.response ต้องเป็น
// Zod schema เสมอ ไม่ใช่ raw JSON-schema object ธรรมดา ไม่งั้น serializer จะเรียก .safeParse ไม่เจอแล้ว 500
const healthResponseSchema = z.object({
  status: z.string(),
  version: z.string(),
  timestamp: z.string(),
  uptime: z.number(),
  db: z.string(),
})

const healthRoutes: FastifyPluginAsync = async (app) => {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.get('/health', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
      response: {
        200: healthResponseSchema,
        503: healthResponseSchema,
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
