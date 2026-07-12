import { z } from 'zod'

export const surveyQuestionTypeSchema = z.enum(['RATING', 'TEXT'])

// ─── Question schemas ──────────────────────────────────────────────────────

export const surveyQuestionAdminSchema = z.object({
  id: z.string().cuid(),
  type: surveyQuestionTypeSchema,
  text: z.string(),     // localized
  textEn: z.string(),   // raw
  textTh: z.string().nullable(),
  order: z.number().int(),
})

export const surveyQuestionForUserSchema = z.object({
  id: z.string().cuid(),
  type: surveyQuestionTypeSchema,
  text: z.string(),
  order: z.number().int(),
})

// ─── Survey response schemas (the survey definition itself) ────────────────

export const surveyAdminResponseSchema = z.object({
  id: z.string().cuid(),
  courseId: z.string().cuid(),
  questions: z.array(surveyQuestionAdminSchema),
})

export const surveyForUserResponseSchema = z.object({
  id: z.string().cuid(),
  courseId: z.string().cuid(),
  questions: z.array(surveyQuestionForUserSchema),
  alreadySubmitted: z.boolean(),
})

// ─── Input schemas ─────────────────────────────────────────────────────────

export const createSurveyQuestionInputSchema = z.object({
  type: surveyQuestionTypeSchema,
  textEn: z.string().min(1).max(2000),
  textTh: z.string().max(2000).optional(),
  order: z.number().int().min(0).optional(),
})

export const updateSurveyQuestionInputSchema = z.object({
  type: surveyQuestionTypeSchema.optional(),
  textEn: z.string().min(1).max(2000).optional(),
  textTh: z.string().max(2000).nullable().optional(),
  order: z.number().int().min(0).optional(),
})

// answers: { [questionId]: number (1-5, RATING) | string (TEXT) }
// server validates ทุก RATING question ต้องตอบ, TEXT ไม่บังคับ
export const submitSurveyInputSchema = z.object({
  answers: z.record(
    z.string().cuid(),
    z.union([z.number().int().min(1).max(5), z.string().max(2000)]),
  ),
})

// ─── Response record (a single user's submitted answers) ───────────────────

export const surveyResponseRecordSchema = z.object({
  id: z.string().cuid(),
  surveyId: z.string().cuid(),
  userId: z.string().cuid(),
  answers: z.record(z.string(), z.union([z.number(), z.string()])),
  createdAt: z.string().datetime(),
})

// ─── Types ─────────────────────────────────────────────────────────────────

export type SurveyQuestionType = z.infer<typeof surveyQuestionTypeSchema>
export type SurveyAdminResponse = z.infer<typeof surveyAdminResponseSchema>
export type SurveyForUserResponse = z.infer<typeof surveyForUserResponseSchema>
export type CreateSurveyQuestionInput = z.infer<typeof createSurveyQuestionInputSchema>
export type UpdateSurveyQuestionInput = z.infer<typeof updateSurveyQuestionInputSchema>
export type SubmitSurveyInput = z.infer<typeof submitSurveyInputSchema>
export type SurveyResponseRecord = z.infer<typeof surveyResponseRecordSchema>
