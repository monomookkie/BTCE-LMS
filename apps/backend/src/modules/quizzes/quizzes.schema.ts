import { z } from 'zod'

export const quizCourseParamsSchema = z.object({
  courseId: z.string().cuid(),
})

export const questionParamsSchema = z.object({
  courseId: z.string().cuid(),
  questionId: z.string().cuid(),
})

export const optionParamsSchema = z.object({
  courseId: z.string().cuid(),
  questionId: z.string().cuid(),
  optionId: z.string().cuid(),
})

export const attemptsQuerySchema = z.object({
  userId: z.string().cuid().optional(),
})
