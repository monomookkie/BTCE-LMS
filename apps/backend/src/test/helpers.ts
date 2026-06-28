import type { FastifyInstance } from 'fastify'
import type { InjectOptions } from 'fastify'
import type { OutgoingHttpHeaders } from 'node:http'
import { PrismaClient } from '@prisma/client'
import { buildApp } from '../app.js'
import { hashPassword } from '../lib/password.js'

export type TestApp = Awaited<ReturnType<typeof buildApp>>

// Prisma client สำหรับ seed ข้อมูลใน tests
export const prisma = new PrismaClient()

/** แปลง set-cookie header เป็น Cookie header สำหรับ request ถัดไป */
export function extractCookies(res: { headers: OutgoingHttpHeaders }): string {
  // set-cookie เป็น string | string[] ในทางปฏิบัติ (ไม่ใช่ number)
  const raw = res.headers['set-cookie'] as string | string[] | undefined
  if (!raw) return ''
  const arr = Array.isArray(raw) ? raw : [raw]
  return arr.map((c) => c.split(';')[0]!).join('; ')
}

/** สร้าง Fastify app สำหรับ test (ใช้ test DB จาก env) */
export async function buildTestApp(): Promise<TestApp> {
  return buildApp()
}

interface CreateUserOpts {
  email?: string
  password?: string
  name?: string
  role?: 'ADMIN' | 'MANAGER' | 'USER'
  isActive?: boolean
  mustChangePassword?: boolean
}

/** สร้าง user ใน test DB และ return ทั้ง user record + plaintext password */
export async function createUser(opts: CreateUserOpts = {}): Promise<{
  user: { id: string; email: string; role: string }
  plainPassword: string
}> {
  const plainPassword = opts.password ?? 'TestPass1!'
  const user = await prisma.user.create({
    data: {
      email: opts.email ?? `user-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`,
      password: await hashPassword(plainPassword),
      name: opts.name ?? 'Test User',
      role: opts.role ?? 'USER',
      isActive: opts.isActive ?? true,
      mustChangePassword: opts.mustChangePassword ?? false,
    },
    select: { id: true, email: true, role: true },
  })
  return { user, plainPassword }
}

/** Login และ return cookies header string */
export async function loginAs(
  app: FastifyInstance,
  email: string,
  password: string,
): Promise<{ statusCode: number; cookies: string; body: unknown }> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password },
  } satisfies InjectOptions)

  return {
    statusCode: res.statusCode,
    cookies: extractCookies(res),
    body: res.json(),
  }
}
