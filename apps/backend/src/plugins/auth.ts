import fp from 'fastify-plugin'
import jwt from '@fastify/jwt'
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import type { Role } from '@prisma/client'
import { env } from '../config/env.js'

interface JwtPayload {
  sub: string
  role: Role
}

// ตั้งค่า type ของ req.user ผ่าน @fastify/jwt เพื่อหลีกเลี่ยง type conflict
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload
    user: { id: string; role: Role }
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    verifyJwt: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
    requireRole: (roles: Role[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

async function extractUser(req: FastifyRequest): Promise<void> {
  const token = req.cookies['access_token']
  if (!token) {
    const err = new Error('Authentication required') as Error & { statusCode: number }
    err.statusCode = 401
    throw err
  }
  try {
    const payload = req.server.jwt.verify<JwtPayload>(token)
    req.user = { id: payload.sub, role: payload.role }
  } catch {
    const err = new Error('Invalid or expired token') as Error & { statusCode: number }
    err.statusCode = 401
    throw err
  }
}

const authPlugin: FastifyPluginAsync = fp(async (app) => {
  await app.register(jwt, { secret: env.JWT_SECRET })

  app.decorate('verifyJwt', async (req: FastifyRequest, _reply: FastifyReply) => {
    await extractUser(req)
  })

  app.decorate(
    'requireRole',
    (roles: Role[]) => async (req: FastifyRequest, _reply: FastifyReply) => {
      await extractUser(req)
      if (!roles.includes(req.user.role)) {
        const err = new Error('Insufficient permissions') as Error & { statusCode: number }
        err.statusCode = 403
        throw err
      }
    },
  )
})

export default authPlugin
