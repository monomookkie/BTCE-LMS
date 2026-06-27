import fp from 'fastify-plugin'
import type { FastifyPluginAsync } from 'fastify'
import { prisma } from '../lib/prisma.js'

declare module 'fastify' {
  interface FastifyInstance {
    prisma: typeof prisma
  }
}

const prismaPlugin: FastifyPluginAsync = fp(async (app) => {
  app.decorate('prisma', prisma)

  app.addHook('onClose', async () => {
    await prisma.$disconnect()
  })
})

export default prismaPlugin
