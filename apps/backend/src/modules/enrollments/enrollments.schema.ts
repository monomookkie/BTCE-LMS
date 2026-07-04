import { z } from 'zod'
import { paginationQuerySchema } from '@btec-lms/shared'

export const enrollmentListQuerySchema = paginationQuerySchema.extend({
  userId: z.string().cuid().optional(),
  courseId: z.string().cuid().optional(),
  status: z.enum(['ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED']).optional(),
})

export const enrollmentParamsSchema = z.object({
  id: z.string().cuid(),
})

export const completeMaterialParamsSchema = z.object({
  id: z.string().cuid(),         // enrollmentId
  materialId: z.string().cuid(),
})

export const materialProgressInputSchema = z.object({
  watchedPercent: z.number().int().min(0).max(100),
})

export const materialProgressResponseSchema = z.object({
  materialId: z.string().cuid(),
  openedAt: z.string().datetime().nullable(),
  watchedPercent: z.number().int().min(0).max(100),
})

export type EnrollmentListQuery = z.infer<typeof enrollmentListQuerySchema>
export type MaterialProgressInput = z.infer<typeof materialProgressInputSchema>
export type MaterialProgressResponse = z.infer<typeof materialProgressResponseSchema>
