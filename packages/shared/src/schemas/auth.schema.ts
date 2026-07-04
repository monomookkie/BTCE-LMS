import { z } from 'zod'

export const loginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

// self-registration จำกัดเฉพาะอีเมลองค์กร — exact match เท่านั้น กัน subdomain spoofing
// เช่น user@redcross.or.th.evil.com หรือ user@sub.redcross.or.th ต้องไม่ผ่าน
const REGISTER_ALLOWED_EMAIL_DOMAIN = 'redcross.or.th'

export function getEmailDomain(email: string): string {
  return email.trim().toLowerCase().split('@').pop() ?? ''
}

export function isAllowedRegisterEmailDomain(email: string): boolean {
  return getEmailDomain(email) === REGISTER_ALLOWED_EMAIL_DOMAIN
}

export const registerInputSchema = z.object({
  email: z.string().email().refine(isAllowedRegisterEmailDomain, {
    message: `Email must be a @${REGISTER_ALLOWED_EMAIL_DOMAIN} address`,
  }),
  password: z.string().min(8).max(72),
  name: z.string().min(1).max(100),
  employeeId: z.string().max(50).optional(),
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
