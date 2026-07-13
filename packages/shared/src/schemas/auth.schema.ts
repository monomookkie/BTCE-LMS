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

// self-registration เท่านั้น: บังคับ complexity (login/change-password/admin-create
// ยังใช้แค่ min/max เดิม ไม่แตะ) — เพราะ register ไม่มี admin คอยตรวจสอบตัวตนก่อน
export const registerPasswordSchema = z
  .string()
  .min(8)
  .max(72)
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain a special character')

// self-registration: department บังคับกรอก, positionId บังคับ "เลือก" จาก dropdown จริง
// (ต่างจาก admin-create-user ที่ positionId ยัง optional) — ค่า null ที่ถูกต้องคือ
// เลือก "Others" ตั้งใจ (2C-5) ไม่ใช่แค่ไม่ได้กรอก — ต้องส่ง field มาเสมอ ไม่ optional
export const registerInputSchema = z.object({
  email: z.string().email().refine(isAllowedRegisterEmailDomain, {
    message: `Email must be a @${REGISTER_ALLOWED_EMAIL_DOMAIN} address`,
  }),
  password: registerPasswordSchema,
  name: z.string().min(1).max(100),
  department: z.string().trim().min(1).max(100),
  positionId: z.string().cuid().nullable(),
  employeeId: z.string().max(50).optional(),
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
