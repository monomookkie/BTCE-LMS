import { z } from 'zod'

// ─── Dashboard Summary ────────────────────────────────────────────────────────

export const dashboardSummarySchema = z.object({
  totalUsers: z.number().int(),
  totalCourses: z.number().int(),           // PUBLISHED courses
  totalEnrollments: z.number().int(),
  completedEnrollments: z.number().int(),
  pendingEnrollments: z.number().int(),     // ASSIGNED + IN_PROGRESS
  // overall = mandatory + optional ปนกัน — ไม่ใช่ compliance rate ที่แท้จริง (2C-4)
  // ห้ามใช้ตัวนี้แทน mandatoryComplianceRate บน UI ที่ต้องการรายงาน compliance บังคับเรียน
  overallCompletionRate: z.number().nullable(), // completedEnrollments/totalEnrollments*100, null ถ้า totalEnrollments=0
  // 2C-4: แยกนับ mandatory (POSITION_BASED) vs optional (PUBLIC) — snapshot จาก Enrollment.isMandatory
  mandatoryEnrollments: z.number().int(),
  mandatoryCompleted: z.number().int(),
  // compliance rate ที่แท้จริง — นับเฉพาะ mandatory เท่านั้น (optional สมัครใจ ไม่เรียนก็ไม่ผิด)
  // null ถ้า mandatoryEnrollments=0 (ไม่มีอะไรให้วัด ต่างจาก "วัดแล้วได้ 0%")
  mandatoryComplianceRate: z.number().nullable(),
  optionalEnrollments: z.number().int(),
  optionalCompleted: z.number().int(),
})

export type DashboardSummary = z.infer<typeof dashboardSummarySchema>

// ─── Compliance row ───────────────────────────────────────────────────────────
// PII ขั้นต่ำ — ชื่อ/หลักสูตรเท่านั้น ไม่มี email / employeeId

export const complianceRowSchema = z.object({
  enrollmentId: z.string(),
  userId: z.string(),
  userName: z.string(),
  courseId: z.string(),
  courseTitle: z.string(),                  // localized
  enrollmentStatus: z.enum(['ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED']),
  progress: z.number().int(),
  isMandatory: z.boolean(),                 // 2C-4: snapshot จาก Enrollment.isMandatory
  completedAt: z.string().nullable(),       // ISO8601
})

export const complianceListSchema = z.object({
  data: z.array(complianceRowSchema),
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
})

export type ComplianceRow = z.infer<typeof complianceRowSchema>
export type ComplianceList = z.infer<typeof complianceListSchema>
