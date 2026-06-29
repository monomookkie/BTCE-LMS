import { z } from 'zod'

export const complianceQuerySchema = z.object({
  departmentId: z.string().cuid().optional(),
  courseId: z.string().cuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

// export endpoint ไม่มี pagination — เพิ่ม filter เดียวกัน แต่ไม่มี page/limit
export const complianceExportQuerySchema = z.object({
  departmentId: z.string().cuid().optional(),
  courseId: z.string().cuid().optional(),
})

export type ComplianceQuery = z.infer<typeof complianceQuerySchema>
export type ComplianceExportQuery = z.infer<typeof complianceExportQuerySchema>
