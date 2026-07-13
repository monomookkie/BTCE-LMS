import { z } from 'zod'

export const courseStatusSchema = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED'])

// 2C-2: แทน allowSelfEnroll เดิม — exclusive 2 แบบ (คู่เดียวเท่านั้น ไม่ใช่ toggle)
export const courseAccessTypeSchema = z.enum(['POSITION_BASED', 'PUBLIC'])

// ─── Response schemas ──────────────────────────────────────────────────────

// position ที่ผูกกับ course — ชื่อ localized เท่านั้น (raw en/th ดูผ่าน /positions/admin แยก)
export const coursePositionItemSchema = z.object({
  id: z.string().cuid(),
  name: z.string(),
})

// ข้อมูล common ที่ทุก role เห็นได้ — ผ่าน localizeField แล้ว ไม่มี raw En/Th
const courseBaseFields = {
  id: z.string().cuid(),
  title: z.string(),
  category: z.string(),
  description: z.string().nullable(),
  status: courseStatusSchema,
  expiryMonths: z.number().int().nullable(),
  enrollmentCloseAt: z.string().datetime().nullable(),
  paperSavingSheets: z.number().int().nullable(),
  accessType: courseAccessTypeSchema,
  positions: z.array(coursePositionItemSchema),
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
  expiryMonths: z.number().int().positive().nullable().optional(),
  enrollmentCloseAt: z.string().datetime().nullable().optional(),
  paperSavingSheets: z.number().int().positive().nullable().optional(),
  accessType: courseAccessTypeSchema.default('PUBLIC'),
})

export const updateCourseInputSchema = z.object({
  titleEn: z.string().min(1).max(200).optional(),
  titleTh: z.string().max(200).nullable().optional(),
  categoryEn: z.string().min(1).max(100).optional(),
  categoryTh: z.string().max(100).nullable().optional(),
  descriptionEn: z.string().max(5000).nullable().optional(),
  descriptionTh: z.string().max(5000).nullable().optional(),
  expiryMonths: z.number().int().positive().nullable().optional(),
  enrollmentCloseAt: z.string().datetime().nullable().optional(),
  paperSavingSheets: z.number().int().positive().nullable().optional(),
  accessType: courseAccessTypeSchema.optional(),
})

// DRAFT → PUBLISHED หรือ PUBLISHED/DRAFT → ARCHIVED (ADMIN only)
export const updateCourseStatusSchema = z.object({
  status: z.enum(['PUBLISHED', 'ARCHIVED']),
})

// PUT /courses/:id/positions — replace ทั้งชุด (ง่ายกว่ามี add/remove endpoint แยก)
export const setCoursePositionsInputSchema = z.object({
  positionIds: z.array(z.string().cuid()),
})

// ─── Types ─────────────────────────────────────────────────────────────────

export type CourseStatus = z.infer<typeof courseStatusSchema>
export type CourseAccessType = z.infer<typeof courseAccessTypeSchema>
export type CoursePositionItem = z.infer<typeof coursePositionItemSchema>
export type CoursePublicResponse = z.infer<typeof coursePublicResponseSchema>
export type CourseAdminResponse = z.infer<typeof courseAdminResponseSchema>
export type CreateCourseInput = z.infer<typeof createCourseInputSchema>
export type UpdateCourseInput = z.infer<typeof updateCourseInputSchema>
export type UpdateCourseStatusInput = z.infer<typeof updateCourseStatusSchema>
export type SetCoursePositionsInput = z.infer<typeof setCoursePositionsInputSchema>
