import { z } from 'zod'

export const courseStatusSchema = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED'])

// ─── Response schemas ──────────────────────────────────────────────────────

// ข้อมูล common ที่ทุก role เห็นได้ — ผ่าน localizeField แล้ว ไม่มี raw En/Th
const courseBaseFields = {
  id: z.string().cuid(),
  title: z.string(),
  category: z.string(),
  description: z.string().nullable(),
  status: courseStatusSchema,
  durationMin: z.number().int().nullable(),
  passScore: z.number().int(),
  expiryMonths: z.number().int().nullable(),
  allowSelfEnroll: z.boolean(),
  createdById: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}

// USER-facing — localized fields เท่านั้น ไม่มี raw En/Th
export const coursePublicResponseSchema = z.object(courseBaseFields)

// ADMIN-facing — ครบทั้ง localized + raw En/Th (สำหรับ edit form)
export const courseAdminResponseSchema = z.object({
  ...courseBaseFields,
  titleEn: z.string(),
  titleTh: z.string().nullable(),
  categoryEn: z.string(),
  categoryTh: z.string().nullable(),
  descriptionEn: z.string().nullable(),
  descriptionTh: z.string().nullable(),
})

// ─── Input schemas ─────────────────────────────────────────────────────────

export const createCourseInputSchema = z.object({
  titleEn: z.string().min(1).max(200),
  titleTh: z.string().max(200).optional(),
  categoryEn: z.string().min(1).max(100),
  categoryTh: z.string().max(100).optional(),
  descriptionEn: z.string().max(5000).optional(),
  descriptionTh: z.string().max(5000).optional(),
  durationMin: z.number().int().positive().optional(),
  passScore: z.number().int().min(0).max(100).default(80),
  expiryMonths: z.number().int().positive().nullable().optional(),
  allowSelfEnroll: z.boolean().default(false),
})

export const updateCourseInputSchema = z.object({
  titleEn: z.string().min(1).max(200).optional(),
  titleTh: z.string().max(200).nullable().optional(),
  categoryEn: z.string().min(1).max(100).optional(),
  categoryTh: z.string().max(100).nullable().optional(),
  descriptionEn: z.string().max(5000).nullable().optional(),
  descriptionTh: z.string().max(5000).nullable().optional(),
  durationMin: z.number().int().positive().nullable().optional(),
  passScore: z.number().int().min(0).max(100).optional(),
  expiryMonths: z.number().int().positive().nullable().optional(),
  allowSelfEnroll: z.boolean().optional(),
})

// DRAFT → PUBLISHED หรือ PUBLISHED/DRAFT → ARCHIVED (ADMIN only)
export const updateCourseStatusSchema = z.object({
  status: z.enum(['PUBLISHED', 'ARCHIVED']),
})

// ─── Types ─────────────────────────────────────────────────────────────────

export type CourseStatus = z.infer<typeof courseStatusSchema>
export type CoursePublicResponse = z.infer<typeof coursePublicResponseSchema>
export type CourseAdminResponse = z.infer<typeof courseAdminResponseSchema>
export type CreateCourseInput = z.infer<typeof createCourseInputSchema>
export type UpdateCourseInput = z.infer<typeof updateCourseInputSchema>
export type UpdateCourseStatusInput = z.infer<typeof updateCourseStatusSchema>
