import { z } from 'zod'
import { courseStatusSchema, paginationQuerySchema } from '@btec-lms/shared'

export const courseListQuerySchema = paginationQuerySchema.extend({
  status: courseStatusSchema.optional(),
  category: z.string().max(100).optional(),
  search: z.string().max(200).optional(),
})

export const courseParamsSchema = z.object({ id: z.string().cuid() })

export type CourseListQuery = z.infer<typeof courseListQuerySchema>
