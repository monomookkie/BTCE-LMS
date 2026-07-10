import { z } from 'zod'

// ─── Option schemas ────────────────────────────────────────────────────────

// admin sees isCorrect (answer key) + raw bilingual fields for editing
export const optionAdminSchema = z.object({
  id: z.string().cuid(),
  text: z.string(),     // localized
  textEn: z.string(),   // raw
  textTh: z.string().nullable(),
  isCorrect: z.boolean(),
})

// USER ไม่เห็น isCorrect เด็ดขาด — field ไม่มีอยู่ในนี้เลย (layer 2 protection)
// USER ก็ไม่ต้องเห็น raw En/Th
export const optionForUserSchema = z.object({
  id: z.string().cuid(),
  text: z.string(),
})

// ─── Question schemas ──────────────────────────────────────────────────────

export const questionAdminSchema = z.object({
  id: z.string().cuid(),
  text: z.string(),     // localized
  textEn: z.string(),   // raw
  textTh: z.string().nullable(),
  order: z.number().int(),
  options: z.array(optionAdminSchema),
})

export const questionForUserSchema = z.object({
  id: z.string().cuid(),
  text: z.string(),
  order: z.number().int(),
  options: z.array(optionForUserSchema),
})

// ─── Quiz response schemas ─────────────────────────────────────────────────

export const quizAdminResponseSchema = z.object({
  id: z.string().cuid(),
  courseId: z.string().cuid(),
  title: z.string(),       // localized
  titleEn: z.string(),     // raw
  titleTh: z.string().nullable(),
  passScore: z.number().int(),
  maxAttempts: z.number().int().nullable(),
  shuffle: z.boolean(),
  questions: z.array(questionAdminSchema),
})

// ใช้กับ /take — Zod serialize strips ทุก field ที่ไม่อยู่ใน schema (layer 3 protection)
export const quizForUserResponseSchema = z.object({
  id: z.string().cuid(),
  courseId: z.string().cuid(),
  title: z.string(),
  passScore: z.number().int(),
  maxAttempts: z.number().int().nullable(),
  questions: z.array(questionForUserSchema),
})

// ─── Input schemas ─────────────────────────────────────────────────────────

export const createQuizInputSchema = z.object({
  titleEn: z.string().min(1).max(200),
  titleTh: z.string().max(200).optional(),
  passScore: z.number().int().min(0).max(100).default(80),
  maxAttempts: z.number().int().positive().nullable().optional(),
  shuffle: z.boolean().default(true),
})

export const updateQuizInputSchema = z.object({
  titleEn: z.string().min(1).max(200).optional(),
  titleTh: z.string().max(200).nullable().optional(),
  passScore: z.number().int().min(0).max(100).optional(),
  maxAttempts: z.number().int().positive().nullable().optional(),
  shuffle: z.boolean().optional(),
})

export const createQuestionInputSchema = z.object({
  textEn: z.string().min(1).max(2000),
  textTh: z.string().max(2000).optional(),
  order: z.number().int().min(0).optional(),
  options: z
    .array(z.object({ textEn: z.string().min(1).max(500), textTh: z.string().max(500).optional(), isCorrect: z.boolean() }))
    .min(2)
    .max(10)
    .refine((options) => options.some((o) => o.isCorrect), {
      message: 'At least one option must be marked correct',
    }),
})

export const updateQuestionInputSchema = z.object({
  textEn: z.string().min(1).max(2000).optional(),
  textTh: z.string().max(2000).nullable().optional(),
  order: z.number().int().min(0).optional(),
})

export const addOptionInputSchema = z.object({
  textEn: z.string().min(1).max(500),
  textTh: z.string().max(500).optional(),
  isCorrect: z.boolean(),
})

export const updateOptionInputSchema = z.object({
  textEn: z.string().min(1).max(500).optional(),
  textTh: z.string().max(500).nullable().optional(),
  isCorrect: z.boolean().optional(),
})

// score ไม่รับจาก client เด็ดขาด — server คำนวณเอง
export const submitQuizInputSchema = z.object({
  answers: z.record(z.string().cuid(), z.string().cuid()),
})

// ─── Attempt response ──────────────────────────────────────────────────────

export const quizAttemptResponseSchema = z.object({
  id: z.string().cuid(),
  quizId: z.string().cuid(),
  userId: z.string().cuid(),
  score: z.number().int(),
  passed: z.boolean(),
  answers: z.record(z.string(), z.string()),
  createdAt: z.string().datetime(),
})

// ─── Types ─────────────────────────────────────────────────────────────────

export type QuizAdminResponse = z.infer<typeof quizAdminResponseSchema>
export type QuizForUserResponse = z.infer<typeof quizForUserResponseSchema>
export type CreateQuizInput = z.infer<typeof createQuizInputSchema>
export type UpdateQuizInput = z.infer<typeof updateQuizInputSchema>
export type CreateQuestionInput = z.infer<typeof createQuestionInputSchema>
export type UpdateQuestionInput = z.infer<typeof updateQuestionInputSchema>
export type AddOptionInput = z.infer<typeof addOptionInputSchema>
export type UpdateOptionInput = z.infer<typeof updateOptionInputSchema>
export type SubmitQuizInput = z.infer<typeof submitQuizInputSchema>
export type QuizAttemptResponse = z.infer<typeof quizAttemptResponseSchema>
