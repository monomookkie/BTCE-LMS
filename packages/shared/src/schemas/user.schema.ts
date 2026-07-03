import { z } from 'zod'

export const roleSchema = z.enum(['ADMIN', 'USER'])

export const languageSchema = z.enum(['en', 'th'])

export const userResponseSchema = z.object({
  id: z.string().cuid(),
  employeeId: z.string().nullable(),
  name: z.string(),
  email: z.string().email(),
  role: roleSchema,
  language: languageSchema,
  position: z.string().nullable(),
  avatarKey: z.string().nullable(),
  isActive: z.boolean(),
  lastLoginAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
})

export const updateProfileInputSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  position: z.string().max(100).optional(),
  language: languageSchema.optional(),
})

export const updateUserInputSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  role: roleSchema.optional(),
  position: z.string().max(100).optional(),
  isActive: z.boolean().optional(),
})

export const createUserInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(72),
  name: z.string().min(1).max(100),
  role: roleSchema.optional(),
  employeeId: z.string().max(50).optional(),
  position: z.string().max(100).optional(),
})

export type Role = z.infer<typeof roleSchema>
export type Language = z.infer<typeof languageSchema>
export type UserResponse = z.infer<typeof userResponseSchema>
export type UpdateProfileInput = z.infer<typeof updateProfileInputSchema>
export type UpdateUserInput = z.infer<typeof updateUserInputSchema>
export type CreateUserInput = z.infer<typeof createUserInputSchema>
