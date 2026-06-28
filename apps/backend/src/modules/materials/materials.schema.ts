import { z } from 'zod'

export const materialCourseParamsSchema = z.object({
  courseId: z.string().cuid(),
})

export const materialParamsSchema = z.object({
  courseId: z.string().cuid(),
  materialId: z.string().cuid(),
})

export type MaterialCourseParams = z.infer<typeof materialCourseParamsSchema>
export type MaterialParams = z.infer<typeof materialParamsSchema>
