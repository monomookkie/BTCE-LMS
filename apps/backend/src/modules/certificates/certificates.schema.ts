import { z } from 'zod'

export const certParamsSchema = z.object({
  id: z.string().cuid(),
})
export type CertParams = z.infer<typeof certParamsSchema>

export const certListQuerySchema = z.object({
  userId: z.string().cuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})
export type CertListQuery = z.infer<typeof certListQuerySchema>

// hash = verifyHash (UUID v4) — public verify endpoint
export const certVerifyParamsSchema = z.object({
  hash: z.string().uuid(),
})
export type CertVerifyParams = z.infer<typeof certVerifyParamsSchema>

export const extCertParamsSchema = z.object({
  id: z.string().cuid(),
})
export type ExtCertParams = z.infer<typeof extCertParamsSchema>
