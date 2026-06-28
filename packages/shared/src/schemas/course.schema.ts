import { z } from 'zod'

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
  createdById: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const createCourseInputSchema = z.object({
  title: z.string().min(1).max(200),
  category: z.string().min(1).max(100),
  description: z.string().max(5000).optional(),
  durationMin: z.number().int().positive().optional(),
  passScore: z.number().int().min(0).max(100).default(80),
  expiryMonths: z.number().int().positive().nullable().optional(),
})

export const updateCourseInputSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  category: z.string().min(1).max(100).optional(),
  description: z.string().max(5000).nullable().optional(),
  durationMin: z.number().int().positive().nullable().optional(),
  passScore: z.number().int().min(0).max(100).optional(),
  expiryMonths: z.number().int().positive().nullable().optional(),
})

// DRAFT → PUBLISHED หรือ PUBLISHED/DRAFT → ARCHIVED (ADMIN only)
export const updateCourseStatusSchema = z.object({
  status: z.enum(['PUBLISHED', 'ARCHIVED']),
})

export type CourseStatus = z.infer<typeof courseStatusSchema>
export type CourseResponse = z.infer<typeof courseResponseSchema>
export type CreateCourseInput = z.infer<typeof createCourseInputSchema>
export type UpdateCourseInput = z.infer<typeof updateCourseInputSchema>
export type UpdateCourseStatusInput = z.infer<typeof updateCourseStatusSchema>
