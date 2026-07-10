import { z } from 'zod'

export const extCertListQuerySchema = z.object({
  userId: z.string().cuid().optional(),
})
export type ExtCertListQuery = z.infer<typeof extCertListQuerySchema>

export const extCertParamsSchema = z.object({
  id: z.string().cuid(),
})
export type ExtCertParams = z.infer<typeof extCertParamsSchema>
