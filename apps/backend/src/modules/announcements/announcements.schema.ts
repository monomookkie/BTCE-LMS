import { z } from 'zod'

export const announcementParamsSchema = z.object({
  id: z.string().cuid(),
})

export const announcementListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export type AnnouncementParams = z.infer<typeof announcementParamsSchema>
export type AnnouncementListQuery = z.infer<typeof announcementListQuerySchema>
