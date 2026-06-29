import { z } from 'zod'

export const notificationParamsSchema = z.object({
  id: z.string().cuid(),
})

export const notificationListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export const notificationResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  link: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
})

export const notificationListResponseSchema = z.object({
  data: z.array(notificationResponseSchema),
  total: z.number(),
  unreadCount: z.number(),
  page: z.number(),
  limit: z.number(),
})

export type NotificationParams = z.infer<typeof notificationParamsSchema>
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>
