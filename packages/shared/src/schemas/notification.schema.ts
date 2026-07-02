import { z } from 'zod'

export const notificationResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  link: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
})
export type NotificationResponse = z.infer<typeof notificationResponseSchema>

export const notificationListResponseSchema = z.object({
  data: z.array(notificationResponseSchema),
  total: z.number(),
  unreadCount: z.number(),
  page: z.number(),
  limit: z.number(),
})
export type NotificationListResponse = z.infer<typeof notificationListResponseSchema>
