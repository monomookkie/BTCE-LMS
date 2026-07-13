import { z } from 'zod'

const enrollmentStatusSchema = z.enum(['ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED'])

// z.coerce.boolean() ใช้ไม่ได้กับ query string — Boolean("false") === true ใน JS
// (เหมือน pattern isActive ใน users.schema.ts) ต้อง transform เทียบ string ตรงๆ แทน
const booleanQuerySchema = z
  .string()
  .optional()
  .transform((v) => (v === 'true' ? true : v === 'false' ? false : undefined))

export const complianceQuerySchema = z.object({
  courseId: z.string().cuid().optional(),
  status: enrollmentStatusSchema.optional(),
  isMandatory: booleanQuerySchema, // 2C-4
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

// export endpoint ไม่มี pagination — เพิ่ม filter เดียวกัน แต่ไม่มี page/limit
export const complianceExportQuerySchema = z.object({
  courseId: z.string().cuid().optional(),
  status: enrollmentStatusSchema.optional(),
  isMandatory: booleanQuerySchema, // 2C-4
})

export type ComplianceQuery = z.infer<typeof complianceQuerySchema>
export type ComplianceExportQuery = z.infer<typeof complianceExportQuerySchema>
