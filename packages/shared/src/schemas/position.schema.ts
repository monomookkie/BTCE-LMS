import { z } from 'zod'

// public: localized name เท่านั้น — ใช้บนหน้า self-registration (unauthenticated)
export const positionPublicResponseSchema = z.object({
  id: z.string().cuid(),
  name: z.string(),
})

// admin: raw bilingual fields สำหรับหน้า Manage Positions (edit form)
export const positionAdminResponseSchema = z.object({
  id: z.string().cuid(),
  name: z.string(),
  nameEn: z.string(),
  nameTh: z.string().nullable(),
})

export const createPositionInputSchema = z.object({
  nameEn: z.string().trim().min(1).max(100),
  nameTh: z.string().trim().max(100).optional(),
})

export const updatePositionInputSchema = z.object({
  nameEn: z.string().trim().min(1).max(100).optional(),
  nameTh: z.string().trim().max(100).optional(),
})

export type PositionPublicResponse = z.infer<typeof positionPublicResponseSchema>
export type PositionAdminResponse = z.infer<typeof positionAdminResponseSchema>
export type CreatePositionInput = z.infer<typeof createPositionInputSchema>
export type UpdatePositionInput = z.infer<typeof updatePositionInputSchema>
