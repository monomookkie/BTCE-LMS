import { z } from 'zod'

export const materialTypeSchema = z.enum(['PDF', 'VIDEO', 'LINK', 'IMAGE', 'DOC'])

// ─── Response schemas ──────────────────────────────────────────────────────

// ข้อมูล common — ผ่าน localizeField แล้ว ไม่มี raw En/Th
const materialBaseFields = {
  id: z.string().cuid(),
  courseId: z.string().cuid(),
  type: materialTypeSchema,
  title: z.string(),       // localized
  fileKey: z.string().nullable(),
  url: z.string().nullable(),
  signedUrl: z.string().nullable(), // computed at response time — ไม่เก็บใน DB
  mimeType: z.string().nullable(),
  sizeBytes: z.number().int().nullable(),
  order: z.number().int(),
  createdAt: z.string().datetime(),
}

// USER-facing (enrolled user) — localized fields เท่านั้น
export const materialPublicResponseSchema = z.object(materialBaseFields)

// ADMIN/MANAGER-facing — ครบทั้ง localized + raw En/Th (สำหรับ edit form)
export const materialAdminResponseSchema = z.object({
  ...materialBaseFields,
  titleEn: z.string(),
  titleTh: z.string().nullable(),
})

// ─── Input schemas ─────────────────────────────────────────────────────────

// สำหรับ VIDEO / LINK — ส่งเป็น JSON ปกติ
export const createLinkMaterialInputSchema = z.object({
  type: z.enum(['VIDEO', 'LINK']),
  titleEn: z.string().min(1).max(200),
  titleTh: z.string().max(200).optional(),
  url: z.string().url(),
  order: z.number().int().min(0).optional(),
})

// metadata ที่ส่งมาพร้อม multipart upload (PDF / IMAGE / DOC)
export const createFileMaterialMetaSchema = z.object({
  type: z.enum(['PDF', 'IMAGE', 'DOC']),
  titleEn: z.string().min(1).max(200),
  titleTh: z.string().max(200).optional(),
  order: z.number().int().min(0).optional(),
})

export const updateMaterialInputSchema = z.object({
  titleEn: z.string().min(1).max(200).optional(),
  titleTh: z.string().max(200).nullable().optional(),
  url: z.string().url().optional(),
  order: z.number().int().min(0).optional(),
})

export const reorderMaterialsInputSchema = z.object({
  // ลำดับ array = ลำดับ order ใหม่ (index 0 = order 0)
  materialIds: z.array(z.string().cuid()).min(1),
})

// ─── Types ─────────────────────────────────────────────────────────────────

export type MaterialType = z.infer<typeof materialTypeSchema>
export type MaterialPublicResponse = z.infer<typeof materialPublicResponseSchema>
export type MaterialAdminResponse = z.infer<typeof materialAdminResponseSchema>
export type CreateLinkMaterialInput = z.infer<typeof createLinkMaterialInputSchema>
export type CreateFileMaterialMeta = z.infer<typeof createFileMaterialMetaSchema>
export type UpdateMaterialInput = z.infer<typeof updateMaterialInputSchema>
export type ReorderMaterialsInput = z.infer<typeof reorderMaterialsInputSchema>
