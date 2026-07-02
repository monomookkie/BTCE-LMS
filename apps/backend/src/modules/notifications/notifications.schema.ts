import { z } from 'zod'

// Response shapes (notificationResponseSchema / notificationListResponseSchema) live in
// @btec-lms/shared — FE consumes the same schema so the two sides can't drift.
export { notificationResponseSchema, notificationListResponseSchema } from '@btec-lms/shared'

export const notificationParamsSchema = z.object({
  id: z.string().cuid(),
})

export const notificationListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export type NotificationParams = z.infer<typeof notificationParamsSchema>
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>
