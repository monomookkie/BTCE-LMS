import { z } from 'zod'

// ─── Dashboard Summary ────────────────────────────────────────────────────────

export const dashboardSummarySchema = z.object({
  totalUsers: z.number().int(),
  totalCourses: z.number().int(),           // PUBLISHED courses
  totalEnrollments: z.number().int(),
  completedEnrollments: z.number().int(),
  pendingEnrollments: z.number().int(),     // ASSIGNED + IN_PROGRESS
  certsIssued: z.number().int(),
  certsExpiringSoon: z.number().int(),      // expiresAt ≤ 30 days
  certsExpired: z.number().int(),
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
  completedAt: z.string().nullable(),       // ISO8601
  certNumber: z.string().nullable(),
  certStatus: z.enum(['valid', 'expiring-soon', 'expired', 'revoked']).nullable(),
  certExpiresAt: z.string().nullable(),     // ISO8601
})

export const complianceListSchema = z.object({
  data: z.array(complianceRowSchema),
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
})

export type ComplianceRow = z.infer<typeof complianceRowSchema>
export type ComplianceList = z.infer<typeof complianceListSchema>
