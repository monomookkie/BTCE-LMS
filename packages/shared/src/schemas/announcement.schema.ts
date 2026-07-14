import { z } from 'zod'

// ─── Announcement status enum ─────────────────────────────────────────────────

export const announcementStatusSchema = z.enum(['DRAFT', 'PUBLISHED'])
export type AnnouncementStatus = z.infer<typeof announcementStatusSchema>

// ─── Convention #12: public/admin response split ─────────────────────────────

const announcementBaseFields = {
  id: z.string().cuid(),
  title: z.string(),           // localized
  content: z.string().nullable(), // localized — "ข้อความเพิ่มเติม" ไม่บังคับ (รูปภาพคือเนื้อหาหลัก)
  fileSignedUrl: z.string().nullable(),
  link: z.string().nullable(),
  publishedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
}

// USER — localized fields only; status not exposed (always PUBLISHED for USER)
export const announcementPublicResponseSchema = z.object(announcementBaseFields)
export type AnnouncementPublicResponse = z.infer<typeof announcementPublicResponseSchema>

// ADMIN — superset: localized + raw bilingual + admin metadata
export const announcementAdminResponseSchema = z.object({
  ...announcementBaseFields,
  titleEn: z.string(),
  titleTh: z.string().nullable(),
  contentEn: z.string().nullable(),
  contentTh: z.string().nullable(),
  status: announcementStatusSchema,
  fileKey: z.string().nullable(),
  createdById: z.string().nullable(),
  updatedAt: z.string().datetime(),
})
export type AnnouncementAdminResponse = z.infer<typeof announcementAdminResponseSchema>

// ─── List response ────────────────────────────────────────────────────────────

export const announcementListPublicSchema = z.object({
  data: z.array(announcementPublicResponseSchema),
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
})
export type AnnouncementListPublic = z.infer<typeof announcementListPublicSchema>

export const announcementListAdminSchema = z.object({
  data: z.array(announcementAdminResponseSchema),
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
})
export type AnnouncementListAdmin = z.infer<typeof announcementListAdminSchema>

// GET /announcements/latest — null เมื่อไม่มีประกาศ PUBLISHED เลย (ใช้กับ dashboard board + login popup)
export const latestAnnouncementResponseSchema = announcementPublicResponseSchema.nullable()
export type LatestAnnouncementResponse = z.infer<typeof latestAnnouncementResponseSchema>

// ─── Input schemas ────────────────────────────────────────────────────────────

// POST — parsed from multipart fields
// contentEn: "ข้อความเพิ่มเติม" ไม่บังคับ — รูปภาพ (file) คือเนื้อหาหลัก และบังคับเมื่อ status=PUBLISHED
// (เช็คที่ route handler เพราะ file มาจาก multipart part แยกจาก field ธรรมดา ไม่ใช่ผ่าน schema นี้)
export const createAnnouncementInputSchema = z.object({
  titleEn: z.string().min(1).max(255),
  titleTh: z.string().max(255).optional(),
  contentEn: z.string().optional(),
  contentTh: z.string().optional(),
  link: z.string().url().optional(),
  status: announcementStatusSchema.default('DRAFT'),
})
export type CreateAnnouncementInput = z.infer<typeof createAnnouncementInputSchema>

// PATCH — JSON body; all optional
export const updateAnnouncementInputSchema = z.object({
  titleEn: z.string().min(1).max(255).optional(),
  titleTh: z.string().max(255).nullable().optional(),
  contentEn: z.string().nullable().optional(),
  contentTh: z.string().nullable().optional(),
  link: z.string().url().nullable().optional(),
  status: announcementStatusSchema.optional(),
})
export type UpdateAnnouncementInput = z.infer<typeof updateAnnouncementInputSchema>
