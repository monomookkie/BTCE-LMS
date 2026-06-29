import { z } from 'zod'

// ─── Announcement type enum ───────────────────────────────────────────────────

export const announcementTypeSchema = z.enum(['INFO', 'WARNING', 'URGENT'])
export type AnnouncementType = z.infer<typeof announcementTypeSchema>

export const announcementStatusSchema = z.enum(['DRAFT', 'PUBLISHED'])
export type AnnouncementStatus = z.infer<typeof announcementStatusSchema>

// ─── Convention #12: public/admin response split ─────────────────────────────

const announcementBaseFields = {
  id: z.string().cuid(),
  title: z.string(),    // localized
  content: z.string(),  // localized
  type: z.string(),
  fileSignedUrl: z.string().nullable(),
  link: z.string().nullable(),
  publishedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
}

// USER — localized fields only; status not exposed (always PUBLISHED for USER)
export const announcementPublicResponseSchema = z.object(announcementBaseFields)
export type AnnouncementPublicResponse = z.infer<typeof announcementPublicResponseSchema>

// ADMIN/MANAGER — superset: localized + raw bilingual + admin metadata
export const announcementAdminResponseSchema = z.object({
  ...announcementBaseFields,
  titleEn: z.string(),
  titleTh: z.string().nullable(),
  contentEn: z.string(),
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

// ─── Input schemas ────────────────────────────────────────────────────────────

// POST — parsed from multipart fields
export const createAnnouncementInputSchema = z.object({
  titleEn: z.string().min(1).max(255),
  titleTh: z.string().max(255).optional(),
  contentEn: z.string().min(1),
  contentTh: z.string().optional(),
  type: announcementTypeSchema.default('INFO'),
  link: z.string().url().optional(),
  status: announcementStatusSchema.default('DRAFT'),
})
export type CreateAnnouncementInput = z.infer<typeof createAnnouncementInputSchema>

// PATCH — JSON body; all optional
export const updateAnnouncementInputSchema = z.object({
  titleEn: z.string().min(1).max(255).optional(),
  titleTh: z.string().max(255).nullable().optional(),
  contentEn: z.string().min(1).optional(),
  contentTh: z.string().nullable().optional(),
  type: announcementTypeSchema.optional(),
  link: z.string().url().nullable().optional(),
  status: announcementStatusSchema.optional(),
})
export type UpdateAnnouncementInput = z.infer<typeof updateAnnouncementInputSchema>
