import { z } from 'zod'

export const surveyCourseParamsSchema = z.object({
  courseId: z.string().cuid(),
})

export const surveyQuestionParamsSchema = z.object({
  courseId: z.string().cuid(),
  questionId: z.string().cuid(),
})

export const surveyResponsesQuerySchema = z.object({
  userId: z.string().cuid().optional(),
})
