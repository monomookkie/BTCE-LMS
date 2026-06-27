import { z } from 'zod'

// Phase 2 で detail を追加予定 — Phase 0 は placeholder のみ
export const courseStatusSchema = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED'])

export const courseResponseSchema = z.object({
  id: z.string().cuid(),
  title: z.string(),
  category: z.string(),
  description: z.string().nullable(),
  status: courseStatusSchema,
  durationMin: z.number().int().nullable(),
  passScore: z.number().int(),
  expiryMonths: z.number().int().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export type CourseStatus = z.infer<typeof courseStatusSchema>
export type CourseResponse = z.infer<typeof courseResponseSchema>
