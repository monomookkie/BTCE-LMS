import { z } from 'zod'

export const loginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

export const registerInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(72),
  name: z.string().min(1).max(100),
  employeeId: z.string().max(50).optional(),
  departmentId: z.string().cuid().optional(),
  position: z.string().max(100).optional(),
})

export const changePasswordInputSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(72),
})

export const refreshTokenResponseSchema = z.object({
  message: z.literal('ok'),
})

export type LoginInput = z.infer<typeof loginInputSchema>
export type RegisterInput = z.infer<typeof registerInputSchema>
export type ChangePasswordInput = z.infer<typeof changePasswordInputSchema>
