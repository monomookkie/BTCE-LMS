import { z } from 'zod'

export const materialTypeSchema = z.enum(['PDF', 'VIDEO', 'LINK', 'IMAGE', 'DOC'])

export const materialResponseSchema = z.object({
  id: z.string().cuid(),
  courseId: z.string().cuid(),
  type: materialTypeSchema,
  title: z.string(),
  fileKey: z.string().nullable(),
  url: z.string().nullable(),
  signedUrl: z.string().nullable(), // computed at response time — ไม่เก็บใน DB
  mimeType: z.string().nullable(),
  sizeBytes: z.number().int().nullable(),
  order: z.number().int(),
  createdAt: z.string().datetime(),
})

// สำหรับ VIDEO / LINK — ส่งเป็น JSON ปกติ
export const createLinkMaterialInputSchema = z.object({
  type: z.enum(['VIDEO', 'LINK']),
  title: z.string().min(1).max(200),
  url: z.string().url(),
  order: z.number().int().min(0).optional(),
})

// metadata ที่ส่งมาพร้อม multipart upload (PDF / IMAGE / DOC)
export const createFileMaterialMetaSchema = z.object({
  type: z.enum(['PDF', 'IMAGE', 'DOC']),
  title: z.string().min(1).max(200),
  order: z.number().int().min(0).optional(),
})

export const updateMaterialInputSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  url: z.string().url().optional(),
  order: z.number().int().min(0).optional(),
})

export const reorderMaterialsInputSchema = z.object({
  // ลำดับ array = ลำดับ order ใหม่ (index 0 = order 0)
  materialIds: z.array(z.string().cuid()).min(1),
})

export type MaterialType = z.infer<typeof materialTypeSchema>
export type MaterialResponse = z.infer<typeof materialResponseSchema>
export type CreateLinkMaterialInput = z.infer<typeof createLinkMaterialInputSchema>
export type CreateFileMaterialMeta = z.infer<typeof createFileMaterialMetaSchema>
export type UpdateMaterialInput = z.infer<typeof updateMaterialInputSchema>
export type ReorderMaterialsInput = z.infer<typeof reorderMaterialsInputSchema>
